/**
 * api-v1.test.mjs — User Story 3 (Public REST API Integration) coverage:
 *   T038 — contract test across the documented endpoint surface
 *   T039 — API key authentication + scope enforcement
 *   T040 — rate limiting
 *
 * Runs a REAL createDashboardServer(config) over an isolated temp repo root (its own SQLite
 * file, its own policy.yaml) so nothing here touches the real dev database. The dashboard's
 * per-boot token (needed to authorize api-keys management) is read the same way a real browser
 * client would — GET '/' and pull it out of the served page — rather than pre-setting
 * $AIOS_DASH_TOKEN, since static `import`s are hoisted before any top-of-file code runs, so
 * setting the env var textually "before" the import would in fact run AFTER dashboard/server.mjs
 * has already computed its module-level AUTH_TOKEN constant.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

import { createDashboardServer } from '../dashboard/server.mjs';
import { resolvePaths } from '../config.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';

const repoRoot = mkdtempSync(join(tmpdir(), 'api-v1-'));
mkdirSync(join(repoRoot, '.ai'), { recursive: true });
const config = resolvePaths({ root: repoRoot, domain: FIXTURE_DOMAIN });

let server, port, dashToken;

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
  assert.ok(dashToken, 'expected to extract the per-boot dashboard token from the served index page');
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

/** Minimal http client — resolves {status, headers, body (parsed JSON or raw string)}. */
function request({ method = 'GET', path, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request({
      host: '127.0.0.1', port, path, method,
      headers: { 'content-type': 'application/json', host: `localhost:${port}`, ...headers },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let parsed = data;
        try { parsed = data ? JSON.parse(data) : null; } catch { /* leave raw (e.g. openapi.yaml) */ }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function createApiKey(scopes) {
  const res = await request({
    method: 'POST', path: '/api/v1/api-keys',
    headers: { 'x-aios-token': dashToken },
    body: { name: 'Test Key', scopes },
  });
  assert.equal(res.status, 201);
  return res.body.id;
}

// ─── T038: contract coverage across the documented endpoint surface ────────────────────────
describe('T038 — REST API v1 contract', () => {
  test('GET /api/v1/openapi.yaml serves the spec unauthenticated', async () => {
    const res = await request({ path: '/api/v1/openapi.yaml' });
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /yaml/);
    assert.match(String(res.body), /openapi: 3\.0\.3/);
  });

  test('GET /api/v1/docs serves Swagger UI unauthenticated', async () => {
    const res = await request({ path: '/api/v1/docs' });
    assert.equal(res.status, 200);
    assert.match(String(res.body), /swagger-ui/);
  });

  test('POST /api/v1/api-keys (dashboard-token gated) returns a key formatted mk-{32 hex}', async () => {
    const res = await request({
      method: 'POST', path: '/api/v1/api-keys',
      headers: { 'x-aios-token': dashToken },
      body: { name: 'Contract Key', scopes: ['tasks:read', 'costs:read'] },
    });
    assert.equal(res.status, 201);
    assert.match(res.body.id, /^mk-[a-zA-Z0-9]{32}$/);
  });

  test('full task lifecycle: create, get, list, patch, delete', async () => {
    const key = await createApiKey(['tasks:read', 'tasks:write']);
    const auth = { authorization: `Bearer ${key}` };

    const created = await request({ method: 'POST', path: '/api/v1/tasks', headers: auth, body: { title: 'Ship the docs', tags: ['docs'] } });
    assert.equal(created.status, 201);
    assert.equal(created.body.status, 'todo');
    assert.equal(created.body.source, 'api');
    assert.deepEqual(created.body.tags, ['docs']);

    const got = await request({ path: `/api/v1/tasks/${created.body.id}`, headers: auth });
    assert.equal(got.status, 200);
    assert.equal(got.body.title, 'Ship the docs');

    const list = await request({ path: '/api/v1/tasks', headers: auth });
    assert.equal(list.status, 200);
    assert.ok(list.body.tasks.some((t) => t.id === created.body.id));

    // 'blocked' is legal from every active state (machine.mjs) — a safe status change to
    // exercise PATCH + the task.failed webhook mapping without depending on the orchestrator's
    // full proposed→spec→…→in-progress ladder.
    const patched = await request({ method: 'PATCH', path: `/api/v1/tasks/${created.body.id}`, headers: auth, body: { status: 'in-progress', title: 'Ship the docs (v2)' } });
    // 'todo' (proposed) → 'in-progress' isn't a legal direct transition (machine.mjs requires
    // spec → designing → ready-for-impl first) — the API must reject it, not silently clamp it.
    assert.equal(patched.status, 400);

    const blocked = await request({ method: 'PATCH', path: `/api/v1/tasks/${created.body.id}`, headers: auth, body: { status: 'blocked', title: 'Ship the docs (v2)' } });
    assert.equal(blocked.status, 200);
    assert.equal(blocked.body.status, 'blocked');
    assert.equal(blocked.body.title, 'Ship the docs (v2)');
    assert.deepEqual(blocked.body.tags, ['docs'], 'tags must survive a PATCH that does not mention them');

    const del = await request({ method: 'DELETE', path: `/api/v1/tasks/${created.body.id}`, headers: auth });
    assert.equal(del.status, 204);

    const goneCheck = await request({ path: `/api/v1/tasks/${created.body.id}`, headers: auth });
    assert.equal(goneCheck.status, 404);
  });

  test('GET /api/v1/costs and /api/v1/costs/summary respond even with an empty ledger', async () => {
    const key = await createApiKey(['costs:read']);
    const auth = { authorization: `Bearer ${key}` };
    const costs = await request({ path: '/api/v1/costs', headers: auth });
    assert.equal(costs.status, 200);
    assert.ok(Array.isArray(costs.body.costs));
    const summary = await request({ path: '/api/v1/costs/summary', headers: auth });
    assert.equal(summary.status, 200);
    assert.ok(Array.isArray(summary.body.summary));
  });

  test('GET /api/v1/providers lists resolved providers', async () => {
    const key = await createApiKey(['providers:read']);
    const res = await request({ path: '/api/v1/providers', headers: { authorization: `Bearer ${key}` } });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.providers));
  });

  test('GET /api/v1/config returns budget + gateway + providers', async () => {
    const key = await createApiKey(['config:read']);
    const res = await request({ path: '/api/v1/config', headers: { authorization: `Bearer ${key}` } });
    assert.equal(res.status, 200);
    assert.ok('monthly_limit' in res.body.budget);
    assert.ok('port' in res.body.gateway);
  });

  test('PUT /api/v1/config updates budget.monthly_limit', async () => {
    const key = await createApiKey(['config:read', 'config:write']);
    const auth = { authorization: `Bearer ${key}` };
    const put = await request({ method: 'PUT', path: '/api/v1/config', headers: auth, body: { budget: { monthly_limit: 250 } } });
    assert.equal(put.status, 200);
    const after2 = await request({ path: '/api/v1/config', headers: auth });
    assert.equal(after2.body.budget.monthly_limit, 250);
  });

  test('webhook registration: create, list, delete', async () => {
    const key = await createApiKey(['config:read', 'config:write']);
    const auth = { authorization: `Bearer ${key}` };
    const created = await request({ method: 'POST', path: '/api/v1/webhooks', headers: auth, body: { url: 'https://example.com/hook', events: ['task.created'] } });
    assert.equal(created.status, 201);
    const list = await request({ path: '/api/v1/webhooks', headers: auth });
    assert.ok(list.body.webhooks.some((w) => w.id === created.body.id));
    const del = await request({ method: 'DELETE', path: `/api/v1/webhooks/${created.body.id}`, headers: auth });
    assert.equal(del.status, 204);
  });

  test('an unknown /api/v1 route returns 404 with the standard error envelope', async () => {
    const key = await createApiKey(['tasks:read']);
    const res = await request({ path: '/api/v1/nonexistent', headers: { authorization: `Bearer ${key}` } });
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'Not Found');
  });
});

