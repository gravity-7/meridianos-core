/**
 * F006 — Azure DevOps Connector tests.
 *
 * Uses a fetch-intercept pattern to mock ADO REST API responses without network calls,
 * plus in-memory SQLite boards for syncToBoard/syncFromBoard tests.
 *
 * Run: node --test tests/azure-devops-source.test.mjs
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db.mjs';
import { createProjectStore } from '../project-store.mjs';
import { resolvePaths } from '../config.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';
import {
  authHeader,
  pullWorkItems,
  pushStatus,
  syncToBoard,
  syncFromBoard,
  resolveAdoConfig,
  mapAdoState,
  mapAiosStateToAdo,
  extractFields,
  buildTaskId,
  toTask,
} from '../azure-devops-source.mjs';

// ─── Test fixtures ─────────────────────────────────────────────────────────

const MOCK_ORG = 'testorg';
const MOCK_PROJECT = 'testproject';
const MOCK_PAT = 'test-pat-xxxx';
const ADO_BASE = `https://dev.azure.com/${MOCK_ORG}/${MOCK_PROJECT}`;

const ADO_WIQL_URL = `${ADO_BASE}/_apis/wit/wiql?api-version=7.1-preview.2`;
const ADO_WORKITEM_URL = (id) =>
  `${ADO_BASE}/_apis/wit/workitems/${id}?$expand=all&api-version=7.1-preview.3`;
const ADO_PATCH_URL = (id) =>
  `${ADO_BASE}/_apis/wit/workitems/${id}?api-version=7.1-preview.3`;

/** A work item ID → detail map for the mock fetch. */
function mockAdoItems(items) {
  return new Map(items.map((i) => [i.id, i]));
}

/** Build a mock ADO work item detail object. */
function mockWorkItem(id, overrides = {}) {
  return {
    id,
    rev: 1,
    fields: {
      'System.Id': id,
      'System.Title': overrides.title ?? `Test Work Item ${id}`,
      'System.State': overrides.state ?? 'Active',
      'System.WorkItemType': overrides.type ?? 'Feature',
      'System.Description': overrides.description ?? `Description for item ${id}`,
      'Microsoft.VSTS.Common.AcceptanceCriteria': overrides.acceptanceCriteria ?? '',
      'System.Tags': overrides.tags ?? '',
      'System.AssignedTo': overrides.assignedTo ?? null,
      'System.Reason': overrides.reason ?? 'New',
      'System.CreatedDate': overrides.createdDate ?? '2026-01-01T00:00:00Z',
      'System.ChangedDate': overrides.changedDate ?? '2026-01-01T00:00:00Z',
    },
    _links: {
      html: { href: `https://dev.azure.com/${MOCK_ORG}/${MOCK_PROJECT}/_workitems/edit/${id}` },
    },
    url: `https://dev.azure.com/${MOCK_ORG}/${MOCK_PROJECT}/_apis/wit/workitems/${id}`,
  };
}

/** Build a WIQL response for a set of work item ids. */
function mockWiqlResponse(ids) {
  return {
    workItems: ids.map((id) => ({
      id,
      url: `https://dev.azure.com/${MOCK_ORG}/${MOCK_PROJECT}/_apis/wit/workitems/${id}`,
    })),
  };
}

/**
 * Install a mock global fetch that routes ADO API calls to canned responses.
 * Non-ADO URLs are passed through to the real fetch (or fail if not wanted).
 */
