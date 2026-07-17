import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIntakeRegistry } from '../intake-registry.mjs';
import { createGithubSource } from '../github-source.mjs';

// Fixtures mirror the real shape returned by GitHub's "List repository issues" /
// "Get an issue" REST endpoints (verified by hand against the live API docs) — no network
// access here, ever; `fetch` is always injected as a stub.

const issue1 = {
  number: 1,
  state: 'open',
  title: 'Add feature X',
  body: 'full issue body text',
  labels: [{ name: 'feature:x' }, { name: 'bug' }],
  user: { login: 'octocat' },
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
  html_url: 'https://github.com/acme/widgets/issues/1',
  milestone: { title: 'v1' },
};

const pr2 = {
  number: 2,
  state: 'open',
  title: 'A pull request, not an issue',
  body: 'pr body',
  labels: [],
  user: { login: 'bot' },
  created_at: '2026-01-03T00:00:00Z',
  updated_at: '2026-01-03T00:00:00Z',
  html_url: 'https://github.com/acme/widgets/pull/2',
  pull_request: { url: 'https://api.github.com/repos/acme/widgets/pulls/2' },
};

/** A stubbed fetch distinguishing the list endpoint (`/issues?...`) from the single-issue
 *  endpoint (`/issues/<number>`), the same way a real GitHub API base would. */
function makeFetch({ listStatus = 200, singleStatus = 200, onCall } = {}) {
  return async (url, opts) => {
    onCall?.(url, opts);
    if (/\/issues\/\d+$/.test(url)) {
      return { ok: singleStatus < 400, status: singleStatus, json: async () => issue1 };
    }
    if (url.includes('/issues?')) {
      return { ok: listStatus < 400, status: listStatus, json: async () => [issue1, pr2] };
    }
    throw new Error(`unexpected url in test stub: ${url}`);
  };
}

// ---- AC1: registry duplicate-name guard ------------------------------------------------------

test('AC1: createIntakeRegistry registers a source; registering a second with the same name throws', () => {
  const registry = createIntakeRegistry();
  const source = createGithubSource({ owner: 'acme', repo: 'widgets', fetch: makeFetch() });
  registry.register(source);
  assert.equal(registry.get('github-issues'), source);
  assert.deepEqual(registry.list(), [source]);

  const dup = createGithubSource({ owner: 'acme', repo: 'other', fetch: makeFetch() });
  assert.throws(() => registry.register(dup), /already registered/);
});

// ---- AC2: list() excludes PRs, no body -------------------------------------------------------

test('AC2: list() returns exactly one normalized item (PR excluded), body absent', async () => {
  const source = createGithubSource({ owner: 'acme', repo: 'widgets', fetch: makeFetch() });
  const items = await source.list();
  assert.equal(items.length, 1);
  const [item] = items;
  assert.equal(item.id, 'issue-1');
  assert.equal(item.source, 'github-issues');
  assert.equal(item.kind, 'request');
  assert.equal(item.status, 'open');
  assert.equal(item.path, null);
  assert.equal('body' in item, false);
});

// ---- AC3: read() includes body + meta -------------------------------------------------------

test('AC3: read(id) returns an item with body present and meta.url/labels/number populated', async () => {
  const source = createGithubSource({ owner: 'acme', repo: 'widgets', fetch: makeFetch() });
  const item = await source.read('issue-1');
  assert.equal(item.id, 'issue-1');
  assert.equal(item.body, 'full issue body text');
  assert.equal(item.meta.url, 'https://github.com/acme/widgets/issues/1');
  assert.deepEqual(item.meta.labels, ['feature:x', 'bug']);
  assert.equal(item.meta.number, 1);
  assert.equal(item.feature, 'x', 'derived from the feature:<x> label');
  assert.equal(item.meta.milestone, 'v1');
});

// ---- AC4: unset tokenEnv still issues the request; HTTP failure throws, never [] -------------

test('AC4: unset tokenEnv still issues the request (public repos work tokenless)', async () => {
  delete process.env.GH_SOURCE_TEST_UNSET_TOKEN;
  let called = false;
  let sawAuthHeader = false;
  const fetchImpl = makeFetch({
    onCall: (url, opts) => {
      called = true;
      if (opts?.headers?.Authorization) sawAuthHeader = true;
    },
  });
  const source = createGithubSource({ owner: 'acme', repo: 'widgets', tokenEnv: 'GH_SOURCE_TEST_UNSET_TOKEN', fetch: fetchImpl });
  const items = await source.list();
  assert.equal(called, true, 'the request was issued despite the token env var being unset');
  assert.equal(sawAuthHeader, false, 'no Authorization header is sent when the token is unset');
  assert.equal(items.length, 1);
});

test('AC4: a 401/403 response throws a message naming the repo and status, never returns []', async () => {
  const source401 = createGithubSource({ owner: 'acme', repo: 'private-widgets', fetch: makeFetch({ listStatus: 401 }) });
  await assert.rejects(
    () => source401.list(),
    (err) => {
      assert.match(err.message, /acme\/private-widgets/);
      assert.match(err.message, /401/);
      return true;
    },
  );

  const source403 = createGithubSource({ owner: 'acme', repo: 'private-widgets', fetch: makeFetch({ listStatus: 403 }) });
  await assert.rejects(
    () => source403.list(),
    (err) => {
      assert.match(err.message, /acme\/private-widgets/);
      assert.match(err.message, /403/);
      return true;
    },
  );
});

// ---- AC5: exports + name -----------------------------------------------------------------------

test('AC5: createIntakeRegistry and createGithubSource are exported and usable together', () => {
  assert.equal(typeof createIntakeRegistry, 'function');
  assert.equal(typeof createGithubSource, 'function');
  const source = createGithubSource({ owner: 'acme', repo: 'widgets', fetch: makeFetch() });
  assert.equal(source.name, 'github-issues');
  assert.equal(typeof source.list, 'function');
  assert.equal(typeof source.read, 'function');
  assert.equal(source.submit, undefined, 'pull-only: no submit() implemented for GitHub');
});