// ─── T039: authentication + scope enforcement ───────────────────────────────────────────────
describe('T039 — API key authentication and scopes', () => {
  test('no Authorization header → 401 Unauthorized', async () => {
    const res = await request({ path: '/api/v1/tasks' });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'Unauthorized');
  });

  test('malformed / unknown bearer token → 401 Unauthorized', async () => {
    const res = await request({ path: '/api/v1/tasks', headers: { authorization: 'Bearer mk-doesnotexist000000000000000000' } });
    assert.equal(res.status, 401);
  });

  test('valid key but missing scope → 403 Forbidden', async () => {
    const key = await createApiKey(['tasks:read']); // no tasks:write
    const res = await request({ method: 'POST', path: '/api/v1/tasks', headers: { authorization: `Bearer ${key}` }, body: { title: 'nope' } });
    assert.equal(res.status, 403);
    assert.match(res.body.message, /tasks:write/);
  });

  test('revoked key is rejected', async () => {
    const createRes = await request({ method: 'POST', path: '/api/v1/api-keys', headers: { 'x-aios-token': dashToken }, body: { name: 'Revoke Me', scopes: ['tasks:read'] } });
    const key = createRes.body.id;
    const revoke = await request({ method: 'DELETE', path: `/api/v1/api-keys/${key}`, headers: { 'x-aios-token': dashToken } });
    assert.equal(revoke.status, 204);
    const afterRevoke = await request({ path: '/api/v1/tasks', headers: { authorization: `Bearer ${key}` } });
    assert.equal(afterRevoke.status, 401);
  });

  test('api-keys management itself requires the dashboard token, not a Bearer key', async () => {
    const res = await request({ method: 'POST', path: '/api/v1/api-keys', body: { name: 'x', scopes: ['tasks:read'] } });
    assert.equal(res.status, 403);
  });
});

