import { createHash, randomUUID } from 'node:crypto';

const SEVERITY = Object.freeze({ info: 0, warning: 1, critical: 2 });
const ACTIONS = new Set(['acknowledge', 'resolve', 'reopen']);

export class AlertStoreError extends Error {
  constructor(code, message, httpStatus = 400, details = {}) {
    super(message); this.name = 'AlertStoreError'; this.code = code; this.httpStatus = httpStatus; this.details = details;
  }
}

export const normalizeAlertSeverity = (value) => value === 'warn' ? 'warning' : (SEVERITY[value] == null ? 'info' : value);
const projectKey = (value) => value == null ? '' : String(value);
const clean = (value, max = 2000) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const json = (value, fallback) => { try { return JSON.parse(value); } catch { return fallback; } };
const fingerprintFor = (candidate, context) => candidate.fingerprint || createHash('sha256').update(JSON.stringify([
  context.tenantId, context.projectId ?? null, candidate.source, candidate.ruleId, candidate.taskId ?? null, candidate.runId ?? null,
])).digest('base64url');

function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const value = fn(); db.exec('COMMIT'); return value; }
  catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
}

function occurrence(row) {
  if (!row) return null;
  return { ...row, project_id: row.project_id || null, related_entities: json(row.related_entities_json, []) };
}

function eventRecord(row) {
  if (!row) return null;
  return { ...row, project_id: row.project_id || null, metadata: json(row.metadata_json, {}) };
}

function appendEvent(db, alert, eventType, context, changes = {}) {
  const id = randomUUID();
  const actor = context.actor ?? { id: 'system', type: 'system', role: null };
  db.prepare(`INSERT INTO alert_events(
    id,alert_id,tenant_id,project_id,event_type,actor_type,actor_id,actor_role,
    from_status,to_status,from_severity,to_severity,reason,target_type,target_id,result,
    correlation_id,metadata_json,created_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, alert.id, alert.tenant_id, projectKey(alert.project_id), eventType,
    actor.type === 'user' ? 'user' : 'system', clean(actor.id || 'system', 200), actor.role ?? null,
    changes.fromStatus ?? alert.status, changes.toStatus ?? alert.status,
    changes.fromSeverity ?? alert.severity, changes.toSeverity ?? alert.severity,
    clean(changes.reason, 1000) || null, changes.targetType ?? (alert.run_id ? 'run' : alert.task_id ? 'task' : 'alert'),
    changes.targetId ?? alert.run_id ?? alert.task_id ?? alert.id, changes.result ?? 'recorded',
    clean(context.correlationId || randomUUID(), 200), JSON.stringify(changes.metadata ?? {}), context.now ?? new Date().toISOString(),
  );
  return eventRecord(db.prepare('SELECT * FROM alert_events WHERE id = ?').get(id));
}

export function upsertAlertOccurrence(db, candidate, context) {
  if (!context?.tenantId) throw new AlertStoreError('ALERT_SCOPE_REQUIRED', 'tenant scope is required', 403);
  const title = clean(candidate.title, 200);
  const summary = clean(candidate.summary ?? candidate.message, 2000);
  if (!title || !summary) throw new AlertStoreError('ALERT_INVALID', 'alert title and safe summary are required');
  const now = context.now ?? new Date().toISOString();
  const project = projectKey(context.projectId);
  const fingerprint = fingerprintFor(candidate, context);
  const nextSeverity = normalizeAlertSeverity(candidate.severity);

  return transaction(db, () => {
    let current = occurrence(db.prepare(`SELECT * FROM alert_occurrences
      WHERE tenant_id=? AND project_id=? AND fingerprint=? AND status IN ('open','acknowledged')`).get(context.tenantId, project, fingerprint));
    if (!current) {
      const previous = occurrence(db.prepare(`SELECT * FROM alert_occurrences
        WHERE tenant_id=? AND project_id=? AND fingerprint=? AND status='resolved' ORDER BY resolved_at DESC LIMIT 1`).get(context.tenantId, project, fingerprint));
      const id = candidate.id || randomUUID();
      db.prepare(`INSERT INTO alert_occurrences(
        id,tenant_id,project_id,source,rule_id,fingerprint,severity,status,title,summary,task_id,run_id,gateway_event_id,
        related_entities_json,previous_occurrence_id,first_seen_at,last_seen_at,occurrence_count,notification_suppression_reason,version,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, context.tenantId, project, clean(candidate.source, 100) || 'unknown', clean(candidate.ruleId, 200) || 'unknown', fingerprint,
        nextSeverity, 'open', title, summary, candidate.taskId ?? null, candidate.runId ?? null, candidate.gatewayEventId ?? null,
        JSON.stringify(Array.isArray(candidate.relatedEntities) ? candidate.relatedEntities : []), previous?.id ?? null,
        now, now, 1, clean(candidate.notificationSuppressionReason, 1000) || null, 1, now, now,
      );
      current = occurrence(db.prepare('SELECT * FROM alert_occurrences WHERE id=?').get(id));
      const event = appendEvent(db, current, 'created', { ...context, now }, { fromStatus: null, fromSeverity: null });
      db.prepare('UPDATE alert_occurrences SET latest_event_id=? WHERE id=?').run(event.id, id);
      return { occurrence: getAlertOccurrence(db, id, { tenantId: context.tenantId, projectId: context.projectId }), event };
    }

    const escalated = SEVERITY[nextSeverity] > SEVERITY[current.severity];
    let status = current.status;
    let suppressionReason = current.notification_suppression_reason;
    let suppressionUntil = current.notification_suppressed_until;
    let eventType = 'observed';
    if (current.status === 'acknowledged' && !escalated) {
      eventType = 'notification_suppressed';
      suppressionReason = 'duplicate suppressed while acknowledged';
      suppressionUntil = null;
    } else if (candidate.notificationSuppressionReason && !escalated) {
      eventType = 'notification_suppressed';
      suppressionReason = clean(candidate.notificationSuppressionReason, 1000);
      suppressionUntil = null;
    } else if (escalated) {
      eventType = 'escalated'; status = 'open'; suppressionReason = null; suppressionUntil = null;
    }
    const severity = escalated ? nextSeverity : current.severity;
    const version = current.version + 1;
    db.prepare(`UPDATE alert_occurrences SET severity=?,status=?,title=?,summary=?,last_seen_at=?,occurrence_count=occurrence_count+1,
      notification_suppressed_until=?,notification_suppression_reason=?,version=?,updated_at=? WHERE id=?`).run(
      severity, status, title, summary, now, suppressionUntil, suppressionReason, version, now, current.id,
    );
    const updated = occurrence(db.prepare('SELECT * FROM alert_occurrences WHERE id=?').get(current.id));
    const event = appendEvent(db, updated, eventType, { ...context, now }, {
      fromStatus: current.status, toStatus: status, fromSeverity: current.severity, toSeverity: severity,
      reason: suppressionReason, metadata: { occurrenceCount: updated.occurrence_count },
    });
    db.prepare('UPDATE alert_occurrences SET latest_event_id=? WHERE id=?').run(event.id, current.id);
    return { occurrence: getAlertOccurrence(db, current.id, { tenantId: context.tenantId, projectId: context.projectId }), event };
  });
}

