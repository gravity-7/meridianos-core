import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db.mjs';
import { upsertTask, listTasks } from '../state.mjs';
import { meetsDefinitionOfReady, meetsSpecEntry, countAcceptanceCriteria, hasUserStoryStatement } from '../definition-of-ready.mjs';
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
// A story with a placeholder title — blocked by Tier-1 spec-entry gate
// (upsertTask defaults owner to 'both', so missing owner is not testable at DB level;
//  placeholder title is the reliable Tier-1 blocker for this integration test)
const noOwnerStory = {
  id: 'S-noowner', type: 'story', status: 'proposed', priority: 100, complexity: 2,
  title: 'task', // matches the PLACEHOLDER regex — should be blocked at Tier-1
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

test('a well-formed story meets full DoR (Tier-2); a thin one does not', () => {
  assert.equal(meetsDefinitionOfReady(goodStory).ready, true);
  const thin = meetsDefinitionOfReady(thinStory);
  assert.equal(thin.ready, false);
  assert.ok(thin.reasons.length >= 2);
});

test('meetsSpecEntry (Tier-1): thin story passes if title+owner set; placeholder title is blocked', () => {
  // Thin story has a real title and an owner — passes Tier-1 so spec agent can flesh it out
  assert.equal(meetsSpecEntry(thinStory).ready, true, 'thin story with owner passes Tier-1');
  // Placeholder title: blocked even at Tier-1
  const r = meetsSpecEntry({ id: 'S-x', type: 'story', status: 'proposed', owner: 'claude', title: 'task' });
  assert.equal(r.ready, false, 'placeholder-title story blocked at Tier-1');
  assert.ok(r.reasons.some(s => /placeholder/i.test(s)));
});

test('epics/features are not gated by DoR or spec-entry (containers)', () => {
  assert.equal(meetsDefinitionOfReady({ type: 'epic', title: 'F2' }).ready, true);
  assert.equal(meetsSpecEntry({ type: 'epic', title: 'F2' }).ready, true);
});

test('planner promotes thin+good stories (Tier-1 met) to spec; blocks placeholder-title story', () => {
  const db = openDb(':memory:', config);
  upsertTask(db, goodStory);
  upsertTask(db, thinStory);
  upsertTask(db, noOwnerStory);
  const r = plannerCycle(db, { policy: { sensitive_actions: {} }, config });
  // Both good and thin stories are promoted (both have real titles + owner — Tier-1 passes)
  assert.ok(r.promoted.some((p) => p.id === 'S-good' && p.to === 'spec'), 'good story promoted');
  assert.ok(r.promoted.some((p) => p.id === 'S-thin' && p.to === 'spec'), 'thin story promoted (spec agent will fill ACs)');
  // The placeholder-title story is still blocked at Tier-1
  assert.ok(r.skippedNotReady.some((s) => s.id === 'S-noowner'), 'placeholder story flagged not-ready');
  const blocked = listTasks(db).find((t) => t.id === 'S-noowner');
  assert.equal(blocked.status, 'proposed', 'placeholder story NOT promoted');
  assert.match(blocked.note, /not ready/);
});
