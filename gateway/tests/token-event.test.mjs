import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTokenEvent, validateTokenEvent, tokenEventToUsage } from '../token-event.mjs';

function fullEvent(overrides = {}) {
  return makeTokenEvent({
    agent: 'claude',
    session: 'sess-1',
    requestId: 'req-1',
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    wire: 'anthropic',
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 150,
    costUsd: 0.01,
    ...overrides,
  });
}

// ─── makeTokenEvent ─────────────────────────────────────────────────────────

test('makeTokenEvent assigns a unique id and an ISO-8601 ts when absent', () => {
  const a = makeTokenEvent({});
  const b = makeTokenEvent({});
  assert.equal(typeof a.id, 'string');
  assert.ok(a.id.length > 0);
  assert.notEqual(a.id, b.id);
  assert.equal(new Date(a.ts).toISOString(), a.ts);
});

test('makeTokenEvent preserves an explicit id and ts', () => {
  const evt = makeTokenEvent({ id: 'fixed-id', ts: '2026-01-01T00:00:00.000Z' });
  assert.equal(evt.id, 'fixed-id');
  assert.equal(evt.ts, '2026-01-01T00:00:00.000Z');
});

test('makeTokenEvent defaults tenant to pv', () => {
  const evt = makeTokenEvent({});
  assert.equal(evt.tenant, 'pv');
});

test('makeTokenEvent honors a configurable defaultTenant', () => {
  const evt = makeTokenEvent({}, { defaultTenant: 'acme' });
  assert.equal(evt.tenant, 'acme');
});

test('makeTokenEvent preserves an explicit tenant over the default', () => {
  const evt = makeTokenEvent({ tenant: 'explicit' }, { defaultTenant: 'acme' });
  assert.equal(evt.tenant, 'explicit');
});

test('makeTokenEvent defaults enforcementDecision to allow', () => {
  const evt = makeTokenEvent({});
  assert.equal(evt.enforcementDecision, 'allow');
});

test('makeTokenEvent leaves unknown token/cost fields as null, never fabricated as 0', () => {
  const evt = makeTokenEvent({});
  assert.equal(evt.inputTokens, null);
  assert.equal(evt.outputTokens, null);
  assert.equal(evt.cacheReadTokens, null);
  assert.equal(evt.cacheWriteTokens, null);
  assert.equal(evt.totalTokens, null);
  assert.equal(evt.costUsd, null);
});

test('makeTokenEvent does not auto-compute totalTokens from components', () => {
  const evt = makeTokenEvent({ inputTokens: 10, outputTokens: 20 });
  assert.equal(evt.totalTokens, null);
});

test('makeTokenEvent leaves nullable attribution fields as null by default', () => {
  const evt = makeTokenEvent({});
  assert.equal(evt.task, null);
  assert.equal(evt.runId, null);
  assert.equal(evt.capWindow, null);
});

// ─── validateTokenEvent — happy path ────────────────────────────────────────

test('validateTokenEvent passes on a fully-formed event from makeTokenEvent', () => {
  assert.equal(validateTokenEvent(fullEvent()), true);
});

test('validateTokenEvent passes when nullable fields are null', () => {
  const evt = fullEvent({ task: null, runId: null, upstreamStatus: null, latencyMs: null, capWindow: null });
  assert.equal(validateTokenEvent(evt), true);
});

test('validateTokenEvent passes with null usage/cost fields (unknown, not fabricated)', () => {
  const evt = fullEvent({ inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, totalTokens: null, costUsd: null });
  assert.equal(validateTokenEvent(evt), true);
});

// ─── validateTokenEvent — throws on the first malformed field ──────────────

test('validateTokenEvent throws on a non-object', () => {
  assert.throws(() => validateTokenEvent(null), /object/);
  assert.throws(() => validateTokenEvent('nope'), /object/);
});

test('validateTokenEvent throws on a missing id', () => {
  const evt = fullEvent(); delete evt.id;
  assert.throws(() => validateTokenEvent(evt), /id/);
});

test('validateTokenEvent throws on a missing ts', () => {
  const evt = fullEvent(); evt.ts = '';
  assert.throws(() => validateTokenEvent(evt), /ts/);
});

test('validateTokenEvent throws on an empty tenant', () => {
  const evt = fullEvent(); evt.tenant = '';
  assert.throws(() => validateTokenEvent(evt), /tenant/);
});

