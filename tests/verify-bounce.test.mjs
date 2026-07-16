import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db.mjs';
import { upsertTask, getTask } from '../state.mjs';
import { createProjectStore } from '../project-store.mjs';
import { verifyCycle, clearVerifyState } from '../verify-loop.mjs';
import { resolvePaths } from '../config.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';

const config = resolvePaths({ domain: FIXTURE_DOMAIN });
const T0 = '2026-07-03T00:00:00.000Z';
function freshDb(seed = []) {
  const db = openDb(':memory:', config);
  for (const t of seed) upsertTask(db, t, { now: T0 });
  return db;
}
const freshStore = (seed = []) => createProjectStore({ db: freshDb(seed), config });
const inReview = (o = {}) => ({ id: 'S1', type: 'story', title: 's', owner: 'claude', status: 'in-review', priority: 10, pr: '42', ...o });
const policy = { auto_merge: 'peer_agent_review' };
const passRunners = [{ name: 'tests', fn: () => ({ status: 'pass' }) }, { name: 'guardrails', fn: () => ({ status: 'pass' }) }];
const failRunners = [{ name: 'tests', fn: () => ({ status: 'fail', detail: 'CI red' }) }, { name: 'guardrails', fn: () => ({ status: 'pass' }) }];

test('a failing check BOUNCES the task out of in-review (no infinite re-check loop)', async () => {
  const db = freshDb([inReview()]);
  const store = createProjectStore({ db, config });
  clearVerifyState('S1');
  const r = await verifyCycle(store, { policy, dryRun: false, checkRunners: failRunners });
  assert.equal(getTask(db, 'S1').status, 'in-progress', 'bounced back for rework, not left in-review');
  assert.equal(r.failed[0].disposition, 'bounced');
  // Second cycle: task is no longer in-review, so it is NOT re-checked (loop is broken).
  const r2 = await verifyCycle(store, { policy, dryRun: false, checkRunners: failRunners });
  assert.equal(r2.checked, 0);
});

test('after MAX attempts a persistently failing task is BLOCKED + escalated, not churned', async () => {
  const db = freshDb([inReview()]);
  const store = createProjectStore({ db, config });
  clearVerifyState('S1');
  // Simulate the task returning to review and failing repeatedly.
  for (let i = 0; i < 2; i++) {
    await verifyCycle(store, { policy, dryRun: false, checkRunners: failRunners });
    // agent re-submits (bounce → back to in-review) for the next round
    if (getTask(db, 'S1').status === 'in-progress') {
      db.prepare("UPDATE tasks SET status='in-review' WHERE id='S1'").run();
    }
  }
  const r = await verifyCycle(store, { policy, dryRun: false, checkRunners: failRunners });
  assert.equal(getTask(db, 'S1').status, 'blocked', 'parked for the founder after repeated failures');
  assert.equal(r.failed[0].disposition, 'blocked');
});

test('all checks pass + peer LGTM → dry-run reports a merge', async () => {
  const store = freshStore([inReview()]);
  clearVerifyState('S1');
  // selectModel returns null; peer review is spawned via child process, which we avoid by pre-passing
  // sync checks and using verifier_gated mode (no peer review required) to test the merge path.
  const r = await verifyCycle(store, { policy: { auto_merge: 'verifier_gated' }, dryRun: true, checkRunners: passRunners });
  assert.deepEqual(r.merged.map(m => m.task), ['S1']);
});
