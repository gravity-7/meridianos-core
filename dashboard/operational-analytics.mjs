import { createHash } from 'node:crypto';

const MAX_POINTS = 2000;
const DIMENSIONS = Object.freeze({ provider: 'provider', model: 'model', project: 'project_id', agent: 'agent', task: 'task', run: 'run_id' });

function scopedRows(db, scope) {
  const clauses = ['tenant=?', 'ts>=?', 'ts<?'];
  const params = [scope.tenantId, scope.from, scope.to];
  if (scope.projectId) { clauses.push('project_id=?'); params.push(scope.projectId); }
  if (scope.provider) { clauses.push('provider=?'); params.push(scope.provider); }
  return db.prepare(`SELECT id,ts,tenant,project_id,provider,model,agent,task,run_id,upstream_status,latency_ms,
    input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,total_tokens,cost_usd,enforcement_decision
    FROM token_events WHERE ${clauses.join(' AND ')} ORDER BY ts,id`).all(...params);
}

function publicScope(scope) {
  return { from: scope.from, to: scope.to, project: scope.projectId ?? null, provider: scope.provider ?? null, timezone: 'UTC' };
}

function href(pathname, scope, extra = {}) {
  const params = new URLSearchParams({ from: scope.from, to: scope.to });
  if (scope.projectId) params.set('project', scope.projectId);
  if (scope.provider) params.set('provider', scope.provider);
  for (const [key, value] of Object.entries(extra)) if (value != null) params.set(key, value);
  return `${pathname}?${params}`;
}

function bucketPoints(rows, valueOf, scope, label) {
  if (!rows.length) return { points: [], aggregation: 'no samples' };
  const size = Math.max(1, Math.ceil(rows.length / MAX_POINTS));
  const points = [];
  for (let index = 0; index < rows.length; index += size) {
    const bucket = rows.slice(index, index + size);
    points.push({
      at: bucket[0].ts,
      value: valueOf(bucket),
      sampleCount: bucket.length,
      drilldown: { entityType: 'usage-records', href: href('/app/observability/usage', scope, { from: bucket[0].ts, to: new Date(Date.parse(bucket.at(-1).ts) + 1).toISOString(), metric: label }) },
    });
  }
  return { points, aggregation: `deterministic bucket size ${size}` };
}

function series(metric, unit, rows, valueOf, scope) {
  const bucketed = bucketPoints(rows, valueOf, scope, metric);
  return { metric, unit, scope: publicScope(scope), freshAsOf: new Date().toISOString(), aggregation: bucketed.aggregation, points: bucketed.points };
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

function breakdown(rows, dimension, scope) {
  const column = DIMENSIONS[dimension];
  const grouped = new Map();
  for (const row of rows) {
    const key = row[column] || 'unattributed';
    const item = grouped.get(key) ?? { key, cost: 0, tokens: 0, requests: 0, unknownCostEvents: 0 };
    item.requests++;
    item.tokens += row.total_tokens ?? 0;
    if (row.cost_usd == null) item.unknownCostEvents++; else item.cost += row.cost_usd;
    grouped.set(key, item);
  }
  const total = [...grouped.values()].reduce((sum, item) => sum + item.cost, 0);
  return [...grouped.values()].map((item) => ({
    ...item,
    share: total ? Math.round((item.cost / total) * 10000) / 100 : 0,
    drilldown: { entityType: 'usage-records', href: href('/app/observability/usage', scope, { dimension, value: item.key }) },
  })).sort((a, b) => b.cost - a.cost || a.key.localeCompare(b.key));
}

function allBreakdowns(rows, scope) {
  return Object.fromEntries(Object.keys(DIMENSIONS).map((dimension) => [dimension, breakdown(rows, dimension, scope)]));
}

export function queryGatewayMetrics(db, scope) {
  const rows = scopedRows(db, scope);
  const failures = rows.filter((row) => row.enforcement_decision === 'deny' || Number(row.upstream_status) >= 400);
  const latency = rows.map((row) => row.latency_ms).filter(Number.isFinite);
  const summary = {
    requests: rows.length,
    errors: failures.length,
    errorRate: rows.length ? Math.round((failures.length / rows.length) * 10000) / 100 : 0,
    latencyP50: percentile(latency, 0.5),
    latencyP95: percentile(latency, 0.95),
    missingLatencySamples: rows.length - latency.length,
  };
  return {
    summary,
    series: {
      requests: series('requests', 'requests', rows, (bucket) => bucket.length, scope),
      errorRate: series('error_rate', '%', rows, (bucket) => Math.round((bucket.filter((row) => row.enforcement_decision === 'deny' || Number(row.upstream_status) >= 400).length / bucket.length) * 10000) / 100, scope),
      latencyP50: series('latency_p50', 'ms', rows.filter((row) => Number.isFinite(row.latency_ms)), (bucket) => percentile(bucket.map((row) => row.latency_ms), 0.5), scope),
      latencyP95: series('latency_p95', 'ms', rows.filter((row) => Number.isFinite(row.latency_ms)), (bucket) => percentile(bucket.map((row) => row.latency_ms), 0.95), scope),
    },
    freshAsOf: new Date().toISOString(), scope: publicScope(scope),
  };
}

export function queryUsageMetrics(db, scope) {
  const rows = scopedRows(db, scope);
  const sum = (key) => rows.reduce((total, row) => total + (row[key] ?? 0), 0);
  return {
    summary: { inputTokens: sum('input_tokens'), outputTokens: sum('output_tokens'), cachedTokens: sum('cache_read_tokens'), totalTokens: sum('total_tokens'), requests: rows.length, unknownTokenEvents: rows.filter((row) => row.total_tokens == null).length },
    series: {
      inputTokens: series('input_tokens', 'tokens', rows, (bucket) => bucket.reduce((sumValue, row) => sumValue + (row.input_tokens ?? 0), 0), scope),
      outputTokens: series('output_tokens', 'tokens', rows, (bucket) => bucket.reduce((sumValue, row) => sumValue + (row.output_tokens ?? 0), 0), scope),
      cachedTokens: series('cached_tokens', 'tokens', rows, (bucket) => bucket.reduce((sumValue, row) => sumValue + (row.cache_read_tokens ?? 0), 0), scope),
      totalTokens: series('total_tokens', 'tokens', rows, (bucket) => bucket.reduce((sumValue, row) => sumValue + (row.total_tokens ?? 0), 0), scope),
    },
    breakdowns: allBreakdowns(rows, scope), freshAsOf: new Date().toISOString(), scope: publicScope(scope),
  };
}

export function queryCostMetrics(db, scope, budget = {}, { now = Date.now() } = {}) {
  const rows = scopedRows(db, scope);
  const spend = rows.reduce((total, row) => total + (row.cost_usd ?? 0), 0);
  const monthlyLimit = Number(budget.monthlyLimit) || 0;
  const instant = new Date(now);
  const periodStart = new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth() + 1, 1));
  const monthRows = scopedRows(db, { ...scope, from: periodStart.toISOString(), to: periodEnd.toISOString() });
  const monthSpend = monthRows.reduce((total, row) => total + (row.cost_usd ?? 0), 0);
  const trailingStart = new Date(instant.getTime() - 7 * 86400000).toISOString();
  const trailingRows = scopedRows(db, { ...scope, from: trailingStart, to: instant.toISOString() });
  const dailyBurnRate = trailingRows.reduce((total, row) => total + (row.cost_usd ?? 0), 0) / 7;
  const daysRemaining = Math.max(0, Math.ceil((periodEnd.getTime() - instant.getTime()) / 86400000));
  const forecast = monthSpend + dailyBurnRate * daysRemaining;
  return {
    summary: {
      spend,
      unknownCostEvents: rows.filter((row) => row.cost_usd == null).length,
      currency: 'USD',
      budget: {
        period: periodStart.toISOString().slice(0, 7), periodFrom: periodStart.toISOString(), periodTo: periodEnd.toISOString(),
        periodLabel: 'Current monthly budget period (fixed exception to selected time scope)',
        monthlyLimit, spend: monthSpend, utilization: monthlyLimit ? Math.round((monthSpend / monthlyLimit) * 10000) / 10000 : null,
        forecast: Math.round(forecast * 10000) / 10000, dailyBurnRate: Math.round(dailyBurnRate * 10000) / 10000,
      },
    },
    series: { cost: series('cost', 'USD', rows, (bucket) => bucket.reduce((sumValue, row) => sumValue + (row.cost_usd ?? 0), 0), scope) },
    breakdowns: allBreakdowns(rows, scope), freshAsOf: new Date().toISOString(), scope: publicScope(scope),
  };
}

