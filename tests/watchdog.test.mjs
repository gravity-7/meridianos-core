import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db.mjs';
import { upsertTask, claimTask, reapExpiredLeases, getTask } from '../state.mjs';
import { agentHealth, recentReaps, slaBreaches, healthStatus, collectEscalations, parkedTasks, tick } from '../watchdog.mjs';
import { resolvePaths } from '../config.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';

// This module's fixtures hardcode agent identities ('claude'/'antigravity') matching the
// runner/watchdog/bus modules' own per-agent shaped objects (budget.claude, hs.agents.claude,
// etc.) — those modules derive their agent set from config.domain.agents, so the injected
// roster here must match the fixture literals below (a per-test inline override of
// FIXTURE_DOMAIN, per the fixture-domain module's own doc comment).
const config = resolvePaths({ domain: { ...FIXTURE_DOMAIN, agents: ['claude', 'antigravity'] } });
const T0 = Date.parse('2026-07-03T00:00:00.000Z');
const at = (ms) => T0 + ms;
const iso = (ms) => new Date(ms).toISOString();
function freshDb(seed = []) {
  const db = openDb(':memory:', config);
  for (const t of seed) upsertTask(db, t, { now: iso(T0) });
  return db;
}
const impl = (o = {}) => ({ id: 'F-impl', title: 'impl', owner: 'claude', status: 'ready-for-impl', priority: 10, ...o });
const policy = (over = {}) => ({ work: { lease_ttl_min: 30, reap_sla: 2 }, ...over });
const budget = (over = {}) => ({ kill_switch: false, claude: { state: 'ok' }, antigravity: { state: 'ok' }, mayClaim: { claude: true, antigravity: true }, ...over });

test('agentHealth: active while holding a fresh lease, idle otherwise', () => {
  const db = freshDb([impl()]);
  claimTask(db, { taskId: 'F-impl', agent: 'claude', session: 's1', ttlMs: 30 * 60 * 1000, now: iso(T0) });
  const h = agentHealth(db, { policy: policy(), budget: budget(), now: at(1000), config });
  assert.equal(h.claude.state, 'active');
  assert.equal(h.claude.leaseTask, 'F-impl');
  assert.equal(h.antigravity.state, 'idle');
});

test('agentHealth: halted under kill switch / budget halt', () => {
  const db = freshDb([impl()]);
  assert.equal(agentHealth(db, { policy: policy(), budget: budget({ kill_switch: true }), now: T0, config }).claude.state, 'halted');
  assert.equal(agentHealth(db, { policy: policy(), budget: budget({ mayClaim: { claude: false, antigravity: true } }), now: T0, config }).claude.state, 'halted');
});

test('agentHealth: offline when the lease is live but the heartbeat is stale', () => {
  const db = freshDb([impl()]);
  claimTask(db, { taskId: 'F-impl', agent: 'claude', session: 's1', ttlMs: 3 * 60 * 60 * 1000, now: iso(T0) });
  const h = agentHealth(db, { policy: policy(), budget: budget(), now: at(1801 * 1000), config }); // 1801s > 1800s ttl
  assert.equal(h.claude.state, 'offline');
});

test('slaBreaches + recentReaps after repeated reaps (owner recovered)', () => {
  const db = freshDb([impl()]);
  claimTask(db, { taskId: 'F-impl', agent: 'claude', session: 's1', ttlMs: 1000, now: iso(at(0)) });
  reapExpiredLeases(db, { now: iso(at(2000)) });
  claimTask(db, { taskId: 'F-impl', agent: 'claude', session: 's2', ttlMs: 1000, now: iso(at(3000)) });
  reapExpiredLeases(db, { now: iso(at(5000)) });
  const breaches = slaBreaches(db, { policy: policy(), config });
  assert.equal(breaches.length, 1);
  assert.equal(breaches[0].reapCount, 2);
  const reaps = recentReaps(db);
  assert.ok(reaps.length >= 2);
  assert.equal(reaps[0].owner, 'claude');
});

test('collectEscalations surfaces kill switch, budget, and blocked tasks', () => {
  const db = freshDb([impl(), { id: 'F-blk', title: 'blocked one', status: 'blocked', owner: 'claude', priority: 50, note: 'awaiting founder data' }]);
  const esc = collectEscalations(db, {
    policy: policy(),
    budget: budget({ kill_switch: true, claude: { state: 'halt' }, antigravity: { state: 'warn' }, mayClaim: { claude: false, antigravity: true } }),
    now: T0,
    config,
  });
  const kinds = esc.map((e) => e.kind);
  assert.ok(kinds.includes('kill_switch'));
  assert.ok(kinds.includes('budget_halt'));
  assert.ok(kinds.includes('budget_warn'));
  assert.ok(kinds.includes('task_blocked'));
  const blk = esc.find((e) => e.kind === 'task_blocked');
  assert.equal(blk.task, 'F-blk');
  assert.equal(blk.severity, 'warn');
});

