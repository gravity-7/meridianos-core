import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openLedger, appendEvent } from '../ledger.mjs';
import { makeTokenEvent } from '../token-event.mjs';
import { agentBudgetVerdict, toEnforcementDecision, makeCheckVerdict } from '../windows.mjs';

const NOW = Date.parse('2026-01-10T12:00:00.000Z');
const H5 = 5 * 60 * 60 * 1000;
const WEEK = 7 * 24 * 60 * 60 * 1000;

function evt(overrides = {}) {
  return makeTokenEvent({
    agent: 'claude',
    session: 'sess-1',
    requestId: `req-${Math.random()}`,
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    wire: 'anthropic',
    ...overrides,
  });
}

function policyWith(caps, warnPct = 80) {
  return { agent_budget: { claude: caps, warn_pct: warnPct } };
}

// ─── state thresholds ───────────────────────────────────────────────────────

test('agentBudgetVerdict: state ok when usage is well under both caps', () => {
  const ledger = openLedger(':memory:');
  appendEvent(ledger, evt({ ts: new Date(NOW - 60_000).toISOString(), totalTokens: 100 }));
  const policy = policyWith({ per_5h_tokens: 1000, per_week_tokens: 5000 });
  const v = agentBudgetVerdict(ledger, { agent: 'claude', now: NOW, policy });
  assert.equal(v.state, 'ok');
  assert.equal(v.tenant, 'pv');
  assert.equal(v.agent, 'claude');
});

test('agentBudgetVerdict: state warn once usage crosses warn_pct of a cap', () => {
  const ledger = openLedger(':memory:');
  appendEvent(ledger, evt({ ts: new Date(NOW - 60_000).toISOString(), totalTokens: 850 }));
  const policy = policyWith({ per_5h_tokens: 1000, per_week_tokens: 5000 });
  const v = agentBudgetVerdict(ledger, { agent: 'claude', now: NOW, policy });
  assert.equal(v.state, 'warn');
});

test('agentBudgetVerdict: state halt once usage is at/over a cap', () => {
  const ledger = openLedger(':memory:');
  appendEvent(ledger, evt({ ts: new Date(NOW - 60_000).toISOString(), totalTokens: 1000 }));
  const policy = policyWith({ per_5h_tokens: 1000, per_week_tokens: 5000 });
  const v = agentBudgetVerdict(ledger, { agent: 'claude', now: NOW, policy });
  assert.equal(v.state, 'halt');
});

// ─── window boundaries ──────────────────────────────────────────────────────

test('agentBudgetVerdict: an event older than 5h but within the week counts toward week only', () => {
  const ledger = openLedger(':memory:');
  // 6h old: outside the rolling 5h window, inside the rolling week window.
  appendEvent(ledger, evt({ ts: new Date(NOW - 6 * 60 * 60 * 1000).toISOString(), totalTokens: 300 }));
  const policy = policyWith({ per_5h_tokens: 1000, per_week_tokens: 5000 });
  const v = agentBudgetVerdict(ledger, { agent: 'claude', now: NOW, policy });
  const w5 = v.windows.find((w) => w.window === '5h');
  const wWeek = v.windows.find((w) => w.window === 'week');
  assert.equal(w5.used, 0);
  assert.equal(wWeek.used, 300);
  assert.equal(v.sums.last5h.totalTokens, 0);
  assert.equal(v.sums.last7d.totalTokens, 300);
});

test('agentBudgetVerdict: an event older than the week window is excluded from both windows', () => {
  const ledger = openLedger(':memory:');
  appendEvent(ledger, evt({ ts: new Date(NOW - WEEK - 60_000).toISOString(), totalTokens: 999 }));
  const policy = policyWith({ per_5h_tokens: 1000, per_week_tokens: 5000 });
  const v = agentBudgetVerdict(ledger, { agent: 'claude', now: NOW, policy });
  assert.equal(v.sums.last5h.totalTokens, 0);
  assert.equal(v.sums.last7d.totalTokens, 0);
  assert.equal(v.state, 'ok');
});

