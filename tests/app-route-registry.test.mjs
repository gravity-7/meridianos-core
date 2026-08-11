import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAppRoute, buildAppPath, APP_ROUTES } from '../dashboard/app/route-registry.mjs';

test('app route registry retains foundation/setup routes and adds canonical drill-downs', () => {
  assert.equal(resolveAppRoute('/app').id, 'overview');
  assert.equal(resolveAppRoute('/app/foundation').id, 'foundation');
  assert.equal(resolveAppRoute('/app/setup').id, 'setup');
  assert.deepEqual(resolveAppRoute('/app/operations/runs/run-123'), { id: 'run-detail', params: { runId: 'run-123' }, pathname: '/app/operations/runs/run-123' });
  assert.deepEqual(resolveAppRoute('/app/operations/tasks/project-a%2Ftask-a'), { id: 'task-detail', params: { taskId: 'project-a/task-a' }, pathname: '/app/operations/tasks/project-a%2Ftask-a' });
  assert.equal(APP_ROUTES.some((route) => route.id === 'alert-detail'), true);
  assert.equal(buildAppPath('alert-detail', { alertId: 'alert 1' }), '/app/observability/alerts/alert%201');
});

test('app route registry rejects encoded separators/traversal and unknown routes', () => {
  assert.equal(resolveAppRoute('/app/operations/runs/%2Fetc'), null);
  assert.equal(resolveAppRoute('/app/operations/tasks/project-a%2F..%2Fsecret'), null);
  assert.equal(resolveAppRoute('/app/operations/runs/%2e%2e'), null);
  assert.equal(resolveAppRoute('/app/not-real'), null);
});