test('collectEscalations excludes skipped and future-snoozed blocked tasks; includes past-snoozed and normal blocked', () => {
  const pastUntil = iso(at(-1000)); // already elapsed → resurfaces
  const futureUntil = iso(at(999999)); // far in the future → still parked
  const db = freshDb([
    { id: 'F-normal', title: 'normal', status: 'blocked', owner: 'claude', priority: 10, note: 'awaiting founder data' },
    { id: 'F-skipped', title: 'skipped', status: 'blocked', owner: 'claude', priority: 20, note: 'blocked', skipped_at: iso(T0), skip_reason: 'waiting on legal' },
    { id: 'F-future', title: 'future', status: 'blocked', owner: 'claude', priority: 30, note: 'blocked', snoozed_until: futureUntil },
    { id: 'F-past', title: 'past', status: 'blocked', owner: 'claude', priority: 40, note: 'blocked', snoozed_until: pastUntil },
  ]);
  const esc = collectEscalations(db, { policy: policy(), budget: budget(), now: T0, config });
  const blockedIds = esc.filter((e) => e.kind === 'task_blocked').map((e) => e.task);
  assert.ok(blockedIds.includes('F-normal'));
  assert.ok(blockedIds.includes('F-past'), 'a past-due snooze auto-resurfaces');
  assert.ok(!blockedIds.includes('F-skipped'), 'a skipped task is excluded');
  assert.ok(!blockedIds.includes('F-future'), 'a still-future snooze is excluded');
});

test('collectEscalations enriches task-linked escalations with status/owner', () => {
  const db = freshDb([{ id: 'F-blk', title: 'blocked one', status: 'blocked', owner: 'antigravity', priority: 50, note: 'awaiting founder data' }]);
  const esc = collectEscalations(db, { policy: policy(), budget: budget(), now: T0, config });
  const blk = esc.find((e) => e.kind === 'task_blocked');
  assert.equal(blk.status, 'blocked');
  assert.equal(blk.owner, 'antigravity');
});

test('parkedTasks lists skipped + currently-snoozed blocked tasks (not past-snoozed, not normal blocked)', () => {
  const pastUntil = iso(at(-1000));
  const futureUntil = iso(at(999999));
  const db = freshDb([
    { id: 'F-normal', title: 'normal', status: 'blocked', owner: 'claude', priority: 10, note: 'awaiting founder data' },
    { id: 'F-skipped', title: 'skipped', status: 'blocked', owner: 'claude', priority: 20, note: 'blocked', skipped_at: iso(T0), skip_reason: 'waiting on legal' },
    { id: 'F-future', title: 'future', status: 'blocked', owner: 'claude', priority: 30, note: 'blocked', snoozed_until: futureUntil },
    { id: 'F-past', title: 'past', status: 'blocked', owner: 'claude', priority: 40, note: 'blocked', snoozed_until: pastUntil },
  ]);
  const parked = parkedTasks(db, { now: T0 });
  const ids = parked.map((p) => p.task);
  assert.ok(ids.includes('F-skipped'));
  assert.ok(ids.includes('F-future'));
  assert.ok(!ids.includes('F-normal'));
  assert.ok(!ids.includes('F-past'), 'a lapsed snooze is no longer parked');
  const skippedEntry = parked.find((p) => p.task === 'F-skipped');
  assert.equal(skippedEntry.skipped, true);
  assert.equal(skippedEntry.snoozedUntil, null);
  const futureEntry = parked.find((p) => p.task === 'F-future');
  assert.equal(futureEntry.skipped, false);
  assert.equal(futureEntry.snoozedUntil, futureUntil);
});

test('healthStatus emits the dashboard health shape', () => {
  const hs = healthStatus(freshDb([impl()]), { policy: policy(), budget: budget(), now: T0, intervalSec: 60, config });
  assert.equal(hs.watchdog.running, true);
  assert.equal(hs.watchdog.intervalSec, 60);
  assert.ok(hs.agents.claude && hs.agents.antigravity);
  assert.ok(Array.isArray(hs.reaps) && Array.isArray(hs.slaBreaches));
});

test('tick reaps expired leases and returns health + escalations', () => {
  const db = freshDb([impl()]);
  claimTask(db, { taskId: 'F-impl', agent: 'claude', session: 's1', ttlMs: 1000, now: iso(at(0)) });
  const r = tick(db, { policy: policy(), budget: budget(), now: at(2000), config });
  assert.deepEqual(r.reaped, ['F-impl']);
  assert.equal(getTask(db, 'F-impl').reap_count, 1);
  assert.ok(r.health.watchdog.running);
  assert.ok(Array.isArray(r.escalations));
});
