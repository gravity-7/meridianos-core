/**
 * Durability of §6 governance + park state (the "persist in columns, not note markers" change).
 *
 * Covers:
 *   - REGRESSION for the live minio bug: an approved sensitive task that later takes a
 *     note-overwriting transition (a verify bounce) must STAY approved and NOT be re-blocked.
 *   - the one-time note-marker → column BACKFILL is correct, idempotent, and non-destructive.
 *   - a founder approval survives a board.json render → reseed round-trip (fresh-checkout rebuild).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, backfillGovernanceColumns } from '../db.mjs';
import { upsertTask, getTask, transition, setGovernanceFlags, seedTasks } from '../state.mjs';
import { isFounderApproved, snoozedUntil, isSkipped } from '../sensitive.mjs';
import { buildBoardJson } from '../render.mjs';
import { plannerCycle } from '../planner.mjs';
import { decide } from '../router.mjs';
import { resolvePaths } from '../config.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';

const config = resolvePaths({ domain: FIXTURE_DOMAIN });
const T0 = '2026-07-03T00:00:00.000Z';
const policy = (over = {}) => ({
  agent_models: { claude: { default: 'claude-opus-4-8' }, antigravity: { default: 'gemini-3-pro' } },
  work: { max_parallel: 2, wip_per_agent: 1, priority_floor: 999, lease_ttl_min: 30 },
  sensitive_actions: { deploy: 'block_and_ask', external_send: 'block_and_ask', spend_money: 'block_and_ask', schema_change: 'block_and_ask' },
  ...over,
});
const budget = (over = {}) => ({ kill_switch: false, claude: { state: 'ok' }, antigravity: { state: 'ok' }, mayClaim: { claude: true, antigravity: true }, ...over });

function seeded(seed) {
  const db = openDb(':memory:');
  for (const t of seed) upsertTask(db, t, { now: T0 });
  return db;
}

test('REGRESSION (minio): a note-overwriting verify bounce does NOT erase a founder approval', () => {
  // Story under a payments epic → sensitive (spend_money). Founder approved it; it went to verify;
  // the verifier bounced it back with a note. Before this change the note carried the approval mark,
  // so the bounce clobbered it and the planner re-blocked an already-approved task.
  const db = seeded([
    { id: 'F2', type: 'epic', title: 'payments epic', status: 'in-progress', risk_tags: ['payments'] },
    { id: 'F2-minio', type: 'story', parent_id: 'F2', title: 'integrate minio local storage', owner: 'claude', status: 'in-review', priority: 10, risk_tags: [] },
  ]);
  // Founder approval lands in the durable column (via the dashboard unblock path / setter).
  setGovernanceFlags(db, { taskId: 'F2-minio', approvedAt: T0 }, { actor: 'founder', op: 'unblock', now: T0 });
  assert.equal(isFounderApproved(getTask(db, 'F2-minio')), true);

  // Verify bounce: a legal in-review → in-progress transition that REWRITES the note.
  const r = transition(db, { taskId: 'F2-minio', to: 'in-progress', actor: 'verifier', note: 'verification failed: minio bucket config missing', now: '2026-07-03T01:00:00.000Z' });
  assert.equal(r.ok, true);

  const t = getTask(db, 'F2-minio');
  assert.equal(t.note, 'verification failed: minio bucket config missing', 'note was overwritten by the bounce');
  assert.equal(t.approved_at, T0, 'approval column is untouched by the transition');
  assert.equal(isFounderApproved(t), true, 'still approved after the note-overwriting bounce');

  // The planner must NOT re-block the approved task…
  const pr = plannerCycle(db, { policy: policy() });
  assert.ok(!pr.promoted.some((p) => p.id === 'F2-minio' && p.to === 'blocked'), 'approved task not re-blocked by the planner');
  assert.equal(getTask(db, 'F2-minio').status, 'in-progress', 'stays workable');

  // …and the router's §6 gate must not deny it for the sensitive tag.
  const d = decide(db, { agent: 'claude', policy: policy(), budget: budget(), config });
  assert.notEqual(d.reason, 'sensitive_action:spend_money', 'router does not re-gate an approved task');
});

test('backfill: legacy note markers populate the new columns (correct + idempotent + non-destructive)', () => {
  const db = seeded([
    { id: 'A-approved', type: 'story', title: 'approved', status: 'ready-for-impl', priority: 10, note: 'founder-approved: unblocked from dashboard' },
    { id: 'B-snoozed', type: 'story', title: 'snoozed', status: 'blocked', priority: 20, note: 'governance hold: spend money [founder-snoozed:2026-07-20T00:00:00.000Z]' },
    { id: 'C-skipped', type: 'story', title: 'skipped', status: 'blocked', priority: 30, note: 'governance hold: external send [founder-skipped:waiting on legal]' },
    { id: 'D-plain', type: 'story', title: 'plain', status: 'blocked', priority: 40, note: 'awaiting founder data' },
  ]);
  // Simulate a pre-migration DB: the seed above already left the columns NULL (upsertTask defaults
  // them). Run the one-time backfill.
  backfillGovernanceColumns(db);

  const a = getTask(db, 'A-approved');
  assert.equal(a.approved_at, a.updated_at, 'approved_at backfilled from updated_at');
  assert.equal(isFounderApproved(a), true);

  const b = getTask(db, 'B-snoozed');
  assert.equal(snoozedUntil(b), '2026-07-20T00:00:00.000Z', 'snoozed_until parsed from the marker');

  const c = getTask(db, 'C-skipped');
  assert.equal(isSkipped(c), true);
  assert.equal(c.skipped_at, c.updated_at);
  assert.equal(c.skip_reason, 'waiting on legal');

  const d = getTask(db, 'D-plain');
  assert.equal(d.approved_at, null);
  assert.equal(d.snoozed_until, null);
  assert.equal(d.skipped_at, null);

  // Re-running is a pure no-op — capture the row, run again, compare.
  const before = ['A-approved', 'B-snoozed', 'C-skipped', 'D-plain'].map((id) => JSON.stringify(getTask(db, id)));
  backfillGovernanceColumns(db);
  const after = ['A-approved', 'B-snoozed', 'C-skipped', 'D-plain'].map((id) => JSON.stringify(getTask(db, id)));
  assert.deepEqual(after, before, 're-running the backfill changes nothing');
});

test('backfill is non-destructive: a post-upgrade column value is NOT overwritten by a stale note marker', () => {
  const db = seeded([
    { id: 'E', type: 'story', title: 'resnoozed', status: 'blocked', priority: 10, note: 'blocked [founder-snoozed:2026-07-01T00:00:00.000Z]' },
  ]);
  // Founder re-snoozed via the column AFTER upgrade (a newer date than the stale note marker).
  setGovernanceFlags(db, { taskId: 'E', snoozedUntil: '2026-08-01T00:00:00.000Z' }, { actor: 'founder', op: 'snooze', now: T0 });
  backfillGovernanceColumns(db);
  assert.equal(snoozedUntil(getTask(db, 'E')), '2026-08-01T00:00:00.000Z', 'column value wins; stale note marker ignored');
});

test('durability: a founder approval survives a board.json render → reseed (fresh-checkout rebuild)', () => {
  const db = seeded([
    { id: 'F2', type: 'epic', title: 'payments epic', status: 'in-progress', risk_tags: ['payments'] },
    { id: 'F2-pay', type: 'story', parent_id: 'F2', title: 'paid', status: 'ready-for-impl', priority: 10 },
  ]);
  setGovernanceFlags(db, { taskId: 'F2-pay', approvedAt: T0 }, { actor: 'founder', op: 'unblock', now: T0 });

  // Render the durable projection and rebuild a fresh DB from it (what a clean checkout does).
  const boardJson = buildBoardJson(db);
  const paid = boardJson.tasks.find((t) => t.id === 'F2-pay');
  assert.equal(paid.approved_at, T0, 'approval is serialized into board.json');

  const db2 = openDb(':memory:');
  seedTasks(db2, boardJson);
  assert.equal(isFounderApproved(getTask(db2, 'F2-pay')), true, 'approval restored after reseed');
});
