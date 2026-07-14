/**
 * Tests for gateway/registry-pull.mjs (3.4b)
 *
 * All sources are stubs — no real HTTP or network calls.
 * Poller tests use short intervalMs and Promise-based ticks to stay fast and non-flaky.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRegistryStore, pullOnce, startRegistryPoll } from '../registry-pull.mjs';
import { PROVIDERS } from '../../providers.mjs';

// ─── Shared helpers ──────────────────────────────────────────────────────────

/** Minimal valid registry envelope for testing. */
function makeReg(version, extra = {}) {
  return {
    version,
    generatedAt: '2026-07-14T00:00:00.000Z',
    tenant: 'pv',
    providers: { anthropic: PROVIDERS.anthropic },
    routes: {},
    ...extra,
  };
}

/** Waits at least `ms` milliseconds (macrotask boundary). */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── createRegistryStore — get() ────────────────────────────────────────────

test('get() returns null before any apply', () => {
  const store = createRegistryStore();
  assert.equal(store.get(), null);
});

test('get() returns null when explicitly initialised with null', () => {
  const store = createRegistryStore(null);
  assert.equal(store.get(), null);
});

test('get() returns the initial registry when one is supplied', () => {
  const reg = makeReg(1);
  const store = createRegistryStore(reg);
  assert.equal(store.get(), reg);
});

// ─── createRegistryStore — applyIfNewer: first apply ────────────────────────

test('applyIfNewer: first valid apply succeeds (null → v1)', () => {
  const store = createRegistryStore();
  const reg = makeReg(1);
  const result = store.applyIfNewer(reg);
  assert.deepEqual(result, { applied: true, version: 1 });
  assert.equal(store.get(), reg);
});

test('applyIfNewer: applied registry is the exact object (no clone)', () => {
  const store = createRegistryStore();
  const reg = makeReg(1);
  store.applyIfNewer(reg);
  assert.equal(store.get() === reg, true);
});

// ─── createRegistryStore — applyIfNewer: version monotonicity ───────────────

test('applyIfNewer: higher version replaces the active registry', () => {
  const store = createRegistryStore();
  const v1 = makeReg(1);
  const v2 = makeReg(2);
  store.applyIfNewer(v1);
  const result = store.applyIfNewer(v2);
  assert.deepEqual(result, { applied: true, version: 2 });
  assert.equal(store.get(), v2);
});

test('applyIfNewer: equal version is ignored — active unchanged, applied:false', () => {
  const store = createRegistryStore();
  const v1a = makeReg(1);
  const v1b = makeReg(1);
  store.applyIfNewer(v1a);
  const result = store.applyIfNewer(v1b);
  assert.deepEqual(result, { applied: false, version: 1 });
  assert.equal(store.get(), v1a);   // still the original object
});

test('applyIfNewer: lower version is ignored — active unchanged, applied:false', () => {
  const store = createRegistryStore();
  const v3 = makeReg(3);
  const v2 = makeReg(2);
  store.applyIfNewer(v3);
  const result = store.applyIfNewer(v2);
  assert.deepEqual(result, { applied: false, version: 3 });
  assert.equal(store.get(), v3);
});

// ─── createRegistryStore — applyIfNewer: validation gate ────────────────────

test('applyIfNewer: malformed envelope (no version) throws before any swap', () => {
  const store = createRegistryStore();
  const good = makeReg(1);
  store.applyIfNewer(good);

  const bad = { tenant: 'pv', generatedAt: '2026-07-14T00:00:00.000Z', providers: {}, routes: {} };
  assert.throws(() => store.applyIfNewer(bad), /version/);
  assert.equal(store.get(), good);  // active unchanged
});

test('applyIfNewer: malformed envelope (non-object) throws and leaves active intact', () => {
  const store = createRegistryStore();
  const good = makeReg(5);
  store.applyIfNewer(good);

  assert.throws(() => store.applyIfNewer(null), /object/);
  assert.equal(store.get(), good);
});

test('applyIfNewer: malformed envelope (bad route) throws and leaves active intact', () => {
  const store = createRegistryStore();
  const good = makeReg(1);
  store.applyIfNewer(good);

  // Route references a provider not in providers map → should fail validateProviderRegistry
  const bad = makeReg(2, {
    routes: { ghost: { upstreamUrl: 'https://ghost.example', wire: 'openai', keyEnv: 'GHOST_KEY' } },
  });
  assert.throws(() => store.applyIfNewer(bad), /ghost/);
  assert.equal(store.get(), good);
});

test('applyIfNewer: first apply with malformed envelope throws (stays null)', () => {
  const store = createRegistryStore();
  assert.throws(() => store.applyIfNewer({ not: 'a registry' }), /version/);
  assert.equal(store.get(), null);
});

// ─── createRegistryStore — stability of get() reference ─────────────────────

test('get() returns the same stable reference across multiple calls', () => {
  const store = createRegistryStore();
  store.applyIfNewer(makeReg(1));
  const a = store.get();
  const b = store.get();
  assert.equal(a === b, true);
});