function installMockFetch(itemsById) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const urlStr = typeof url === 'string' ? url : url?.href ?? String(url);
    const method = init.method ?? 'GET';

    // ── WIQL query ──
    if (method === 'POST' && urlStr.includes('/_apis/wit/wiql')) {
      const ids = [...itemsById.keys()];
      return new Response(JSON.stringify(mockWiqlResponse(ids)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ── PATCH work item ──
    if (method === 'PATCH' && urlStr.includes('/_apis/wit/workitems/')) {
      const idMatch = urlStr.match(/workitems\/(\d+)/);
      const id = idMatch ? parseInt(idMatch[1], 10) : null;
      const item = id != null ? itemsById.get(id) : null;
      if (!item) {
        return new Response(JSON.stringify({ message: 'Not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // Parse the patch body to update state
      let body;
      try { body = JSON.parse(init.body || '[]'); } catch { body = []; }
      const statePatch = body.find((p) => p.path === '/fields/System.State');
      if (statePatch) {
        item.fields['System.State'] = statePatch.value;
      }
      return new Response(JSON.stringify(item), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ── GET work item (single) ──
    if (method === 'GET' && urlStr.includes('/_apis/wit/workitems/')) {
      const idMatch = urlStr.match(/workitems\/(\d+)/);
      const id = idMatch ? parseInt(idMatch[1], 10) : null;
      const item = id != null ? itemsById.get(id) : null;
      if (!item) {
        return new Response(JSON.stringify({ message: 'Not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(item), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ── Pass through to real fetch for non-ADO URLs ──
    return realFetch(url, init);
  };
  return realFetch;
}

function restoreMockFetch(realFetch) {
  globalThis.fetch = realFetch;
}

// ─── Helper to create an in-memory store with the fixture domain ───────────

const config = resolvePaths({ domain: FIXTURE_DOMAIN });
function freshStore() {
  const db = openDb(':memory:', config);
  return createProjectStore({ db, config });
}

// ─── Simple unit tests (no fetch mocking needed) ───────────────────────────

test('authHeader creates Basic auth base64', () => {
  const h = authHeader('mypat');
  assert.ok(h.startsWith('Basic '));
  const decoded = Buffer.from(h.slice(6), 'base64').toString('utf8');
  assert.equal(decoded, ':mypat');
});

test('mapAdoState maps known states correctly', () => {
  assert.equal(mapAdoState('To Do'), 'proposed');
  assert.equal(mapAdoState('Active'), 'designing');
  assert.equal(mapAdoState('In Progress'), 'designing');
  assert.equal(mapAdoState('Resolved'), 'in-review');
  assert.equal(mapAdoState('Closed'), 'done');
  assert.equal(mapAdoState('Removed'), 'archived');
  assert.equal(mapAdoState('UnknownState'), 'proposed');
  assert.equal(mapAdoState(''), 'proposed');
  assert.equal(mapAdoState(null), 'proposed');
});

test('mapAiosStateToAdo maps back to ADO states', () => {
  assert.equal(mapAiosStateToAdo('proposed'), 'Proposed');
  assert.equal(mapAiosStateToAdo('designing'), 'Active');
  assert.equal(mapAiosStateToAdo('in-progress'), 'In Progress');
  assert.equal(mapAiosStateToAdo('in-review'), 'Resolved');
  assert.equal(mapAiosStateToAdo('done'), 'Closed');
  assert.equal(mapAiosStateToAdo('unknown'), 'Active');
});

test('buildTaskId creates ADO-prefixed ids', () => {
  assert.equal(buildTaskId(3), 'ADO-3');
  assert.equal(buildTaskId(42), 'ADO-42');
  assert.equal(buildTaskId(0), 'ADO-0');
});

test('extractFields pulls all relevant fields from an ADO work item', () => {
  const adoItem = mockWorkItem(5, {
    title: 'My Feature',
    state: 'Active',
    type: 'Epic',
    tags: 'complexity-4; builder',
    assignedTo: { displayName: 'Alice' },
  });
  const f = extractFields(adoItem);
  assert.equal(f.adoId, 5);
  assert.equal(f.title, 'My Feature');
  assert.equal(f.state, 'Active');
  assert.equal(f.type, 'Epic');
  assert.equal(f.tags, 'complexity-4; builder');
  assert.equal(f.assignedTo, 'Alice');
  assert.ok(f.url.includes('_workitems/edit/5'));
});

test('toTask converts an ADO item to a MeridianOS task shape', () => {
  const adoItem = mockWorkItem(7, { title: 'Cool Feature', state: 'Active', tags: 'complexity-3' });
  const task = toTask(adoItem, { config });
  assert.equal(task.id, 'ADO-7');
  assert.equal(task.title, 'Cool Feature');
  assert.equal(task.status, 'designing');
  assert.equal(task.complexity, 3);
  assert.equal(task.adoId, 7);
  assert.equal(task.adoType, 'Feature');
  assert.ok(task.adoUrl);
});

test('toTask handles missing fields gracefully', () => {
  // Minimal ADO item — no tags, no assignedTo, etc.
  const minimal = {
    id: 99,
    fields: { 'System.Title': 'Minimal', 'System.State': 'To Do', 'System.WorkItemType': 'Feature' },
    _links: {},
  };
  const task = toTask(minimal, { config });
  assert.equal(task.id, 'ADO-99');
  assert.equal(task.status, 'proposed');
  assert.equal(task.complexity, undefined);
  assert.equal(task.owner, undefined);
});

// ─── resolveAdoConfig tests ────────────────────────────────────────────────

test('resolveAdoConfig returns null when integrations.ado is not set', () => {
  assert.equal(resolveAdoConfig({}), null);
  assert.equal(resolveAdoConfig({ integrations: {} }), null);
  assert.equal(resolveAdoConfig({ integrations: { ado: {} } }), null);
});

test('resolveAdoConfig returns null when enabled is false', () => {
  assert.equal(
    resolveAdoConfig({ integrations: { ado: { enabled: false, org: 'x', project: 'y' } } }),
    null,
  );
});

test('resolveAdoConfig returns null when org or project is missing', () => {
  assert.equal(
    resolveAdoConfig({ integrations: { ado: { enabled: true, org: 'x' } } }),
    null,
  );
  assert.equal(
    resolveAdoConfig({ integrations: { ado: { enabled: true, project: 'y' } } }),
    null,
  );
});

test('resolveAdoConfig returns null when PAT is not set in env', () => {
  assert.equal(
    resolveAdoConfig({ integrations: { ado: { enabled: true, org: 'x', project: 'y' } } }),
    null,
  );
});

test('resolveAdoConfig resolves with ADO_PAT env var', () => {
  process.env.ADO_PAT = 'test-pat';
  const cfg = resolveAdoConfig({ integrations: { ado: { enabled: true, org: 'x', project: 'y' } } });
  assert.ok(cfg);
  assert.equal(cfg.org, 'x');
  assert.equal(cfg.project, 'y');
  assert.equal(cfg.pat, 'test-pat');
  delete process.env.ADO_PAT;
});

test('resolveAdoConfig supports legacy integrations.azure_devops key', () => {
  process.env.ADO_PAT = 'test-pat-legacy';
  const cfg = resolveAdoConfig({
    integrations: { azure_devops: { enabled: true, org: 'leg', project: 'proj' } },
  });
  assert.ok(cfg);
  assert.equal(cfg.org, 'leg');
  assert.equal(cfg.project, 'proj');
  delete process.env.ADO_PAT;
});

test('resolveAdoConfig prefers integrations.ado over integrations.azure_devops', () => {
  process.env.ADO_PAT = 'test-pat-pref';
  const cfg = resolveAdoConfig({
    integrations: {
      ado: { enabled: true, org: 'new', project: 'np' },
      azure_devops: { enabled: true, org: 'old', project: 'op' },
    },
  });
  assert.equal(cfg.org, 'new');
  delete process.env.ADO_PAT;
});

// ─── pullWorkItems tests (fetch mock) ──────────────────────────────────────

test('pullWorkItems fetches and returns full work item details', async () => {
  const items = new Map();
  items.set(1, mockWorkItem(1, { title: 'Feature A', state: 'Active' }));
  items.set(2, mockWorkItem(2, { title: 'Feature B', state: 'To Do' }));
  const realFetch = installMockFetch(items);

  try {
    const result = await pullWorkItems({ org: MOCK_ORG, project: MOCK_PROJECT, pat: MOCK_PAT });
    assert.equal(result.length, 2);
    assert.equal(result[0].id, 1);
    assert.equal(result[0].fields['System.Title'], 'Feature A');
    assert.equal(result[1].id, 2);
    assert.equal(result[1].fields['System.Title'], 'Feature B');
  } finally {
    restoreMockFetch(realFetch);
  }
});

test('pullWorkItems skips items that fail to fetch and logs a warning', async () => {
  // Only item 1 is in the mock — item 2 will 404
  const items = new Map();
  items.set(1, mockWorkItem(1, { title: 'Only One' }));
  const realFetch = installMockFetch(items);

  // Override WIQL to return both ids (including one that will 404)
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const urlStr = typeof url === 'string' ? url : url?.href ?? String(url);
    if (init.method === 'POST' && urlStr.includes('/_apis/wit/wiql')) {
      return new Response(JSON.stringify(mockWiqlResponse([1, 999])), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return origFetch(url, init);
  };

  try {
    const result = await pullWorkItems({ org: MOCK_ORG, project: MOCK_PROJECT, pat: MOCK_PAT });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 1);
  } finally {
    restoreMockFetch(realFetch);
  }
});

// ─── pushStatus tests (fetch mock) ─────────────────────────────────────────

test('pushStatus maps MeridianOS status to ADO state and patches the work item', async () => {
  const items = new Map();
  items.set(10, mockWorkItem(10, { title: 'Push Test', state: 'Active' }));
  const realFetch = installMockFetch(items);

  try {
    const result = await pushStatus(
      { org: MOCK_ORG, project: MOCK_PROJECT, pat: MOCK_PAT },
      10,
      'done',
      'Completed via MeridianOS',
    );
    assert.equal(result.id, 10);
    assert.equal(result.fields['System.State'], 'Closed');

    // The mock should have updated state
    const updated = items.get(10);
    assert.equal(updated.fields['System.State'], 'Closed');
  } finally {
    restoreMockFetch(realFetch);
  }
});

test('pushStatus uses default comment when none provided', async () => {
  const items = new Map();
  items.set(20, mockWorkItem(20, { title: 'Default Comment Test', state: 'Active' }));
  const realFetch = installMockFetch(items);

  try {
    const result = await pushStatus(
      { org: MOCK_ORG, project: MOCK_PROJECT, pat: MOCK_PAT },
      20,
      'in-progress',
    );
    assert.equal(result.id, 20);
    assert.equal(result.fields['System.State'], 'In Progress');
  } finally {
    restoreMockFetch(realFetch);
  }
});

// ─── syncToBoard tests (fetch mock + real SQLite board) ────────────────────

test('syncToBoard creates new tasks from ADO work items in the local board', async () => {
  const items = new Map();
  items.set(1, mockWorkItem(1, { title: 'New Feature', state: 'Active', tags: 'complexity-3' }));
  items.set(2, mockWorkItem(2, { title: 'Another Feature', state: 'To Do' }));
  const realFetch = installMockFetch(items);
  const store = freshStore();

  try {
    const result = await syncToBoard(
      { org: MOCK_ORG, project: MOCK_PROJECT, pat: MOCK_PAT },
      store,
    );
    assert.equal(result.created, 2);
    assert.equal(result.updated, 0);
    assert.equal(result.errors.length, 0);

    // Verify tasks are in the board
    const t1 = store.state.getTask('ADO-1');
    assert.ok(t1);
    assert.equal(t1.title, 'New Feature');
    assert.equal(t1.status, 'designing'); // Active → designing
    assert.equal(t1.complexity, 3);

    const t2 = store.state.getTask('ADO-2');
    assert.ok(t2);
    assert.equal(t2.title, 'Another Feature');
    assert.equal(t2.status, 'proposed'); // To Do → proposed

    // Verify ADO metadata stored in note
    const meta1 = JSON.parse(t1.note);
    assert.equal(meta1.adoId, 1);
    assert.equal(meta1.adoState, 'Active');
    assert.equal(meta1.adoType, 'Feature');
  } finally {
    restoreMockFetch(realFetch);
  }
});

test('syncToBoard updates existing tasks when ADO state changes', async () => {
  const items = new Map();
  items.set(3, mockWorkItem(3, { title: 'Changing Feature', state: 'Resolved' }));
  const realFetch = installMockFetch(items);
  const store = freshStore();

  // Pre-seed the board with a task that has older ADO state
  store.state.upsertTask({
    id: 'ADO-3',
    title: 'Changing Feature',
    status: 'designing',
    note: JSON.stringify({ adoId: 3, adoState: 'Active', adoType: 'Feature' }),
  });

  try {
    const result = await syncToBoard(
      { org: MOCK_ORG, project: MOCK_PROJECT, pat: MOCK_PAT },
      store,
    );
    assert.equal(result.created, 0);
    assert.equal(result.updated, 1);
    assert.equal(result.errors.length, 0);

    const t = store.state.getTask('ADO-3');
    assert.equal(t.status, 'in-review'); // Resolved → in-review
    const meta = JSON.parse(t.note);
    assert.equal(meta.adoState, 'Resolved');
  } finally {
    restoreMockFetch(realFetch);
  }
});

test('syncToBoard skips tasks that have not changed', async () => {
  const items = new Map();
  items.set(4, mockWorkItem(4, { title: 'Stable Feature', state: 'Active' }));
  const realFetch = installMockFetch(items);
  const store = freshStore();

  // Pre-seed with matching state
  store.state.upsertTask({
    id: 'ADO-4',
    title: 'Stable Feature',
    status: 'designing', // Active → designing
    note: JSON.stringify({ adoId: 4, adoState: 'Active', adoType: 'Feature' }),
  });

  try {
    const result = await syncToBoard(
      { org: MOCK_ORG, project: MOCK_PROJECT, pat: MOCK_PAT },
      store,
    );
    assert.equal(result.created, 0);
    assert.equal(result.updated, 0);
    // skipped should be 1 (the one item that didn't change)
    assert.equal(result.skipped, 1);
    assert.equal(result.errors.length, 0);
  } finally {
    restoreMockFetch(realFetch);
  }
});

// ─── syncFromBoard tests (fetch mock + real SQLite board) ──────────────────

test('syncFromBoard pushes status changes for ADO-linked board tasks', async () => {
  const items = new Map();
  items.set(10, mockWorkItem(10, { title: 'Push Me', state: 'Active' }));
  const realFetch = installMockFetch(items);
  const store = freshStore();

  // Seed a task where local status differs from ADO
  store.state.upsertTask({
    id: 'ADO-10',
    title: 'Push Me',
    status: 'done',
    note: JSON.stringify({ adoId: 10, adoState: 'Active', adoType: 'Feature' }),
  });

  try {
    const result = await syncFromBoard(
      { org: MOCK_ORG, project: MOCK_PROJECT, pat: MOCK_PAT },
      store,
    );
    assert.equal(result.pushed, 1);
    assert.equal(result.skipped, 0);
    assert.equal(result.errors.length, 0);

    // The ADO item should now have state 'Closed'
    const updated = items.get(10);
    assert.equal(updated.fields['System.State'], 'Closed');
  } finally {
    restoreMockFetch(realFetch);
  }
});

test('syncFromBoard skips tasks where ADO state already matches', async () => {
  const items = new Map();
  items.set(11, mockWorkItem(11, { title: 'Already Synced', state: 'Active' }));
  const realFetch = installMockFetch(items);
  const store = freshStore();

  // Seed a task where local status maps to the same ADO state
  store.state.upsertTask({
    id: 'ADO-11',
    title: 'Already Synced',
    status: 'designing', // designing → Active
    note: JSON.stringify({ adoId: 11, adoState: 'Active', adoType: 'Feature' }),
  });

  try {
    const result = await syncFromBoard(
      { org: MOCK_ORG, project: MOCK_PROJECT, pat: MOCK_PAT },
      store,
    );
    assert.equal(result.pushed, 0);
    assert.equal(result.skipped, 1);
    assert.equal(result.errors.length, 0);

    // ADO item should be unchanged
    const unchanged = items.get(11);
    assert.equal(unchanged.fields['System.State'], 'Active');
  } finally {
    restoreMockFetch(realFetch);
  }
});

test('syncFromBoard ignores non-ADO tasks', async () => {
  const items = new Map();
  items.set(12, mockWorkItem(12, { title: 'ADO Task', state: 'Active' }));
  const realFetch = installMockFetch(items);
  const store = freshStore();

  // Seed a mix of ADO and non-ADO tasks
  store.state.upsertTask({
    id: 'ADO-12',
    title: 'ADO Task',
    status: 'done',
    note: JSON.stringify({ adoId: 12, adoState: 'Active' }),
  });
  store.state.upsertTask({
    id: 'F-local',
    title: 'Local Task',
    status: 'done',
  });

  try {
    const result = await syncFromBoard(
      { org: MOCK_ORG, project: MOCK_PROJECT, pat: MOCK_PAT },
      store,
    );
    // Only ADO-12 should be processed; F-local is ignored
    assert.equal(result.pushed, 1);
    assert.equal(result.skipped, 0);
  } finally {
    restoreMockFetch(realFetch);
  }
});

test('syncFromBoard handles tasks with unparseable notes gracefully', async () => {
  const items = new Map();
  items.set(13, mockWorkItem(13, { title: 'Bad Note', state: 'Active' }));
  const realFetch = installMockFetch(items);
  const store = freshStore();

  // Seed a task with a plain-text note (not JSON)
  store.state.upsertTask({
    id: 'ADO-13',
    title: 'Bad Note',
    status: 'in-review',
    note: 'just some text, not json',
  });

  try {
    const result = await syncFromBoard(
      { org: MOCK_ORG, project: MOCK_PROJECT, pat: MOCK_PAT },
      store,
    );
    // Since adoMeta.adoState is undefined (note wasn't JSON), no push should happen
    assert.equal(result.pushed, 0);
    assert.equal(result.skipped, 1);
  } finally {
    restoreMockFetch(realFetch);
  }
});

// ─── Full round-trip test ──────────────────────────────────────────────────

test('round-trip: pull → board → status change → push', async () => {
  const items = new Map();
  items.set(100, mockWorkItem(100, { title: 'Round Trip', state: 'Active' }));
  const realFetch = installMockFetch(items);
  const store = freshStore();

  try {
    // 1. Pull ADO → Board
    const pullResult = await syncToBoard(
      { org: MOCK_ORG, project: MOCK_PROJECT, pat: MOCK_PAT },
      store,
    );
    assert.equal(pullResult.created, 1);
    const t1 = store.state.getTask('ADO-100');
    assert.equal(t1.status, 'designing'); // Active → designing

    // 2. Simulate agent completing the task (transition to done)
    // We use upsertTask directly since transition requires lease mechanics
    store.state.upsertTask({
      ...t1,
      status: 'done',
      note: JSON.stringify({ adoId: 100, adoState: 'Active', adoType: 'Feature' }),
    });

    // 3. Push Board → ADO
    const pushResult = await syncFromBoard(
      { org: MOCK_ORG, project: MOCK_PROJECT, pat: MOCK_PAT },
      store,
    );
    assert.equal(pushResult.pushed, 1);

    // 4. Verify ADO item state was updated
    const updated = items.get(100);
    assert.equal(updated.fields['System.State'], 'Closed');

    // 5. Verify board note was updated with new ADO state
    const t2 = store.state.getTask('ADO-100');
    const meta = JSON.parse(t2.note);
    assert.equal(meta.adoState, 'Closed');
  } finally {
    restoreMockFetch(realFetch);
  }
});
