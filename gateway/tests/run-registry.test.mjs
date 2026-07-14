import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRunRegistry } from '../run-registry.mjs';

function ctx(overrides = {}) {
  return { tenant: 'pv', agent: 'claude', session: 's1', task: 't1', runId: 'r1', provider: 'anthropic', model: 'claude-sonnet-5', tier: 'medium', ...overrides };
}

test('registerRun then resolveRun returns the same ctx', () => {
  const runs = createRunRegistry();
  runs.registerRun('tok-1', ctx());
  assert.deepEqual(runs.resolveRun('tok-1'), ctx());
});

test('resolveRun returns null for an unknown token', () => {
  const runs = createRunRegistry();
  assert.equal(runs.resolveRun('nope'), null);
});

test('unregisterRun removes the mapping', () => {
  const runs = createRunRegistry();
  runs.registerRun('tok-1', ctx());
  runs.unregisterRun('tok-1');
  assert.equal(runs.resolveRun('tok-1'), null);
});

test('unregisterRun on an unknown token is a no-op', () => {
  const runs = createRunRegistry();
  assert.doesNotThrow(() => runs.unregisterRun('nope'));
});

test('two run registries do not share state', () => {
  const a = createRunRegistry();
  const b = createRunRegistry();
  a.registerRun('tok-1', ctx());
  assert.equal(b.resolveRun('tok-1'), null);
});

test('registerRun throws on a non-string token', () => {
  const runs = createRunRegistry();
  assert.throws(() => runs.registerRun(42, ctx()), /token/);
});

test('registerRun throws on an empty-string token', () => {
  const runs = createRunRegistry();
  assert.throws(() => runs.registerRun('', ctx()), /token/);
});

test('registerRun throws on a non-object ctx', () => {
  const runs = createRunRegistry();
  assert.throws(() => runs.registerRun('tok-1', null), /ctx/);
});

test('registerRun overwrites an existing token mapping', () => {
  const runs = createRunRegistry();
  runs.registerRun('tok-1', ctx({ agent: 'claude' }));
  runs.registerRun('tok-1', ctx({ agent: 'antigravity' }));
  assert.equal(runs.resolveRun('tok-1').agent, 'antigravity');
});
