import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db.mjs';
import {
  upsertTask, claimTask, heartbeat, releaseLease, reapExpiredLeases,
  transition, nextEligibleTask, getTask, annotateTask,
} from '../state.mjs';

const T0 = '2026-07-03T00:00:00.000Z';
const at = (ms) => new Date(Date.parse(T0) + ms).toISOString();

function freshDb(seed = []) {
  const db = openDb(':memory:');
  for (const t of seed) upsertTask(db, t, { now: T0 });
  return db;
}

// A claude-claimable task is 'ready-for-impl'; an antigravity one is 'designing'.
const impl = (over = {}) => ({ id: 'F-impl', title: 'impl task', owner: 'claude', status: 'ready-for-impl', priority: 10, ...over });

test('transition to in-review/done frees the lease (no lingering lease → no false reap)', () => {
  const db = freshDb([impl()]);
  claimTask(db, { taskId: 'F-impl', agent: 'claude', session: 's1', now: T0 });
  transition(db, { taskId: 'F-impl', to: 'in-progress', actor: 'claude', now: T0 });
  assert.equal(getTask(db, 'F-impl').lease_owner, 'claude', 'still leased while working');
  transition(db, { taskId: 'F-impl', to: 'in-review', actor: 'claude', now: T0 });
  const t = getTask(db, 'F-impl');
  assert.equal(t.lease_owner, null, 'lease freed on handoff to review');
  assert.equal(t.lease_expires, null);
});

test('transition to done clears reap_count so a shipped task stops showing as stalling', () => {
  const db = freshDb([impl({ status: 'in-review' })]);
  db.prepare('UPDATE tasks SET reap_count = 4 WHERE id = ?').run('F-impl');
  transition(db, { taskId: 'F-impl', to: 'done', actor: 'verifier', now: T0 });
  assert.equal(getTask(db, 'F-impl').reap_count, 0);
});

test('transition persists the note to the task row (so approval/block notes stick)', () => {
  const db = freshDb([impl({ note: 'planned' })]);
  // A note passed to transition is now saved on the task, not just the history — this is what
  // the dashboard Unblock (founder-approved mark) and the planner block notes rely on.
  transition(db, { taskId: 'F-impl', to: 'in-progress', actor: 'x', note: 'founder-approved: unblocked' });
  assert.equal(getTask(db, 'F-impl').note, 'founder-approved: unblocked');
  // Omitting the note leaves the existing one intact (agents transition without a note).
  transition(db, { taskId: 'F-impl', to: 'in-review', actor: 'x' });
  assert.equal(getTask(db, 'F-impl').note, 'founder-approved: unblocked');
});

test('annotateTask updates the note and writes an audit row, WITHOUT changing status', () => {
  const db = freshDb([impl({ status: 'blocked', note: 'blocked from dashboard' })]);
  const r = annotateTask(db, { taskId: 'F-impl', note: 'blocked from dashboard [founder-snoozed:2026-07-10T00:00:00.000Z]', actor: 'founder', op: 'snooze', now: T0 });
  assert.equal(r.ok, true);
  const t = getTask(db, 'F-impl');
  assert.equal(t.status, 'blocked', 'status untouched');
  assert.equal(t.note, 'blocked from dashboard [founder-snoozed:2026-07-10T00:00:00.000Z]');
  const row = db.prepare("SELECT * FROM history WHERE task_id='F-impl' AND op='snooze'").get();
  assert.ok(row, 'audit row written for the snooze op');
  assert.equal(row.from_state, 'blocked');
  assert.equal(row.to_state, 'blocked');
  assert.equal(row.actor, 'founder');
});

