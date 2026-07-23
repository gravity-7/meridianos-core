import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { createIntakeRegistry } from '../intake-registry.mjs';
import {
  createAzureDevOpsSource,
  syncFromAdo,
  pushPrLink,
  updateWorkItemState,
  pullWorkItems,
  getWorkItem,
  queryWorkItems,
  mapAdoState,
  mapAiosStateToAdo,
  toTask,
  buildTaskId,
  extractFields,
  stripHtml,
  authHeader,
} from '../azure-devops-source.mjs';

// Stubbed ADO responses matching REST API v7.1
const mockAdoWI1 = {
  id: 101,
  url: 'https://dev.azure.com/qaisarit/meridianOS/_apis/wit/workitems/101',
  _links: {
    html: { href: 'https://dev.azure.com/qaisarit/meridianOS/_workitems/edit/101' },
  },
  fields: {
    'System.Title': 'Add Azure DevOps Connector',
    'System.Description': '<div>Implement the <b>ADO connector</b> for MeridianOS</div>',
    'Microsoft.VSTS.Common.AcceptanceCriteria': '<p>1. Sync works</p><p>2. PR link pushed</p>',
    'System.State': 'Active',
    'System.WorkItemType': 'Feature',
    'System.Tags': 'builder; complexity-3',
    'System.AssignedTo': { displayName: 'Qaisar' },
    'System.CreatedDate': '2026-07-20T00:00:00Z',
    'System.ChangedDate': '2026-07-20T01:00:00Z',
  },
};

const mockAdoWI2 = {
  id: 102,
  url: 'https://dev.azure.com/qaisarit/meridianOS/_apis/wit/workitems/102',
  _links: {
    html: { href: 'https://dev.azure.com/qaisarit/meridianOS/_workitems/edit/102' },
  },
  fields: {
    'System.Title': 'Slack Integration',
    'System.Description': '<p>Connect Slack webhooks</p>',
    'Microsoft.VSTS.Common.AcceptanceCriteria': '',
    'System.State': 'Proposed',
    'System.WorkItemType': 'Feature',
    'System.Tags': 'designer',
  },
};

function makeFetch({ wiqlStatus = 200, itemStatus = 200, patchStatus = 200, onCall } = {}) {
  return async (url, opts = {}) => {
    onCall?.(url, opts);

    if (url.includes('/_apis/wit/wiql')) {
      if (wiqlStatus >= 400) {
        return { ok: false, status: wiqlStatus, text: async () => 'WIQL error', json: async () => ({}) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          workItems: [{ id: 101 }, { id: 102 }],
        }),
      };
    }

    if (url.includes('/_apis/wit/workitems/101')) {
      if (itemStatus >= 400) {
        return { ok: false, status: itemStatus, text: async () => 'Item error', json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => mockAdoWI1 };
    }

    if (url.includes('/_apis/wit/workitems/102')) {
      if (itemStatus >= 400) {
        return { ok: false, status: itemStatus, text: async () => 'Item error', json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => mockAdoWI2 };
    }

    if (opts.method === 'PATCH' && url.includes('/_apis/wit/workitems/')) {
      if (patchStatus >= 400) {
        return { ok: false, status: patchStatus, text: async () => 'Patch error', json: async () => ({}) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 101, fields: { 'System.State': 'Resolved' } }),
      };
    }

    throw new Error(`unexpected URL in test stub: ${url}`);
  };
}

function mockStore() {
  const tasks = new Map();
  return {
    state: {
      getTask(id) {
        return tasks.get(id);
      },
      upsertTask(t) {
        tasks.set(t.id, { ...t });
        return t;
      },
      getAllTasks() {
        return [...tasks.values()];
      },
    },
  };
}

// ------------------------------------------------------------------------------------------------
// AC1: Basic State and Field Mapping
// ------------------------------------------------------------------------------------------------

