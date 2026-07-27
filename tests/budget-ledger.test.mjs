/**
 * budget-ledger — C9 (ADR 0001, scope item 5, second half): proves budget.mjs's per-agent 5h/week
 * budget windows are sourced from the SAME gateway ledger the gateway itself enforces on
 * (gateway/ledger.mjs's `queryWindow`) when `config.gateway.enabled === true` — "one canonical
 * ledger" for both metering and budgeting, so caps and metering can never disagree.
 *
 * AC5: with the gateway on, a per-agent window computed by `budgetStatus` equals `queryWindow`'s
 *      own totals for that tenant+agent+window — the ledger IS the source of truth.
 * AC6: with `config.gateway` absent or `enabled: false`, budget verdicts are byte-identical to the
 *      pre-C9 meter-reader path — proven here AND by tests/budget.test.mjs staying green,
 *      unmodified (run separately: `node --test tests/budget.test.mjs`).
 *
 * Hermetic: every ledger is `:memory:` (no `.ai/gateway/ledger.db` touched), every config is built
 * via `resolvePaths({ root: <tmp>, domain: FIXTURE_DOMAIN-derived })` — no ambient repo `.ai/`
 * state, no live escalation secret.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { budgetStatus, ledgerWindowUsage } from '../budget.mjs';
import { resolvePaths } from '../config.mjs';
import { openLedger, appendEvent, queryWindow } from '../gateway/ledger.mjs';
import { makeTokenEvent } from '../gateway/token-event.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';

const H5 = 5 * 60 * 60 * 1000;
const WEEK = 7 * 24 * 60 * 60 * 1000;

// Same roster shape tests/budget.test.mjs uses (claude=transcript, antigravity=protobuf) — the
// meter-reader path (AC6) needs a real roster/meter mapping to exercise, even though the AC5
// ledger path never touches those readers at all.
function freshConfig() {
  const root = mkdtempSync(join(tmpdir(), 'bg-ledger-root-'));
  const domain = { ...FIXTURE_DOMAIN, agents: ['claude', 'antigravity'], budgetMeter: { claude: 'transcript', antigravity: 'protobuf' } };
  return resolvePaths({ root, domain });
}

function evt(overrides = {}) {
  return makeTokenEvent({
    tenant: 'pv', agent: 'claude', session: 'sess-1', requestId: `req-${Math.random()}`,
    provider: 'anthropic', model: 'claude-sonnet-5', wire: 'anthropic',
    ...overrides,
  });
}

// ─── AC5: ledger is the source of truth when the gateway is on ─────────────

test('AC5: budgetStatus per-agent window usage equals queryWindow ledger totals, tenant+agent scoped', () => {
  const now = Date.parse('2026-07-18T12:00:00Z');
  const ledger = openLedger(':memory:');

  // claude: two events inside the 5h window, one 6h ago (inside week, outside 5h).
  appendEvent(ledger, evt({ agent: 'claude', ts: new Date(now - 60 * 60 * 1000).toISOString(), inputTokens: 1000, outputTokens: 200, totalTokens: 1200, costUsd: 0.05 }));
  appendEvent(ledger, evt({ agent: 'claude', ts: new Date(now - 30 * 60 * 1000).toISOString(), inputTokens: 500, outputTokens: 100, totalTokens: 600, costUsd: 0.02 }));
  appendEvent(ledger, evt({ agent: 'claude', ts: new Date(now - 6 * 60 * 60 * 1000).toISOString(), inputTokens: 300, outputTokens: 50, totalTokens: 350, costUsd: 0.01 }));
  // a different agent's event in the SAME window must not bleed into claude's totals.
  appendEvent(ledger, evt({ agent: 'antigravity', ts: new Date(now - 60 * 60 * 1000).toISOString(), inputTokens: 9999, outputTokens: 9999, totalTokens: 19998, costUsd: 5 }));

  const config = { ...freshConfig(), gateway: { url: 'http://127.0.0.1:9999', enabled: true, registry: { tenant: 'pv' } } };
  const policy = { agent_budget: { warn_pct: 80, claude: { per_5h_tokens: 100000, per_week_tokens: 1000000 }, antigravity: { per_5h_tokens: 100000, per_week_tokens: 1000000 } } };
  const s = budgetStatus({ config, policy, now, runs: [], ledger });

  const nowIso = new Date(now).toISOString();
  const w5 = queryWindow(ledger, { tenant: 'pv', agent: 'claude', since: new Date(now - H5).toISOString(), until: nowIso });
  const wWeek = queryWindow(ledger, { tenant: 'pv', agent: 'claude', since: new Date(now - WEEK).toISOString(), until: nowIso });

  assert.equal(s.claude.source, 'ledger');
  assert.equal(s.claude.usage.last5h.billable, w5.totalTokens);
  assert.equal(s.claude.usage.last7d.billable, wWeek.totalTokens);
  assert.equal(s.claude.usage.last5h.billable, 1800); // 1200 + 600 (the 350 one is 6h ago)
  assert.equal(s.claude.usage.last7d.billable, 2150); // all three claude events

  // The other agent's window is scoped to ITS OWN tenant+agent ledger rows only.
  const agW5 = queryWindow(ledger, { tenant: 'pv', agent: 'antigravity', since: new Date(now - H5).toISOString(), until: nowIso });
  assert.equal(s.antigravity.usage.last5h.billable, agW5.totalTokens);
  assert.equal(s.antigravity.usage.last5h.billable, 19998);
});

test('AC5: ledger-sourced verdict halts/warns exactly like verdictFor thresholds on transcript usage', () => {
  const now = Date.parse('2026-07-18T12:00:00Z');
  const ledger = openLedger(':memory:');
  appendEvent(ledger, evt({ agent: 'claude', ts: new Date(now - 60 * 60 * 1000).toISOString(), inputTokens: 800000, outputTokens: 100000, totalTokens: 900000, costUsd: 1 }));

  const config = { ...freshConfig(), gateway: { url: 'http://127.0.0.1:9999', enabled: true, registry: { tenant: 'pv' } } };
  const policy = { agent_budget: { warn_pct: 80, claude: { per_5h_tokens: 800000, per_week_tokens: 6000000 } } };
  const s = budgetStatus({ config, policy, now, runs: [], ledger });

  assert.equal(s.claude.state, 'halt'); // 900k >= 800k cap
  assert.equal(s.mayClaim.claude, false);
});

test('AC5: never fabricates — an agent with zero ledger rows reports 0 usage, not a crash', () => {
  const now = Date.parse('2026-07-18T12:00:00Z');
  const ledger = openLedger(':memory:'); // completely empty
  const config = { ...freshConfig(), gateway: { url: 'http://127.0.0.1:9999', enabled: true, registry: { tenant: 'pv' } } };
  const policy = { agent_budget: { warn_pct: 80, claude: { per_5h_tokens: 1000, per_week_tokens: 10000 } } };

  const s = budgetStatus({ config, policy, now, runs: [], ledger });
  assert.equal(s.claude.source, 'ledger');
  assert.equal(s.claude.usage.last5h.billable, 0);
  assert.equal(s.claude.usage.last7d.billable, 0);
  assert.equal(s.claude.state, 'ok');
  assert.equal(s.mayClaim.claude, true);
});

test('AC5: week_anchor policy lever is honoured identically on the ledger path (same weekWindow boundary)', () => {
  const anchor = Date.parse('2026-07-15T00:00:00Z'); // a known weekly reset instant
  const now = anchor + 2 * 24 * 60 * 60 * 1000; // 2 days after the anchor's most recent recurrence
  const ledger = openLedger(':memory:');

  // one event 1 day before `now` (inside this week's window, since the anchor recurs weekly)
  appendEvent(ledger, evt({ agent: 'claude', ts: new Date(now - 24 * 60 * 60 * 1000).toISOString(), inputTokens: 100, outputTokens: 20, totalTokens: 120, costUsd: 0 }));
  // one event well before the anchor recurrence — must NOT count toward this week's window
  appendEvent(ledger, evt({ agent: 'claude', ts: new Date(anchor - 24 * 60 * 60 * 1000).toISOString(), inputTokens: 5000, outputTokens: 5000, totalTokens: 10000, costUsd: 0 }));

  const config = { ...freshConfig(), gateway: { url: 'http://127.0.0.1:9999', enabled: true, registry: { tenant: 'pv' } } };
  const policy = { agent_budget: { warn_pct: 80, week_anchor: new Date(anchor).toISOString(), claude: { per_week_tokens: 1000000 } } };
  const s = budgetStatus({ config, policy, now, runs: [], ledger });

  assert.equal(s.claude.usage.last7d.billable, 120); // only the post-anchor event
});

// ─── AC6: gateway absent/disabled ⇒ byte-identical to the pre-C9 meter-reader path ──

const claudeLine = (ts, input, output) => JSON.stringify({
  timestamp: new Date(ts).toISOString(),
  message: { role: 'assistant', model: 'claude-opus-4-8', usage: { input_tokens: input, output_tokens: output, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
});

test('AC6: gateway entirely absent from config ⇒ meter-reader path, source "meter"', () => {
  const now = Date.parse('2026-07-18T12:00:00Z');
  const cdir = mkdtempSync(join(tmpdir(), 'bg-ledger-meter-'));
  writeFileSync(join(cdir, 's.jsonl'), claudeLine(now - 60 * 60 * 1000, 500, 100) + '\n');

  const config = freshConfig(); // no `.gateway` field at all
  const policy = { agent_budget: { warn_pct: 80, claude: { per_5h_tokens: 100000, per_week_tokens: 1000000 } } };
  const s = budgetStatus({ config, policy, now, agentDirs: { claude: cdir, antigravity: [mkdtempSync(join(tmpdir(), 'bg-ledger-ag-'))] }, runs: [] });

  assert.equal(s.claude.source, 'meter');
  assert.equal(s.claude.usage.last5h.billable, 600);
});

test('AC6: config.gateway.enabled === false ⇒ meter-reader path, even with a ledger that HAS matching rows', () => {
  const now = Date.parse('2026-07-18T12:00:00Z');
  const cdir = mkdtempSync(join(tmpdir(), 'bg-ledger-meter-off-'));
  writeFileSync(join(cdir, 's.jsonl'), claudeLine(now - 60 * 60 * 1000, 500, 100) + '\n');

  const ledger = openLedger(':memory:');
  appendEvent(ledger, evt({ agent: 'claude', ts: new Date(now - 60 * 60 * 1000).toISOString(), inputTokens: 999999, outputTokens: 999999, totalTokens: 1999998, costUsd: 9 }));

  const config = { ...freshConfig(), gateway: { enabled: false, registry: { tenant: 'pv' } } };
  const policy = { agent_budget: { warn_pct: 80, claude: { per_5h_tokens: 100000, per_week_tokens: 1000000 } } };
  // Ledger explicitly passed but MUST be ignored entirely while gateway.enabled is false.
  const s = budgetStatus({ config, policy, now, agentDirs: { claude: cdir, antigravity: [mkdtempSync(join(tmpdir(), 'bg-ledger-ag2-'))] }, runs: [], ledger });

  assert.equal(s.claude.source, 'meter');
  assert.equal(s.claude.usage.last5h.billable, 600); // the transcript number, NOT the ledger's 1999998
  assert.equal(s.claude.state, 'ok');
});

test('AC6: gateway on but tenant missing from registry degrades to the meter-reader path, no crash', () => {
  const now = Date.parse('2026-07-18T12:00:00Z');
  const cdir = mkdtempSync(join(tmpdir(), 'bg-ledger-notenant-'));
  writeFileSync(join(cdir, 's.jsonl'), claudeLine(now - 60 * 60 * 1000, 40, 10) + '\n');

  const config = { ...freshConfig(), gateway: { url: 'http://127.0.0.1:9999', enabled: true, registry: {} } }; // no tenant
  const policy = { agent_budget: { warn_pct: 80, claude: { per_5h_tokens: 100000, per_week_tokens: 1000000 } } };
  const s = budgetStatus({ config, policy, now, agentDirs: { claude: cdir, antigravity: [mkdtempSync(join(tmpdir(), 'bg-ledger-ag3-'))] }, runs: [] });

  assert.equal(s.claude.source, 'meter');
  assert.equal(s.claude.usage.last5h.billable, 50);
});

test('AC6: identical numeric output whether config.gateway is absent or explicitly {enabled:false}', () => {
  const now = Date.parse('2026-07-18T12:00:00Z');
  const cdir = mkdtempSync(join(tmpdir(), 'bg-ledger-parity-'));
  writeFileSync(join(cdir, 's.jsonl'), claudeLine(now - 60 * 60 * 1000, 700, 300) + '\n');
  const adir = mkdtempSync(join(tmpdir(), 'bg-ledger-parity-ag-'));

  const baseConfig = freshConfig();
  const policy = { agent_budget: { warn_pct: 80, claude: { per_5h_tokens: 100000, per_week_tokens: 1000000 } } };
  const opts = { policy, now, agentDirs: { claude: cdir, antigravity: [adir] }, runs: [] };

  const absent = budgetStatus({ config: baseConfig, ...opts });
  const disabled = budgetStatus({ config: { ...baseConfig, gateway: { enabled: false } }, ...opts });

  assert.deepEqual(absent.claude, disabled.claude);
  assert.deepEqual(absent.antigravity, disabled.antigravity);
  assert.deepEqual(absent.mayClaim, disabled.mayClaim);
});

// ─── ledgerWindowUsage — the unit under both AC5 tests above ────────────────

test('ledgerWindowUsage: five_hour_sessions activity-anchoring mirrors claude-usage.mjs session5h semantics', () => {
  const now = Date.parse('2026-07-18T12:00:00Z');
  const ledger = openLedger(':memory:');
  // An old, expired session (6h+ ago) — must NOT be the active window.
  appendEvent(ledger, evt({ agent: 'claude', ts: new Date(now - 7 * 60 * 60 * 1000).toISOString(), inputTokens: 5000, outputTokens: 0, totalTokens: 5000, costUsd: 0 }));
  // The current session: first activity 2h ago (< 5h ago ⇒ still open), one more event since.
  appendEvent(ledger, evt({ agent: 'claude', ts: new Date(now - 2 * 60 * 60 * 1000).toISOString(), inputTokens: 100, outputTokens: 10, totalTokens: 110, costUsd: 0 }));
  appendEvent(ledger, evt({ agent: 'claude', ts: new Date(now - 30 * 60 * 1000).toISOString(), inputTokens: 40, outputTokens: 5, totalTokens: 45, costUsd: 0 }));

  const lu = ledgerWindowUsage(ledger, { tenant: 'pv', agent: 'claude', now, session5h: true });
  assert.equal(lu.last5h.billable, 155); // only the current (still-open) session, old one excluded
  assert.ok(lu.fiveHourSession.start != null);
  assert.equal(lu.fiveHourSession.resetAt, lu.fiveHourSession.start + H5);
});

test('ledgerWindowUsage: no active five_hour_session (last activity > 5h ago) reports 0 for last5h', () => {
  const now = Date.parse('2026-07-18T12:00:00Z');
  const ledger = openLedger(':memory:');
  appendEvent(ledger, evt({ agent: 'claude', ts: new Date(now - 6 * 60 * 60 * 1000).toISOString(), inputTokens: 500, outputTokens: 100, totalTokens: 600, costUsd: 0 }));

  const lu = ledgerWindowUsage(ledger, { tenant: 'pv', agent: 'claude', now, session5h: true });
  assert.equal(lu.last5h.billable, 0);
  assert.equal(lu.fiveHourSession.start, null);
  assert.equal(lu.fiveHourSession.resetAt, null);
});
