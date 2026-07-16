import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db.mjs';
import { upsertTask, upsertSprint } from '../state.mjs';
import { createProjectStore } from '../project-store.mjs';
import {
  effectiveRiskTags, sensitiveBlock, isFounderApproved,
  snoozedUntil, isSkipped, parseNoteMarkers,
} from '../sensitive.mjs';
import { plannerCycle } from '../planner.mjs';
import { decide, buildSprintFilter, composeFilters } from '../router.mjs';
import { resolvePaths } from '../config.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';

const config = resolvePaths({ domain: FIXTURE_DOMAIN });
const T0 = '2026-07-03T00:00:00.000Z';
function freshDb(seed = []) {
  const db = openDb(':memory:', config);
  for (const t of seed) upsertTask(db, t, { now: T0 });
  return db;
}
const policy = (over = {}) => ({
  agent_models: { claude: { default: 'claude-opus-4-8' }, antigravity: { default: 'gemini-3-pro' } },
  work: { max_parallel: 2, wip_per_agent: 1, priority_floor: 999, lease_ttl_min: 30 },
  sensitive_actions: { deploy: 'block_and_ask', external_send: 'block_and_ask', spend_money: 'block_and_ask', schema_change: 'block_and_ask' },
  ...over,
});
const budget = (over = {}) => ({
  kill_switch: false, claude: { state: 'ok' }, antigravity: { state: 'ok' },
  mayClaim: { claude: true, antigravity: true }, ...over,
});

test('effectiveRiskTags inherits risk_tags from an ancestor epic (via parent_id)', () => {
  const db = freshDb([
    { id: 'F2', type: 'epic', title: 'epic', status: 'in-progress', risk_tags: ['payments', 'external'] },
    { id: 'F2-implement-replicateadapter', type: 'story', title: 'paid adapter', status: 'ready-for-impl', parent_id: 'F2', risk_tags: [] },
  ]);
  const child = { id: 'F2-implement-replicateadapter', parent_id: 'F2', risk_tags: '[]' };
  const tags = effectiveRiskTags(db, child);
  assert.ok(tags.includes('payments'), 'inherits payments from F2');
  assert.ok(tags.includes('external'), 'inherits external from F2');
});

test('effectiveRiskTags does NOT inherit across a mere id-prefix sibling epic', () => {
  const db = freshDb([
    { id: 'F2', type: 'epic', title: 'money epic', status: 'in-progress', risk_tags: ['payments', 'external'] },
    { id: 'F2-3-photo-tools-ui', type: 'epic', title: 'ui epic', status: 'in-progress', parent_id: null, risk_tags: ['ui'] },
    { id: 'F2-3-photo-tools-ui-dropzone', type: 'story', title: 'dropzone', status: 'ready-for-impl', parent_id: 'F2-3-photo-tools-ui', risk_tags: [] },
  ]);
  const tags = effectiveRiskTags(db, { id: 'F2-3-photo-tools-ui-dropzone', parent_id: 'F2-3-photo-tools-ui', risk_tags: '[]' });
  assert.ok(tags.includes('ui'));
  assert.ok(!tags.includes('payments'), 'pure-UI work is NOT tarred with the money epic tag');
});

test('effectiveRiskTags inherits via explicit parent_id too', () => {
  const db = freshDb([
    { id: 'EPIC', type: 'epic', title: 'e', status: 'in-progress', risk_tags: ['schema'] },
    { id: 'STORY-9', type: 'story', title: 's', status: 'ready-for-impl', parent_id: 'EPIC', risk_tags: [] },
  ]);
  const tags = effectiveRiskTags(db, { id: 'STORY-9', parent_id: 'EPIC', risk_tags: '[]' });
  assert.deepEqual(tags, ['schema']);
});

test('sensitiveBlock returns the blocked action for a block_and_ask tag', () => {
  assert.equal(sensitiveBlock(policy(), ['payments'], undefined, config), 'spend_money');
  assert.equal(sensitiveBlock(policy(), ['external'], undefined, config), 'external_send');
  assert.equal(sensitiveBlock(policy(), ['schema'], undefined, config), 'schema_change');
  assert.equal(sensitiveBlock(policy(), ['ui', 'testing'], undefined, config), null, 'ordinary tags do not block');
});

test('sensitiveBlock respects notify_only / allow dispositions (does not block)', () => {
  const p = policy({ sensitive_actions: { spend_money: 'notify_only', external_send: 'allow' } });
  assert.equal(sensitiveBlock(p, ['payments'], undefined, config), null);
  assert.equal(sensitiveBlock(p, ['external'], undefined, config), null);
});

