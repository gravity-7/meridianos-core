/**
 * windows — per-agent 5h/weekly budget verdict computed FROM the gateway's own ledger
 * (gateway/ledger.mjs), for 3.2c's gateway enforcement seam to consult before letting a request
 * through. This is deliberately a thin bridge, not a reimplementation: it sources usage from
 * `queryWindow` (the ledger's own never-fabricate aggregate) and hands it straight to
 * budget.mjs's `verdictFor` for the ok/warn/halt comparison against policy.yaml's caps — the same
 * comparison logic the transcript-based budget.mjs uses today, reused verbatim so the two paths
 * can't drift on what "halt" means.
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

  const v = verdictFor(usage, caps, warnPct);

  return { tenant, agent, ...v, sums: { last5h: w5, last7d: wWeek } };
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