test('annotateTask on a missing task returns ok:false', () => {
  const db = freshDb([]);
  const r = annotateTask(db, { taskId: 'nope', note: 'x', actor: 'founder', now: T0 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-such-task');
});

test('a claim acquires a lease; a second claimant on the same task loses', () => {
  const db = freshDb([impl()]);
  const a = claimTask(db, { taskId: 'F-impl', agent: 'claude', session: 's1', ttlMs: 1000, now: T0 });
  assert.equal(a.won, true);
  const b = claimTask(db, { taskId: 'F-impl', agent: 'claude', session: 's2', ttlMs: 1000, now: at(1) });
  assert.equal(b.won, false);
  assert.equal(b.reason, 'leased');
});

test('claiming a non-claimable status is refused', () => {
  const db = freshDb([impl({ status: 'proposed' })]); // proposed is not in CLAIMABLE
  const r = claimTask(db, { taskId: 'F-impl', agent: 'claude', session: 's1', now: T0 });
  assert.equal(r.won, false);
  assert.match(r.reason, /not claimable/);
});

test('heartbeat extends the lease only for the holder', () => {
  const db = freshDb([impl()]);
  claimTask(db, { taskId: 'F-impl', agent: 'claude', session: 's1', ttlMs: 1000, now: T0 });
  assert.equal(heartbeat(db, { taskId: 'F-impl', session: 'intruder', ttlMs: 1000, now: at(500) }).ok, false);
  assert.equal(heartbeat(db, { taskId: 'F-impl', session: 's1', ttlMs: 1000, now: at(500) }).ok, true);
  // extended to at(1500): a claim at at(1200) still loses
  assert.equal(claimTask(db, { taskId: 'F-impl', agent: 'claude', session: 's2', now: at(1200) }).won, false);
});

test('the reaper frees an expired lease and lets someone else claim', () => {
  const db = freshDb([impl()]);
  claimTask(db, { taskId: 'F-impl', agent: 'claude', session: 's1', ttlMs: 1000, now: T0 });
  const { reaped } = reapExpiredLeases(db, { now: at(2000) }); // lease expired at at(1000)
  assert.deepEqual(reaped, ['F-impl']);
  assert.equal(getTask(db, 'F-impl').reap_count, 1);
  assert.equal(getTask(db, 'F-impl').lease_session, null);
  const r = claimTask(db, { taskId: 'F-impl', agent: 'claude', session: 's2', now: at(2001) });
  assert.equal(r.won, true);
});

test('releaseLease frees the lease for the holder only', () => {
  const db = freshDb([impl()]);
  claimTask(db, { taskId: 'F-impl', agent: 'claude', session: 's1', now: T0 });
  assert.equal(releaseLease(db, { taskId: 'F-impl', session: 'nope' }).ok, false);
  assert.equal(releaseLease(db, { taskId: 'F-impl', session: 's1' }).ok, true);
  assert.equal(getTask(db, 'F-impl').lease_owner, null);
});

test('two tasks sharing a resource cannot both be claimed (deadlock-free locking)', () => {
  const db = freshDb([
    impl({ id: 'A', resources: ['apps/api'] }),
    impl({ id: 'B', resources: ['apps/api'] }),
  ]);
  assert.equal(claimTask(db, { taskId: 'A', agent: 'claude', session: 'sa', now: T0 }).won, true);
  const b = claimTask(db, { taskId: 'B', agent: 'claude', session: 'sb', now: T0 });
  assert.equal(b.won, false);
  assert.match(b.reason, /resource-locked/);
});

test('transition enforces the state machine and can require the lease holder', () => {
  const db = freshDb([impl()]);
  claimTask(db, { taskId: 'F-impl', agent: 'claude', session: 's1', now: T0 });
  assert.throws(() => transition(db, { taskId: 'F-impl', to: 'done' }), /illegal transition/);
  assert.equal(transition(db, { taskId: 'F-impl', to: 'in-progress', requireSession: 'wrong' }).ok, false);
  assert.equal(transition(db, { taskId: 'F-impl', to: 'in-progress', requireSession: 's1', actor: 'claude' }).ok, true);
  assert.equal(getTask(db, 'F-impl').status, 'in-progress');
});

test('nextEligibleTask honours priority, live leases, and dependencies', () => {
  const db = freshDb([
    impl({ id: 'low', priority: 50 }),
    impl({ id: 'high', priority: 5 }),
    impl({ id: 'gated', priority: 1, depends_on: ['blocker'] }),
    // dependency that isn't done — status 'in-review' is not claimable, so it never surfaces itself
    { id: 'blocker', title: 'blocker', owner: 'claude', status: 'in-review', priority: 1 },
  ]);
  // 'gated' has the lowest priority number but its dependency isn't done → skip to 'high'
  assert.equal(nextEligibleTask(db, { agent: 'claude', now: T0 }).id, 'high');
  // claim 'high' → next becomes 'low'
  claimTask(db, { taskId: 'high', agent: 'claude', session: 's1', now: T0 });
  assert.equal(nextEligibleTask(db, { agent: 'claude', now: T0 }).id, 'low');
});
