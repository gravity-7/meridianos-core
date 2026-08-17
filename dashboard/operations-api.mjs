import { randomUUID } from 'node:crypto';
import { queryRuns } from '../runlog.mjs';
import { listAlertOccurrences, queryAlertOccurrences, getAlertOccurrence, listAlertEvents, getAlertEvent, transitionAlertOccurrence } from './operational-alert-store.mjs';
import { listOperationalTasks, getOperationalTask, getOperationalRun } from './operational-runs.mjs';
import { queryGatewayMetrics, queryUsageMetrics, queryCostMetrics, queryUsageRecords, operationalExportRows } from './operational-analytics.mjs';
import { retryOperationalRun } from './operational-recovery.mjs';
import { getOperationalAudit } from './operational-audit.mjs';
import { publicOperationalScope, scopeQuery } from './operational-scope.mjs';
import { buildSearchResults } from './search.mjs';
import { resolveAllProviders } from '../providers.mjs';
import { recordUxfEvent } from './uxf-telemetry.mjs';

export class OperationsApiError extends Error {
  constructor(code, message, httpStatus = 400, details = null) { super(message); this.name = 'OperationsApiError'; this.code = code; this.httpStatus = httpStatus; this.details = details; }
}

const safeId = (raw) => {
  try {
    const value = decodeURIComponent(raw);
    if (!value || value === '.' || value === '..' || value.includes('\\') || value.includes('\0')) throw new Error('unsafe');
    return value;
  } catch { throw new OperationsApiError('INVALID_ENTITY_ID', 'The entity identifier is malformed.', 400); }
};
const query = (scope) => scopeQuery(scope).toString();
const href = (path, scope) => `${path}?${query(scope)}`;
const readLimit = (url, fallback = 50) => Math.max(1, Math.min(200, Number(url.searchParams.get('limit')) || fallback));

function attentionItem(alert, scope) {
  const affected = alert.run_id ?? alert.task_id ?? alert.gateway_event_id ?? alert.id;
  return {
    id: alert.id, severity: alert.severity, status: alert.status, title: alert.title, summary: alert.summary,
    affectedEntity: affected, firstSeenAt: alert.first_seen_at, lastSeenAt: alert.last_seen_at, occurrenceCount: alert.occurrence_count,
    drilldown: { entityType: 'alert', entityId: alert.id, label: `Investigate ${alert.title}`, href: href(`/app/observability/alerts/${encodeURIComponent(alert.id)}`, scope) },
  };
}