test('AC1: mapAdoState correctly translates ADO states to MeridianOS task statuses', () => {
  assert.equal(mapAdoState('To Do'), 'proposed');
  assert.equal(mapAdoState('Proposed'), 'proposed');
  assert.equal(mapAdoState('Active'), 'designing');
  assert.equal(mapAdoState('Doing'), 'designing');
  assert.equal(mapAdoState('In Progress'), 'designing');
  assert.equal(mapAdoState('In Review'), 'in-review');
  assert.equal(mapAdoState('Resolved'), 'in-review');
  assert.equal(mapAdoState('Done'), 'done');
  assert.equal(mapAdoState('Closed'), 'done');
  assert.equal(mapAdoState('Removed'), 'archived');
  assert.equal(mapAdoState('Unknown'), 'proposed');
});

test('AC1: mapAiosStateToAdo correctly translates MeridianOS statuses to ADO states', () => {
  assert.equal(mapAiosStateToAdo('proposed'), 'Proposed');
  assert.equal(mapAiosStateToAdo('designing'), 'Active');
  assert.equal(mapAiosStateToAdo('in-progress'), 'In Progress');
  assert.equal(mapAiosStateToAdo('in-review'), 'Resolved');
  assert.equal(mapAiosStateToAdo('done'), 'Closed');
  assert.equal(mapAiosStateToAdo('archived'), 'Removed');
});

test('AC1: toTask converts ADO work item into a valid MeridianOS task shape', () => {
  const task = toTask(mockAdoWI1);
  assert.equal(task.id, 'ADO-101');
  assert.equal(task.title, 'Add Azure DevOps Connector');
  assert.equal(task.status, 'designing');
  assert.equal(task.complexity, 3);
  assert.equal(task.owner, 'builder');
  assert.equal(task.acceptance_criteria, '1. Sync works\n\n2. PR link pushed');
  assert.equal(task.spec, '.ai/features/ADO-101/spec.md');
});