// ─── pullOnce ───────────────────────────────────────────────────────────────

test('pullOnce: sync source returning a valid registry applies it', async () => {
  const store = createRegistryStore();
  const reg = makeReg(1);
  const result = await pullOnce(store, () => reg);
  assert.deepEqual(result, { applied: true, version: 1 });
  assert.equal(store.get(), reg);
});

test('pullOnce: async source returning a valid registry applies it', async () => {
  const store = createRegistryStore();
  const reg = makeReg(1);
  const result = await pullOnce(store, async () => reg);
  assert.deepEqual(result, { applied: true, version: 1 });
  assert.equal(store.get(), reg);
});

test('pullOnce: ascending versions — both applied in order', async () => {
  const store = createRegistryStore();
  const r1 = await pullOnce(store, () => makeReg(1));
  assert.deepEqual(r1, { applied: true, version: 1 });

  const r2 = await pullOnce(store, () => makeReg(2));
  assert.deepEqual(r2, { applied: true, version: 2 });
});

test('pullOnce: descending versions — second is ignored', async () => {
  const store = createRegistryStore();
  await pullOnce(store, () => makeReg(5));
  const r = await pullOnce(store, () => makeReg(3));
  assert.deepEqual(r, { applied: false, version: 5 });
});

test('pullOnce: source throwing propagates the error', async () => {
  const store = createRegistryStore();
  await assert.rejects(
    () => pullOnce(store, () => { throw new Error('source down'); }),
    /source down/,
  );
  assert.equal(store.get(), null);
});

// ─── startRegistryPoll ──────────────────────────────────────────────────────

test('startRegistryPoll: onApply fires when a newer version arrives', async () => {
  const store = createRegistryStore();
  const applied = [];

  let callCount = 0;
  const source = () => makeReg(++callCount);

  const { stop } = startRegistryPoll({
    store,
    source,
    intervalMs: 10,
    onApply: (result) => applied.push(result),
    onError: (err) => { throw err; },
  });

  await sleep(55);  // enough for ~5 ticks at 10 ms
  stop();

  assert.ok(applied.length >= 1, `expected at least 1 onApply call, got ${applied.length}`);
  assert.equal(applied[0].applied, true);
  assert.equal(applied[0].version, 1);
  // Each subsequent tick should have applied:true with an ever-increasing version
  for (let i = 1; i < applied.length; i++) {
    assert.equal(applied[i].applied, true);
    assert.ok(applied[i].version > applied[i - 1].version);
  }
});

test('startRegistryPoll: onError fires when source throws, loop survives', async () => {
  const store = createRegistryStore();
  const errors = [];
  let calls = 0;

  const source = () => {
    calls++;
    throw new Error(`boom #${calls}`);
  };

  const { stop } = startRegistryPoll({
    store,
    source,
    intervalMs: 10,
    onApply: () => {},
    onError: (err) => errors.push(err.message),
  });

  await sleep(55);
  stop();

  // Loop must have survived (multiple error callbacks fired)
  assert.ok(errors.length >= 1, `expected at least 1 onError call, got ${errors.length}`);
  assert.ok(errors[0].startsWith('boom #'));
  assert.equal(store.get(), null);  // no valid registry was ever applied
});

test('startRegistryPoll: stop() halts further pulls', async () => {
  const store = createRegistryStore();
  let callCount = 0;
  const source = () => makeReg(++callCount);
  const applied = [];

  const { stop } = startRegistryPoll({
    store,
    source,
    intervalMs: 10,
    onApply: (r) => applied.push(r),
    onError: () => {},
  });

  await sleep(35);   // a few ticks
  stop();
  const countAfterStop = callCount;
  await sleep(30);   // wait to confirm no more ticks
  assert.equal(callCount, countAfterStop);  // no further calls after stop()
});

test('startRegistryPoll: same-version source never calls onApply after first', async () => {
  const store = createRegistryStore();
  const applied = [];
  const errors = [];

  // Source always returns version 1 — first tick applies, rest are ignored
  const source = () => makeReg(1);

  const { stop } = startRegistryPoll({
    store,
    source,
    intervalMs: 10,
    onApply: (r) => applied.push(r),
    onError: (e) => errors.push(e),
  });

  await sleep(55);
  stop();

  assert.equal(applied.length, 1, 'onApply should fire exactly once for constant version');
  assert.equal(errors.length, 0);
});

test('startRegistryPoll: onError handler throwing does not crash the loop', async () => {
  const store = createRegistryStore();
  let errorCalls = 0;

  const source = () => { throw new Error('unstable source'); };

  const { stop } = startRegistryPoll({
    store,
    source,
    intervalMs: 10,
    onApply: () => {},
    onError: () => {
      errorCalls++;
      throw new Error('handler also threw');  // should be swallowed
    },
  });

  // If loop were crashing, subsequent ticks wouldn't fire
  await sleep(55);
  stop();

  assert.ok(errorCalls >= 1, 'expected onError to have been called at least once');
});
