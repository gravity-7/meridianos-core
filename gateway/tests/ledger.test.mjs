import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openLedger, appendEvent, queryWindow, listEvents, pruneEvents } from '../ledger.mjs';
import { makeTokenEvent } from '../token-event.mjs';

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

// ─── openLedger / appendEvent ───────────────────────────────────────────────

test('openLedger creates an empty, queryable ledger in-memory', () => {
  const ledger = openLedger(':memory:');
  assert.deepEqual(listEvents(ledger), []);
});

test('appendEvent persists a well-formed event and returns its id', () => {
  const ledger = openLedger(':memory:');
  const e = evt({ id: 'evt-1' });
  const id = appendEvent(ledger, e);
  assert.equal(id, 'evt-1');
  const [stored] = listEvents(ledger);
  assert.equal(stored.id, 'evt-1');
  assert.deepEqual(stored, e);
});

test('appendEvent throws on a malformed event (caller bug), never swallowed', () => {
  const ledger = openLedger(':memory:');
  const bad = evt(); bad.wire = 'grpc';
  assert.throws(() => appendEvent(ledger, bad), /wire/);
  assert.deepEqual(listEvents(ledger), []);
});

test('appendEvent never fabricates null token/cost fields into the stored row', () => {
  const ledger = openLedger(':memory:');
  const e = evt({ inputTokens: null, outputTokens: null, totalTokens: null, costUsd: null });
  appendEvent(ledger, e);
  const [stored] = listEvents(ledger);
  assert.equal(stored.inputTokens, null);
  assert.equal(stored.outputTokens, null);
  assert.equal(stored.totalTokens, null);
  assert.equal(stored.costUsd, null);
});

// ─── queryWindow ─────────────────────────────────────────────────────────────

test('queryWindow sums tokens/cost across matching rows', () => {
  const ledger = openLedger(':memory:');
  appendEvent(ledger, evt({ ts: '2026-01-01T00:00:00.000Z', inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.01 }));
  appendEvent(ledger, evt({ ts: '2026-01-01T01:00:00.000Z', inputTokens: 200, outputTokens: 25, totalTokens: 225, costUsd: 0.02 }));
  const w = queryWindow(ledger, { tenant: 'pv', since: '2026-01-01T00:00:00.000Z', until: '2026-01-02T00:00:00.000Z' });
  assert.equal(w.inputTokens, 300);
  assert.equal(w.outputTokens, 75);
  assert.equal(w.totalTokens, 375);
  assert.equal(w.costUsd, 0.03);
  assert.equal(w.runs, 2);
  assert.equal(w.unknownRuns, 0);
  assert.equal(w.costUnknownRuns, 0);
});

test('queryWindow excludes null-token rows from sums but counts them as unknownRuns', () => {
  const ledger = openLedger(':memory:');
  appendEvent(ledger, evt({ ts: '2026-01-01T00:00:00.000Z', inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.01 }));
  appendEvent(ledger, evt({ ts: '2026-01-01T01:00:00.000Z', inputTokens: null, outputTokens: null, totalTokens: null, costUsd: null }));
  const w = queryWindow(ledger, { tenant: 'pv', since: '2026-01-01T00:00:00.000Z', until: '2026-01-02T00:00:00.000Z' });
  assert.equal(w.inputTokens, 100);
  assert.equal(w.outputTokens, 50);
  assert.equal(w.totalTokens, 150);
  assert.equal(w.costUsd, 0.01);
  assert.equal(w.runs, 2);
  assert.equal(w.unknownRuns, 1);
  assert.equal(w.costUnknownRuns, 1);
});

test('queryWindow filters by window boundaries [since, until)', () => {
  const ledger = openLedger(':memory:');
  appendEvent(ledger, evt({ ts: '2026-01-01T00:00:00.000Z', totalTokens: 10 }));
  appendEvent(ledger, evt({ ts: '2026-01-02T00:00:00.000Z', totalTokens: 20 })); // == until, excluded
  appendEvent(ledger, evt({ ts: '2026-01-01T12:00:00.000Z', totalTokens: 30 }));
  const w = queryWindow(ledger, { tenant: 'pv', since: '2026-01-01T00:00:00.000Z', until: '2026-01-02T00:00:00.000Z' });
  assert.equal(w.runs, 2);
  assert.equal(w.totalTokens, 40);
});

test('queryWindow scopes to tenant and, optionally, one agent', () => {
  const ledger = openLedger(':memory:');
  appendEvent(ledger, evt({ tenant: 'pv', agent: 'claude', totalTokens: 100 }));
  appendEvent(ledger, evt({ tenant: 'pv', agent: 'antigravity', totalTokens: 200 }));
  appendEvent(ledger, evt({ tenant: 'acme', agent: 'claude', totalTokens: 999 }));

  const allPv = queryWindow(ledger, { tenant: 'pv' });
  assert.equal(allPv.runs, 2);
  assert.equal(allPv.totalTokens, 300);

  const claudeOnly = queryWindow(ledger, { tenant: 'pv', agent: 'claude' });
  assert.equal(claudeOnly.runs, 1);
  assert.equal(claudeOnly.totalTokens, 100);
});

// ─── listEvents ──────────────────────────────────────────────────────────────

test('listEvents returns newest first', () => {
  const ledger = openLedger(':memory:');
  appendEvent(ledger, evt({ id: 'e1', ts: '2026-01-01T00:00:00.000Z' }));
  appendEvent(ledger, evt({ id: 'e2', ts: '2026-01-02T00:00:00.000Z' }));
  appendEvent(ledger, evt({ id: 'e3', ts: '2026-01-03T00:00:00.000Z' }));
  const ids = listEvents(ledger).map((e) => e.id);
  assert.deepEqual(ids, ['e3', 'e2', 'e1']);
});

test('listEvents respects limit and tenant/agent filters', () => {
  const ledger = openLedger(':memory:');
  appendEvent(ledger, evt({ id: 'e1', tenant: 'pv', agent: 'claude' }));
  appendEvent(ledger, evt({ id: 'e2', tenant: 'pv', agent: 'antigravity' }));
  appendEvent(ledger, evt({ id: 'e3', tenant: 'acme', agent: 'claude' }));

  assert.equal(listEvents(ledger, { limit: 1 }).length, 1);
  const pvOnly = listEvents(ledger, { tenant: 'pv' }).map((e) => e.id).sort();
  assert.deepEqual(pvOnly, ['e1', 'e2']);
  const pvClaude = listEvents(ledger, { tenant: 'pv', agent: 'claude' }).map((e) => e.id);
  assert.deepEqual(pvClaude, ['e1']);
});

// ─── pruneEvents ─────────────────────────────────────────────────────────────

test('pruneEvents keeps only the newest N rows', () => {
  const ledger = openLedger(':memory:');
  for (let i = 0; i < 5; i++) {
    appendEvent(ledger, evt({ id: `e${i}`, ts: `2026-01-0${i + 1}T00:00:00.000Z` }));
  }
  const deleted = pruneEvents(ledger, { keep: 2 });
  assert.equal(deleted, 3);
  const remaining = listEvents(ledger).map((e) => e.id);
  assert.deepEqual(remaining, ['e4', 'e3']);
});

test('pruneEvents is a no-op when row count is within keep', () => {
  const ledger = openLedger(':memory:');
  appendEvent(ledger, evt({ id: 'e1' }));
  assert.equal(pruneEvents(ledger, { keep: 50000 }), 0);
  assert.equal(listEvents(ledger).length, 1);
});
