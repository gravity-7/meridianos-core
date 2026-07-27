/**
 * windows — per-agent 5h/weekly budget verdict computed FROM the gateway's own ledger
 * (gateway/ledger.mjs), for 3.2c's gateway enforcement seam to consult before letting a request
 * through. This is deliberately a thin bridge, not a reimplementation: it sources usage from
 * `queryWindow` (the ledger's own never-fabricate aggregate) and hands it straight to
 * budget.mjs's `verdictFor` for the ok/warn/halt comparison against policy.yaml's caps — the same
 * comparison logic the transcript-based budget.mjs uses today, reused verbatim so the two paths
 * can't drift on what "halt" means.
 *
 * Cost caps (opt-in, additive): the ledger records `cost_usd` per event, so this module ALSO
 * compares summed cost against optional `agent_budget.<agent>.per_5h_cost_usd` / `per_week_cost_usd`
 * caps and denies if EITHER the token OR the cost cap is hit. This fixes token caps over-penalizing
 * cache-heavy work (near-free cache reads inflate token totals but cost cents). An agent with no
 * cost caps behaves EXACTLY as the token-only path did. Cost is never fabricated (see `costVerdictFor`).
 *
 * FOLLOW-UP (3.3c): budget.mjs also supports `five_hour_sessions` — activity-anchored 5h windows
 * derived from the records themselves (first activity opens the window; it closes 5h later),
 * rather than a rolling trailing window. This module only implements the rolling trailing-5h/
 * trailing-week form. Anchored-session parity for the ledger path is deferred to 3.3c, when
 * budget.mjs itself is reconciled onto the ledger as its usage source.
 */
import { queryWindow } from './ledger.mjs';
import { verdictFor } from '../budget.mjs';

// Not exported by budget.mjs (they're module-local consts there) — redefined here identically.
const H5 = 5 * 60 * 60 * 1000;
const WEEK = 7 * 24 * 60 * 60 * 1000;

/**
 * Compute one agent's budget verdict from the ledger's rolling trailing 5h/week windows.
 * Never fabricates usage: `queryWindow` only sums non-null token rows, and a window with no
 * matching rows (or only null-total rows) simply reports 0 used tokens for that window, same as
 * `verdictFor` already handles for any other zero-usage caller.
 */
export function agentBudgetVerdict(ledger, { tenant = 'pv', agent, now = Date.now(), policy, config } = {}) {
  const since5h = new Date(now - H5).toISOString();
  const sinceWeek = new Date(now - WEEK).toISOString();

  const w5 = queryWindow(ledger, { tenant, agent, since: since5h });
  const wWeek = queryWindow(ledger, { tenant, agent, since: sinceWeek });

  const usage = {
    last5h: { billable: w5.totalTokens },
    last7d: { billable: wWeek.totalTokens },
  };

  const caps = policy?.agent_budget?.[agent];
  const warnPct = policy?.agent_budget?.warn_pct ?? 80;

  // Token caps (existing behavior, reused verbatim from budget.mjs) …
  const tokenVerdict = verdictFor(usage, caps, warnPct);
  // … AND opt-in USD cost caps from the SAME ledger window (cost_usd is summed by queryWindow).
  // An agent with no cost caps set yields an all-'no-cap' cost verdict, so the merge below is
  // byte-identical to the token-only verdict — pure additive, zero behavior change when unused.
  const costVerdict = costVerdictFor({ last5h: w5.costUsd, last7d: wWeek.costUsd }, caps, warnPct);
  const v = mergeVerdicts(tokenVerdict, costVerdict);

  return { tenant, agent, ...v, sums: { last5h: w5, last7d: wWeek } };
}

