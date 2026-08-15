import { queryRuns, queryRunEvidence } from '../runlog.mjs';
import { createHash } from 'node:crypto';
import { getRecoveryEligibility } from './operational-recovery.mjs';
import { listAlertOccurrences } from './operational-alert-store.mjs';
import { scopeQuery } from './operational-scope.mjs';

const parseJson = (value, fallback = []) => { try { return JSON.parse(value ?? '') ?? fallback; } catch { return fallback; } };
const projectForTask = (id) => String(id || '').includes('/') ? String(id).split('/')[0] : null;
const scopedHref = (pathname, scope) => `${pathname}?${scopeQuery(scope)}`;

function publicTask(row, scope) {
  if (!row) return null;
  return {
    id: row.id, title: row.title, type: row.type, status: row.status, owner: row.owner,
    lane: row.lane, priority: row.priority, note: row.note, projectId: projectForTask(row.id),
    lease: row.lease_owner ? { owner: row.lease_owner, session: row.lease_session, acquiredAt: row.lease_acquired, expiresAt: row.lease_expires } : null,
    riskTags: parseJson(row.risk_tags), dependencies: parseJson(row.depends_on), createdAt: row.created_at, updatedAt: row.updated_at,
    drilldown: { entityType: 'task', entityId: row.id, label: `Open task ${row.id}`, href: scopedHref(`/app/operations/tasks/${encodeURIComponent(row.id)}`, scope) },
  };
}

function taskInScope(task, scope) {
  return Boolean(task) && (!scope.projectId || projectForTask(task.id) === scope.projectId);
}

function ledgerRows(ledger, scope, { taskId = null, runId = null } = {}) {
  const clauses = ['tenant=?', 'ts>=?', 'ts<?'];
  const params = [scope.tenantId, scope.from, scope.to];
  if (scope.projectId) { clauses.push('project_id=?'); params.push(scope.projectId); }
  if (scope.provider) { clauses.push('provider=?'); params.push(scope.provider); }
  if (taskId) { clauses.push('task=?'); params.push(taskId); }
  if (runId) { clauses.push('run_id=?'); params.push(runId); }
  return ledger.prepare(`SELECT id,ts,provider,model,agent,task,run_id,upstream_status,latency_ms,input_tokens,output_tokens,total_tokens,cost_usd,enforcement_decision
    FROM token_events WHERE ${clauses.join(' AND ')} ORDER BY ts,id`).all(...params);
}

function attribution(rows) {
  return {
    requests: rows.length,
    inputTokens: rows.reduce((sum, row) => sum + (row.input_tokens ?? 0), 0),
    outputTokens: rows.reduce((sum, row) => sum + (row.output_tokens ?? 0), 0),
    totalTokens: rows.reduce((sum, row) => sum + (row.total_tokens ?? 0), 0),
    costUsd: rows.reduce((sum, row) => sum + (row.cost_usd ?? 0), 0),
    unknownCostEvents: rows.filter((row) => row.cost_usd == null).length,
  };
}

function relatedAlerts(db, scope, predicate) {
  return listAlertOccurrences(db, { tenantId: scope.tenantId, projectId: scope.projectId, limit: 200 })
    .filter(predicate)
    .map((alert) => ({
      id: alert.id, severity: alert.severity, status: alert.status, title: alert.title,
      drilldown: { entityType: 'alert', entityId: alert.id, label: `Open alert ${alert.title}`, href: scopedHref(`/app/observability/alerts/${encodeURIComponent(alert.id)}`, scope) },
    }));
}

const taskCursorFingerprint = (scope, status) => createHash('sha256').update(JSON.stringify([scope.tenantId, scope.projectId ?? null, status ?? null])).digest('base64url').slice(0, 16);
const decodeTaskCursor = (value) => {
  try { return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); }
  catch { throw Object.assign(new Error('task cursor is malformed'), { code: 'INVALID_CURSOR', httpStatus: 400 }); }
};

export function listOperationalTasks({ db, scope, status = null, cursor = null, limit = 200 } = {}) {
  const params = [];
  const clauses = [];
  if (scope.projectId) { clauses.push('id LIKE ?'); params.push(`${scope.projectId}/%`); }
  if (status) { clauses.push('status=?'); params.push(status); }
  const fingerprint = taskCursorFingerprint(scope, status); const decoded = cursor ? decodeTaskCursor(cursor) : null;
  if (decoded && (decoded.v !== 1 || decoded.f !== fingerprint || typeof decoded.s !== 'string' || !Number.isFinite(decoded.p) || typeof decoded.i !== 'string')) throw Object.assign(new Error('task cursor does not match the authorized filters'), { code: 'INVALID_CURSOR', httpStatus: 400 });
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const snapshot = decoded?.s ?? db.prepare(`SELECT MAX(updated_at) AS value FROM tasks ${where}`).get(...params)?.value ?? new Date().toISOString();
  clauses.push('updated_at<=?'); params.push(snapshot);
  if (decoded) { clauses.push('(COALESCE(priority,0)>? OR (COALESCE(priority,0)=? AND id>?))'); params.push(decoded.p, decoded.p, decoded.i); }
  const boundedLimit = Math.max(1, Math.min(200, Number(limit) || 50)); params.push(boundedLimit + 1);
  const rows = db.prepare(`SELECT * FROM tasks WHERE ${clauses.join(' AND ')} ORDER BY COALESCE(priority,0),id LIMIT ?`).all(...params);
  const hasMore = rows.length > boundedLimit; const pageRows = rows.slice(0, boundedLimit); const last = pageRows.at(-1);
  const nextCursor = hasMore ? Buffer.from(JSON.stringify({ v: 1, f: fingerprint, s: snapshot, p: Number(last.priority) || 0, i: last.id })).toString('base64url') : null;
  const page = { nextCursor, snapshot, limit: boundedLimit };
  return { items: pageRows.map((row) => publicTask(row, scope)), ...page, page };
}