test('agentBudgetVerdict: an event just inside the 5h window counts toward both windows', () => {
  const ledger = openLedger(':memory:');
  appendEvent(ledger, evt({ ts: new Date(NOW - H5 + 60_000).toISOString(), totalTokens: 400 }));
  const policy = policyWith({ per_5h_tokens: 1000, per_week_tokens: 5000 });
  const v = agentBudgetVerdict(ledger, { agent: 'claude', now: NOW, policy });
  assert.equal(v.sums.last5h.totalTokens, 400);
  assert.equal(v.sums.last7d.totalTokens, 400);
});

// ─── null-is-unknown ─────────────────────────────────────────────────────────

test('agentBudgetVerdict: null-total events never inflate used tokens, but are visible as unknownRuns', () => {
  const ledger = openLedger(':memory:');
  appendEvent(ledger, evt({ ts: new Date(NOW - 60_000).toISOString(), totalTokens: 100 }));
  appendEvent(ledger, evt({ ts: new Date(NOW - 30_000).toISOString(), totalTokens: null }));
  const policy = policyWith({ per_5h_tokens: 1000, per_week_tokens: 5000 });
  const v = agentBudgetVerdict(ledger, { agent: 'claude', now: NOW, policy });
  assert.equal(v.sums.last5h.totalTokens, 100); // the null row contributes nothing to the sum
  assert.equal(v.sums.last5h.unknownRuns, 1);
  assert.equal(v.sums.last5h.runs, 2);
  assert.equal(v.state, 'ok');
});

// ─── missing caps ────────────────────────────────────────────────────────────

test('agentBudgetVerdict: an agent absent from policy gets verdictFor\'s no-cap behavior (state stays ok)', () => {
  const ledger = openLedger(':memory:');
  appendEvent(ledger, evt({ ts: new Date(NOW - 60_000).toISOString(), totalTokens: 999999 }));
  const policy = { agent_budget: { warn_pct: 80 } }; // no 'claude' entry at all
  const v = agentBudgetVerdict(ledger, { agent: 'claude', now: NOW, policy });
  assert.equal(v.state, 'ok');
  for (const w of v.windows) {
    assert.equal(w.cap, null);
    assert.equal(w.state, 'no-cap');
  }
});

// A literal `per_5h_tokens: 0` in policy.yaml is INDISTINGUISHABLE from "no cap set" — verdictFor's
// `if (!r.cap) return {...'no-cap'}` treats 0 as falsy, same as null/undefined. This matters
// directly for the #29 live-dogfood confirmation plan (scratch/dogfood-29-confirm.md): a founder
// reaching for the intuitive "set the cap to zero to force-deny" will get a fully PERMISSIVE agent
// instead, silently. The smallest cap that actually halts is 1, not 0.
test('agentBudgetVerdict: a literal per_5h_tokens:0 cap is treated as NO CAP, not "deny everything" (footgun, not a bug — verdictFor\'s `!cap` check)', () => {
  const ledger = openLedger(':memory:');
  appendEvent(ledger, evt({ ts: new Date(NOW - 60_000).toISOString(), totalTokens: 500 }));
  const policy = policyWith({ per_5h_tokens: 0, per_week_tokens: 0 });
  const v = agentBudgetVerdict(ledger, { agent: 'claude', now: NOW, policy });
  assert.equal(v.state, 'ok'); // NOT 'halt' — a naive reader would expect a 0-token cap to deny immediately
  for (const w of v.windows) assert.equal(w.state, 'no-cap');
  assert.deepEqual(toEnforcementDecision(v), { decision: 'allow', capWindow: null });
});

test('agentBudgetVerdict: missing policy entirely behaves the same as missing caps', () => {
  const ledger = openLedger(':memory:');
  appendEvent(ledger, evt({ ts: new Date(NOW - 60_000).toISOString(), totalTokens: 100 }));
  const v = agentBudgetVerdict(ledger, { agent: 'claude', now: NOW, policy: undefined });
  assert.equal(v.state, 'ok');
});

// ─── toEnforcementDecision ───────────────────────────────────────────────────

test('toEnforcementDecision: ok state maps to allow with a null capWindow', () => {
  const verdict = { state: 'ok', windows: [{ window: '5h', state: 'ok' }, { window: 'week', state: 'ok' }] };
  assert.deepEqual(toEnforcementDecision(verdict), { decision: 'allow', capWindow: null });
});

