import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db.mjs';
import { upsertTask, getTask, listTasks, upsertSprint } from '../state.mjs';
import { parentOf, epicsOf, proposeTasks, acceptProposals, plannerStatus, plannerCycle } from '../planner.mjs';
import { resolvePaths } from '../config.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';

const config = resolvePaths({ domain: FIXTURE_DOMAIN });
const T0 = '2026-07-03T00:00:00.000Z';
function freshDb(seed = []) {
  const db = openDb(':memory:', config);
  for (const t of seed) upsertTask(db, t, { now: T0 });
  return db;
}

test('parentOf returns the nearest ancestor by id-prefix', () => {
  const tasks = [{ id: 'F1' }, { id: 'F1-1' }, { id: 'F1-1.9' }];
  assert.equal(parentOf('F1-1.9', tasks), 'F1-1');
  assert.equal(parentOf('F1-1', tasks), 'F1');
  assert.equal(parentOf('F1', tasks), null);
});

test('proposeTasks materializes children with inherited owner/priority', () => {
  const db = freshDb([{ id: 'F9', title: 'epic', status: 'in-progress', owner: 'claude', priority: 5 }]);
  const r = proposeTasks(db, { parentId: 'F9', children: [
    { title: 'child a', resources: ['pkg/x'] },
    { id: 'F9.custom', title: 'child b', owner: 'antigravity', priority: 2 },
  ] });
  assert.deepEqual(r.created, ['F9.1', 'F9.custom']);
  const a = getTask(db, 'F9.1');
  assert.equal(a.owner, 'claude');   // inherited from parent
  assert.equal(a.priority, 5);       // inherited
  assert.equal(a.status, 'proposed');
  const b = getTask(db, 'F9.custom');
  assert.equal(b.owner, 'antigravity');
  assert.equal(b.priority, 2);
});

test('epicsOf reports done/total progress for parents with descendants', () => {
  const db = freshDb([
    { id: 'E', title: 'epic', status: 'in-progress', owner: 'both', priority: 5 },
    { id: 'E.1', title: 'c1', status: 'done', owner: 'claude', priority: 10 },
    { id: 'E.2', title: 'c2', status: 'ready-for-impl', owner: 'claude', priority: 10 },
  ]);
  const epics = epicsOf(listTasks(db));
  assert.equal(epics.length, 1);
  assert.equal(epics[0].id, 'E');
  assert.equal(epics[0].childrenTotal, 2);
  assert.equal(epics[0].childrenReady, 1);
});

test('acceptProposals promotes proposed → spec', () => {
  const db = freshDb([{ id: 'P1', title: 'p', status: 'proposed', owner: 'claude', priority: 10 }]);
  const r = acceptProposals(db, { ids: ['P1'] });
  assert.deepEqual(r.accepted, ['P1']);
  assert.equal(getTask(db, 'P1').status, 'spec');
});

// ─── plannerCycle ─────────────────────────────────────────────────────────

test('plannerCycle promotes proposed → spec', () => {
  const db = freshDb([
    { id: 'P1', title: 'task a', status: 'proposed', owner: 'claude', priority: 10 },
    { id: 'P2', title: 'task b', status: 'proposed', owner: 'antigravity', priority: 20 },
  ]);
  const r = plannerCycle(db, { config });
  assert.equal(r.promoted.length, 2);
  assert.equal(getTask(db, 'P1').status, 'spec');
  assert.equal(getTask(db, 'P2').status, 'spec');
});

test('plannerCycle skips proposed tasks with unmet dependencies', () => {
  const db = freshDb([
    { id: 'D1', title: 'dep', status: 'in-progress', owner: 'claude', priority: 5 },
    { id: 'P1', title: 'blocked', status: 'proposed', owner: 'claude', priority: 10, depends_on: ['D1'] },
  ]);
  const r = plannerCycle(db, { config });
  assert.equal(r.promoted.length, 0);
  assert.equal(getTask(db, 'P1').status, 'proposed');
});

test('plannerCycle promotes proposed when deps are done', () => {
  const db = freshDb([
    { id: 'D1', title: 'dep', status: 'done', owner: 'claude', priority: 5 },
    { id: 'P1', title: 'ready', status: 'proposed', owner: 'claude', priority: 10, depends_on: ['D1'] },
  ]);
  const r = plannerCycle(db, { config });
  assert.equal(r.promoted.length, 1);
  assert.equal(getTask(db, 'P1').status, 'spec');
});

