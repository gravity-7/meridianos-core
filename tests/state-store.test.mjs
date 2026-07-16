import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db.mjs';
import {
  upsertTask, getTask, upsertSprint, taskWithAncestors, effectiveRiskTags, buildSprintFilter,
  recentReaps, parkedTasks, claimTask, reapExpiredLeases,
} from '../state.mjs';
import { createStateStore } from '../state-store.mjs';
import { resolvePaths } from '../config.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';

const config = resolvePaths({ domain: FIXTURE_DOMAIN });
const T0 = '2026-07-03T00:00:00.000Z';

function freshDb(seed = []) {
  const db = openDb(':memory:', config);
  for (const t of seed) upsertTask(db, t, { now: T0 });
  return db;
}
const impl = (o = {}) => ({ id: 'F-impl', title: 'impl', owner: 'agent-a', status: 'ready-for-impl', priority: 10, ...o });

test('createStateStore(db).getTask(...) deep-equals state.getTask(db, ...)', () => {
  const db = freshDb([impl()]);
  const store = createStateStore(db);
  assert.deepEqual(store.getTask('F-impl'), getTask(db, 'F-impl'));
});

test('a claim via the store is visible to a bare state.getTask on the SAME db handle', () => {
  const db = freshDb([impl()]);
  const store = createStateStore(db);
  const r = store.claimTask({ taskId: 'F-impl', agent: 'agent-a', session: 's1', now: T0 });
  assert.equal(r.won, true);
  // Same transaction/handle — the bare state.mjs read sees the store's write immediately.
  const bare = getTask(db, 'F-impl');
  assert.equal(bare.lease_owner, 'agent-a');
  assert.equal(bare.lease_session, 's1');
  assert.deepEqual(store.getTask('F-impl'), bare);
});

test('store methods thread through every db-bound state.mjs function (list/upsert/transition/lease lifecycle)', () => {
  const db = freshDb();
  const store = createStateStore(db);

  const created = store.upsertTask({ id: 'F-x', title: 'x', owner: 'agent-a', status: 'ready-for-impl', priority: 5 }, { now: T0 });
  assert.equal(created.id, 'F-x');
  assert.equal(store.listTasks().length, 1);

  const claimed = store.claimTask({ taskId: 'F-x', agent: 'agent-a', session: 's1', now: T0 });
  assert.equal(claimed.won, true);
  assert.equal(store.heartbeat({ taskId: 'F-x', session: 's1', now: T0 }).ok, true);

  const t = store.transition({ taskId: 'F-x', to: 'in-progress', actor: 'agent-a', now: T0 });
  assert.equal(t.ok, true);
  assert.equal(t.task.status, 'in-progress');

  const rel = store.releaseLease({ taskId: 'F-x', session: 's1', now: T0 });
  assert.equal(rel.ok, true);
  assert.equal(store.getTask('F-x').lease_owner, null);
});

test('seedTasks/upsertPI/upsertSprint/listSprints/listPIs round-trip through the store', () => {
  const db = openDb(':memory:', config);
  const store = createStateStore(db);
  store.seedTasks({
    pis: [{ id: 'PI1', name: 'PI 1' }],
    sprints: [{ id: 'S1', pi_id: 'PI1', name: 'Sprint 1' }],
    tasks: [{ id: 'F-1', title: 'one', owner: 'agent-a', status: 'proposed', priority: 5 }],
  }, { now: T0 });
  assert.equal(store.listPIs().length, 1);
  assert.equal(store.listSprints().length, 1);
  assert.equal(store.listTasks().length, 1);
});

test('blockTask/annotateTask/setGovernanceFlags/nextEligibleTask/reapExpiredLeases/forceReleaseLease/releaseAllLeases/pruneHistory all work via the store', () => {
  const db = freshDb([impl()]);
  const store = createStateStore(db);

  const blocked = store.blockTask({ taskId: 'F-impl', actor: 'founder', reason: 'waiting', now: T0 });
  assert.equal(blocked.ok, true);
  assert.equal(blocked.task.status, 'blocked');

  const ann = store.annotateTask({ taskId: 'F-impl', note: 'blocked [founder-skipped]', actor: 'founder', now: T0 });
  assert.equal(ann.ok, true);

  const gov = store.setGovernanceFlags({ taskId: 'F-impl', approvedAt: T0 }, { actor: 'founder', now: T0 });
  assert.equal(gov.ok, true);
  assert.equal(store.getTask('F-impl').approved_at, T0);

  // Reset to a claimable status for the eligibility/lease checks below.
  store.transition({ taskId: 'F-impl', to: 'ready-for-impl', actor: 'founder', now: T0 });
  const next = store.nextEligibleTask({ agent: 'agent-a', now: T0 });
  assert.equal(next.id, 'F-impl');

  const claim = store.claimTask({ taskId: 'F-impl', agent: 'agent-a', session: 's2', ttlMs: 1, now: T0 });
  assert.equal(claim.won, true);
  const later = new Date(Date.parse(T0) + 1000).toISOString();
  const reaped = store.reapExpiredLeases({ now: later });
  assert.deepEqual(reaped.reaped, ['F-impl']);

  const claim2 = store.claimTask({ taskId: 'F-impl', agent: 'agent-a', session: 's3', now: later });
  assert.equal(claim2.won, true);
  const forced = store.forceReleaseLease({ taskId: 'F-impl', agent: 'agent-a', now: later });
  assert.equal(forced.ok, true);

  store.claimTask({ taskId: 'F-impl', agent: 'agent-a', session: 's4', now: later });
  const freed = store.releaseAllLeases({ now: later });
  assert.deepEqual(freed.freed, ['F-impl']);

  const deleted = store.pruneHistory({ keep: 0 });
  assert.equal(typeof deleted, 'number');
});