test('toEnforcementDecision: warn state maps to allow with a null capWindow (advisory, not a blocker)', () => {
  const verdict = { state: 'warn', windows: [{ window: '5h', state: 'warn' }, { window: 'week', state: 'ok' }] };
  assert.deepEqual(toEnforcementDecision(verdict), { decision: 'allow', capWindow: null });
});

test('toEnforcementDecision: halt on the 5h window maps to deny with capWindow "5h"', () => {
  const verdict = { state: 'halt', windows: [{ window: '5h', state: 'halt' }, { window: 'week', state: 'ok' }] };
  assert.deepEqual(toEnforcementDecision(verdict), { decision: 'deny', capWindow: '5h' });
});

test('toEnforcementDecision: halt on the week window (5h still ok) maps to deny with capWindow "week"', () => {
  const verdict = { state: 'halt', windows: [{ window: '5h', state: 'ok' }, { window: 'week', state: 'halt' }] };
  assert.deepEqual(toEnforcementDecision(verdict), { decision: 'deny', capWindow: 'week' });
});

test('toEnforcementDecision: end-to-end halt from agentBudgetVerdict maps through correctly', () => {
  const ledger = openLedger(':memory:');
  appendEvent(ledger, evt({ ts: new Date(NOW - 60_000).toISOString(), totalTokens: 1000 }));
  const policy = policyWith({ per_5h_tokens: 1000, per_week_tokens: 5000 });
  const v = agentBudgetVerdict(ledger, { agent: 'claude', now: NOW, policy });
  assert.deepEqual(toEnforcementDecision(v), { decision: 'deny', capWindow: '5h' });
});

// ─── makeCheckVerdict ────────────────────────────────────────────────────────

test('makeCheckVerdict: returns deny when the agent is over its cap in a seeded ledger', () => {
  const ledger = openLedger(':memory:');
  appendEvent(ledger, evt({ ts: new Date(NOW - 60_000).toISOString(), totalTokens: 1000 }));
  const policy = policyWith({ per_5h_tokens: 1000, per_week_tokens: 5000 });
  const checkVerdict = makeCheckVerdict({ ledger, policy, now: () => NOW });
  const result = checkVerdict({ tenant: 'pv', agent: 'claude' });
  assert.deepEqual(result, { decision: 'deny', capWindow: '5h' });
});

test('makeCheckVerdict: returns allow when the agent is under its cap in a seeded ledger', () => {
  const ledger = openLedger(':memory:');
  appendEvent(ledger, evt({ ts: new Date(NOW - 60_000).toISOString(), totalTokens: 100 }));
  const policy = policyWith({ per_5h_tokens: 1000, per_week_tokens: 5000 });
  const checkVerdict = makeCheckVerdict({ ledger, policy, now: () => NOW });
  const result = checkVerdict({ tenant: 'pv', agent: 'claude' });
  assert.deepEqual(result, { decision: 'allow', capWindow: null });
});

test('makeCheckVerdict: re-evaluates now() on every call (fresh spend each request)', () => {
  const ledger = openLedger(':memory:');
  // Event is fresh relative to NOW, but will have aged out of the 5h window by NOW + 6h.
  appendEvent(ledger, evt({ ts: new Date(NOW - 60_000).toISOString(), totalTokens: 1000 }));
  const policy = policyWith({ per_5h_tokens: 1000, per_week_tokens: 5000 });
  let clock = NOW;
  const checkVerdict = makeCheckVerdict({ ledger, policy, now: () => clock });

  assert.deepEqual(checkVerdict({ tenant: 'pv', agent: 'claude' }), { decision: 'deny', capWindow: '5h' });

  clock = NOW + 6 * 60 * 60 * 1000; // 6h later: event has aged out of the 5h window
  assert.deepEqual(checkVerdict({ tenant: 'pv', agent: 'claude' }), { decision: 'allow', capWindow: null });
});

test('makeCheckVerdict: scopes by ctx.agent (a different agent with no events gets allow)', () => {
  const ledger = openLedger(':memory:');
  appendEvent(ledger, evt({ agent: 'claude', ts: new Date(NOW - 60_000).toISOString(), totalTokens: 1000 }));
  const policy = { agent_budget: { claude: { per_5h_tokens: 1000, per_week_tokens: 5000 }, other: { per_5h_tokens: 1000, per_week_tokens: 5000 } } };
  const checkVerdict = makeCheckVerdict({ ledger, policy, now: () => NOW });
  assert.deepEqual(checkVerdict({ tenant: 'pv', agent: 'other' }), { decision: 'allow', capWindow: null });
});

