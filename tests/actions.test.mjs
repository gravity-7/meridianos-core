import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db.mjs';
import { upsertTask, getTask } from '../state.mjs';
import { createProjectStore } from '../project-store.mjs';
import { isFounderApproved, isSkipped, snoozedUntil } from '../sensitive.mjs';
import { runNow, taskAction, verifyAction, escalationAction, handleAction } from '../dashboard/actions.mjs';
import { resolvePaths } from '../config.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';

// This module's fixtures hardcode agent identities ('claude'/'antigravity') matching the
// runner/watchdog/bus modules' own per-agent shaped objects (budget.claude, hs.agents.claude,
// etc.) — those modules derive their agent set from config.domain.agents, so the injected
// roster here must match the fixture literals below (a per-test inline override of
// FIXTURE_DOMAIN, per the fixture-domain module's own doc comment).
const config = resolvePaths({ domain: { ...FIXTURE_DOMAIN, agents: ['claude', 'antigravity'] } });
const T0 = Date.parse('2026-07-03T00:00:00.000Z');
function freshDb(seed = []) {
  const db = openDb(':memory:', config);
  for (const t of seed) upsertTask(db, t, { now: new Date(T0).toISOString() });
  return db;
}
const freshStore = (seed = []) => createProjectStore({ db: freshDb(seed), config });
const impl = (o = {}) => ({ id: 'F-impl', title: 'impl', owner: 'claude', status: 'ready-for-impl', priority: 10, ...o });
const policy = (over = {}) => ({
  agent_models: { claude: { default: 'claude-opus-4-8' }, antigravity: { default: 'gemini-3-pro' } },
  work: { max_parallel: 2, wip_per_agent: 1, priority_floor: 999, lease_ttl_min: 30, max_runs_per_5h: 8 },
  schedule: { cadence: 'every_30m' }, quiet_hours: { enabled: false }, auto_merge: 'founder_only', ...over,
});
const budget = (over = {}) => ({ kill_switch: false, claude: { state: 'ok' }, antigravity: { state: 'ok' }, mayClaim: { claude: true, antigravity: true }, ...over });

test('runNow returns a dry-run plan and claims nothing', () => {
  const db = freshDb([impl()]);
  const store = createProjectStore({ db, config });
  const r = runNow(store, { policy: policy(), budget: budget(), now: T0, runs: [], config });
  assert.equal(r.ok, true);
  assert.equal(r.fire, true);
  assert.equal(r.plan[0].agent, 'claude');
  assert.equal(r.plan[0].task, 'F-impl');
  assert.equal(getTask(db, 'F-impl').lease_session, null); // nothing spawned/claimed
});

test('taskAction blocks and unblocks', () => {
  const db = freshDb([impl()]);
  const store = createProjectStore({ db, config });
  assert.equal(taskAction(store, { id: 'F-impl', action: 'block' }).ok, true);
  assert.equal(getTask(db, 'F-impl').status, 'blocked');
  assert.equal(taskAction(store, { id: 'F-impl', action: 'unblock' }).ok, true);
  assert.equal(getTask(db, 'F-impl').status, 'ready-for-impl');
  assert.equal(taskAction(store, { id: 'nope', action: 'block' }).ok, false);
  assert.equal(taskAction(store, { id: 'F-impl', action: 'explode' }).ok, false);
});

test('taskAction snooze/unsnooze round-trip via COLUMN, note free-text untouched', () => {
  const store = freshStore([impl({ status: 'blocked', note: 'governance hold: spend money' })]);
  const T1 = T0 + 1000;
  const r = taskAction(store, { id: 'F-impl', action: 'snooze', days: 3, now: T1 });
  assert.equal(r.ok, true);
  let t = store.state.getTask('F-impl');
  assert.equal(t.status, 'blocked', 'snooze never changes status');
  assert.equal(snoozedUntil(t), new Date(T1 + 3 * 24 * 60 * 60 * 1000).toISOString());
  assert.equal(t.snoozed_until, new Date(T1 + 3 * 24 * 60 * 60 * 1000).toISOString(), 'lives in the column');
  assert.equal(t.note, 'governance hold: spend money', 'note free-text untouched (no marker appended)');

  const un = taskAction(store, { id: 'F-impl', action: 'unsnooze', now: T1 + 2000 });
  assert.equal(un.ok, true);
  t = store.state.getTask('F-impl');
  assert.equal(t.status, 'blocked');
  assert.equal(snoozedUntil(t), null);
  assert.equal(t.snoozed_until, null, 'column cleared');
  assert.equal(t.note, 'governance hold: spend money', 'note still intact after unsnooze');
});

