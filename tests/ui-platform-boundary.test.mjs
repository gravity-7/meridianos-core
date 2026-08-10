import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusViewFromResponse, readApplicationStatus } from '../dashboard/static/app-boundary.mjs';

test('status boundary maps existing API outcomes to stable user-safe view states', () => {
  assert.deepEqual(statusViewFromResponse({ status: 200, body: { runs: [{}], queue: [{}, {}] } }), { state: 'content', data: { activeRuns: 1, queuedTasks: 2 } });
  assert.deepEqual(statusViewFromResponse({ status: 200, body: { runs: [], queue: [] } }), { state: 'empty', message: 'There are no active runs or queued tasks.' });
  assert.deepEqual(statusViewFromResponse({ status: 401 }), { state: 'error', message: 'You do not have access to application status.', recoverable: false });
  assert.deepEqual(statusViewFromResponse({ status: 503, error: new Error('secret upstream url') }), { state: 'error', message: 'Unable to load application status. Try again.', recoverable: true });
});

test('status boundary retains the existing API request and safely handles malformed JSON', async () => {
  let requested = null;
  const result = await readApplicationStatus(async (path, options) => { requested = { path, options }; return { status: 200, json: async () => { throw new Error('bad json'); } }; });
  assert.equal(requested.path, '/api/status');
  assert.deepEqual(result, { state: 'error', message: 'Application status was unavailable.', recoverable: true });
});
