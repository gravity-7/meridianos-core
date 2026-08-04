/**
 * plugin-security-gate.test.mjs — code-review follow-up (PR #79): the dashboard's
 * POST /api/plugins/:id/test route used to `import()` a catalog entry's `main` file directly,
 * bypassing the static-analysis gate that plugin-loader.mjs's `loadPlugin()` runs before every
 * OTHER dynamic import of plugin code (FR-019). This proves the route now runs the same
 * `analyzePluginSource` check first, and refuses to import a plugin containing `eval()`.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

import { createDashboardServer } from '../../dashboard/server.mjs';
import { resolvePaths } from '../../config.mjs';
import { FIXTURE_DOMAIN } from '../_fixture-domain.mjs';
import { registryPath, upsertPluginEntry } from '../../plugin-registry.mjs';

const repoRoot = mkdtempSync(join(tmpdir(), 'plugin-security-gate-'));
mkdirSync(join(repoRoot, '.ai'), { recursive: true });
const config = resolvePaths({ root: repoRoot, domain: FIXTURE_DOMAIN });

let server, port, dashToken;

function request({ method = 'GET', path, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request({ host: '127.0.0.1', port, path, method, headers: { 'content-type': 'application/json', ...headers } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let parsed = data;
        try { parsed = data ? JSON.parse(data) : null; } catch { /* raw */ }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

before(async () => {
  server = createDashboardServer(config);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;

  const indexHtml = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/', method: 'GET' }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.end();
  });
  dashToken = indexHtml.match(/const AIOS_TOKEN = "([^"]+)"/)?.[1];
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('code-review follow-up — POST /api/plugins/:id/test static-analysis gate', () => {
  test('refuses to import (and reports) a catalog entry whose source fails static analysis', async () => {
    const pluginDir = join(repoRoot, 'malicious-plugin');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'index.mjs'), "export function testConnection() { eval('1'); return { success: true }; }\n", 'utf8');
    upsertPluginEntry(registryPath(config), {
      id: 'malicious-test', name: 'Malicious Test', type: 'intake-source', version: '1.0.0',
      main: 'malicious-plugin/index.mjs',
    });

    const res = await request({ method: 'POST', path: '/api/plugins/malicious-test/test', headers: { 'x-aios-token': dashToken } });
    assert.equal(res.status, 400);
    assert.equal(res.body.ok, false);
    assert.match(res.body.error, /failed static analysis/);
    assert.match(res.body.error, /eval/);
  });

  test('still imports and tests a plugin whose source passes static analysis', async () => {
    const pluginDir = join(repoRoot, 'safe-plugin');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'index.mjs'), "export function testConnection() { return { success: true, message: 'ok' }; }\n", 'utf8');
    upsertPluginEntry(registryPath(config), {
      id: 'safe-test', name: 'Safe Test', type: 'intake-source', version: '1.0.0',
      main: 'safe-plugin/index.mjs',
    });

    const res = await request({ method: 'POST', path: '/api/plugins/safe-test/test', headers: { 'x-aios-token': dashToken } });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.success, true);
  });
});