function overviewModel({ db, ledger, config, scope, policy }) {
  const alerts = listAlertOccurrences(db, { tenantId: scope.tenantId, projectId: scope.projectId, limit: 200 })
    .filter((alert) => alert.status === 'open')
    .map((alert) => attentionItem(alert, scope));
  const taskParams = []; const taskScope = scope.projectId ? 'WHERE id LIKE ?' : '';
  if (scope.projectId) taskParams.push(`${scope.projectId}/%`);
  const tasks = db.prepare(`SELECT id,status,lease_owner,lease_expires FROM tasks ${taskScope}`).all(...taskParams);
  const failedRuns = queryRuns({ config, scope, filters: { state: 'failed' }, limit: 200 }).items;
  const gateway = queryGatewayMetrics(ledger, scope);
  const usage = queryUsageMetrics(ledger, scope);
  const cost = queryCostMetrics(ledger, scope, { monthlyLimit: policy?.analytics?.budget?.monthlyLimit ?? 0 });
  const now = new Date().toISOString();
  return {
    attention: alerts,
    attentionSummary: alerts.length ? `${alerts.length} unacknowledged condition${alerts.length === 1 ? '' : 's'} require attention.` : 'No current attention is required.',
    health: {
      state: gateway.summary.errors ? 'degraded' : gateway.summary.requests ? 'healthy' : 'empty',
      label: gateway.summary.errors ? 'Gateway requests need review' : gateway.summary.requests ? 'Gateway healthy in selected scope' : 'No gateway requests in selected scope',
      requests: gateway.summary.requests, errors: gateway.summary.errors, errorRate: gateway.summary.errorRate,
      freshAsOf: gateway.freshAsOf, drilldown: { entityType: 'gateway', label: 'Open gateway evidence', href: href('/app/observability/gateway', scope) },
    },
    work: {
      activeAgents: new Set(tasks.filter((task) => task.lease_owner && (!task.lease_expires || task.lease_expires > now)).map((task) => task.lease_owner)).size,
      queuedTasks: tasks.filter((task) => ['approved','ready-for-impl','ready-for-review','changes-requested'].includes(task.status)).length,
      blockedTasks: tasks.filter((task) => task.status === 'blocked').length,
      failedRuns: failedRuns.length,
      drilldowns: {
        tasks: { entityType: 'task-list', label: 'Open task operations', href: href('/app/operations/tasks', scope) },
        runs: { entityType: 'run-list', label: 'Open failed runs', href: `${href('/app/operations/runs', scope)}&state=failed` },
      },
      definition: 'Active agents use current, unexpired task leases; failed runs use retained failed outcomes in the selected interval.',
    },
    cost: { ...cost.summary, drilldown: { entityType: 'cost', label: 'Open cost drivers', href: href('/app/observability/cost', scope) } },
    usage: usage.summary,
    trends: {
      requests: gateway.series?.requests ?? { points: [], aggregation: 'none', freshAsOf: gateway.freshAsOf },
      errorRate: gateway.series?.errorRate ?? { points: [], aggregation: 'none', freshAsOf: gateway.freshAsOf },
      latencyP50: gateway.series?.latencyP50 ?? { points: [], aggregation: 'none', freshAsOf: gateway.freshAsOf },
      latencyP95: gateway.series?.latencyP95 ?? { points: [], aggregation: 'none', freshAsOf: gateway.freshAsOf },
      tokens: usage.series?.totalTokens ?? { points: [], aggregation: 'none', freshAsOf: usage.freshAsOf },
      cost: cost.series?.cost ?? { points: [], aggregation: 'none', freshAsOf: cost.freshAsOf },
    },
    regions: { attention: 'fresh', health: 'fresh', work: 'fresh', cost: 'fresh' },
    freshAsOf: new Date().toISOString(),
  };
}

function evidenceValue(value, unavailableReason) { return value ? { earliestAvailableAt: value, unavailableReason: null } : { earliestAvailableAt: null, unavailableReason }; }