test('sensitiveBlock fails safe: an unnamed sensitive action defaults to block_and_ask', () => {
  assert.equal(sensitiveBlock({ sensitive_actions: {} }, ['deploy'], undefined, config), 'deploy');
});

// ---- DI-1: injected config drives the default (not just the singleton) -----------------------

test('sensitiveBlock honors an injected NON-DEFAULT config\'s riskToAction map', () => {
  const fakeConfig = resolvePaths({
    domain: { agents: ['x', 'y'], riskToAction: { crypto: 'spend_money' }, knownRiskTags: ['crypto'], boardTitle: 'Z Board' },
  });
  const p = policy();
  // 'crypto' is not a PV tag at all — the DEFAULT (PV) config never blocks on it.
  assert.equal(sensitiveBlock(p, ['crypto'], undefined, config), null);
  // Under the injected tenant config, 'crypto' hard-stops as spend_money.
  assert.equal(sensitiveBlock(p, ['crypto'], undefined, fakeConfig), 'spend_money');
  // Explicit riskToAction still wins over an injected config (existing 2.2b field-param behavior).
  assert.equal(sensitiveBlock(p, ['crypto'], { crypto: 'external_send' }, fakeConfig), 'external_send');
});

test('router.decide + planner.plannerCycle thread an injected config into the governance gate', () => {
  const fakeConfig = resolvePaths({
    domain: { agents: ['x', 'y'], riskToAction: { crypto: 'spend_money' }, knownRiskTags: ['crypto'], boardTitle: 'Z Board' },
  });
  const db = freshDb([
    { id: 'F9', type: 'epic', title: 'crypto epic', status: 'in-progress', risk_tags: ['crypto'] },
    { id: 'F9-buy', type: 'story', title: 'buy', owner: 'claude', status: 'ready-for-impl', priority: 10, parent_id: 'F9', risk_tags: [] },
  ]);
  const store = createProjectStore({ db, config });
  const storeFake = createProjectStore({ db, config: fakeConfig });
  // The DEFAULT (PV) config doesn't know 'crypto' at all → claimable.
  const dDefault = decide(store, { agent: 'claude', policy: policy(), budget: budget(), config });
  assert.equal(dDefault.mayClaim, true);
  // Under the injected tenant config, the inherited 'crypto' tag hard-stops the claim.
  const dFake = decide(storeFake, { agent: 'claude', policy: policy(), budget: budget(), config: fakeConfig });
  assert.equal(dFake.mayClaim, false);
  assert.equal(dFake.reason, 'sensitive_action:spend_money');
  // planner.plannerCycle parks the same task under the injected config.
  const r = plannerCycle(storeFake, { policy: policy(), config: fakeConfig });
  assert.ok(r.promoted.some((x) => x.id === 'F9-buy' && x.to === 'blocked'), 'injected config governance-blocks the story');
});

test('router refuses to claim a story that inherits a spend_money epic tag', () => {
  const db = freshDb([
    { id: 'F2', type: 'epic', title: 'epic', status: 'in-progress', risk_tags: ['payments'] },
    { id: 'F2-pay', type: 'story', title: 'paid', owner: 'claude', status: 'ready-for-impl', priority: 10, parent_id: 'F2', risk_tags: [] },
  ]);
  const store = createProjectStore({ db, config });
  const d = decide(store, { agent: 'claude', policy: policy(), budget: budget(), config });
  assert.equal(d.mayClaim, false);
  assert.equal(d.reason, 'sensitive_action:spend_money');
});

test('a founder-approved task is exempt from the §6 gate (router + planner)', () => {
  const db = freshDb([
    { id: 'F2', type: 'epic', title: 'epic', status: 'in-progress', risk_tags: ['payments'] },
    { id: 'F2-pay', type: 'story', title: 'paid', owner: 'claude', status: 'ready-for-impl', priority: 10, parent_id: 'F2', risk_tags: [], approved_at: '2026-07-03T00:00:00.000Z' },
  ]);
  const store = createProjectStore({ db, config });
  assert.equal(isFounderApproved({ approved_at: '2026-07-03T00:00:00.000Z' }), true);
  assert.equal(isFounderApproved({ approved_at: null, note: 'planned' }), false);
  // router: approved task is claimable despite the money tag
  const d = decide(store, { agent: 'claude', policy: policy(), budget: budget(), config });
  assert.equal(d.mayClaim, true);
  assert.equal(d.task.id, 'F2-pay');
  // planner: does NOT re-block an approved task
  const r = plannerCycle(store, { policy: policy(), config });
  assert.ok(!r.promoted.some((p) => p.id === 'F2-pay' && p.to === 'blocked'), 'approved task not re-blocked');
});

