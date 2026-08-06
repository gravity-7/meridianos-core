/**
 * tests/integration/test-auth-http.mjs — HTTP-level coverage for the dashboard's Authentication
 * API (Multi-Tenant Platform US2). Every handler here (handleLogin, handleGetCurrentUser, etc.)
 * was referenced in dashboard/server.mjs's route table but never defined anywhere in the file —
 * pre-existing tests (test-invitation-lifecycle.mjs etc.) only ever exercise auth/user-store.mjs's
 * classes directly, never make an actual HTTP request, so this gap went undetected.
 *
 * auth/user-store.mjs, auth/api-tokens.mjs, and compliance/audit-log.mjs each hold a module-level
 * singleton (getUserStore()/getAPITokenManager()/getActivityLogger()) hardcoded to
 * <repo-root>/.ai/control-plane.db — not derived from the `config` passed to
 * createDashboardServer(config). dashboard/server.mjs's handlers call these singletons directly,
 * so (unlike policy.yaml-backed tests elsewhere in this repo) this file cannot sandbox itself via
 * a temp repoRoot — it uses the one real file and is responsible for leaving it exactly as it
 * found it. See tests/helpers/wipe-control-plane.mjs for the close-then-delete teardown this uses,
 * and why `before()` and `after()` need two different variants of it. Unique-per-run emails (see
 * ADMIN_EMAIL below) are kept as a second line of defense in case a leftover row ever does survive.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createDashboardServer } from '../../dashboard/server.mjs';
import { resolvePaths } from '../../config.mjs';
import { FIXTURE_DOMAIN } from '../_fixture-domain.mjs';
import { getUserStore } from '../../auth/user-store.mjs';
import { wipeControlPlaneDbFiles, closeControlPlaneSingletonsAndWipeDb } from '../helpers/wipe-control-plane.mjs';

const config = resolvePaths({ domain: FIXTURE_DOMAIN });

let server;
let port;
let aiosToken;
let adminUser;
// Unique per run — wipeControlPlaneDb() can't always delete the file (see its own comment), so a
// fixed email would collide with a leftover row from a prior run on Windows.
const RUN_ID = Date.now();
const ADMIN_EMAIL = `test-auth-http-admin-${RUN_ID}@example.com`;
const ADMIN_PASSWORD = 'correct-horse-battery-staple';

function httpRequest({ path, method, token, aios, body }) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const req = http.request({
      host: '127.0.0.1', port, path, method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(aios ? { 'x-aios-token': aios } : {}),
        ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let out = '';
      res.on('data', (c) => (out += c));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(out || '{}') }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

before(async () => {
  await wipeControlPlaneDbFiles();
  adminUser = await getUserStore().createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, full_name: 'Test Admin', role: 'admin' });

  server = createDashboardServer(config);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;

  // httpRequest() always JSON.parses the response, but GET / returns HTML — fetch raw here instead.
  const raw = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/', method: 'GET' }, (res) => {
      let out = ''; res.on('data', (c) => (out += c)); res.on('end', () => resolve(out));
    });
    req.on('error', reject);
    req.end();
  });
  aiosToken = /AIOS_TOKEN = "([^"]+)"/.exec(raw)[1];
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await closeControlPlaneSingletonsAndWipeDb();
});

test('POST /api/auth/login rejects a request without the dashboard token (same-origin gate)', async () => {
  const res = await httpRequest({ path: '/api/auth/login', method: 'POST', body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  assert.equal(res.status, 403);
});

test('POST /api/auth/login rejects wrong credentials with AUTH_BAD_CREDENTIALS', async () => {
  const res = await httpRequest({ path: '/api/auth/login', method: 'POST', aios: aiosToken, body: { email: ADMIN_EMAIL, password: 'wrong' } });
  assert.equal(res.status, 401);
  assert.equal(res.body.code, 'AUTH_BAD_CREDENTIALS');
});

test('POST /api/auth/login succeeds with correct credentials and returns a usable JWT', async () => {
  const res = await httpRequest({ path: '/api/auth/login', method: 'POST', aios: aiosToken, body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.ok(res.body.token);
  assert.equal(res.body.user.email, ADMIN_EMAIL);
  assert.equal(res.body.user.role, 'admin');
  assert.equal(res.body.user.password_hash, undefined); // never leak the hash
});

test('GET /api/auth/me requires a bearer token and returns the caller\'s own profile', async () => {
  const login = await httpRequest({ path: '/api/auth/login', method: 'POST', aios: aiosToken, body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  const token = login.body.token;

  const noAuth = await httpRequest({ path: '/api/auth/me', method: 'GET' });
  assert.equal(noAuth.status, 401);

  const authed = await httpRequest({ path: '/api/auth/me', method: 'GET', token });
  assert.equal(authed.status, 200);
  assert.equal(authed.body.user.id, adminUser.id);
});

test('PUT /api/auth/me updates full_name but silently ignores an attempted role self-escalation', async () => {
  const login = await httpRequest({ path: '/api/auth/login', method: 'POST', aios: aiosToken, body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  const token = login.body.token;

  const res = await httpRequest({ path: '/api/auth/me', method: 'PUT', token, aios: aiosToken, body: { full_name: 'Updated Name', role: 'superadmin' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.full_name, 'Updated Name');
  assert.equal(res.body.user.role, 'admin'); // unchanged — role is not self-service
});

test('POST /api/auth/me/password changes the password and the old one stops working', async () => {
  const email = `test-auth-http-pwchange-${RUN_ID}@example.com`;
  await getUserStore().createUser({ email, password: 'original-pass', full_name: 'PW Test' });

  const login1 = await httpRequest({ path: '/api/auth/login', method: 'POST', aios: aiosToken, body: { email, password: 'original-pass' } });
  const token = login1.body.token;

  const changeRes = await httpRequest({ path: '/api/auth/me/password', method: 'POST', token, aios: aiosToken, body: { oldPassword: 'original-pass', newPassword: 'new-pass-123' } });
  assert.equal(changeRes.status, 200);

  const loginOld = await httpRequest({ path: '/api/auth/login', method: 'POST', aios: aiosToken, body: { email, password: 'original-pass' } });
  assert.equal(loginOld.status, 401);

  const loginNew = await httpRequest({ path: '/api/auth/login', method: 'POST', aios: aiosToken, body: { email, password: 'new-pass-123' } });
  assert.equal(loginNew.status, 200);
});

test('API tokens: create, list (never re-exposes the raw token), and revoke', async () => {
  const login = await httpRequest({ path: '/api/auth/login', method: 'POST', aios: aiosToken, body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  const token = login.body.token;

  const created = await httpRequest({ path: '/api/auth/tokens', method: 'POST', token, aios: aiosToken, body: { name: 'ci-token', scope: 'tasks:read' } });
  assert.equal(created.status, 201);
  assert.ok(created.body.token.token); // raw value only ever returned here

  const listed = await httpRequest({ path: '/api/auth/tokens', method: 'GET', token });
  assert.equal(listed.status, 200);
  const found = listed.body.tokens.find((t) => t.id === created.body.token.id);
  assert.ok(found);
  assert.equal(found.token, undefined); // list never re-exposes the raw value

  const revoked = await httpRequest({ path: '/api/auth/tokens/' + created.body.token.id, method: 'DELETE', token, aios: aiosToken });
  assert.equal(revoked.status, 200);

  const listedAfter = await httpRequest({ path: '/api/auth/tokens', method: 'GET', token });
  assert.equal(listedAfter.body.tokens.find((t) => t.id === created.body.token.id).is_active, 0);
});

test('POST /api/auth/refresh exchanges a valid token for a new one', async () => {
  const login = await httpRequest({ path: '/api/auth/login', method: 'POST', aios: aiosToken, body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  const token = login.body.token;

  const refreshed = await httpRequest({ path: '/api/auth/refresh', method: 'POST', aios: aiosToken, body: { token } });
  assert.equal(refreshed.status, 200);
  assert.ok(refreshed.body.token);
  assert.notEqual(refreshed.body.token, token);

  const me = await httpRequest({ path: '/api/auth/me', method: 'GET', token: refreshed.body.token });
  assert.equal(me.status, 200);
});

test('POST /api/auth/users requires admin role — a non-admin gets AUTH_FORBIDDEN', async () => {
  const viewerEmail = `test-auth-http-viewer-${RUN_ID}@example.com`;
  await getUserStore().createUser({ email: viewerEmail, password: 'viewer-pass', full_name: 'Viewer', role: 'viewer' });
  const login = await httpRequest({ path: '/api/auth/login', method: 'POST', aios: aiosToken, body: { email: viewerEmail, password: 'viewer-pass' } });

  const res = await httpRequest({
    path: '/api/auth/users', method: 'POST', token: login.body.token, aios: aiosToken,
    body: { email: `test-auth-http-blocked-${RUN_ID}@example.com`, password: 'x', role: 'admin' },
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'AUTH_FORBIDDEN');
});

test('POST /api/auth/users as admin creates a new user with the requested role', async () => {
  const login = await httpRequest({ path: '/api/auth/login', method: 'POST', aios: aiosToken, body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });

  const res = await httpRequest({
    path: '/api/auth/users', method: 'POST', token: login.body.token, aios: aiosToken,
    body: { email: `test-auth-http-operator-${RUN_ID}@example.com`, password: 'op-pass-123', full_name: 'New Op', role: 'operator' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.user.role, 'operator');
});

test('POST /api/auth/logout succeeds (stateless — nothing to invalidate server-side)', async () => {
  const res = await httpRequest({ path: '/api/auth/logout', method: 'POST', aios: aiosToken });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
});