/**
 * USD-cost verdict, mirroring budget.mjs's `verdictFor` shape/thresholds but comparing summed
 * `cost_usd` against OPT-IN caps (`caps.per_5h_cost_usd` / `caps.per_week_cost_usd`). A null/absent
 * cap → 'no-cap' for that window. NEVER denies on unknown cost: `queryWindow` sums only PRICED rows
 * (unpriced runs land in `costUnknownRuns`, never fabricated), so a window whose runs are all
 * unpriced reports 0 cost (< any cap) and cannot halt — under-enforcement on missing pricing is the
 * deliberate safe direction (a real call is never wrongly blocked because we couldn't price it).
 */
function costVerdictFor({ last5h, last7d }, caps, warnPct) {
  const rows = [
    { window: '5h', used: last5h, cap: caps?.per_5h_cost_usd ?? null },
    { window: 'week', used: last7d, cap: caps?.per_week_cost_usd ?? null },
  ];
  const windows = rows.map((r) => {
    // cap === 0 means "block everything" (hard block); cap === null/undefined means "no limit"
    if (r.cap == null) return { ...r, pct: null, state: 'no-cap', unit: 'usd' };
    const pct = Math.round((r.used / r.cap) * 100);
    const s = r.used >= r.cap ? 'halt' : (pct >= warnPct ? 'warn' : 'ok');
    return { ...r, pct, state: s, unit: 'usd' };
  });
  const state = windows.reduce((acc, w) => (RANK[w.state] > RANK[acc] ? w.state : acc), 'ok');
  return { state, windows };
}

// Severity ladder for combining token + cost verdicts. 'no-cap' ranks BELOW 'ok' so a window with a
// real cap always wins over one without, and the overall state never reads 'no-cap'.
const RANK = { 'no-cap': -1, ok: 0, warn: 1, halt: 2 };

/**
 * Combine the token and cost verdicts into one, per window: an agent is at the WORSE of its two
 * caps for each of 5h/week (deny if EITHER is halted). The merged `windows` keep their '5h'/'week'
 * names so `toEnforcementDecision` still resolves a valid `capWindow`.
 */
function mergeVerdicts(tokenV, costV) {
  const windows = ['5h', 'week'].map((name) => {
    const rt = tokenV.windows.find((w) => w.window === name);
    const rc = costV.windows.find((w) => w.window === name);
    if (!rt) return rc;
    if (!rc) return rt;
    return (RANK[rc.state] ?? 0) > (RANK[rt.state] ?? 0) ? rc : rt;
  }).filter(Boolean);
  const state = windows.reduce((acc, w) => (RANK[w.state] > RANK[acc] ? w.state : acc), 'ok');
  return { state, windows };
}

/**
 * Bridge a budget verdict to the gateway's enforcement-decision shape (token-event.mjs's
 * `enforcementDecision`/`capWindow` fields). Only 'halt' denies; 'ok'/'warn' both allow (warn is
 * advisory — surfaced to the dashboard, not a request-blocker). On halt, `capWindow` names the
 * FIRST window (checked in 5h-then-week order) whose usage is at/over its cap, matching
 * token-event.mjs's VALID_CAP_WINDOWS ('5h' | 'week' | null).
 */
export function toEnforcementDecision(verdict) {
  if (verdict.state !== 'halt') return { decision: 'allow', capWindow: null };
  const halted = verdict.windows.find((w) => w.state === 'halt');
  return { decision: 'deny', capWindow: halted?.window ?? null };
}

/**
 * The real verdict factory a caller passes as `startGateway({ checkVerdict })` (see server.mjs,
 * bite 3.2c). Closes over the ledger/policy/config once at gateway-start time, but re-evaluates
 * `now()` on EVERY call so each request's spend is checked against a fresh window — a request
 * made 10 minutes after the gateway started must not be judged against a 10-minute-stale clock.
 */
export function makeCheckVerdict({ ledger, policy, config, now = () => Date.now() } = {}) {
  return (ctx) => toEnforcementDecision(
    agentBudgetVerdict(ledger, { tenant: ctx.tenant, agent: ctx.agent, now: now(), policy, config }),
  );
}