function alertDetail(db, alertId, scope, { ledger, config, actor } = {}) {
  const occurrence = getAlertOccurrence(db, alertId, { tenantId: scope.tenantId, projectId: scope.projectId });
  if (!occurrence) return null;
  const timeline = listAlertEvents(db, alertId, { tenantId: scope.tenantId, limit: 200 });
  const runDetail = occurrence.run_id ? getOperationalRun({ db, ledger, config, scope, runId: occurrence.run_id, actor }) : null;
  const ledgerClauses = ['tenant=?','ts>=?','ts<?']; const ledgerParams = [scope.tenantId, scope.from, scope.to];
  if (scope.projectId) { ledgerClauses.push('project_id=?'); ledgerParams.push(scope.projectId); }
  if (scope.provider) { ledgerClauses.push('provider=?'); ledgerParams.push(scope.provider); }
  if (occurrence.run_id) { ledgerClauses.push('run_id=?'); ledgerParams.push(occurrence.run_id); }
  else if (occurrence.task_id) { ledgerClauses.push('task=?'); ledgerParams.push(occurrence.task_id); }
  const earliestLedger = ledger?.prepare(`SELECT MIN(ts) AS value FROM token_events WHERE ${ledgerClauses.join(' AND ')}`).get(...ledgerParams)?.value ?? null;
  const lifecycleRole = ['operator','admin'].includes(actor?.role);
  const action = (allowed, explanation) => ({ allowed: Boolean(allowed), explanation });
  return {
    occurrence,
    timeline: timeline.map((event) => ({
      ...event, drilldown: { entityType: 'audit', entityId: event.id, label: `Open audit event ${event.event_type}`, href: href(`/app/observability/audit/${encodeURIComponent(event.id)}`, scope) },
    })),
    related: {
      task: occurrence.task_id ? { entityType: 'task', entityId: occurrence.task_id, label: `Open task ${occurrence.task_id}`, href: href(`/app/operations/tasks/${encodeURIComponent(occurrence.task_id)}`, scope) } : null,
      run: occurrence.run_id ? { entityType: 'run', entityId: occurrence.run_id, label: `Open run ${occurrence.run_id}`, href: href(`/app/operations/runs/${encodeURIComponent(occurrence.run_id)}`, scope) } : null,
    },
    actions: {
      acknowledge: action(lifecycleRole && occurrence.status === 'open', lifecycleRole ? `Acknowledgement is ${occurrence.status === 'open' ? 'available with a reason' : `not valid while ${occurrence.status}`}.` : 'Operator or administrator authority is required.'),
      resolve: action(lifecycleRole && ['open','acknowledged'].includes(occurrence.status), lifecycleRole ? `Resolution is ${['open','acknowledged'].includes(occurrence.status) ? 'available with evidence and a reason' : `not valid while ${occurrence.status}`}.` : 'Operator or administrator authority is required.'),
      reopen: action(lifecycleRole && occurrence.status === 'acknowledged', lifecycleRole ? `Reopen is ${occurrence.status === 'acknowledged' ? 'available with a reason' : `not valid while ${occurrence.status}`}.` : 'Operator or administrator authority is required.'),
      retry: runDetail?.recovery?.retry ?? action(false, occurrence.run_id ? 'Related run evidence is no longer retained.' : 'This alert has no related run.'),
      restart: runDetail?.recovery?.restart ?? action(false, 'Administrator restart is unavailable without retained run evidence.'),
    },
    evidenceAvailability: {
      alert: evidenceValue(timeline[0]?.created_at, 'No retained alert events are available.'),
      run: evidenceValue(runDetail?.retention?.earliestAvailable, occurrence.run_id ? 'Related run evidence is no longer retained or outside this scope.' : 'This alert has no related run.'),
      ledger: evidenceValue(earliestLedger, 'No related gateway-ledger evidence is retained in the selected scope.'),
    },
  };
}

function csv(rows) {
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const cell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return [keys.map(cell).join(','), ...rows.map((row) => keys.map((key) => cell(row[key])).join(','))].join('\r\n');
}