const cursorFingerprint = (scope, options) => createHash('sha256').update(JSON.stringify([scope, options.dimension ?? null, options.value ?? null])).digest('base64url').slice(0, 16);
const decode = (cursor) => { try { return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch { throw Object.assign(new Error('invalid usage cursor'), { code: 'INVALID_CURSOR' }); } };

export function queryUsageRecords(db, scope, options = {}) {
  let rows = scopedRows(db, scope).reverse();
  const column = DIMENSIONS[options.dimension];
  if (column && options.value != null) rows = rows.filter((row) => (row[column] || 'unattributed') === options.value);
  const fingerprintValue = cursorFingerprint(scope, options);
  const cursor = options.cursor ? decode(options.cursor) : { v: 1, o: 0, f: fingerprintValue };
  if (cursor.v !== 1 || cursor.f !== fingerprintValue || !Number.isInteger(cursor.o)) throw Object.assign(new Error('usage cursor does not match scope'), { code: 'INVALID_CURSOR' });
  const limit = Math.max(1, Math.min(200, Number(options.limit) || 50));
  const items = rows.slice(cursor.o, cursor.o + limit).map((row) => ({
    id: row.id, ts: row.ts, outcome: row.enforcement_decision === 'deny' || Number(row.upstream_status) >= 400 ? 'failed' : 'ok',
    provider: row.provider, model: row.model, agent: row.agent, projectId: row.project_id, taskId: row.task, runId: row.run_id,
    upstreamStatus: row.upstream_status, latencyMs: row.latency_ms,
    inputTokens: row.input_tokens, outputTokens: row.output_tokens, cachedTokens: row.cache_read_tokens, totalTokens: row.total_tokens,
    costUsd: row.cost_usd,
    taskUrl: row.task ? href(`/app/operations/tasks/${encodeURIComponent(row.task)}`, scope) : null,
    runUrl: row.run_id ? href(`/app/operations/runs/${encodeURIComponent(row.run_id)}`, scope) : null,
  }));
  const nextOffset = cursor.o + items.length;
  return { items, nextCursor: nextOffset < rows.length ? Buffer.from(JSON.stringify({ v: 1, o: nextOffset, f: fingerprintValue })).toString('base64url') : null, limit };
}

export function operationalExportRows(db, scope, view = 'cost') {
  if (view === 'gateway') return queryUsageRecords(db, scope, { limit: 200 }).items.map(({ id, ts, outcome, upstreamStatus, latencyMs, provider, model, agent, projectId, taskId, runId }) => ({ id, ts, outcome, upstreamStatus, latencyMs, provider, model, agent, projectId, taskId, runId }));
  return queryUsageRecords(db, scope, { limit: 200 }).items;
}
