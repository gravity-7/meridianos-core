import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { buildDashboardBoard } from '../dashboard/app/shared/legacy-parity-adapters.mjs';

test('Spec 017 parity contract preserves live and fallback routes', async () => {
  const server = await fs.readFile('dashboard/server.mjs', 'utf8');
  const spec = await fs.readFile('specs/017-platform-observability-dashboard/spec.md', 'utf8');
  assert.match(server, /\/legacy/);
  assert.match(server, /\/index\.html/);
  assert.match(server, /\/setup/);
  assert.match(spec, /FR-017-015/);
  assert.doesNotMatch(spec, /cloud\/dashboard\/index\.html.*live demo route/);
});

test('parity inventory is required before convergence', async () => {
  const tasks = await fs.readFile('specs/017-platform-observability-dashboard/tasks.md', 'utf8');
  assert.match(tasks, /parity-inventory\.md/);
  assert.match(tasks, /no unclassified/);
});

test('every in-scope legacy capability has an explicit disposition and adapter preserves empty semantics', async () => {
  const inventory = await fs.readFile('specs/017-platform-observability-dashboard/parity-inventory.md', 'utf8');
  const rows = inventory.split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| Legacy capability') && !line.startsWith('|---'));
  assert.ok(rows.length >= 20);
  for (const row of rows) assert.match(row, /\| (planned|verified|retained|retired) \|/);
  const board = buildDashboardBoard({ overview: { attention: [], health: { requests: 0, errors: 0 }, usage: {}, cost: {} } });
  assert.equal(board.health.state, 'empty');
  assert.deepEqual(board.trends.requests.points, []);
  assert.equal(board.trends.cost.unit, 'USD');
});