test('taskAction snooze defaults to 7 days when no `days` is given', () => {
  const store = freshStore([impl({ status: 'blocked', note: 'blocked' })]);
  const r = taskAction(store, { id: 'F-impl', action: 'snooze', now: T0 });
  assert.equal(r.snoozedUntil, new Date(T0 + 7 * 24 * 60 * 60 * 1000).toISOString());
});

test('re-snooze REPLACES the date in the column (latest wins, nothing stacked)', () => {
  const store = freshStore([impl({ status: 'blocked', note: 'governance hold: spend money' })]);
  taskAction(store, { id: 'F-impl', action: 'snooze', days: 1, now: T0 });
  taskAction(store, { id: 'F-impl', action: 'snooze', days: 30, now: T0 });
  const t = store.state.getTask('F-impl');
  assert.equal(snoozedUntil(t), new Date(T0 + 30 * 24 * 60 * 60 * 1000).toISOString(), 'latest date wins');
  assert.equal(t.note, 'governance hold: spend money', 'note free-text untouched');
});

test('re-skip just overwrites the column (reason updates, no stacking)', () => {
  const store = freshStore([impl({ status: 'blocked', note: 'blocked' })]);
  taskAction(store, { id: 'F-impl', action: 'skip', reason: 'first', now: T0 });
  taskAction(store, { id: 'F-impl', action: 'skip', reason: 'second', now: T0 });
  const t = store.state.getTask('F-impl');
  assert.equal(isSkipped(t), true);
  assert.equal(t.skip_reason, 'second', 'reason overwritten, not stacked');
  assert.equal(t.note, 'blocked', 'note free-text untouched');
});

test('taskAction skip/unskip round-trip: reason in COLUMN, note untouched, reversible', () => {
  const store = freshStore([impl({ status: 'blocked', note: 'governance hold: external send' })]);
  const r = taskAction(store, { id: 'F-impl', action: 'skip', reason: 'waiting on legal', now: T0 });
  assert.equal(r.ok, true);
  let t = store.state.getTask('F-impl');
  assert.equal(t.status, 'blocked');
  assert.equal(isSkipped(t), true);
  assert.equal(t.skip_reason, 'waiting on legal', 'reason lives in the column');
  assert.equal(t.skipped_at, new Date(T0).toISOString());
  assert.equal(t.note, 'governance hold: external send', 'note free-text untouched');

  const un = taskAction(store, { id: 'F-impl', action: 'unskip', now: T0 + 1000 });
  assert.equal(un.ok, true);
  t = store.state.getTask('F-impl');
  assert.equal(isSkipped(t), false);
  assert.equal(t.skip_reason, null, 'skip_reason cleared');
  assert.equal(t.note, 'governance hold: external send', 'note still intact after unskip');
});

test('taskAction skip without a reason still marks isSkipped', () => {
  const store = freshStore([impl({ status: 'blocked', note: 'blocked' })]);
  taskAction(store, { id: 'F-impl', action: 'skip', now: T0 });
  const t = store.state.getTask('F-impl');
  assert.equal(isSkipped(t), true);
  assert.equal(t.skip_reason, null);
});

test('snooze/skip never trip isFounderApproved (approved_at stays null)', () => {
  const store = freshStore([impl({ status: 'blocked', note: 'governance hold: spend money' })]);
  taskAction(store, { id: 'F-impl', action: 'snooze', now: T0 });
  assert.equal(isFounderApproved(store.state.getTask('F-impl')), false);
  taskAction(store, { id: 'F-impl', action: 'unsnooze', now: T0 });
  taskAction(store, { id: 'F-impl', action: 'skip', now: T0 });
  assert.equal(isFounderApproved(store.state.getTask('F-impl')), false);
});

test('unblock sets approved_at (durable) and clears any park state', () => {
  const store = freshStore([impl({ status: 'blocked', note: 'governance hold: spend money', snoozed_until: new Date(T0 + 24 * 60 * 60 * 1000).toISOString() })]);
  const r = taskAction(store, { id: 'F-impl', action: 'unblock', now: T0 });
  assert.equal(r.ok, true);
  const t = store.state.getTask('F-impl');
  assert.equal(t.status, 'ready-for-impl');
  assert.equal(isFounderApproved(t), true, 'approval recorded in the column');
  assert.equal(t.approved_at, new Date(T0).toISOString());
  assert.equal(t.snoozed_until, null, 'park state cleared on approve');
  assert.doesNotMatch(t.note ?? '', /founder-approved/, 'approval is NOT written into the note');
});

