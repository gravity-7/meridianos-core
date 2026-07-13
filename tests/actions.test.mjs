import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db.mjs';
import { upsertTask, getTask } from '../state.mjs';
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
const impl = (o = {}) => ({ id: 'F-impl', title: 'impl', owner: 'claude', status: 'ready-for-impl', priority: 10, ...o });
const policy = (over = {}) => ({
  agent_models: { claude: { default: 'claude-opus-4-8' }, antigravity: { default: 'gemini-3-pro' } },
  work: { max_parallel: 2, wip_per_agent: 1, priority_floor: 999, lease_ttl_min: 30, max_runs_per_5h: 8 },
  schedule: { cadence: 'every_30m' }, quiet_hours: { enabled: false }, auto_merge: 'founder_only', ...over,
});
const budget = (over = {}) => ({ kill_switch: false, claude: { state: 'ok' }, antigravity: { state: 'ok' }, mayClaim: { claude: true, antigravity: true }, ...over });

test('runNow returns a dry-run plan and claims nothing', () => {
  const db = freshDb([impl()]);
  const r = runNow(db, { policy: policy(), budget: budget(), now: T0, runs: [], config });
  assert.equal(r.ok, true);
  assert.equal(r.fire, true);
  assert.equal(r.plan[0].agent, 'claude');
  assert.equal(r.plan[0].task, 'F-impl');
  assert.equal(getTask(db, 'F-impl').lease_session, null); // nothing spawned/claimed
});

test('taskAction blocks and unblocks', () => {
  const db = freshDb([impl()]);
  assert.equal(taskAction(db, { id: 'F-impl', action: 'block' }).ok, true);
  assert.equal(getTask(db, 'F-impl').status, 'blocked');
  assert.equal(taskAction(db, { id: 'F-impl', action: 'unblock' }).ok, true);
  assert.equal(getTask(db, 'F-impl').status, 'ready-for-impl');
  assert.equal(taskAction(db, { id: 'nope', action: 'block' }).ok, false);
  assert.equal(taskAction(db, { id: 'F-impl', action: 'explode' }).ok, false);
});

test('taskAction snooze/unsnooze round-trip via COLUMN, note free-text untouched', () => {
  const db = freshDb([impl({ status: 'blocked', note: 'governance hold: spend money' })]);
  const T1 = T0 + 1000;
  const r = taskAction(db, { id: 'F-impl', action: 'snooze', days: 3, now: T1 });
  assert.equal(r.ok, true);
  let t = getTask(db, 'F-impl');
  assert.equal(t.status, 'blocked', 'snooze never changes status');
  assert.equal(snoozedUntil(t), new Date(T1 + 3 * 24 * 60 * 60 * 1000).toISOString());
  assert.equal(t.snoozed_until, new Date(T1 + 3 * 24 * 60 * 60 * 1000).toISOString(), 'lives in the column');
  assert.equal(t.note, 'governance hold: spend money', 'note free-text untouched (no marker appended)');

  const un = taskAction(db, { id: 'F-impl', action: 'unsnooze', now: T1 + 2000 });
  assert.equal(un.ok, true);
  t = getTask(db, 'F-impl');
  assert.equal(t.status, 'blocked');
  assert.equal(snoozedUntil(t), null);
  assert.equal(t.snoozed_until, null, 'column cleared');
  assert.equal(t.note, 'governance hold: spend money', 'note still intact after unsnooze');
});

test('taskAction snooze defaults to 7 days when no `days` is given', () => {
  const db = freshDb([impl({ status: 'blocked', note: 'blocked' })]);
  const r = taskAction(db, { id: 'F-impl', action: 'snooze', now: T0 });
  assert.equal(r.snoozedUntil, new Date(T0 + 7 * 24 * 60 * 60 * 1000).toISOString());
});

test('re-snooze REPLACES the date in the column (latest wins, nothing stacked)', () => {
  const db = freshDb([impl({ status: 'blocked', note: 'governance hold: spend money' })]);
  taskAction(db, { id: 'F-impl', action: 'snooze', days: 1, now: T0 });
  taskAction(db, { id: 'F-impl', action: 'snooze', days: 30, now: T0 });
  const t = getTask(db, 'F-impl');
  assert.equal(snoozedUntil(t), new Date(T0 + 30 * 24 * 60 * 60 * 1000).toISOString(), 'latest date wins');
  assert.equal(t.note, 'governance hold: spend money', 'note free-text untouched');
});