test('createStateStore re-exposes the non-db passthroughs (parseJsonArray, nowIso, DEFAULT_TTL_MS, DAY)', () => {
  const db = freshDb();
  const store = createStateStore(db);
  assert.equal(typeof store.parseJsonArray, 'function');
  assert.deepEqual(store.parseJsonArray('["a","b"]'), ['a', 'b']);
  assert.deepEqual(store.parseJsonArray(null), []);
  assert.equal(typeof store.nowIso, 'function');
  assert.match(store.nowIso(), /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(typeof store.DEFAULT_TTL_MS, 'number');
  assert.equal(typeof store.DAY, 'number');
});

// --- Promoted read-queries (D2 bite #2, stage 2a): these used to live in sensitive.mjs /
// router.mjs / watchdog.mjs. The store versions must match the bare state.mjs functions exactly.

test('store.taskWithAncestors(task) deep-equals state.taskWithAncestors(db, task)', () => {
  const db = freshDb([
    { id: 'F2', type: 'epic', title: 'epic', status: 'in-progress', risk_tags: ['payments'] },
    { id: 'F2-pay', type: 'story', title: 'paid', status: 'ready-for-impl', parent_id: 'F2', priority: 10 },
  ]);
  const store = createStateStore(db);
  const task = { id: 'F2-pay', parent_id: 'F2', risk_tags: '[]' };
  assert.deepEqual(store.taskWithAncestors(task), taskWithAncestors(db, task));
  assert.equal(store.taskWithAncestors(task).length, 2);
});

test('store.effectiveRiskTags(task) inherits ancestor risk_tags, matching the bare function', () => {
  const db = freshDb([
    { id: 'F2', type: 'epic', title: 'epic', status: 'in-progress', risk_tags: ['payments', 'external'] },
    { id: 'F2-pay', type: 'story', title: 'paid', status: 'ready-for-impl', parent_id: 'F2', priority: 10, risk_tags: [] },
  ]);
  const store = createStateStore(db);
  const task = { id: 'F2-pay', parent_id: 'F2', risk_tags: '[]' };
  const tags = store.effectiveRiskTags(task);
  assert.deepEqual(new Set(tags), new Set(effectiveRiskTags(db, task)));
  assert.ok(tags.includes('payments'));
  assert.ok(tags.includes('external'));
});

test('store.buildSprintFilter() matches state.buildSprintFilter(db) (null when no active sprint, gating function once active)', () => {
  const db = freshDb([{ id: 'S1', type: 'story', title: 's', status: 'ready-for-impl', priority: 10 }]);
  const store = createStateStore(db);
  assert.equal(store.buildSprintFilter(), null);
  assert.equal(buildSprintFilter(db), null);

  upsertSprint(db, { id: 'S-A', name: 'A', status: 'active' });
  const f = store.buildSprintFilter();
  assert.equal(typeof f, 'function');
  assert.equal(f({ type: 'story', sprint_id: 'S-A' }), true);
  assert.equal(f({ type: 'story', sprint_id: 'S-B' }), false);
});

test('store.recentReaps() matches state.recentReaps(db, ...) after a reap', () => {
  const db = freshDb([impl()]);
  const claim = store => store.claimTask({ taskId: 'F-impl', agent: 'agent-a', session: 's1', ttlMs: 1, now: T0 });
  const store = createStateStore(db);
  claim(store);
  const later = new Date(Date.parse(T0) + 1000).toISOString();
  reapExpiredLeases(db, { now: later });
  const viaStore = store.recentReaps({ limit: 5 });
  const viaBare = recentReaps(db, { limit: 5 });
  assert.deepEqual(viaStore, viaBare);
  assert.equal(viaStore.length, 1);
  assert.equal(viaStore[0].task, 'F-impl');
  assert.equal(viaStore[0].owner, 'agent-a');
});

test('store.parkedTasks() matches state.parkedTasks(db, ...) for skipped + snoozed blocked tasks', () => {
  const db = freshDb([
    { id: 'F-normal', title: 'normal', status: 'blocked', owner: 'agent-a', priority: 10, note: 'blocked' },
    { id: 'F-skipped', title: 'skipped', status: 'blocked', owner: 'agent-a', priority: 20, note: 'blocked', skipped_at: T0, skip_reason: 'legal' },
  ]);
  const store = createStateStore(db);
  const viaStore = store.parkedTasks({ now: Date.parse(T0) });
  const viaBare = parkedTasks(db, { now: Date.parse(T0) });
  assert.deepEqual(viaStore, viaBare);
  assert.equal(viaStore.length, 1);
  assert.equal(viaStore[0].task, 'F-skipped');
  assert.equal(viaStore[0].skipped, true);
});