test('validateTokenEvent throws when agent is not a string', () => {
  const evt = fullEvent(); evt.agent = null;
  assert.throws(() => validateTokenEvent(evt), /agent/);
});

test('validateTokenEvent throws when session is empty', () => {
  const evt = fullEvent(); evt.session = '';
  assert.throws(() => validateTokenEvent(evt), /session/);
});

test('validateTokenEvent throws when requestId is missing', () => {
  const evt = fullEvent(); evt.requestId = '';
  assert.throws(() => validateTokenEvent(evt), /requestId/);
});

test('validateTokenEvent throws when task is a non-string, non-null value', () => {
  const evt = fullEvent(); evt.task = 123;
  assert.throws(() => validateTokenEvent(evt), /task/);
});

test('validateTokenEvent throws when runId is a non-string, non-null value', () => {
  const evt = fullEvent(); evt.runId = 123;
  assert.throws(() => validateTokenEvent(evt), /runId/);
});

test('validateTokenEvent throws on an empty provider', () => {
  const evt = fullEvent(); evt.provider = '';
  assert.throws(() => validateTokenEvent(evt), /provider/);
});

test('validateTokenEvent throws on an empty model', () => {
  const evt = fullEvent(); evt.model = '';
  assert.throws(() => validateTokenEvent(evt), /model/);
});

test('validateTokenEvent throws on an invalid wire', () => {
  const evt = fullEvent(); evt.wire = 'grpc';
  assert.throws(() => validateTokenEvent(evt), /wire/);
});

test('validateTokenEvent throws when upstreamStatus is not a number or null', () => {
  const evt = fullEvent(); evt.upstreamStatus = '200';
  assert.throws(() => validateTokenEvent(evt), /upstreamStatus/);
});

test('validateTokenEvent throws when latencyMs is not a number or null', () => {
  const evt = fullEvent(); evt.latencyMs = '12';
  assert.throws(() => validateTokenEvent(evt), /latencyMs/);
});

for (const field of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'totalTokens']) {
  test(`validateTokenEvent throws when ${field} is not a number or null`, () => {
    const evt = fullEvent(); evt[field] = 'lots';
    assert.throws(() => validateTokenEvent(evt), new RegExp(field));
  });
}

test('validateTokenEvent throws when costUsd is not a number or null', () => {
  const evt = fullEvent(); evt.costUsd = '0.01';
  assert.throws(() => validateTokenEvent(evt), /costUsd/);
});

test('validateTokenEvent throws on an invalid enforcementDecision', () => {
  const evt = fullEvent(); evt.enforcementDecision = 'maybe';
  assert.throws(() => validateTokenEvent(evt), /enforcementDecision/);
});

test('validateTokenEvent throws on an invalid capWindow', () => {
  const evt = fullEvent(); evt.capWindow = 'month';
  assert.throws(() => validateTokenEvent(evt), /capWindow/);
});

test('validateTokenEvent accepts both valid capWindow values', () => {
  assert.equal(validateTokenEvent(fullEvent({ capWindow: '5h' })), true);
  assert.equal(validateTokenEvent(fullEvent({ capWindow: 'week' })), true);
});

test('validateTokenEvent accepts every valid enforcementDecision', () => {
  for (const d of ['allow', 'deny', 'degrade']) {
    assert.equal(validateTokenEvent(fullEvent({ enforcementDecision: d })), true);
  }
});

// ─── tokenEventToUsage — superset drop-in for usage-readers.mjs ────────────

test('tokenEventToUsage projects the exact usage-readers.mjs shape', () => {
  const evt = fullEvent();
  const usage = tokenEventToUsage(evt);
  assert.deepEqual(Object.keys(usage).sort(), ['inputTokens', 'model', 'outputTokens', 'provider', 'totalTokens'].sort());
  assert.equal(usage.inputTokens, evt.inputTokens);
  assert.equal(usage.outputTokens, evt.outputTokens);
  assert.equal(usage.totalTokens, evt.totalTokens);
  assert.equal(usage.provider, evt.provider);
  assert.equal(usage.model, evt.model);
});

test('tokenEventToUsage preserves null-is-unknown, never coerces null to 0', () => {
  const evt = fullEvent({ inputTokens: null, outputTokens: null, totalTokens: null });
  const usage = tokenEventToUsage(evt);
  assert.equal(usage.inputTokens, null);
  assert.equal(usage.outputTokens, null);
  assert.equal(usage.totalTokens, null);
});
