import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db.mjs';
import { upsertTask, listTasks } from '../state.mjs';
import { meetsDefinitionOfReady, countAcceptanceCriteria, hasUserStoryStatement } from '../definition-of-ready.mjs';
import { plannerCycle } from '../planner.mjs';
import { resolvePaths } from '../config.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';

const config = resolvePaths({ domain: FIXTURE_DOMAIN });

const goodStory = {
  id: 'S-good', type: 'story', status: 'proposed', owner: 'antigravity', priority: 100, complexity: 3,
  title: 'Photo cleanup — dropzone',
  acceptance_criteria: [
    'As a dealer, I want to drop a listing photo into the panel, so that I can clean it up.',
    '- Given a JPG under 10MB, when I drop it, then a preview thumbnail appears.',
    '- Given a file over 10MB, when I drop it, then an inline size error shows and upload is blocked.',
  ].join('\n'),
};
const thinStory = {
  id: 'S-thin', type: 'story', status: 'proposed', owner: 'antigravity', priority: 100, complexity: 2,
  title: 'Usage meter', acceptance_criteria: '- Visual quota tracker in UI',
};

test('countAcceptanceCriteria counts bullets and Given/When/Then', () => {
  assert.equal(countAcceptanceCriteria('- one thing\n- another thing'), 2);
  assert.equal(countAcceptanceCriteria('Given x when y then z'), 1);
  assert.equal(countAcceptanceCriteria('- ok'), 0); // too short to be meaningful
});

test('hasUserStoryStatement detects the As a / I want form', () => {
  assert.equal(hasUserStoryStatement({ title: 'As a dealer, I want photos, so that leads convert' }), true);
  assert.equal(hasUserStoryStatement({ title: 'Usage meter', acceptance_criteria: '- a tracker' }), false);
});

test('a well-formed story meets DoR; a thin one does not', () => {
  assert.equal(meetsDefinitionOfReady(goodStory).ready, true);
  const thin = meetsDefinitionOfReady(thinStory);
  assert.equal(thin.ready, false);
  assert.ok(thin.reasons.length >= 2);
});

test('epics/features are not gated by DoR (containers)', () => {
  assert.equal(meetsDefinitionOfReady({ type: 'epic', title: 'F2' }).ready, true);
});

test('planner promotes a DoR-ready story but leaves a thin one in proposed + flagged', () => {
  const db = openDb(':memory:', config);
  upsertTask(db, goodStory);
  upsertTask(db, thinStory);
  const r = plannerCycle(db, { policy: { sensitive_actions: {} }, config });
  assert.ok(r.promoted.some((p) => p.id === 'S-good' && p.to === 'spec'), 'good story promoted');
  assert.ok(r.skippedNotReady.some((s) => s.id === 'S-thin'), 'thin story flagged not-ready');
  const thin = listTasks(db).find((t) => t.id === 'S-thin');
  assert.equal(thin.status, 'proposed', 'thin story NOT promoted');
  assert.match(thin.note, /not ready/);
});
