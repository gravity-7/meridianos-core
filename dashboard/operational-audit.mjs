import { randomUUID } from 'node:crypto';

const clean = (value, max = 1000) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const parse = (value) => { try { return JSON.parse(value); } catch { return null; } };
const project = (value) => value == null ? '' : String(value);

function publicEvent(row) {
  if (!row) return null;
  return { ...row, project_id: row.project_id || null, before: parse(row.before_json), after: parse(row.after_json), metadata: parse(row.metadata_json) ?? {} };
}

export function recordOperationalAudit(db, input) {
  const id = input.id || randomUUID(); const now = input.now || new Date().toISOString();
  db.prepare(`INSERT INTO operational_audit_events(id,tenant_id,project_id,event_type,actor_id,actor_role,target_type,target_id,before_json,after_json,reason,result,correlation_id,metadata_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, input.tenantId, project(input.projectId), clean(input.eventType, 100), clean(input.actor?.id || 'system', 200), input.actor?.role ?? null,
    clean(input.targetType, 100), clean(input.targetId, 500), input.before == null ? null : JSON.stringify(input.before), input.after == null ? null : JSON.stringify(input.after),
    clean(input.reason, 1000) || null, clean(input.result, 50) || 'recorded', clean(input.correlationId, 200) || randomUUID(), JSON.stringify(input.metadata ?? {}), now,
  );
  return getOperationalAudit(db, id, { tenantId: input.tenantId, projectId: input.projectId });
}

export function getOperationalAudit(db, id, { tenantId, projectId = null } = {}) {
  const clauses = ['id=?','tenant_id=?']; const params = [id, tenantId];
  if (projectId != null) { clauses.push('project_id=?'); params.push(project(projectId)); }
  return publicEvent(db.prepare(`SELECT * FROM operational_audit_events WHERE ${clauses.join(' AND ')}`).get(...params));
}

export function pruneOperationalAuditEvents(db, { tenantId, projectId = null, before } = {}) {
  const clauses = ['tenant_id=?','created_at<?']; const params = [tenantId, before];
  if (projectId != null) { clauses.push('project_id=?'); params.push(project(projectId)); }
  return db.prepare(`DELETE FROM operational_audit_events WHERE ${clauses.join(' AND ')}`).run(...params).changes;
}