test('verifyAction approve merges (overrides founder_only), reject bounces back', () => {
  const store = freshStore([{ id: 'F-a', title: 'a', status: 'in-review', owner: 'claude', priority: 10 }]);
  const approved = verifyAction(store, { task: 'F-a', action: 'approve', policy: policy() });
  assert.equal(approved.ok, true);
  assert.equal(store.state.getTask('F-a').status, 'done');

  const store2 = freshStore([{ id: 'F-b', title: 'b', status: 'in-review', owner: 'claude', priority: 10 }]);
  const rejected = verifyAction(store2, { task: 'F-b', action: 'reject', policy: policy() });
  assert.equal(rejected.ok, true);
  assert.equal(store2.state.getTask('F-b').status, 'in-progress');
});

test('taskAction bounce sends in-review back to in-progress, with the reason in the note', () => {
  const store = freshStore([impl({ status: 'in-review' })]);
  const r = taskAction(store, { id: 'F-impl', action: 'bounce', reason: 'missing tests', now: T0 });
  assert.deepEqual(r, { ok: true, task: 'F-impl', status: 'in-progress' });
  const t = store.state.getTask('F-impl');
  assert.equal(t.status, 'in-progress');
  assert.equal(t.note, 'bounced by founder: missing tests');
});

test('taskAction bounce without a reason still records that it was a dashboard bounce', () => {
  const store = freshStore([impl({ status: 'in-review' })]);
  assert.equal(taskAction(store, { id: 'F-impl', action: 'bounce', now: T0 }).ok, true);
  assert.equal(store.state.getTask('F-impl').note, 'bounced from dashboard');
});

test('taskAction bounce sends ready-for-impl back to designing for a design redo', () => {
  const store = freshStore([impl({ status: 'ready-for-impl' })]);
  const r = taskAction(store, { id: 'F-impl', action: 'bounce', reason: 'wrong data model', now: T0 });
  assert.deepEqual(r, { ok: true, task: 'F-impl', status: 'designing' });
  const t = store.state.getTask('F-impl');
  assert.equal(t.status, 'designing');
  assert.equal(t.note, 'bounced by founder: wrong data model');
});

// A bounce declares the in-flight work invalid, so the lease ("an agent is working this") must go
// with it — otherwise the task sits unclaimable behind its own stale lease until the TTL reaper
// frees it, inflating reap_count and raising a false "stalling" escalation on the way.
test('taskAction bounce frees a live lease so the task is immediately re-claimable', () => {
  const store = freshStore([impl({ status: 'ready-for-impl' })]);
  const claim = store.state.claimTask({ taskId: 'F-impl', agent: 'claude', session: 'sess-1', now: new Date(T0).toISOString() });
  assert.equal(claim.won, true);
  assert.equal(store.state.getTask('F-impl').lease_session, 'sess-1');

  assert.equal(taskAction(store, { id: 'F-impl', action: 'bounce', now: T0 }).ok, true);
  const t = store.state.getTask('F-impl');
  assert.equal(t.status, 'designing');
  assert.equal(t.lease_session, null, 'lease session freed');
  assert.equal(t.lease_owner, null, 'lease owner freed');
  assert.equal(t.lease_expires, null, 'lease expiry cleared');
});

// The bounceMap must never advertise a move machine.mjs would refuse: an entry the state machine
// rejects surfaces to the founder as a confusing "illegal transition: X -> Y" instead of a clean
// refusal. designing/spec stay out on purpose — plannerCycle would auto-revert those on the next
// watchdog tick. Every non-bounceable status refuses by name.
test('taskAction bounce refuses every non-bounceable status by name, and does not move the task', () => {
  for (const status of ['proposed', 'spec', 'designing', 'in-progress', 'done', 'blocked']) {
    const store = freshStore([impl({ status })]);
    const r = taskAction(store, { id: 'F-impl', action: 'bounce', now: T0 });
    assert.equal(r.ok, false, `${status} should not be bounceable`);
    assert.equal(r.error, `cannot bounce from status '${status}'`);
    assert.doesNotMatch(r.error, /illegal transition/, `${status} must refuse cleanly, not leak a machine error`);
    assert.equal(store.state.getTask('F-impl').status, status, `${status} must be left untouched`);
  }
});

test('escalationAction acks; handleAction routes by path', () => {
  const store = freshStore([impl()]);
  assert.equal(escalationAction(store, { id: 'esc-1', action: 'ack' }).ok, true);
  assert.equal(escalationAction(store, { id: 'esc-1', action: 'nope' }).ok, false);
  assert.equal(handleAction(store, '/api/task', { id: 'F-impl', action: 'block' }).ok, true);
  assert.equal(handleAction(store, '/api/unknown', {}), null);
});
