import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertTransition, isLegalTransition, legalTransitions, STATES } from '../machine.mjs';

test('the happy path is legal end to end', () => {
  const path = ['proposed', 'spec', 'designing', 'ready-for-impl', 'in-progress', 'in-review', 'done'];
  for (let i = 0; i < path.length - 1; i++) {
    assert.ok(isLegalTransition(path[i], path[i + 1]), `${path[i]} -> ${path[i + 1]} should be legal`);
  }
});

test('blocked is reachable from every active state and unblocks back', () => {
  for (const s of ['proposed', 'spec', 'designing', 'ready-for-impl', 'in-progress', 'in-review']) {
    assert.ok(isLegalTransition(s, 'blocked'), `${s} -> blocked should be legal`);
  }
  assert.ok(isLegalTransition('blocked', 'in-progress'));
  assert.ok(isLegalTransition('blocked', 'ready-for-impl'));
});

test('done is terminal', () => {
  assert.deepEqual(legalTransitions('done'), []);
  assert.throws(() => assertTransition('done', 'in-progress'), /illegal transition/);
});

test('illegal skips throw', () => {
  assert.throws(() => assertTransition('proposed', 'in-progress'), /illegal transition/);
  assert.throws(() => assertTransition('designing', 'in-review'), /illegal transition/);
  assert.throws(() => assertTransition('ready-for-impl', 'done'), /illegal transition/);
});

// The pipeline is forward-only apart from exactly TWO bounce edges (see the machine.mjs header).
// The upstream ones stay illegal on purpose: plannerCycle auto-promotes proposed→spec and
// spec→designing every tick, so `designing → spec` or `spec → proposed` would be reverted before
// the agent it was meant for could claim the task. Adding either is a design change, not a
// one-liner; this test is here so it can't happen by accident.
test('in-review→in-progress and ready-for-impl→designing are the ONLY backward edges', () => {
  assert.ok(isLegalTransition('in-review', 'in-progress'));
  assert.ok(isLegalTransition('ready-for-impl', 'designing'));
  for (const [from, to] of [['spec', 'proposed'], ['designing', 'spec'], ['in-progress', 'ready-for-impl']]) {
    assert.equal(isLegalTransition(from, to), false, `${from} -> ${to} should NOT be legal`);
  }
});

test('same-state is an allowed no-op; unknown states are rejected', () => {
  assert.doesNotThrow(() => assertTransition('in-progress', 'in-progress'));
  assert.throws(() => assertTransition('in-progress', 'shipped'), /unknown target state/);
  assert.equal(STATES.length, 8);
});
