/**
 * api/v1/costs — cost/usage query endpoints (contracts/rest-api-v1.md §Costs), reading from the
 * gateway's token-event ledger (gateway/ledger.mjs) — the same store the dashboard's analytics
 * panel reads, just re-shaped to the REST contract's response envelope.
 */
import { openLedger } from '../../gateway/ledger.mjs';

let _ledger;
function getLedger(config) {
  if (_ledger) return _ledger;
  try { _ledger = openLedger(undefined, { config }); } catch { _ledger = null; }
  return _ledger;
}
function getTenant(config) {
  return config?.gateway?.registry?.tenant ?? config?.gateway?.tenant ?? 'default';
}

const GROUP_COLUMNS = { provider: 'provider', model: 'model', agent: 'agent', source: 'source', day: "date(ts)" };

export async function handle(ctx) {
  const { req, url, config, apiKey, json, hasScope } = ctx;

  if (req.method === 'GET' && url.pathname === '/api/v1/costs') {
    if (!hasScope(apiKey, 'costs:read')) return json(403, { error: 'Forbidden', message: 'API key lacks required scope: costs:read' });
    const ledger = getLedger(config);
    if (!ledger) return json(200, { costs: [], total_tokens: 0, total_cost: 0, count: 0 });

    const tenant = getTenant(config);
    const startTime = url.searchParams.get('start_time');
    const endTime = url.searchParams.get('end_time');
    const provider = url.searchParams.get('provider');
    const model = url.searchParams.get('model');
    const agent = url.searchParams.get('agent');
    const source = url.searchParams.get('source');

    const clauses = ['tenant = ?'];
    const params = [tenant];
    if (startTime) { clauses.push('ts >= ?'); params.push(new Date(Number(startTime) * 1000).toISOString()); }
    else { clauses.push('ts >= ?'); params.push(new Date(Date.now() - 24 * 3600 * 1000).toISOString()); }
    if (endTime) { clauses.push('ts < ?'); params.push(new Date(Number(endTime) * 1000).toISOString()); }
    if (provider) { clauses.push('provider = ?'); params.push(provider); }
    if (model) { clauses.push('model = ?'); params.push(model); }
    if (agent) { clauses.push('agent = ?'); params.push(agent); }
    if (source) { clauses.push('source = ?'); params.push(source); }

    const rows = ledger.prepare(
      `SELECT ts, provider, model, agent, source, total_tokens, cost_usd
         FROM token_events WHERE ${clauses.join(' AND ')} ORDER BY ts DESC LIMIT 500`,
    ).all(...params);

    const costs = rows.map((r) => ({
      timestamp: Math.floor(Date.parse(r.ts) / 1000),
      provider: r.provider, model: r.model, agent: r.agent, source: r.source,
      tokens: r.total_tokens ?? 0, cost: r.cost_usd ?? 0,
    }));
    const totals = costs.reduce((acc, c) => ({ tokens: acc.tokens + c.tokens, cost: acc.cost + c.cost }), { tokens: 0, cost: 0 });
    return json(200, { costs, total_tokens: totals.tokens, total_cost: totals.cost, count: costs.length });
  }

  if (req.method === 'GET' && url.pathname === '/api/v1/costs/summary') {
    if (!hasScope(apiKey, 'costs:read')) return json(403, { error: 'Forbidden', message: 'API key lacks required scope: costs:read' });
    const ledger = getLedger(config);
    if (!ledger) return json(200, { summary: [], grand_total_tokens: 0, grand_total_cost: 0, grand_total_requests: 0 });

    const tenant = getTenant(config);
    const groupBy = GROUP_COLUMNS[url.searchParams.get('group_by')] ?? 'provider';
    const startTime = url.searchParams.get('start_time');
    const endTime = url.searchParams.get('end_time');

    const clauses = ['tenant = ?'];
    const params = [tenant];
    clauses.push('ts >= ?'); params.push(startTime ? new Date(Number(startTime) * 1000).toISOString() : new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString());
    if (endTime) { clauses.push('ts < ?'); params.push(new Date(Number(endTime) * 1000).toISOString()); }

    const rows = ledger.prepare(
      `SELECT ${groupBy} AS group_key, SUM(total_tokens) AS total_tokens, SUM(cost_usd) AS total_cost, COUNT(*) AS request_count
         FROM token_events WHERE ${clauses.join(' AND ')} GROUP BY ${groupBy} ORDER BY total_cost DESC`,
    ).all(...params);

    const summary = rows.map((r) => ({
      [url.searchParams.get('group_by') || 'provider']: r.group_key,
      total_tokens: r.total_tokens ?? 0, total_cost: r.total_cost ?? 0, request_count: r.request_count,
    }));
    const totals = rows.reduce((acc, r) => ({
      tokens: acc.tokens + (r.total_tokens ?? 0), cost: acc.cost + (r.total_cost ?? 0), count: acc.count + r.request_count,
    }), { tokens: 0, cost: 0, count: 0 });
    return json(200, { summary, grand_total_tokens: totals.tokens, grand_total_cost: totals.cost, grand_total_requests: totals.count });
  }

  return false;
}