test('plannerCycle fast-tracks spec → designing when spec file exists', () => {
  const db = freshDb([
    { id: 'S1', title: 'has spec', status: 'spec', owner: 'claude', priority: 10, spec: '.ai/features/S1/spec.md' },
  ]);
  const r = plannerCycle(db, { config });
  assert.equal(r.promoted.length, 1);
  assert.equal(r.promoted[0].from, 'spec');
  assert.equal(r.promoted[0].to, 'designing');
  assert.equal(getTask(db, 'S1').status, 'designing');
});

test('plannerCycle leaves spec tasks without a spec file for agents to claim', () => {
  const db = freshDb([
    { id: 'S2', title: 'needs spec', status: 'spec', owner: 'claude', priority: 10 },
  ]);
  const r = plannerCycle(db, { config });
  assert.equal(r.promoted.length, 0);
  assert.equal(getTask(db, 'S2').status, 'spec');
});

// ─── sprint carry-over (stranded stories) ─────────────────────────────────

test('plannerCycle carries a workable story stranded in a completed sprint into the active sprint', () => {
  const db = freshDb([
    { id: 'W1', type: 'story', title: 'reopened', status: 'ready-for-impl', owner: 'claude', priority: 10, sprint_id: 'S-2' },
  ]);
  upsertSprint(db, { id: 'S-2', name: 'Sprint 2', status: 'completed' });
  upsertSprint(db, { id: 'S-3', name: 'Sprint 3', status: 'active' });
  const r = plannerCycle(db, { config });
  assert.equal(getTask(db, 'W1').sprint_id, 'S-3', 'stranded story reassigned to active sprint');
  assert.ok(r.promoted.some((p) => p.id === 'W1' && p.from === 'S-2' && p.sprint_id === 'S-3'), 'promoted log records the carry-over');
});

test('plannerCycle leaves a story already in the active sprint untouched', () => {
  const db = freshDb([
    { id: 'A1', type: 'story', title: 'committed', status: 'ready-for-impl', owner: 'claude', priority: 10, sprint_id: 'S-3' },
  ]);
  upsertSprint(db, { id: 'S-3', name: 'Sprint 3', status: 'active' });
  const r = plannerCycle(db, { config });
  assert.equal(getTask(db, 'A1').sprint_id, 'S-3');
  assert.ok(!r.promoted.some((p) => p.id === 'A1' && p.to === 'sprint_assigned'), 'no spurious re-assignment');
});

test('plannerCycle does not carry over done or blocked stories stranded in a completed sprint', () => {
  const db = freshDb([
    { id: 'D1', type: 'story', title: 'done', status: 'done', owner: 'claude', priority: 10, sprint_id: 'S-2' },
    { id: 'B1', type: 'story', title: 'blocked', status: 'blocked', owner: 'claude', priority: 10, sprint_id: 'S-2' },
  ]);
  upsertSprint(db, { id: 'S-2', name: 'Sprint 2', status: 'completed' });
  upsertSprint(db, { id: 'S-3', name: 'Sprint 3', status: 'active' });
  plannerCycle(db, { config });
  assert.equal(getTask(db, 'D1').sprint_id, 'S-2', 'done story stays put');
  assert.equal(getTask(db, 'B1').sprint_id, 'S-2', 'blocked story stays put');
});

test('plannerStatus reports backlog depth, epics, and proposals', () => {
  const db = freshDb([
    { id: 'E', title: 'epic', status: 'in-progress', owner: 'both', priority: 5 },
    { id: 'E.1', title: 'c1', status: 'proposed', owner: 'claude', priority: 10, resources: ['pkg/x'] },
    { id: 'S', title: 'spec task', status: 'spec', owner: 'claude', priority: 20 },
  ]);
  const s = plannerStatus(db);
  assert.equal(s.backlogDepth, 2); // E.1 proposed + S spec
  assert.ok(s.epics.some((e) => e.id === 'E'));
  assert.equal(s.proposals.length, 1);
  assert.equal(s.proposals[0].id, 'E.1');
  assert.equal(s.proposals[0].fromEpic, 'E');
  assert.deepEqual(s.proposals[0].resources, ['pkg/x']);
});
