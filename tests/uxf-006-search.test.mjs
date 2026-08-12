import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SearchQueryError, buildSearchResults, parseSearchQuery } from '../dashboard/search.mjs';

const scope = { tenantId: 'tenant-a', projectId: 'alpha' };

test('search validates bounded queries and never accepts empty input', () => {
  assert.throws(() => parseSearchQuery(''), (error) => error instanceof SearchQueryError && error.code === 'SEARCH_QUERY_INVALID');
  assert.throws(() => parseSearchQuery('x'.repeat(81)), (error) => error.code === 'SEARCH_QUERY_INVALID');
  assert.equal(parseSearchQuery('  task-1  '), 'task-1');
});

test('search returns only scoped safe projections and ranks exact/prefix matches first', () => {
  const result = buildSearchResults({
    query: 'task', scope, actor: { role: 'operator' },
    tasks: [
      { id: 'alpha/task-1', title: 'Task one', status: 'ready' },
      { id: 'foreign/task-2', title: 'Task two', status: 'ready' },
    ],
    runs: [{ run_id: 'run-1', task: 'alpha/task-1', outcome: 'failed' }],
    providers: [{ id: 'openai', label: 'OpenAI' }],
  });
  assert.equal(result.results[0].id, 'alpha/task-1');
  assert.ok(result.results.every((item) => item.id !== 'foreign/task-2'));
  assert.equal(result.results[0].href, '/app/operations/tasks/alpha%2Ftask-1?project=alpha');
  assert.equal(result.results[0].scope.projectId, 'alpha');
  assert.equal('title' in result.results[0], false);
});

test('search filters commands by server-derived role and never trusts a client role field', () => {
  const viewer = buildSearchResults({ query: 'overview', scope, actor: { role: 'viewer', requestedRole: 'admin' } });
  assert.ok(viewer.results.some((item) => item.kind === 'route' && item.id === 'overview'));
  const admin = buildSearchResults({ query: 'administration', scope, actor: { role: 'admin' } });
  assert.ok(admin.results.some((item) => item.kind === 'route' && item.id === 'administration'));
});

test('search rejects unsafe entity text and does not expose out-of-scope existence', () => {
  const result = buildSearchResults({ query: 'secret', scope, actor: { role: 'viewer' }, tasks: [{ id: 'foreign/secret', title: 'secret' }] });
  assert.deepEqual(result.results, []);
  assert.throws(() => parseSearchQuery('\u0000'), (error) => error.code === 'SEARCH_QUERY_INVALID');
});