// ─── cost-based caps (opt-in, additive to token caps) ───────────────────────

test('cost cap: halt once summed cost_usd is at/over per_5h_cost_usd (token cap unused)', () => {
  const ledger = openLedger(':memory:');
  appendEvent(ledger, evt({ ts: new Date(NOW - 60_000).toISOString(), totalTokens: 10, costUsd: 0.6 }));
  const policy = policyWith({ per_5h_cost_usd: 0.5, per_week_cost_usd: 5 });
  const v = agentBudgetVerdict(ledger, { agent: 'claude', now: NOW, policy });
  assert.equal(v.state, 'halt');
  assert.deepEqual(toEnforcementDecision(v), { decision: 'deny', capWindow: '5h' });
});

test('cost cap: ok while cost is under the cap', () => {
  const ledger = openLedger(':memory:');
  appendEvent(ledger, evt({ ts: new Date(NOW - 60_000).toISOString(), totalTokens: 10, costUsd: 0.1 }));
  const policy = policyWith({ per_5h_cost_usd: 0.5, per_week_cost_usd: 5 });
  const v = agentBudgetVerdict(ledger, { agent: 'claude', now: NOW, policy });
  assert.equal(v.state, 'ok');
  assert.deepEqual(toEnforcementDecision(v), { decision: 'allow', capWindow: null });
});

test('cost cap: never denies on UNKNOWN cost — cache-heavy near-free work is not blocked', () => {
  // The over-penalization case cost caps exist to fix: huge token totals whose cost is null/unknown.
  const ledger = openLedger(':memory:');
  appendEvent(ledger, evt({ ts: new Date(NOW - 60_000).toISOString(), totalTokens: 500_000, costUsd: null }));
  const policy = policyWith({ per_5h_cost_usd: 0.5, per_week_cost_usd: 5 }); // ONLY cost caps, no token cap
  const v = agentBudgetVerdict(ledger, { agent: 'claude', now: NOW, policy });
  assert.equal(v.state, 'ok'); // unknown cost sums to 0 → under cap → allowed
  assert.deepEqual(toEnforcementDecision(v), { decision: 'allow', capWindow: null });
});

test('token + cost caps combine: token OK but cost over → deny (cost cap halts independently)', () => {
  const ledger = openLedger(':memory:');
  appendEvent(ledger, evt({ ts: new Date(NOW - 60_000).toISOString(), totalTokens: 100, costUsd: 2 }));
  const policy = policyWith({ per_5h_tokens: 100_000, per_week_tokens: 500_000, per_5h_cost_usd: 1, per_week_cost_usd: 10 });
  const v = agentBudgetVerdict(ledger, { agent: 'claude', now: NOW, policy });
  assert.equal(v.state, 'halt');
  assert.deepEqual(toEnforcementDecision(v), { decision: 'deny', capWindow: '5h' });
});

test('token + cost caps combine: cost OK but tokens over → still deny (token cap unchanged)', () => {
  const ledger = openLedger(':memory:');
  appendEvent(ledger, evt({ ts: new Date(NOW - 60_000).toISOString(), totalTokens: 1000, costUsd: 0.01 }));
  const policy = policyWith({ per_5h_tokens: 1000, per_week_tokens: 5000, per_5h_cost_usd: 100, per_week_cost_usd: 500 });
  const v = agentBudgetVerdict(ledger, { agent: 'claude', now: NOW, policy });
  assert.equal(v.state, 'halt');
  assert.deepEqual(toEnforcementDecision(v), { decision: 'deny', capWindow: '5h' });
});

test('no cost caps set → verdict is byte-identical to the token-only path (backward compat)', () => {
  const ledger = openLedger(':memory:');
  appendEvent(ledger, evt({ ts: new Date(NOW - 60_000).toISOString(), totalTokens: 850, costUsd: 999 }));
  const policy = policyWith({ per_5h_tokens: 1000, per_week_tokens: 5000 }); // no cost caps
  const v = agentBudgetVerdict(ledger, { agent: 'claude', now: NOW, policy });
  assert.equal(v.state, 'warn'); // 850/1000 = 85% ≥ warn_pct 80 — cost (999) ignored, no cost cap
});
