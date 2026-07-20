/**
 * dashboard/gateway-api — Gateway Spend Dashboard data layer.
 * Queries the gateway sidecar's append-only token-event ledger (.ai/gateway/ledger.db).
 */
import { openLedger } from '../gateway/ledger.mjs';

let _ledger = null;

function getLedger(config, ledgerPath) {
  if (ledgerPath) return openLedger(ledgerPath);
  return (_ledger ||= openLedger(undefined, { config }));
}

/**
 * Reset stored ledger instance (used in tests or dynamic config changes).
 */
export function resetLedgerInstance() {
  _ledger = null;
}

export function getSpendSummary(ledgerOrConfig, ledgerPath) {
  const ledger = typeof ledgerOrConfig?.prepare === 'function' ? ledgerOrConfig : getLedger(ledgerOrConfig, ledgerPath);
  try {
    const row = ledger.prepare(
      `SELECT
         COUNT(*) as totalCalls,
         SUM(COALESCE(cost_usd, 0)) as totalCost,
         SUM(COALESCE(total_tokens, 0)) as totalTokens,
         SUM(CASE WHEN enforcement_decision = 'deny' THEN 1 ELSE 0 END) as denyCount,
         COUNT(DISTINCT agent) as activeAgents
       FROM token_events`
    ).get();
    return {
      totalCost: Number(Number(row?.totalCost || 0).toFixed(6)),
      totalTokens: Number(row?.totalTokens || 0),
      totalCalls: Number(row?.totalCalls || 0),
      denyCount: Number(row?.denyCount || 0),
      activeAgents: Number(row?.activeAgents || 0),
    };
  } catch {
    return { totalCost: 0, totalTokens: 0, totalCalls: 0, denyCount: 0, activeAgents: 0 };
  }
}

export function getAgentSpend(ledgerOrConfig, ledgerPath) {
  const ledger = typeof ledgerOrConfig?.prepare === 'function' ? ledgerOrConfig : getLedger(ledgerOrConfig, ledgerPath);
  try {
    const rows = ledger.prepare(
      `SELECT
         agent,
         COUNT(*) as calls,
         SUM(COALESCE(input_tokens, 0)) as inputTokens,
         SUM(COALESCE(output_tokens, 0)) as outputTokens,
         SUM(COALESCE(cost_usd, 0)) as costUsd,
         SUM(CASE WHEN enforcement_decision = 'deny' THEN 1 ELSE 0 END) as denyCount,
         MAX(ts) as lastSeen
       FROM token_events
       GROUP BY agent
       ORDER BY costUsd DESC, calls DESC`
    ).all();
    return rows.map((r) => ({
      agent: r.agent,
      calls: Number(r.calls || 0),
      inputTokens: Number(r.inputTokens || 0),
      outputTokens: Number(r.outputTokens || 0),
      costUsd: Number(Number(r.costUsd || 0).toFixed(6)),
      denyCount: Number(r.denyCount || 0),
      lastSeen: r.lastSeen || null,
    }));
  } catch {
    return [];
  }
}

export function getModelSpend(ledgerOrConfig, ledgerPath) {
  const ledger = typeof ledgerOrConfig?.prepare === 'function' ? ledgerOrConfig : getLedger(ledgerOrConfig, ledgerPath);
  try {
    const rows = ledger.prepare(
      `SELECT
         provider,
         model,
         COUNT(*) as calls,
         SUM(COALESCE(input_tokens, 0)) as inputTokens,
         SUM(COALESCE(output_tokens, 0)) as outputTokens,
         SUM(COALESCE(cost_usd, 0)) as costUsd
       FROM token_events
       GROUP BY provider, model
       ORDER BY costUsd DESC, calls DESC`
    ).all();

    const totalCost = rows.reduce((acc, r) => acc + (Number(r.costUsd) || 0), 0);
    return rows.map((r) => ({
      provider: r.provider,
      model: r.model,
      calls: Number(r.calls || 0),
      inputTokens: Number(r.inputTokens || 0),
      outputTokens: Number(r.outputTokens || 0),
      costUsd: Number(Number(r.costUsd || 0).toFixed(6)),
      percentage: totalCost > 0 ? Number(((Number(r.costUsd || 0) / totalCost) * 100).toFixed(2)) : 0,
    }));
  } catch {
    return [];
  }
}

export function getDenialEvents(ledgerOrConfig, limit = 50, ledgerPath) {
  const ledger = typeof ledgerOrConfig?.prepare === 'function' ? ledgerOrConfig : getLedger(ledgerOrConfig, ledgerPath);
  try {
    const rows = ledger.prepare(
      `SELECT id, ts, agent, provider, model, cap_window as capWindow, request_id as requestId
       FROM token_events
       WHERE enforcement_decision = 'deny'
       ORDER BY ts DESC, rowid DESC
       LIMIT ?`
    ).all(Number(limit) || 50);
    return rows;
  } catch {
    return [];
  }
}

export function getRecentEvents(ledgerOrConfig, limit = 50, ledgerPath) {
  const ledger = typeof ledgerOrConfig?.prepare === 'function' ? ledgerOrConfig : getLedger(ledgerOrConfig, ledgerPath);
  try {
    const rows = ledger.prepare(
      `SELECT id, ts, agent, session, task, run_id as runId, request_id as requestId,
              provider, model, wire, upstream_status as upstreamStatus, latency_ms as latencyMs,
              input_tokens as inputTokens, output_tokens as outputTokens,
              total_tokens as totalTokens, cost_usd as costUsd,
              enforcement_decision as enforcementDecision, cap_window as capWindow
       FROM token_events
       ORDER BY ts DESC, rowid DESC
       LIMIT ?`
    ).all(Number(limit) || 50);
    return rows;
  } catch {
    return [];
  }
}