// ─── T040: rate limiting ─────────────────────────────────────────────────────────────────────
describe('T040 — rate limiting', () => {
  test('the 101st request within a minute for one API key returns 429 with Retry-After', async () => {
    const key = await createApiKey(['tasks:read']);
    const auth = { authorization: `Bearer ${key}` };

    let last;
    for (let i = 0; i < 100; i++) {
      last = await request({ path: '/api/v1/tasks', headers: auth });
      assert.equal(last.status, 200, `request ${i + 1} should succeed`);
    }
    const blocked = await request({ path: '/api/v1/tasks', headers: auth });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error, 'Too Many Requests');
    assert.ok(blocked.headers['retry-after']);
  });

  test('rate limits are tracked per-key — a fresh key is unaffected by another key being exhausted', async () => {
    const freshKey = await createApiKey(['tasks:read']);
    const res = await request({ path: '/api/v1/tasks', headers: { authorization: `Bearer ${freshKey}` } });
    assert.equal(res.status, 200);
  });
});

// ─── Security hardening follow-up: CORS, security headers, key rotation, request size limits ──
describe('Security hardening — CORS, headers, key rotation, request size limits', () => {
  test('OPTIONS preflight returns 204 with CORS headers and requires no auth', async () => {
    const res = await request({ method: 'OPTIONS', path: '/api/v1/tasks' });
    assert.equal(res.status, 204);
    assert.equal(res.headers['access-control-allow-origin'], '*');
    assert.match(res.headers['access-control-allow-methods'], /GET/);
    assert.match(res.headers['access-control-allow-headers'], /Authorization/i);
  });

  test('a normal 200 response carries baseline security + CORS headers', async () => {
    const key = await createApiKey(['tasks:read']);
    const res = await request({ path: '/api/v1/tasks', headers: { authorization: `Bearer ${key}` } });
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-frame-options'], 'DENY');
    assert.equal(res.headers['access-control-allow-origin'], '*');
    assert.match(res.headers['content-security-policy'], /default-src 'none'/);
  });

  test('error responses (401) carry the same security headers as success responses', async () => {
    const res = await request({ path: '/api/v1/tasks' });
    assert.equal(res.status, 401);
    assert.equal(res.headers['x-frame-options'], 'DENY');
    assert.equal(res.headers['access-control-allow-origin'], '*');
  });

  test('the Swagger docs page ships a relaxed CSP that still permits its own CDN bundle', async () => {
    const res = await request({ path: '/api/v1/docs' });
    assert.match(res.headers['content-security-policy'], /unpkg\.com/);
    assert.equal(res.headers['x-frame-options'], 'DENY');
  });

  test('rotating a key mints a replacement with the same scopes and immediately invalidates the old one', async () => {
    const created = await request({ method: 'POST', path: '/api/v1/api-keys', headers: { 'x-aios-token': dashToken }, body: { name: 'Rotate Me', scopes: ['tasks:read', 'costs:read'] } });
    const oldKey = created.body.id;

    const rotated = await request({ method: 'POST', path: `/api/v1/api-keys/${oldKey}/rotate`, headers: { 'x-aios-token': dashToken } });
    assert.equal(rotated.status, 201);
    assert.notEqual(rotated.body.id, oldKey);
    assert.equal(rotated.body.scopes, 'tasks:read,costs:read');

    const oldStillWorks = await request({ path: '/api/v1/tasks', headers: { authorization: `Bearer ${oldKey}` } });
    assert.equal(oldStillWorks.status, 401);

    const newWorks = await request({ path: '/api/v1/tasks', headers: { authorization: `Bearer ${rotated.body.id}` } });
    assert.equal(newWorks.status, 200);
  });

  test('rotating an unknown key returns 404', async () => {
    const res = await request({ method: 'POST', path: '/api/v1/api-keys/mk-doesnotexist000000000000000000/rotate', headers: { 'x-aios-token': dashToken } });
    assert.equal(res.status, 404);
  });

  test('rotation requires the dashboard token, not a Bearer key', async () => {
    const key = await createApiKey(['tasks:read']);
    const res = await request({ method: 'POST', path: `/api/v1/api-keys/${key}/rotate`, headers: { authorization: `Bearer ${key}` } });
    assert.equal(res.status, 403);
  });

  test('a request body over the size limit returns 413, not 500', async () => {
    const key = await createApiKey(['tasks:write']);
    const hugeBody = { title: 'x'.repeat(2_000_000) };
    const res = await request({ method: 'POST', path: '/api/v1/tasks', headers: { authorization: `Bearer ${key}` }, body: hugeBody });
    assert.equal(res.status, 413);
    assert.equal(res.body.error, 'Payload Too Large');
  });
});