export function transitionAlertOccurrence(db, alertId, action, context) {
  if (!ACTIONS.has(action?.type)) throw new AlertStoreError('ALERT_ACTION_INVALID', 'unsupported alert lifecycle action');
  const reason = clean(action.reason, 1000);
  const role = context?.actor?.role;
  const result = transaction(db, () => {
    const current = getAlertOccurrence(db, alertId, context);
    if (!current) throw new AlertStoreError('ALERT_NOT_FOUND', 'alert was not found in the authorized scope', 404);
    if (!reason) {
      const event = appendEvent(db, current, action.type, context, { result: 'denied', metadata: { code: 'ALERT_REASON_REQUIRED' } });
      db.prepare('UPDATE alert_occurrences SET latest_event_id=? WHERE id=?').run(event.id, current.id);
      return { error: new AlertStoreError('ALERT_REASON_REQUIRED', 'a reason is required') };
    }
    if (!['operator','admin'].includes(role)) {
      const event = appendEvent(db, current, action.type, context, { reason, result: 'denied', metadata: { code: 'ALERT_FORBIDDEN', actorRole: role ?? null } });
      db.prepare('UPDATE alert_occurrences SET latest_event_id=? WHERE id=?').run(event.id, current.id);
      return { error: new AlertStoreError('ALERT_FORBIDDEN', 'operator or administrator authority is required', 403) };
    }
    if (action.expectedVersion !== current.version) {
      const event = appendEvent(db, current, action.type, context, { reason, result: 'denied', metadata: { code: 'ALERT_VERSION_CONFLICT', expectedVersion: action.expectedVersion, currentVersion: current.version } });
      db.prepare('UPDATE alert_occurrences SET latest_event_id=? WHERE id=?').run(event.id, current.id);
      return { error: new AlertStoreError('ALERT_VERSION_CONFLICT', 'the alert changed after this view loaded', 409, { occurrence: current }) };
    }
    const allowed = action.type === 'acknowledge' ? current.status === 'open'
      : action.type === 'resolve' ? ['open','acknowledged'].includes(current.status)
        : current.status === 'acknowledged';
    if (!allowed) {
      const event = appendEvent(db, current, action.type, context, { reason, result: 'denied', metadata: { code: 'ALERT_STATE_CONFLICT' } });
      db.prepare('UPDATE alert_occurrences SET latest_event_id=? WHERE id=?').run(event.id, current.id);
      return { error: new AlertStoreError('ALERT_STATE_CONFLICT', `cannot ${action.type} an alert in ${current.status}`, 409, { occurrence: current }) };
    }
    const now = context.now ?? new Date().toISOString();
    const nextStatus = action.type === 'acknowledge' ? 'acknowledged' : action.type === 'resolve' ? 'resolved' : 'open';
    const version = current.version + 1;
    db.prepare(`UPDATE alert_occurrences SET status=?,version=?,updated_at=?,
      acknowledged_at=?,acknowledged_by=?,acknowledgement_reason=?,
      resolved_at=?,resolved_by=?,resolution_reason=?,
      notification_suppression_reason=? WHERE id=?`).run(
      nextStatus, version, now,
      action.type === 'acknowledge' ? now : current.acknowledged_at,
      action.type === 'acknowledge' ? context.actor.id : current.acknowledged_by,
      action.type === 'acknowledge' ? reason : current.acknowledgement_reason,
      action.type === 'resolve' ? now : null,
      action.type === 'resolve' ? context.actor.id : null,
      action.type === 'resolve' ? reason : null,
      action.type === 'acknowledge' ? 'duplicate suppressed while acknowledged' : null,
      current.id,
    );
    const updated = occurrence(db.prepare('SELECT * FROM alert_occurrences WHERE id=?').get(current.id));
    const eventType = action.type === 'acknowledge' ? 'acknowledged' : action.type === 'resolve' ? 'resolved' : 'reopened';
    const event = appendEvent(db, updated, eventType, { ...context, now }, { fromStatus: current.status, toStatus: nextStatus, reason, result: 'succeeded' });
    db.prepare('UPDATE alert_occurrences SET latest_event_id=? WHERE id=?').run(event.id, current.id);
    return { occurrence: getAlertOccurrence(db, current.id, context), event };
  });
  if (result.error) throw result.error;
  return result;
}