test('re-skip just overwrites the column (reason updates, no stacking)', () => {
  const db = freshDb([impl({ status: 'blocked', note: 'blocked' })]);
  taskAction(db, { id: 'F-impl', action: 'skip', reason: 'first', now: T0 });
  taskAction(db, { id: 'F-impl', action: 'skip', reason: 'second', now: T0 });
  const t = getTask(db, 'F-impl');
  assert.equal(isSkipped(t), true);
  assert.equal(t.skip_reason, 'second', 'reason overwritten, not stacked');
  assert.equal(t.note, 'blocked', 'note free-text untouched');
});

test('taskAction skip/unskip round-trip: reason in COLUMN, note untouched, reversible', () => {
  const db = freshDb([impl({ status: 'blocked', note: 'governance hold: external send' })]);
  const r = taskAction(db, { id: 'F-impl', action: 'skip', reason: 'waiting on legal', now: T0 });
  assert.equal(r.ok, true);
  let t = getTask(db, 'F-impl');
  assert.equal(t.status, 'blocked');
  assert.equal(isSkipped(t), true);
  assert.equal(t.skip_reason, 'waiting on legal', 'reason lives in the column');
  assert.equal(t.skipped_at, new Date(T0).toISOString());
  assert.equal(t.note, 'governance hold: external send', 'note free-text untouched');

  const un = taskAction(db, { id: 'F-impl', action: 'unskip', now: T0 + 1000 });
  assert.equal(un.ok, true);
  t = getTask(db, 'F-impl');
  assert.equal(isSkipped(t), false);
  assert.equal(t.skip_reason, null, 'skip_reason cleared');
  assert.equal(t.note, 'governance hold: external send', 'note still intact after unskip');
});

test('taskAction skip without a reason still marks isSkipped', () => {
  const db = freshDb([impl({ status: 'blocked', note: 'blocked' })]);
  taskAction(db, { id: 'F-impl', action: 'skip', now: T0 });
  const t = getTask(db, 'F-impl');
  assert.equal(isSkipped(t), true);
  assert.equal(t.skip_reason, null);
});

test('snooze/skip never trip isFounderApproved (approved_at stays null)', () => {
  const db = freshDb([impl({ status: 'blocked', note: 'governance hold: spend money' })]);
  taskAction(db, { id: 'F-impl', action: 'snooze', now: T0 });
  assert.equal(isFounderApproved(getTask(db, 'F-impl')), false);
  taskAction(db, { id: 'F-impl', action: 'unsnooze', now: T0 });
  taskAction(db, { id: 'F-impl', action: 'skip', now: T0 });
  assert.equal(isFounderApproved(getTask(db, 'F-impl')), false);
});

test('unblock sets approved_at (durable) and clears any park state', () => {
  const db = freshDb([impl({ status: 'blocked', note: 'governance hold: spend money', snoozed_until: new Date(T0 + 24 * 60 * 60 * 1000).toISOString() })]);
  const r = taskAction(db, { id: 'F-impl', action: 'unblock', now: T0 });
  assert.equal(r.ok, true);
  const t = getTask(db, 'F-impl');
  assert.equal(t.status, 'ready-for-impl');
  assert.equal(isFounderApproved(t), true, 'approval recorded in the column');
  assert.equal(t.approved_at, new Date(T0).toISOString());
  assert.equal(t.snoozed_until, null, 'park state cleared on approve');
  assert.doesNotMatch(t.note ?? '', /founder-approved/, 'approval is NOT written into the note');
});

test('verifyAction approve merges (overrides founder_only), reject bounces back', () => {
  const db = freshDb([{ id: 'F-a', title: 'a', status: 'in-review', owner: 'claude', priority: 10 }]);
  const approved = verifyAction(db, { task: 'F-a', action: 'approve', policy: policy() });
  assert.equal(approved.ok, true);
  assert.equal(getTask(db, 'F-a').status, 'done');

  const db2 = freshDb([{ id: 'F-b', title: 'b', status: 'in-review', owner: 'claude', priority: 10 }]);
  const rejected = verifyAction(db2, { task: 'F-b', action: 'reject', policy: policy() });
  assert.equal(rejected.ok, true);
  assert.equal(getTask(db2, 'F-b').status, 'in-progress');
});

test('escalationAction acks; handleAction routes by path', () => {
  const db = freshDb([impl()]);
  assert.equal(escalationAction(db, { id: 'esc-1', action: 'ack' }).ok, true);
  assert.equal(escalationAction(db, { id: 'esc-1', action: 'nope' }).ok, false);
  assert.equal(handleAction(db, '/api/task', { id: 'F-impl', action: 'block' }).ok, true);
  assert.equal(handleAction(db, '/api/unknown', {}), null);
});