test('planner auto-releases a governance hold once the policy no longer blocks it', () => {
  const strict = policy({ sensitive_actions: { external_send: 'block_and_ask' } });
  const relaxed = policy({ sensitive_actions: { external_send: 'notify_only' } });
  const db = freshDb([
    { id: 'F3', type: 'epic', title: 'external epic', status: 'in-progress', risk_tags: ['external'] },
    { id: 'F3-spec', type: 'story', title: 'spec', owner: 'claude', status: 'ready-for-impl', priority: 10, parent_id: 'F3', risk_tags: [] },
  ]);
  const store = createProjectStore({ db, config });
  // Strict policy → the planner parks it as a governance hold.
  plannerCycle(store, { policy: strict, config });
  let t = db.prepare("SELECT status,note FROM tasks WHERE id='F3-spec'").get();
  assert.equal(t.status, 'blocked');
  assert.ok(t.note.startsWith('governance hold'));
  // Founder relaxes external_send → next planner cycle releases it back to a workable state.
  const r = plannerCycle(store, { policy: relaxed, config });
  t = db.prepare("SELECT status FROM tasks WHERE id='F3-spec'").get();
  assert.equal(t.status, 'ready-for-impl', 'released once policy permits');
  assert.ok(r.promoted.some((p) => p.id === 'F3-spec' && p.reason === 'governance-released'));
});

test('planner does NOT auto-release manual or parked blocks (only its own governance holds)', () => {
  const relaxed = policy({ sensitive_actions: { external_send: 'notify_only', spend_money: 'notify_only' } });
  const db = freshDb([
    { id: 'M1', type: 'story', title: 'manual', owner: 'claude', status: 'blocked', priority: 10, risk_tags: ['external'], note: 'blocked from dashboard' },
    { id: 'P1', type: 'story', title: 'parked', owner: 'claude', status: 'blocked', priority: 10, risk_tags: ['payments'], note: 'PARKED — waiting on data' },
  ]);
  const store = createProjectStore({ db, config });
  plannerCycle(store, { policy: relaxed, config });
  assert.equal(db.prepare("SELECT status FROM tasks WHERE id='M1'").get().status, 'blocked', 'manual block untouched');
  assert.equal(db.prepare("SELECT status FROM tasks WHERE id='P1'").get().status, 'blocked', 'parked block untouched');
});

test('buildSprintFilter is null when no active sprint exists (fail open, no starvation)', () => {
  const db = freshDb([{ id: 'S1', type: 'story', title: 's', status: 'ready-for-impl', priority: 10 }]);
  assert.equal(buildSprintFilter(db), null);
});

test('buildSprintFilter admits only active-sprint stories once a sprint is active', () => {
  const db = freshDb([]);
  upsertSprint(db, { id: 'S-A', name: 'A', status: 'active' });
  const f = buildSprintFilter(db);
  assert.equal(typeof f, 'function');
  assert.equal(f({ type: 'story', sprint_id: 'S-A' }), true);
  assert.equal(f({ type: 'story', sprint_id: 'S-B' }), false, 'other sprint');
  assert.equal(f({ type: 'story', sprint_id: null }), false, 'unassigned = backlog');
  assert.equal(f({ type: 'epic', sprint_id: 'S-A' }), false, 'epics not directly workable');
});

test('composeFilters ANDs two filters and tolerates nulls', () => {
  assert.equal(composeFilters(null, null), null);
  const even = (t) => t.n % 2 === 0;
  const pos = (t) => t.n > 0;
  assert.equal(composeFilters(even, null)({ n: 2 }), true);
  assert.equal(composeFilters(even, pos)({ n: -2 }), false);
  assert.equal(composeFilters(even, pos)({ n: 4 }), true);
});

test('RISK_TO_ACTION maps the constitution §6 hard-stop tags', () => {
  const RISK_TO_ACTION = config.domain.riskToAction;
  assert.equal(RISK_TO_ACTION.payments, 'spend_money');
  assert.equal(RISK_TO_ACTION.external, 'external_send');
  assert.equal(RISK_TO_ACTION.deploy, 'deploy');
  assert.equal(RISK_TO_ACTION.schema, 'schema_change');
});