export function getAlertOccurrence(db, alertId, { tenantId, projectId } = {}) {
  if (!tenantId) return null;
  const clauses = ['id=?', 'tenant_id=?']; const params = [alertId, tenantId];
  if (projectId != null) { clauses.push('project_id=?'); params.push(projectKey(projectId)); }
  return occurrence(db.prepare(`SELECT * FROM alert_occurrences WHERE ${clauses.join(' AND ')}`).get(...params));
}

const alertPageRank = (severity) => severity === 'critical' ? 0 : severity === 'warning' ? 1 : 2;
const alertCursorFingerprint = ({ tenantId, projectId, status, severity }) => createHash('sha256').update(JSON.stringify([tenantId, projectId ?? null, status ?? null, severity ? normalizeAlertSeverity(severity) : null])).digest('base64url').slice(0, 16);
const decodeAlertCursor = (value) => {
  try { return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); }
  catch { throw new AlertStoreError('INVALID_CURSOR', 'alert cursor is malformed'); }
};

export function queryAlertOccurrences(db, { tenantId, projectId = null, status = null, severity = null, cursor = null, limit = 50 } = {}) {
  const clauses = ['tenant_id=?']; const params = [tenantId];
  if (projectId != null) { clauses.push('project_id=?'); params.push(projectKey(projectId)); }
  if (status) { clauses.push('status=?'); params.push(status); }
  if (severity) { clauses.push('severity=?'); params.push(normalizeAlertSeverity(severity)); }
  const fingerprint = alertCursorFingerprint({ tenantId, projectId, status, severity });
  const decoded = cursor ? decodeAlertCursor(cursor) : null;
  if (decoded && (decoded.v !== 1 || decoded.f !== fingerprint || !Number.isInteger(decoded.r) || typeof decoded.t !== 'string' || typeof decoded.i !== 'string' || typeof decoded.s !== 'string')) {
    throw new AlertStoreError('INVALID_CURSOR', 'alert cursor does not match the authorized filters');
  }
  const snapshot = decoded?.s ?? db.prepare(`SELECT MAX(updated_at) AS value FROM alert_occurrences WHERE ${clauses.join(' AND ')}`).get(...params)?.value ?? new Date().toISOString();
  clauses.push('updated_at<=?'); params.push(snapshot);
  if (decoded) {
    clauses.push(`(CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END > ? OR
      (CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END = ? AND last_seen_at < ?) OR
      (CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END = ? AND last_seen_at = ? AND id < ?))`);
    params.push(decoded.r, decoded.r, decoded.t, decoded.r, decoded.t, decoded.i);
  }
  const boundedLimit = Math.max(1, Math.min(200, Number(limit) || 50)); params.push(boundedLimit + 1);
  const rows = db.prepare(`SELECT * FROM alert_occurrences WHERE ${clauses.join(' AND ')}
    ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, last_seen_at DESC, id DESC LIMIT ?`).all(...params);
  const hasMore = rows.length > boundedLimit; const pageRows = rows.slice(0, boundedLimit); const last = pageRows.at(-1);
  const nextCursor = hasMore ? Buffer.from(JSON.stringify({ v: 1, f: fingerprint, s: snapshot, r: alertPageRank(last.severity), t: last.last_seen_at, i: last.id })).toString('base64url') : null;
  const page = { nextCursor, snapshot, limit: boundedLimit };
  return { items: pageRows.map(occurrence), ...page, page };
}