test('AC1: stripHtml removes HTML tags and converts markup to clean markdown/text', () => {
  const html = '<h1>Heading</h1><p>Paragraph with <b>bold</b> and <i>italic</i> and <a href="https://example.com">link</a></p><ul><li>Item 1</li><li>Item 2</li></ul>';
  const clean = stripHtml(html);
  assert.match(clean, /# Heading/);
  assert.match(clean, /\*\*bold\*\*/);
  assert.match(clean, /\*italic\*/);
  assert.match(clean, /\[link\]\(https:\/\/example\.com\)/);
  assert.match(clean, /- Item 1/);
});

// ------------------------------------------------------------------------------------------------
// AC2 & AC3: Pull and Sync Idempotency
// ------------------------------------------------------------------------------------------------

test('AC2 & AC3: syncFromAdo pulls items, writes spec files, upserts tasks idempotently', async () => {
  const store = mockStore();
  const testRoot = join(process.cwd(), 'scratch', 'test-ado-sync-' + Date.now());
  const config = { repoRoot: testRoot };
  const policy = {
    integrations: {
      azure_devops: {
        enabled: true,
        org: 'qaisarit',
        project: 'meridianOS',
        pat_env: 'TEST_ADO_PAT',
      },
    },
  };

  process.env.TEST_ADO_PAT = 'mock-pat-token-123';
  const fetchImpl = makeFetch();

  try {
    // Run 1: First sync
    const res1 = await syncFromAdo({ store, config, policy, fetch: fetchImpl });
    assert.equal(res1.created, 2);
    assert.equal(res1.updated, 0);
    assert.equal(res1.skipped, 0);
    assert.equal(res1.errors.length, 0);

    const task101 = store.state.getTask('ADO-101');
    assert.ok(task101);
    assert.equal(task101.title, 'Add Azure DevOps Connector');

    const specPath = join(testRoot, '.ai', 'features', 'ADO-101', 'spec.md');
    assert.ok(existsSync(specPath));
    const specText = readFileSync(specPath, 'utf8');
    assert.match(specText, /Implement the \*\*ADO connector\*\* for MeridianOS/);

    // Run 2: Second sync (no state changes -> idempotent skip)
    const res2 = await syncFromAdo({ store, config, policy, fetch: fetchImpl });
    assert.equal(res2.created, 0);
    assert.equal(res2.updated, 0);
    assert.equal(res2.skipped, 2);

  } finally {
    delete process.env.TEST_ADO_PAT;
    if (existsSync(testRoot)) rmSync(testRoot, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------------------------------------
// AC4: Write-back PR link
// ------------------------------------------------------------------------------------------------

test('AC4: pushPrLink updates ADO work item with state Resolved and PR link comment', async () => {
  let patchPayload = null;
  let patchUrl = null;
  const fetchImpl = makeFetch({
    onCall: (url, opts) => {
      if (opts.method === 'PATCH') {
        patchUrl = url;
        patchPayload = JSON.parse(opts.body);
      }
    },
  });

  await pushPrLink({
    org: 'qaisarit',
    project: 'meridianOS',
    pat: 'mock-pat',
    id: 101,
    prUrl: 'https://github.com/acme/repo/pull/48',
    fetch: fetchImpl,
  });

  assert.ok(patchUrl.includes('/_apis/wit/workitems/101'));
  assert.ok(Array.isArray(patchPayload));
  const stateOp = patchPayload.find((p) => p.path === '/fields/System.State');
  const commentOp = patchPayload.find((p) => p.path === '/fields/System.History');

  assert.equal(stateOp.value, 'Resolved');
  assert.match(commentOp.value, /PR opened: https:\/\/github\.com\/acme\/repo\/pull\/48/);
});

// ------------------------------------------------------------------------------------------------
// AC5 & AC6: Auth and Error Handling
// ------------------------------------------------------------------------------------------------

test('AC5: syncFromAdo returns graceful error when PAT is missing', async () => {
  delete process.env.TEST_ADO_PAT_UNSET;
  const store = mockStore();
  const policy = {
    integrations: {
      azure_devops: {
        enabled: true,
        org: 'qaisarit',
        project: 'meridianOS',
        pat_env: 'TEST_ADO_PAT_UNSET',
      },
    },
  };

  const res = await syncFromAdo({ store, policy, fetch: makeFetch() });
  assert.equal(res.reason, 'no-pat');
  assert.equal(res.created, 0);
  assert.match(res.errors[0], /PAT not found in env var/);
});

test('AC6: HTTP errors (e.g. 401) throw informative error naming org/project and status', async () => {
  const fetch401 = makeFetch({ wiqlStatus: 401 });
  await assert.rejects(
    () => queryWorkItems({ org: 'qaisarit', project: 'meridianOS', pat: 'bad-pat', fetch: fetch401 }),
    (err) => {
      assert.match(err.message, /qaisarit\/meridianOS/);
      assert.match(err.message, /HTTP 401/);
      return true;
    },
  );
});

// ------------------------------------------------------------------------------------------------
// AC7: IntakeSource Registry Integration
// ------------------------------------------------------------------------------------------------

test('AC7: createAzureDevOpsSource integrates with createIntakeRegistry', async () => {
  process.env.TEST_ADO_PAT = 'mock-pat-123';
  const fetchImpl = makeFetch();
  const source = createAzureDevOpsSource({
    org: 'qaisarit',
    project: 'meridianOS',
    patEnv: 'TEST_ADO_PAT',
    fetch: fetchImpl,
  });

  const registry = createIntakeRegistry();
  registry.register(source);

  assert.equal(registry.get('azure-devops'), source);

  const items = await source.list();
  assert.equal(items.length, 2);
  assert.equal(items[0].id, 'ADO-101');
  assert.equal(items[0].source, 'azure-devops');
  assert.equal(items[0].kind, 'request');

  const item101 = await source.read('ADO-101');
  assert.equal(item101.id, 'ADO-101');
  assert.match(item101.body, /Implement the \*\*ADO connector\*\*/);

  delete process.env.TEST_ADO_PAT;
});