test('sensitiveBlocks / describeBlocks name every currently-blocking action (postmortem #7)', async () => {
  const { sensitiveBlocks, describeBlocks } = await import('../sensitive.mjs');
  const tags = ['external', 'payments'];
  // Both block → both named.
  const strict = { sensitive_actions: { external_send: 'block_and_ask', spend_money: 'block_and_ask' } };
  assert.deepEqual(sensitiveBlocks(strict, tags, undefined, config), ['external_send', 'spend_money']);
  assert.equal(describeBlocks(strict, tags, config), 'external send + spend money');
  // Founder relaxed external_send → only spend_money remains, so the note must say "spend money"
  // (not the stale "external send" that left the adapters mysteriously parked).
  const relaxed = { sensitive_actions: { external_send: 'allow', spend_money: 'block_and_ask' } };
  assert.deepEqual(sensitiveBlocks(relaxed, tags, undefined, config), ['spend_money']);
  assert.equal(describeBlocks(relaxed, tags, config), 'spend money');
});

test('plannerCycle refreshes a stale governance-hold note to the current blocking action', async () => {
  const db = openDb(':memory:', config);
  upsertTask(db, { id: 'F2', type: 'epic', title: 'epic', status: 'in-progress', risk_tags: ['external', 'payments'] }, { now: '2026-07-03T00:00:00.000Z' });
  upsertTask(db, { id: 'F2-adapter', type: 'story', parent_id: 'F2', title: 'adapter', status: 'blocked', note: 'governance hold: needs founder approval to external send' }, { now: '2026-07-03T00:00:00.000Z' });
  // external_send now allowed; spend_money still blocks (inherited payments).
  const policy = { sensitive_actions: { external_send: 'allow', spend_money: 'block_and_ask' } };
  plannerCycle(createProjectStore({ db, config }), { policy, config });
  const t = db.prepare('SELECT note, status FROM tasks WHERE id=?').get('F2-adapter');
  assert.equal(t.status, 'blocked');
  assert.match(t.note, /spend money/);
});

test('snoozedUntil / isSkipped / isFounderApproved read the durable columns, not the note', () => {
  // Readers consult the columns only — a note that happens to contain a legacy-looking marker
  // string must NOT be interpreted (that is the whole point: transitions rewrite the note freely).
  assert.equal(snoozedUntil({ snoozed_until: '2026-07-10T00:00:00.000Z' }), '2026-07-10T00:00:00.000Z');
  assert.equal(snoozedUntil({ snoozed_until: null, note: '[founder-snoozed:2026-07-10T00:00:00.000Z]' }), null, 'note is ignored');
  assert.equal(snoozedUntil({}), null);

  assert.equal(isSkipped({ skipped_at: '2026-07-03T00:00:00.000Z' }), true);
  assert.equal(isSkipped({ skipped_at: null, note: 'blocked [founder-skipped]' }), false, 'note is ignored');
  assert.equal(isSkipped({}), false);

  assert.equal(isFounderApproved({ approved_at: '2026-07-03T00:00:00.000Z' }), true);
  assert.equal(isFounderApproved({ approved_at: null, note: 'verification failed — founder-approved earlier' }), false, 'note is ignored');
  assert.equal(isFounderApproved({}), false);
});

test('governance readers are independent: a snooze/skip column never trips isFounderApproved', () => {
  assert.equal(isFounderApproved({ snoozed_until: '2026-07-10T00:00:00.000Z' }), false);
  assert.equal(isFounderApproved({ skipped_at: '2026-07-03T00:00:00.000Z', skip_reason: 'waiting on legal' }), false);
});

test('parseNoteMarkers (legacy-migration parser) extracts approval / snooze / skip from an old note', () => {
  assert.deepEqual(parseNoteMarkers('governance hold [founder-snoozed:2026-07-10T00:00:00.000Z]'),
    { approved: false, snoozedUntil: '2026-07-10T00:00:00.000Z', skipped: false, skipReason: null });
  assert.deepEqual(parseNoteMarkers('blocked [founder-skipped:waiting on legal]'),
    { approved: false, snoozedUntil: null, skipped: true, skipReason: 'waiting on legal' });
  assert.deepEqual(parseNoteMarkers('blocked [founder-skipped]'),
    { approved: false, snoozedUntil: null, skipped: true, skipReason: null });
  assert.deepEqual(parseNoteMarkers('founder-approved: unblocked from dashboard'),
    { approved: true, snoozedUntil: null, skipped: false, skipReason: null });
  // Unparsable snooze date → null; plain note → all-empty.
  assert.equal(parseNoteMarkers('[founder-snoozed:not-a-date]').snoozedUntil, null);
  assert.deepEqual(parseNoteMarkers('just a plain note'),
    { approved: false, snoozedUntil: null, skipped: false, skipReason: null });
});
