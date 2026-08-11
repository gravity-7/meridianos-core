import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolvePaths } from '../config.mjs';
import { createDashboardServer } from '../dashboard/server.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';
import { DASHBOARD_API_COMPATIBILITY } from './fixtures/dashboard-api-compatibility.mjs';

function request(server, fixture) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, method: fixture.method, path: fixture.path }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function removeFixtureRoot(root) {
  for (let attempt = 0; attempt < 10; attempt++) {
    try { rmSync(root, { recursive: true, force: true }); return; }
    catch (error) {
      if (!['EPERM', 'EBUSY'].includes(error.code) || attempt === 9) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

test('additive operations dispatcher preserves representative dashboard and public API contracts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'meridianos-dashboard-compat-'));
  mkdirSync(join(root, '.ai'), { recursive: true });
  writeFileSync(join(root, '.ai', 'policy.yaml'), 'kill_switch: false\ngateway:\n  tenant: default\nui_platform:\n  enabled: true\n');
  const server = createDashboardServer(resolvePaths({ domain: FIXTURE_DOMAIN, root }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const fixture of DASHBOARD_API_COMPATIBILITY) {
      const response = await request(server, fixture);
      assert.equal(response.status, fixture.status, `${fixture.method} ${fixture.path} status`);
      if (fixture.type === 'json') {
        assert.match(response.headers['content-type'] ?? '', /application\/json/);
        const body = JSON.parse(response.body);
        for (const key of fixture.keys) assert.ok(Object.hasOwn(body, key), `${fixture.path} preserves ${key}`);
      } else {
        assert.match(response.headers['content-type'] ?? '', new RegExp(fixture.type));
        assert.match(response.body, new RegExp(fixture.contains));
      }
    }

    const shell = await request(server, { method: 'GET', path: '/app/operations/runs/missing' });
    assert.equal(shell.status, 200);
    assert.match(shell.body, /id="app"/);
    const denied = await request(server, { method: 'POST', path: '/api/run-now' });
    assert.equal(denied.status, 403);
    assert.deepEqual(JSON.parse(denied.body), { ok: false, error: 'forbidden: missing/invalid token or cross-origin request' });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await removeFixtureRoot(root);
  }
});
