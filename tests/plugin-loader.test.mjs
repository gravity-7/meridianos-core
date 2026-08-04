/**
 * plugin-loader.test.mjs — coverage across User Stories 4 and 5:
 *   T057 — plugin installation (discovery, static analysis, contract validation, install lifecycle)
 *   T058 — the Jira plugin (one of the 6 pre-built connectors)
 *   T072 — plugin scaffolding (US5)
 *   T073 — plugin contract validation, the scaffold→implement→test round trip (US5)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  discoverPlugins, loadPlugin, analyzePluginSource, validateIntakeSourceContract,
  installPlugin, uninstallPlugin, enablePlugin, disablePlugin, setPluginConfig, getPluginConfig,
  testPluginConnection, pluginStatus,
} from '../plugin-loader.mjs';
import { seedBuiltinPlugins, registryPath, loadRegistry, BUILTIN_PLUGINS } from '../plugin-registry.mjs';
import { scaffoldPlugin, publishPlugin } from '../plugin-scaffold.mjs';
import { openDb } from '../db.mjs';
import { createAios } from '../config.mjs';

const { config } = createAios({ domain: { agents: ['claude', 'antigravity'] } });

function writePluginDir(root, { name, main = 'index.mjs', source, extraMeta = {} }) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify({ name, version: '1.0.0', type: 'intake-source', main, ...extraMeta }));
  writeFileSync(join(dir, main), source);
  return dir;
}

const VALID_SOURCE = `
export async function fetchTasks() { return []; }
export async function createTask(task) { return { externalId: 'x', url: null }; }
export async function updateTask() { return { success: true }; }
export async function handleWebhook() { return { action: 'created', externalId: 'x', task: null }; }
`;

// ─── T057: discovery, static analysis, contract validation, install lifecycle ───────────────
describe('T057 — plugin installation', () => {
  test('discoverPlugins loads a well-formed plugin from .ai/plugins/', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'plugins-'));
    writePluginDir(join(repoRoot, '.ai', 'plugins'), { name: 'my-plugin', source: VALID_SOURCE });

    const { loaded, errors } = await discoverPlugins({ repoRoot });
    assert.equal(errors.length, 0);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].metadata.name, 'my-plugin');
    assert.equal(typeof loaded[0].module.fetchTasks, 'function');
  });

  test('discoverPlugins reports (not throws) a plugin missing required IntakeSource methods', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'plugins-'));
    writePluginDir(join(repoRoot, '.ai', 'plugins'), { name: 'broken-plugin', source: 'export async function fetchTasks(){return[]}' });

    const { loaded, errors } = await discoverPlugins({ repoRoot });
    assert.equal(loaded.length, 0);
    assert.equal(errors.length, 1);
    assert.match(errors[0].error, /createTask, updateTask, handleWebhook/);
  });

  test('discoverPlugins rejects (via static analysis) a plugin that uses eval()', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'plugins-'));
    writePluginDir(join(repoRoot, '.ai', 'plugins'), { name: 'evil-plugin', source: `${VALID_SOURCE}\neval('1+1');` });

    const { loaded, errors } = await discoverPlugins({ repoRoot });
    assert.equal(loaded.length, 0);
    assert.match(errors[0].error, /failed static analysis/);
    assert.match(errors[0].error, /eval/);
  });

  test('one broken plugin does not block discovery of a sibling good one', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'plugins-'));
    const dir = join(repoRoot, '.ai', 'plugins');
    writePluginDir(dir, { name: 'good-plugin', source: VALID_SOURCE });
    writePluginDir(dir, { name: 'bad-plugin', source: `${VALID_SOURCE}\nrequire('child_process');` });

    const { loaded, errors } = await discoverPlugins({ repoRoot });
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].metadata.name, 'good-plugin');
    assert.equal(errors.length, 1);
  });

  test('analyzePluginSource and validateIntakeSourceContract are usable standalone', () => {
    assert.equal(analyzePluginSource('export const x = 1;').safe, true);
    assert.equal(analyzePluginSource("new Function('return 1')()").safe, false);
    assert.throws(() => validateIntakeSourceContract({ fetchTasks: () => {} }), /createTask, updateTask, handleWebhook/);
  });

  test('full install lifecycle: seed catalog, install, enable, configure, test, disable, uninstall', async () => {
    const db = openDb(':memory:', config);
    const regPath = registryPath({ repoRoot: mkdtempSync(join(tmpdir(), 'catalog-')) });
    seedBuiltinPlugins(regPath);
    assert.equal(loadRegistry(regPath).length, BUILTIN_PLUGINS.length);

    const installed = installPlugin(db, regPath, 'jira-source', {});
    assert.equal(installed.is_installed, 1);
    assert.equal(installed.is_enabled, 0);

    enablePlugin(db, 'jira-source');
    assert.equal(db.prepare('SELECT is_enabled FROM plugins WHERE id = ?').get('jira-source').is_enabled, 1);

    setPluginConfig(db, 'jira-source', { url: 'https://x.atlassian.net', api_token: 'sekret', email: 'a@b.com' }, { sensitiveKeys: ['api_token'] });
    const publicConfig = getPluginConfig(db, 'jira-source');
    assert.ok(!('api_token' in publicConfig), 'sensitive fields must not appear in a default (non-includeSensitive) read');
    assert.equal(publicConfig.url, 'https://x.atlassian.net');

    const fullConfig = getPluginConfig(db, 'jira-source', { includeSensitive: true });
    assert.equal(fullConfig.api_token, 'sekret');

    const status = pluginStatus(db, regPath).find((p) => p.id === 'jira-source');
    assert.equal(status.is_installed, true);
    assert.equal(status.is_enabled, true);

    disablePlugin(db, 'jira-source');
    assert.equal(db.prepare('SELECT is_enabled FROM plugins WHERE id = ?').get('jira-source').is_enabled, 0);

    uninstallPlugin(db, 'jira-source');
    const afterUninstall = db.prepare('SELECT is_installed, is_enabled FROM plugins WHERE id = ?').get('jira-source');
    assert.equal(afterUninstall.is_installed, 0);
    assert.equal(afterUninstall.is_enabled, 0);
    assert.throws(() => enablePlugin(db, 'jira-source'), /must be installed/);
  });

  test('installPlugin throws for an id not in the catalog', () => {
    const db = openDb(':memory:', config);
    const regPath = registryPath({ repoRoot: mkdtempSync(join(tmpdir(), 'catalog-')) });
    seedBuiltinPlugins(regPath);
    assert.throws(() => installPlugin(db, regPath, 'does-not-exist', {}), /not found in the marketplace catalog/);
  });
});

// ─── T058: the Jira plugin specifically ─────────────────────────────────────────────────────
describe('T058 — Jira plugin (intake-adapters/jira-source.mjs)', () => {
  const jiraConfig = { url: 'https://test.atlassian.net', api_token: 'tok', email: 'me@test.com', project_key: 'TEST' };

  test('passes contract validation and static analysis', async () => {
    const mod = await import('../intake-adapters/jira-source.mjs');
    assert.doesNotThrow(() => validateIntakeSourceContract(mod));
  });

  test('fetchTasks maps Jira issues to the canonical Task shape', async (t) => {
    const { fetchTasks } = await import('../intake-adapters/jira-source.mjs');
    t.mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      json: async () => ({
        issues: [{
          id: '10001', key: 'TEST-1',
          fields: {
            summary: 'Fix the bug', description: 'It is broken',
            status: { name: 'In Progress' }, priority: { name: 'High' }, labels: ['backend'],
            created: '2026-01-01T00:00:00.000Z', updated: '2026-01-02T00:00:00.000Z',
          },
        }],
      }),
    }));
    const tasks = await fetchTasks(jiraConfig);
    assert.equal(tasks.length, 1);
    assert.deepEqual(tasks[0], {
      externalId: '10001', title: 'Fix the bug', body: 'It is broken',
      status: 'in-progress', priority: 'high', tags: ['backend'],
      url: 'https://test.atlassian.net/browse/TEST-1',
      createdAt: Date.parse('2026-01-01T00:00:00.000Z'), updatedAt: Date.parse('2026-01-02T00:00:00.000Z'),
    });
  });

  test('fetchTasks throws a descriptive error on a non-OK response', async (t) => {
    const { fetchTasks } = await import('../intake-adapters/jira-source.mjs');
    t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 401 }));
    await assert.rejects(() => fetchTasks(jiraConfig), /Jira API error: 401/);
  });

  test('createTask posts the mapped fields and returns externalId + url', async (t) => {
    const { createTask } = await import('../intake-adapters/jira-source.mjs');
    let capturedBody;
    t.mock.method(globalThis, 'fetch', async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ id: '999', key: 'TEST-99' }) };
    });
    const result = await createTask({ title: 'New task', body: 'desc', priority: 'critical', tags: ['x'] }, jiraConfig);
    assert.deepEqual(result, { externalId: '999', url: 'https://test.atlassian.net/browse/TEST-99' });
    assert.equal(capturedBody.fields.priority.name, 'Highest');
    assert.equal(capturedBody.fields.labels[0], 'x');
  });

  test('handleWebhook maps jira:issue_created/updated/deleted', async () => {
    const { handleWebhook } = await import('../intake-adapters/jira-source.mjs');
    const issue = { id: '1', key: 'T-1', fields: { summary: 's', status: { name: 'To Do' }, priority: { name: 'Low' }, labels: [], created: '2026-01-01T00:00:00Z', updated: '2026-01-01T00:00:00Z' } };

    const created = await handleWebhook({ webhookEvent: 'jira:issue_created', issue }, jiraConfig);
    assert.equal(created.action, 'created');
    assert.equal(created.task.status, 'todo');

    const deleted = await handleWebhook({ webhookEvent: 'jira:issue_deleted', issue }, jiraConfig);
    assert.deepEqual(deleted, { action: 'deleted', externalId: '1', task: null });

    await assert.rejects(() => handleWebhook({ webhookEvent: 'jira:comment_created', issue }, jiraConfig), /Unknown webhook event/);
  });

  test('testConnection reports success/failure with latency', async (t) => {
    const { testConnection } = await import('../intake-adapters/jira-source.mjs');
    t.mock.method(globalThis, 'fetch', async () => ({ ok: true }));
    const ok = await testConnection(jiraConfig);
    assert.equal(ok.success, true);
    assert.equal(typeof ok.latency_ms, 'number');

    t.mock.method(globalThis, 'fetch', async () => { throw new Error('network down'); });
    const fail = await testConnection(jiraConfig);
    assert.equal(fail.success, false);
    assert.match(fail.message, /network down/);
  });
});

// ─── T072: plugin scaffolding (US5) ──────────────────────────────────────────────────────────
describe('T072 — plugin scaffolding (plugin-scaffold.mjs)', () => {
  test('scaffoldPlugin generates plugin.json, index.mjs, test.mjs, and README.md', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'scaffold-'));
    const result = scaffoldPlugin({ name: 'custom-source', type: 'intake-source', author: 'Test Developer', outDir });

    for (const f of ['plugin.json', 'index.mjs', 'test.mjs', 'README.md']) {
      assert.ok(existsSync(join(result.dir, f)), `expected ${f} to be generated`);
    }
    const meta = JSON.parse(readFileSync(join(result.dir, 'plugin.json'), 'utf8'));
    assert.equal(meta.name, 'custom-source');
    assert.equal(meta.type, 'intake-source');
    assert.equal(meta.main, 'index.mjs');
    assert.ok(!readFileSync(join(result.dir, 'README.md'), 'utf8').includes('{{'), 'template placeholders must all be substituted');
  });

  test('scaffoldPlugin validates the name and type before writing anything', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'scaffold-'));
    assert.throws(() => scaffoldPlugin({ name: 'Not Valid!', outDir }), /lowercase/);
    assert.throws(() => scaffoldPlugin({ name: 'ok-name', type: 'bogus-type', outDir }), /intake-source.*wire-adapter/);
  });

  test('scaffoldPlugin refuses to overwrite an existing directory', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'scaffold-'));
    scaffoldPlugin({ name: 'dup-source', outDir });
    assert.throws(() => scaffoldPlugin({ name: 'dup-source', outDir }), /already exists/);
  });

  test('publishPlugin runs npm publish and registers the plugin in the community catalog', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'scaffold-'));
    const scaffold = scaffoldPlugin({ name: 'publish-me', author: 'Jane Dev', outDir });
    const regPath = join(outDir, 'registry.json');

    const calls = [];
    const fakeExec = (cmd, args, opts) => { calls.push({ cmd, args, cwd: opts.cwd }); return ''; };
    const result = publishPlugin({ pluginDir: scaffold.dir, registryPath: regPath, execImpl: fakeExec });

    assert.equal(result.packageName, '@meridian-plugins/publish-me');
    assert.deepEqual(calls[0].args, ['publish', '--access', 'public']);
    assert.equal(calls[0].cwd, scaffold.dir);

    const catalog = loadRegistry(regPath);
    assert.equal(catalog.length, 1);
    assert.equal(catalog[0].id, 'publish-me');
    assert.equal(catalog[0].author, 'Jane Dev');
    assert.equal(catalog[0].repository, '@meridian-plugins/publish-me');
  });
});

// ─── T073: contract validation across the scaffold→implement→test round trip (US5) ─────────
describe('T073 — plugin contract validation', () => {
  test('a freshly scaffolded plugin (before any implementation) already satisfies the contract shape', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'scaffold-'));
    const result = scaffoldPlugin({ name: 'stub-source', outDir });
    const mod = await import(`file://${join(result.dir, 'index.mjs').replaceAll('\\', '/')}`);
    assert.doesNotThrow(() => validateIntakeSourceContract(mod));
    assert.equal(typeof mod.testConnection, 'function', 'the optional testConnection stub should also be present');
  });

  test("the scaffold's generated test.mjs actually runs and passes (node test.mjs)", () => {
    const outDir = mkdtempSync(join(tmpdir(), 'scaffold-'));
    const result = scaffoldPlugin({ name: 'runnable-source', outDir });
    const output = execFileSync(process.execPath, [join(result.dir, 'test.mjs')], { encoding: 'utf8' });
    assert.match(output, /All contract tests passed for runnable-source/);
  });

  test('validateIntakeSourceContract lists every missing method, not just the first one', () => {
    assert.throws(
      () => validateIntakeSourceContract({ fetchTasks: () => {} }),
      /createTask, updateTask, handleWebhook/,
    );
    assert.throws(
      () => validateIntakeSourceContract({}),
      /fetchTasks, createTask, updateTask, handleWebhook/,
    );
  });

  test('all 6 pre-built connectors and a freshly scaffolded stub pass the SAME validator', async () => {
    const builtins = await Promise.all(
      BUILTIN_PLUGINS.map((p) => import(`../${p.main}`)),
    );
    for (const mod of builtins) assert.doesNotThrow(() => validateIntakeSourceContract(mod));

    const outDir = mkdtempSync(join(tmpdir(), 'scaffold-'));
    const scaffold = scaffoldPlugin({ name: 'another-stub', outDir });
    const stubMod = await import(`file://${join(scaffold.dir, 'index.mjs').replaceAll('\\', '/')}`);
    assert.doesNotThrow(() => validateIntakeSourceContract(stubMod));
  });
});
