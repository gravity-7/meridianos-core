import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db.mjs';
import { seedTasks } from '../state.mjs';
import { buildBoardJson, buildBoardMd } from '../render.mjs';
import { checkInvariants } from '../validate.mjs';
import { resolvePaths } from '../config.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';

const config = resolvePaths({ domain: FIXTURE_DOMAIN });
const board = {
  tasks: [
    { id: 'F2', title: 'B', owner: 'claude', status: 'ready-for-impl', priority: 20, created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-01T00:00:00.000Z' },
    { id: 'F1', title: 'A', owner: 'antigravity', status: 'designing', priority: 10, created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-01T00:00:00.000Z' },
  ],
  milestones: ['m1'],
  founder_actions: ['do x'],
};
const meta = { milestones: board.milestones, founder_actions: board.founder_actions };

test('render is deterministic, priority-ordered, and seed→render is idempotent', () => {
  const db1 = openDb(':memory:', config); seedTasks(db1, board);
  const j1 = JSON.stringify(buildBoardJson(db1, meta));
  const db2 = openDb(':memory:', config); seedTasks(db2, buildBoardJson(db1, meta)); // reseed from projection
  const j2 = JSON.stringify(buildBoardJson(db2, meta));
  assert.equal(j1, j2, 'seed→render must be a fixed point (no drift on re-render)');
  assert.deepEqual(buildBoardJson(db1, meta).tasks.map((t) => t.id), ['F1', 'F2'], 'ordered by priority');
});

test('board.md is generated-marked and renders the agile backlog (features/epics) table', () => {
  const db = openDb(':memory:', config); seedTasks(db, board);
  const md = buildBoardMd(buildBoardJson(db, meta), undefined, config);
  assert.match(md, /GENERATED — do not hand-edit/);
  assert.match(md, /# Test Board/);
  assert.match(md, /## 📚 Backlog \(Features & Epics\)/);
  // Both fixtures are non-story (default type 'feature') → they land in the backlog table.
  assert.match(md, /\| F1 \| feature \| A \| designing \| antigravity \|/);
  assert.match(md, /\| F2 \| feature \| B \| ready-for-impl \| claude \|/);
});

test('checkInvariants catches illegal status, dup id, bad dep, non-integer priority', () => {
  assert.equal(checkInvariants(board, undefined, config).length, 0);
  assert.ok(checkInvariants({ tasks: [{ id: 'X', status: 'shipped', priority: 1 }] }, undefined, config).some((p) => /invalid status/.test(p)));
  assert.ok(checkInvariants({ tasks: [{ id: 'X', status: 'done', priority: 1 }, { id: 'X', status: 'done', priority: 1 }] }, undefined, config).some((p) => /duplicate/.test(p)));
  assert.ok(checkInvariants({ tasks: [{ id: 'X', status: 'done', priority: 1, depends_on: ['ghost'] }] }, undefined, config).some((p) => /unknown task/.test(p)));
  assert.ok(checkInvariants({ tasks: [{ id: 'X', status: 'done', priority: 1.5 }] }, undefined, config).some((p) => /integer/.test(p)));
});

// ---- DI-1: injected config drives the default (not just the singleton) -----------------------

test('checkInvariants honors an injected NON-DEFAULT config: PV tags rejected, tenant tags accepted', () => {
  const fakeConfig = resolvePaths({
    domain: { agents: ['x', 'y'], riskToAction: { crypto: 'spend_money' }, knownRiskTags: ['crypto'], boardTitle: 'Z Board' },
  });
  // 'payments' is a PV taxonomy tag — unknown under the fake tenant's taxonomy.
  const rejected = checkInvariants({ tasks: [{ id: 'X', status: 'done', priority: 1, risk_tags: ['payments'] }] }, undefined, fakeConfig);
  assert.ok(rejected.some((p) => /unknown risk_tag 'payments'/.test(p)));
  // The fake tenant's own tag is accepted.
  const accepted = checkInvariants({ tasks: [{ id: 'X', status: 'done', priority: 1, risk_tags: ['crypto'] }] }, undefined, fakeConfig);
  assert.equal(accepted.length, 0);
  // Explicit knownRiskTags still wins over an injected config (existing 2.2b field-param behavior).
  const explicit = checkInvariants({ tasks: [{ id: 'X', status: 'done', priority: 1, risk_tags: ['payments'] }] }, ['payments'], fakeConfig);
  assert.equal(explicit.length, 0);
});

test('buildBoardMd honors an injected NON-DEFAULT config\'s boardTitle', () => {
  const fakeConfig = resolvePaths({
    domain: { agents: ['x', 'y'], riskToAction: {}, knownRiskTags: [], boardTitle: 'Z Board' },
  });
  const db = openDb(':memory:', config); seedTasks(db, board);
  const md = buildBoardMd(buildBoardJson(db, meta), undefined, fakeConfig);
  assert.match(md, /# Z Board/);
  assert.ok(!md.includes('Test Board'), "the module-level FIXTURE_DOMAIN config's title must not leak through");
});
