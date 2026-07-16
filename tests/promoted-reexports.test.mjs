/**
 * D2 bite #2, stage 2a: taskWithAncestors/effectiveRiskTags/buildSprintFilter/recentReaps/
 * parkedTasks moved to state.mjs (recentVerdicts moved to event-log.mjs), and their OLD homes
 * (sensitive.mjs/router.mjs/watchdog.mjs/verifier.mjs) re-export them by name so every existing
 * external importer keeps working unchanged. This test proves the re-exports are the SAME
 * function object as the new home (not a re-implementation that could drift) and that calling
 * them through the old name still works end-to-end.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db.mjs';
import { upsertTask } from '../state.mjs';
import * as state from '../state.mjs';
import * as eventLog from '../event-log.mjs';
import * as sensitive from '../sensitive.mjs';
import * as router from '../router.mjs';
import * as watchdog from '../watchdog.mjs';
import * as verifier from '../verifier.mjs';

const T0 = '2026-07-03T00:00:00.000Z';

test('sensitive.mjs re-exports taskWithAncestors/effectiveRiskTags by identity from state.mjs', () => {
  assert.equal(sensitive.taskWithAncestors, state.taskWithAncestors);
  assert.equal(sensitive.effectiveRiskTags, state.effectiveRiskTags);
});

test('router.mjs re-exports buildSprintFilter by identity from state.mjs', () => {
  assert.equal(router.buildSprintFilter, state.buildSprintFilter);
});

test('watchdog.mjs re-exports recentReaps/parkedTasks by identity from state.mjs', () => {
  assert.equal(watchdog.recentReaps, state.recentReaps);
  assert.equal(watchdog.parkedTasks, state.parkedTasks);
});

test('verifier.mjs re-exports recentVerdicts by identity from event-log.mjs', () => {
  assert.equal(verifier.recentVerdicts, eventLog.recentVerdicts);
});

test('calling the re-exported names still works end-to-end (not just identity)', () => {
  const db = openDb(':memory:');
  upsertTask(db, {
    id: 'F2', type: 'epic', title: 'epic', status: 'in-progress', risk_tags: ['payments'],
  }, { now: T0 });
  upsertTask(db, {
    id: 'F2-pay', type: 'story', title: 'paid', status: 'ready-for-impl', parent_id: 'F2',
    priority: 10, risk_tags: [],
  }, { now: T0 });

  // via sensitive.mjs's re-export
  const tags = sensitive.effectiveRiskTags(db, { id: 'F2-pay', parent_id: 'F2', risk_tags: '[]' });
  assert.ok(tags.includes('payments'));

  // via router.mjs's re-export
  assert.equal(router.buildSprintFilter(db), null); // no active sprint seeded

  // via watchdog.mjs's re-export
  assert.deepEqual(watchdog.parkedTasks(db, { now: Date.parse(T0) }), []);
  assert.deepEqual(watchdog.recentReaps(db), []);

  // via verifier.mjs's re-export
  assert.deepEqual(verifier.recentVerdicts(db), []);
});
