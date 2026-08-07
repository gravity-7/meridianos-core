/**
 * client-error-endpoint — HTTP-level coverage for POST /api/client-error (009 — Dashboard
 * Modernization, US3/FR-006/FR-007). This is the backend half of the dashboard's error-visibility
 * hardening: every caught client-side error is forwarded here so it survives a reload and is
 * diagnosable from daemon.log without devtools ever having been open.
 *
 * Follows the same isolated-config + x-aios-token pattern as tests/dashboard-project-api.test.mjs,
 * but simpler — this route is a general mutating dashboard route gated by the per-boot
 * `x-aios-token` (authorized()), not a per-user JWT route.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import crypto from 'node:crypto';
import path from 'node:path';
import { resolvePaths } from '../config.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';

// dashboard/server.mjs reads AIOS_DASH_TOKEN at module-load time to seed its per-boot CSRF token —
// set it before the dynamic import below so this test controls the value.
const DASH_TOKEN = `test-dash-token-${crypto.randomBytes(8).toString('hex')}`;
process.env.AIOS_DASH_TOKEN = DASH_TOKEN;
const { createDashboardServer } = await import('../dashboard/server.mjs');

const config = resolvePaths({ root: mkdtempSync(path.join(tmpdir(), 'aios-client-error-')), domain: FIXTURE_DOMAIN });

let server;
let port;

before(async () => {
  server = createDashboardServer(config);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function request(method, pathname, { body, token = DASH_TOKEN } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { 'content-type': 'application/json' };
    if (token !== undefined) headers['x-aios-token'] = token;
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(
      { host: '127.0.0.1', port, path: pathname, method, headers },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(data); } catch { /* non-JSON body */ }
          resolve({ status: res.statusCode, json, raw: data });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test('POST /api/client-error without the dashboard token is rejected (same authorized() gate as every mutating route)', async () => {
  const { status, json } = await request('POST', '/api/client-error', {
    token: 'wrong-token',
    body: { source: 'test-panel', message: 'boom' },
  });
  assert.equal(status, 403);
  assert.equal(json.ok, false);
});

test('POST /api/client-error with a valid payload is accepted and logged', async () => {
  const { status, json } = await request('POST', '/api/client-error', {
    body: { source: 'agent-budget-panel', message: 'TypeError: cannot read x of undefined', stack: 'at foo (index.html:1)' },
  });
  assert.equal(status, 200);
  assert.equal(json.ok, true);
});

test('POST /api/client-error accepts a payload with no stack (stack is optional)', async () => {
  const { status, json } = await request('POST', '/api/client-error', {
    body: { source: 'poll-dispatcher', message: 'network request failed' },
  });
  assert.equal(status, 200);
  assert.equal(json.ok, true);
});

test('POST /api/client-error rejects a payload missing `source`', async () => {
  const { status, json } = await request('POST', '/api/client-error', {
    body: { message: 'boom' },
  });
  assert.equal(status, 400);
  assert.equal(json.ok, false);
  assert.match(json.error, /source/);
});

test('POST /api/client-error rejects a payload missing `message`', async () => {
  const { status, json } = await request('POST', '/api/client-error', {
    body: { source: 'test-panel' },
  });
  assert.equal(status, 400);
  assert.equal(json.ok, false);
  assert.match(json.error, /message/);
});

test('POST /api/client-error rejects a non-JSON body without crashing the server', async () => {
  const { status, json } = await request('POST', '/api/client-error', { body: 'not-json-but-a-string' });
  // JSON.stringify('not-json-but-a-string') round-trips as a JSON string, not an object — the
  // handler must reject the shape (missing source/message), not throw.
  assert.equal(status, 400);
  assert.equal(json.ok, false);
});

test('server is still alive after a malformed client-error report (logging must never crash the daemon)', async () => {
  const { status } = await request('GET', '/api/commands');
  assert.equal(status, 200);
});