export function getOperationalTask({ db, ledger, config, scope, taskId, actor } = {}) {
  const row = db.prepare('SELECT * FROM tasks WHERE id=?').get(taskId);
  if (!taskInScope(row, scope)) return null;
  const runs = queryRuns({ config, scope, filters: { task: taskId }, limit: 200 }).items.map((run) => ({
    ...run,
    drilldown: { entityType: 'run', entityId: run.run_id, label: `Open run ${run.run_id}`, href: scopedHref(`/app/operations/runs/${encodeURIComponent(run.run_id)}`, scope) },
  }));
  const history = db.prepare('SELECT seq,ts,from_state,to_state,actor,op,note FROM history WHERE task_id=? ORDER BY seq').all(taskId);
  const cost = attribution(ledgerRows(ledger, scope, { taskId }));
  return {
    task: publicTask(row, scope), runs, history, cost: { spend: cost.costUsd, currency: 'USD', ...cost },
    alerts: relatedAlerts(db, scope, (alert) => alert.task_id === taskId),
    recovery: runs[0] ? getRecoveryEligibility({ run: runs[0], task: row, actor }) : null,
    drilldown: { entityType: 'task', entityId: row.id, href: scopedHref(`/app/operations/tasks/${encodeURIComponent(row.id)}`, scope) },
    retention: { earliestAvailable: runs.at(-1)?.ts ?? null, disclosure: runs.length ? 'Run evidence is available from the earliest timestamp shown.' : 'No retained run evidence is available for this task.' },
  };
}

export function getOperationalRun({ db, ledger, config, scope, runId, actor, cursor = null, limit = 50 } = {}) {
  const page = queryRuns({ config, scope, filters: { runId }, limit: 1 });
  const run = page.items[0];
  if (!run) return null;
  const task = run.task ? db.prepare('SELECT * FROM tasks WHERE id=?').get(run.task) : null;
  if (task && !taskInScope(task, scope)) return null;
  const rows = ledgerRows(ledger, scope, { runId });
  const recoveryRows = db.prepare('SELECT idempotency_key,correlation_id,actor_id,actor_role,reason,result_json,created_at FROM operational_recovery_requests WHERE run_id=? ORDER BY created_at').all(runId)
    .map(({ result_json: _result, ...item }) => {
      const audit = db.prepare("SELECT id,result,created_at FROM operational_audit_events WHERE tenant_id=? AND target_type='run' AND target_id=? AND correlation_id=? AND event_type='retry.outcome' ORDER BY created_at DESC LIMIT 1").get(scope.tenantId, runId, item.correlation_id);
      return { ...item, result: audit?.result ?? 'unknown', audit: audit ? { entityType: 'audit', entityId: audit.id, href: scopedHref(`/app/observability/audit/${encodeURIComponent(audit.id)}`, scope) } : null };
    });
  const evidence = queryRunEvidence({ config, scope, runId, cursor, limit });
  const taskHistory = run.task ? db.prepare('SELECT seq,ts,from_state,to_state,actor,op,note FROM history WHERE task_id=? ORDER BY seq').all(run.task) : [];
  return {
    run,
    task: publicTask(task, scope),
    timeline: [
      ...taskHistory.map((item) => ({ at: item.ts, type: `task.${item.op}`, summary: `${item.from_state ?? 'none'} → ${item.to_state ?? 'unchanged'}`, auditId: `task-history:${item.seq}` })),
      ...rows.map((item) => ({ at: item.ts, type: 'gateway.request', summary: `${item.provider ?? 'unknown'} / ${item.model ?? 'unknown'}: ${item.enforcement_decision}`, auditId: item.id })),
    ].sort((a, b) => a.at.localeCompare(b.at)),
    evidence,
    attribution: attribution(rows),
    checks: rows.map((item) => ({ id: item.id, status: item.enforcement_decision === 'deny' || Number(item.upstream_status) >= 400 ? 'failed' : 'passed', upstreamStatus: item.upstream_status, latencyMs: item.latency_ms })),
    retryHistory: recoveryRows,
    alerts: relatedAlerts(db, scope, (alert) => alert.run_id === runId),
    recovery: getRecoveryEligibility({ run, task, actor }),
    drilldown: { entityType: 'run', entityId: runId, href: scopedHref(`/app/operations/runs/${encodeURIComponent(runId)}`, scope) },
    retention: { earliestAvailable: evidence.items[0]?.ts ?? null, disclosure: evidence.items.length ? 'Retained evidence available for this run; legacy fields may be unavailable.' : 'Detailed logs are not retained for this run.' },
  };
}