export function dispatchOperationsRequest({ method, pathname, url, body = {}, headers = {}, scope, actor, db, ledger, config, store, policy, broker } = {}) {
  if (!pathname.startsWith('/api/operations/')) return { handled: false };
  const correlationId = headers['x-correlation-id'] || randomUUID(); const freshAsOf = new Date().toISOString();
  const common = { scope: publicOperationalScope(scope), meta: { freshAsOf, correlationId, pollingIntervalMs: policy.operations.pollingIntervalMs, realtimeAvailable: policy.operations.sse.enabled } };
  const success = (data, status = 200) => ({ handled: true, status, body: { ok: true, data, ...common } });
  if (method === 'GET' && pathname === '/api/operations/overview') return success(overviewModel({ db, ledger, config, scope, policy }));
  if (method === 'GET' && pathname === '/api/operations/search') {
    const tasks = db.prepare('SELECT id,title,status FROM tasks ORDER BY updated_at DESC LIMIT 500').all();
    const runs = queryRuns({ config, scope, limit: 200 }).items;
    const providers = Object.values(resolveAllProviders({}, config)).map((provider) => ({ id: provider.name, label: provider.displayName ?? provider.name }));
    const result = buildSearchResults({ query: url.searchParams.get('q'), scope, actor, tasks, runs, providers, limit: url.searchParams.get('limit') });
    recordUxfEvent(null, { event: 'global_search_used', route: '/app/operations/search', scopeKey: `${scope.tenantId}/${scope.projectId ?? ''}`, role: actor?.role, featureFlag: 'uxf006.search', outcome: 'success' }, { db, enabled: policy?.telemetry?.uxfEnabled === true });
    return success(result);
  }
  if (method === 'GET' && pathname === '/api/operations/tasks') return success(listOperationalTasks({ db, scope, status: url.searchParams.get('status') || url.searchParams.get('state'), cursor: url.searchParams.get('cursor'), limit: readLimit(url) }));
  if (method === 'GET' && pathname === '/api/operations/runs') { const result = queryRuns({ config, scope, filters: { state: url.searchParams.get('state') || null, task: url.searchParams.get('task') || null }, cursor: url.searchParams.get('cursor'), limit: readLimit(url) }); return success({ ...result, page: { nextCursor: result.nextCursor, snapshot: result.snapshot, limit: result.limit } }); }
  if (method === 'GET' && pathname === '/api/operations/alerts') { const result = queryAlertOccurrences(db, { tenantId: scope.tenantId, projectId: scope.projectId, status: url.searchParams.get('status'), severity: url.searchParams.get('severity'), cursor: url.searchParams.get('cursor'), limit: readLimit(url) }); return success({ ...result, items: result.items.map((alert) => attentionItem(alert, scope)) }); }
  if (method === 'GET' && pathname === '/api/operations/gateway') return success(queryGatewayMetrics(ledger, scope));
  if (method === 'GET' && pathname === '/api/operations/usage') return success(queryUsageMetrics(ledger, scope));
  if (method === 'GET' && pathname === '/api/operations/usage-records') return success(queryUsageRecords(ledger, scope, { cursor: url.searchParams.get('cursor'), limit: readLimit(url), dimension: url.searchParams.get('dimension'), value: url.searchParams.get('value') }));
  if (method === 'GET' && pathname === '/api/operations/cost') return success(queryCostMetrics(ledger, scope, { monthlyLimit: policy?.analytics?.budget?.monthlyLimit ?? 0 }));
  if (method === 'GET' && pathname === '/api/operations/export') {
    const view = url.searchParams.get('view') || 'cost';
    const format = url.searchParams.get('format') || 'csv';
    if (!['gateway','usage','cost'].includes(view) || !['csv','json'].includes(format)) throw new OperationsApiError('INVALID_EXPORT', 'Export view or format is unsupported.', 400);
    const units = view === 'gateway' ? { request: 'count', latencyMs: 'ms' } : view === 'usage' ? { tokens: 'tokens', costUsd: 'USD' } : { costUsd: 'USD', tokens: 'tokens' };
    const rows = operationalExportRows(ledger, scope, view); const data = { view, format, units, rows };
    if (format === 'json') return success(data);
    const exportMeta = { exportView: view, scopeFrom: scope.from, scopeTo: scope.to, scopeProject: scope.projectId, scopeProvider: scope.provider, freshAsOf, units: JSON.stringify(units) };
    const csvRows = (rows.length ? rows : [{ recordState: 'no-data' }]).map((row) => ({ ...exportMeta, ...row }));
    return { handled: true, status: 200, type: 'text/csv; charset=utf-8', headers: { 'content-disposition': `attachment; filename="meridianos-${view}.csv"`, 'x-correlation-id': correlationId, 'x-operational-fresh-as-of': freshAsOf }, body: csv(csvRows) };
  }

  let match = pathname.match(/^\/api\/operations\/tasks\/([^/]+)$/);
  if (method === 'GET' && match) {
    const data = getOperationalTask({ db, ledger, config, scope, taskId: safeId(match[1]), actor });
    if (!data) throw new OperationsApiError('TASK_NOT_FOUND', 'Task evidence is unavailable or outside the authorized scope.', 404);
    return success(data);
  }
  match = pathname.match(/^\/api\/operations\/runs\/([^/]+)$/);
  if (method === 'GET' && match) {
    const data = getOperationalRun({ db, ledger, config, scope, runId: safeId(match[1]), actor, cursor: url.searchParams.get('cursor'), limit: readLimit(url) });
    if (!data) throw new OperationsApiError('RUN_NOT_FOUND', 'Run evidence is unavailable or no longer retained.', 404);
    return success(data);
  }
  match = pathname.match(/^\/api\/operations\/runs\/([^/]+)\/logs$/);
  if (method === 'GET' && match) {
    const data = getOperationalRun({ db, ledger, config, scope, runId: safeId(match[1]), actor, cursor: url.searchParams.get('cursor'), limit: readLimit(url) });
    if (!data) throw new OperationsApiError('RUN_NOT_FOUND', 'Run evidence is unavailable or no longer retained.', 404);
    return success(data.evidence);
  }
  match = pathname.match(/^\/api\/operations\/alerts\/([^/]+)$/);
  if (method === 'GET' && match) {
    const data = alertDetail(db, safeId(match[1]), scope, { ledger, config, actor });
    if (!data) throw new OperationsApiError('ALERT_NOT_FOUND', 'Alert evidence is unavailable or outside the authorized scope.', 404);
    return success(data);
  }
  match = pathname.match(/^\/api\/operations\/audit\/([^/]+)$/);
  if (method === 'GET' && match) {
    const auditId = safeId(match[1]);
    const data = getAlertEvent(db, auditId, { tenantId: scope.tenantId, projectId: scope.projectId }) ?? getOperationalAudit(db, auditId, { tenantId: scope.tenantId, projectId: scope.projectId });
    if (!data) throw new OperationsApiError('AUDIT_NOT_FOUND', 'Audit evidence is unavailable or outside the authorized scope.', 404);
    return success(data);
  }
  match = pathname.match(/^\/api\/operations\/alerts\/([^/]+)\/(acknowledge|resolve|reopen)$/);
  if (method === 'POST' && match) {
    const result = transitionAlertOccurrence(db, safeId(match[1]), { type: match[2], expectedVersion: body.expectedVersion, reason: body.reason }, { tenantId: scope.tenantId, projectId: scope.projectId, actor, correlationId });
    broker?.publish({ type: 'alert.changed', tenantId: scope.tenantId, projectId: scope.projectId, entityId: result.occurrence.id, correlationId });
    return success({ ...result, audit: { entityType: 'audit', entityId: result.event.id, href: href(`/app/observability/audit/${encodeURIComponent(result.event.id)}`, scope) } });
  }
  match = pathname.match(/^\/api\/operations\/runs\/([^/]+)\/retry$/);
  if (method === 'POST' && match) {
    const runId = safeId(match[1]);
    const detail = getOperationalRun({ db, ledger, config, scope, runId, actor });
    if (!detail) throw new OperationsApiError('RUN_NOT_FOUND', 'Run evidence is unavailable or no longer retained.', 404);
    const idempotencyKey = headers['idempotency-key'] || correlationId;
    const result = retryOperationalRun({ store, db, run: detail.run, actor, scope, reason: body.reason, correlationId, idempotencyKey });
    broker?.publish({ type: 'run.changed', tenantId: scope.tenantId, projectId: scope.projectId, entityId: runId, correlationId });
    const runParams = scopeQuery(scope); runParams.set('task', result.task.id); runParams.set('retryRequest', result.retryRequestId);
    return success({ ...result, taskUrl: href(`/app/operations/tasks/${encodeURIComponent(result.task.id)}`, scope), newRunUrl: `/app/operations/runs?${runParams}`, audit: { ...result.audit, entityType: 'audit', href: href(`/app/observability/audit/${encodeURIComponent(result.audit.id)}`, scope) } });
  }
  throw new OperationsApiError('OPERATIONS_ROUTE_NOT_FOUND', 'The operational route is not available.', 404);
}

export function operationsError(error, scope = null, correlationId = randomUUID()) {
  const status = Number(error?.httpStatus) || (error?.code === 'INVALID_CURSOR' ? 400 : 500);
  const code = error?.code || 'OPERATIONS_UNAVAILABLE';
  const details = error?.details?.occurrence ? { occurrence: error.details.occurrence, refresh: true } : null;
  return { status, body: { ok: false, error: { code, message: status === 500 ? 'Operational information is temporarily unavailable.' : error.message, correlationId, ...(details ? { details } : {}), remediation: code === 'EXPIRED_CURSOR' ? ['Restart pagination from the first page.'] : ['Refresh the current scoped view and try again.'] }, ...(scope ? { scope: publicOperationalScope(scope) } : {}) } };
}
