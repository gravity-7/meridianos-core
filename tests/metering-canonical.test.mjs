import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readUsage, meterRun } from '../usage-readers.mjs';
import { openLedger, appendEvent } from '../gateway/ledger.mjs';
import { makeTokenEvent } from '../gateway/token-event.mjs';

// ─── fixtures ────────────────────────────────────────────────────────────────

const claudeLine = (model, input, output, cw = 0) => JSON.stringify({
  timestamp: new Date().toISOString(),
  message: { role: 'assistant', model, usage: { input_tokens: input, output_tokens: output, cache_creation_input_tokens: cw, cache_read_input_tokens: 0 } },
});

function fakeClaudeHome({ sessionId, lines }) {
  const home = mkdtempSync(join(tmpdir(), 'mc-claude-home-'));
  const projectDir = join(home, '.claude', 'projects', 'some-project');
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, `${sessionId}.jsonl`), lines.join('\n') + '\n');
  return home;
}

function evt(overrides = {}) {
  return makeTokenEvent({
    tenant: 'pv',
    agent: 'claude',
    session: 'sess-1',
    requestId: `req-${Math.random()}`,
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    wire: 'anthropic',
    ...overrides,
  });
}

const gwConfig = (tenant = 'pv') => ({ gateway: { enabled: true, registry: { tenant } } });

// ─── AC1: gateway on + matching ledger event → ledger wins ──────────────────

test('AC1: gateway on with a matching ledger event returns the ledger totals, source "ledger"', () => {
  const ledger = openLedger(':memory:');
  appendEvent(ledger, evt({
    ts: '2026-01-01T00:30:00.000Z',
    inputTokens: 1000, outputTokens: 200, totalTokens: 1200, costUsd: 0.05,
  }));

  const run = {
    agent: 'claude', harness: 'claude-code', session: 'sess-1',
    startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T01:00:00.000Z',
  };
  const m = meterRun(run, {}, { config: gwConfig(), ledger });
  assert.deepEqual(m, { tokensIn: 1000, tokensOut: 200, costUsd: 0.05, source: 'ledger' });
});

test('AC1: ledger match is scoped by tenant + agent, not just time window', () => {
  const ledger = openLedger(':memory:');
  // A different agent's event in the exact same window must NOT be picked up.
  appendEvent(ledger, evt({ agent: 'other-agent', ts: '2026-01-01T00:30:00.000Z', inputTokens: 999, outputTokens: 999, totalTokens: 1998, costUsd: 9 }));
  appendEvent(ledger, evt({ agent: 'claude', ts: '2026-01-01T00:15:00.000Z', inputTokens: 50, outputTokens: 10, totalTokens: 60, costUsd: 0.01 }));

  const run = { agent: 'claude', harness: 'claude-code', session: 'sess-1', startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T01:00:00.000Z' };
  const m = meterRun(run, {}, { config: gwConfig(), ledger });
  assert.equal(m.source, 'ledger');
  assert.equal(m.tokensIn, 50);
  assert.equal(m.tokensOut, 10);
  assert.equal(m.costUsd, 0.01);
});

// ─── AC2: gateway off → usage-reader path, byte-identical to readUsage ──────

test('AC2: gateway off returns the usage-reader result, numbers byte-identical to readUsage', () => {
  const home = fakeClaudeHome({ sessionId: 'sess-off', lines: [claudeLine('claude-opus-4-8', 500, 100, 20)] });
  const run = { agent: 'claude', harness: 'claude-code', session: 'sess-off', provider: { name: 'anthropic' } };
  const overrides = { home };

  const direct = readUsage('claude-code', run, {}, overrides);
  const m = meterRun(run, {}, { config: { gateway: { enabled: false } }, overrides });

  assert.equal(m.source, 'usage-reader');
  assert.equal(m.tokensIn, direct.inputTokens);
  assert.equal(m.tokensOut, direct.outputTokens);
  assert.equal(m.tokensIn, 520);
  assert.equal(m.tokensOut, 100);
});

test('AC2: no config at all (gateway absent) also takes the usage-reader path', () => {
  const home = fakeClaudeHome({ sessionId: 'sess-noconfig', lines: [claudeLine('claude-sonnet-5', 30, 6)] });
  const run = { agent: 'claude', harness: 'claude-code', session: 'sess-noconfig' };
  const m = meterRun(run, {}, { overrides: { home } });
  assert.equal(m.source, 'usage-reader');
  assert.equal(m.tokensIn, 30);
  assert.equal(m.tokensOut, 6);
});

// ─── AC3: gateway on but no matching ledger event → falls back ──────────────

test('AC3: gateway on but ledger has no matching event falls back to usage-reader', () => {
  const home = fakeClaudeHome({ sessionId: 'sess-fallback', lines: [claudeLine('claude-sonnet-5', 400, 80)] });
  const ledger = openLedger(':memory:'); // empty — no events at all

  const run = { agent: 'claude', harness: 'claude-code', session: 'sess-fallback', startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T01:00:00.000Z' };
  const m = meterRun(run, {}, { config: gwConfig(), ledger, overrides: { home } });
  assert.equal(m.source, 'usage-reader');
  assert.equal(m.tokensIn, 400);
  assert.equal(m.tokensOut, 80);
});

test('AC3: gateway on with ledger events outside the run window falls back to usage-reader', () => {
  const home = fakeClaudeHome({ sessionId: 'sess-outside', lines: [claudeLine('claude-sonnet-5', 10, 2)] });
  const ledger = openLedger(':memory:');
  // Event exists for this tenant+agent, but well before the run's own window.
  appendEvent(ledger, evt({ ts: '2025-01-01T00:00:00.000Z', inputTokens: 777, outputTokens: 777, totalTokens: 1554, costUsd: 1 }));

  const run = { agent: 'claude', harness: 'claude-code', session: 'sess-outside', startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T01:00:00.000Z' };
  const m = meterRun(run, {}, { config: gwConfig(), ledger, overrides: { home } });
  assert.equal(m.source, 'usage-reader');
  assert.equal(m.tokensIn, 10);
  assert.equal(m.tokensOut, 2);
});

// ─── never-guess: zeros with an explicit source when nothing is known ───────

test('never guesses: gateway off + no reader data returns zeros tagged "usage-reader", not fabricated', () => {
  const run = { agent: 'claude', harness: 'claude-code', session: 'zz-nonexistent-' + Math.random() };
  const m = meterRun(run, {}, { config: { gateway: { enabled: false } } });
  assert.deepEqual(m, { tokensIn: 0, tokensOut: 0, costUsd: 0, source: 'usage-reader' });
});

test('never guesses: gateway on, no ledger event AND no reader data returns zeros tagged "usage-reader"', () => {
  const ledger = openLedger(':memory:');
  const run = { agent: 'claude', harness: 'claude-code', session: 'zz-nonexistent-' + Math.random() };
  const m = meterRun(run, {}, { config: gwConfig(), ledger });
  assert.deepEqual(m, { tokensIn: 0, tokensOut: 0, costUsd: 0, source: 'usage-reader' });
});

test('gateway on but tenant missing from registry falls back to usage-reader rather than throwing', () => {
  const home = fakeClaudeHome({ sessionId: 'sess-notenant', lines: [claudeLine('claude-sonnet-5', 5, 1)] });
  const ledger = openLedger(':memory:');
  const run = { agent: 'claude', harness: 'claude-code', session: 'sess-notenant' };
  const m = meterRun(run, {}, { config: { gateway: { enabled: true, registry: {} } }, ledger, overrides: { home } });
  assert.equal(m.source, 'usage-reader');
  assert.equal(m.tokensIn, 5);
});