export function listAlertOccurrences(db, options = {}) {
  return queryAlertOccurrences(db, options).items;
}

export function listAlertEvents(db, alertId, { tenantId = null, limit = 200 } = {}) {
  const clauses = ['alert_id=?']; const params = [alertId];
  if (tenantId) { clauses.push('tenant_id=?'); params.push(tenantId); }
  params.push(Math.max(1, Math.min(200, Number(limit) || 200)));
  return db.prepare(`SELECT * FROM alert_events WHERE ${clauses.join(' AND ')} ORDER BY created_at,id LIMIT ?`).all(...params).map(eventRecord);
}

export function getAlertEvent(db, eventId, { tenantId, projectId = null } = {}) {
  const clauses = ['id=?','tenant_id=?']; const params = [eventId, tenantId];
  if (projectId != null) { clauses.push('project_id=?'); params.push(projectKey(projectId)); }
  return eventRecord(db.prepare(`SELECT * FROM alert_events WHERE ${clauses.join(' AND ')}`).get(...params));
}

export function recordAlertEvent(db, alertId, eventType, context, changes = {}) {
  return transaction(db, () => {
    const alert = getAlertOccurrence(db, alertId, context);
    if (!alert) throw new AlertStoreError('ALERT_NOT_FOUND', 'alert was not found in the authorized scope', 404);
    const event = appendEvent(db, alert, eventType, context, changes);
    db.prepare('UPDATE alert_occurrences SET latest_event_id=? WHERE id=?').run(event.id, alert.id);
    return event;
  });
}

export function pruneAlertOccurrences(db, { tenantId, projectId = null, before } = {}) {
  const clauses = ["tenant_id=?", "status='resolved'", 'resolved_at < ?']; const params = [tenantId, before];
  if (projectId != null) { clauses.push('project_id=?'); params.push(projectKey(projectId)); }
  return db.prepare(`DELETE FROM alert_occurrences WHERE ${clauses.join(' AND ')}`).run(...params).changes;
}

export function pruneOperationalEvidence(db, { tenantId, projectId = null, now = Date.now(), alertRetentionDays = 365, auditRetentionDays = 365 } = {}) {
  const alertBefore = new Date(now - alertRetentionDays * 86400000).toISOString();
  const auditBefore = new Date(now - auditRetentionDays * 86400000).toISOString();
  const alerts = pruneAlertOccurrences(db, { tenantId, projectId, before: alertBefore });
  const clauses = ['tenant_id=?','created_at<?']; const params = [tenantId, auditBefore];
  if (projectId != null) { clauses.push('project_id=?'); params.push(projectKey(projectId)); }
  const auditEvents = db.prepare(`DELETE FROM operational_audit_events WHERE ${clauses.join(' AND ')}`).run(...params).changes;
  return { alerts, auditEvents, alertBefore, auditBefore };
}
