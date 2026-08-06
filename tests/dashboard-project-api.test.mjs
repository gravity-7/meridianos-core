/**
 * dashboard-project-api — HTTP-level regression coverage for the project-management, template, and
 * compliance-reporting routes in dashboard/server.mjs. These handlers (handleCreateProject,
 * handleListTemplates, handleGenerateSOC2Report, etc.) were referenced by the router but never
 * defined, so every one of these routes threw `ReferenceError: <name> is not defined` at request
 * time despite the underlying ProjectManager/TemplateLoader/Report classes being fully implemented
 * and unit-tested. This file proves the routes now resolve to real handlers.
 *
 * Deliberately side-effect-free against the project's real `.ai/control-plane.db` (the same file the
 * locally-run dashboard/daemon use): project-lifecycle routes are only exercised against a
 * NON-EXISTENT project id, which every ProjectManager method rejects via `getProject()` returning
 * null BEFORE any DB write, filesystem change, or child-process spawn happens. Only read-only
 * listing routes and the compliance-report generators (which persist a small file under
 * `.ai/reports/`, the app's documented, gitignored location for generated reports — see
 * dashboard/errors.mjs REPORT_NOT_FOUND) touch real state, and those files are removed in `after`.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateToken } from '../auth/jwt.mjs';
import { resolvePaths } from '../config.mjs';
import { closeControlPlaneSingletonsAndWipeDb } from './helpers/wipe-control-plane.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const JWT_SECRET_PATH = path.join(REPO_ROOT, '.ai', 'auth', 'jwt-secret');

// dashboard/server.mjs reads AIOS_DASH_TOKEN at module-load time to seed its per-boot CSRF token
// (every POST must carry it as x-aios-token, independent of the JWT bearer auth — see server.mjs's
// `authorized()`). Set it before the dynamic import below so this test controls the value.
const DASH_TOKEN = `test-dash-token-${crypto.randomBytes(8).toString('hex')}`;
process.env.AIOS_DASH_TOKEN = DASH_TOKEN;
const { createDashboardServer } = await import('../dashboard/server.mjs');

// generateToken()/verifyToken() both read this file directly (no DI hook), and creating it is
// exactly what scripts/generate-jwt-secret.mjs does — reuse an existing secret, never overwrite one.
function ensureJwtSecret() {
  if (existsSync(JWT_SECRET_PATH)) return;
  const dir = path.dirname(JWT_SECRET_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(JWT_SECRET_PATH, crypto.randomBytes(64).toString('hex'), { mode: 0o600 });
}

// Isolated repo root (like every sibling test file) so config-derived paths — db.mjs's aios.db,
// daemon-logger.mjs's daemon.log, etc. — never touch this repo's real .ai/. This does NOT cover
// control-plane.mjs's ProjectManager singleton or dashboard/server.mjs's REPORTS_DIR, both of which
// resolve their paths off their own module location rather than the injected config — see the
// after() cleanup below for those.
const config = resolvePaths({ root: mkdtempSync(path.join(tmpdir(), 'aios-dash-api-')), domain: FIXTURE_DOMAIN });

let server;
let port;
let authToken;
const reportFilesToCleanup = [];

before(async () => {
  ensureJwtSecret();
  authToken = generateToken({ sub: 'test-user-dashboard-api', email: 'test@example.com', role: 'admin' });

  server = createDashboardServer(config);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  for (const filename of reportFilesToCleanup) {
    const full = path.join(REPO_ROOT, '.ai', 'reports', filename);
    if (existsSync(full)) unlinkSync(full);
  }
  // The GET/POST /api/projects and POST /api/compliance/reports/{soc2,gdpr} routes above go
  // through control-plane.mjs's ProjectManager and audit-log.mjs's ActivityLogger + AuditLogger —
  // see tests/helpers/wipe-control-plane.mjs for why these can't be redirected into the isolated
  // `config` root above and have to be cleaned up for real instead.
  await closeControlPlaneSingletonsAndWipeDb();
});

function request(method, pathname, { auth = true, body } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { 'content-type': 'application/json' };
    if (auth) headers.authorization = `Bearer ${authToken}`;
    if (method === 'POST') headers['x-aios-token'] = DASH_TOKEN;
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(
      { host: '127.0.0.1', port, path: pathname, method, headers },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(data); } catch { /* non-JSON body, e.g. CSV */ }
          resolve({ status: res.statusCode, json, raw: data });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ─── Auth gating ──────────────────────────────────────────────────────────────

test('GET /api/projects without a token is rejected, not a ReferenceError', async () => {
  const { status, json } = await request('GET', '/api/projects', { auth: false });
  assert.equal(status, 401);
  assert.equal(json.code, 'AUTH_MISSING_HEADER');
});

// ─── Templates (US4) ────────────────────────────────────────────────────────

test('GET /api/projects/templates lists built-in templates', async () => {
  const { status, json } = await request('GET', '/api/projects/templates');
  assert.equal(status, 200);
  assert.equal(json.success, true);
  assert.ok(Array.isArray(json.templates));
  assert.ok(json.templates.some((t) => t.id === 'blank'));
});

test('GET /api/projects/templates/{id} returns a known template', async () => {
  const { status, json } = await request('GET', '/api/projects/templates/blank');
  assert.equal(status, 200);
  assert.equal(json.success, true);
  assert.equal(json.id, 'blank');
  assert.ok(json.template.agents);
});

test('GET /api/projects/templates/{id} 404s on an unknown template', async () => {
  const { status, json } = await request('GET', '/api/projects/templates/does-not-exist-xyz');
  assert.equal(status, 404);
  assert.equal(json.code, 'TEMPLATE_NOT_FOUND');
});

// ─── Project management (US1) ──────────────────────────────────────────────

test('GET /api/projects lists projects', async () => {
  const { status, json } = await request('GET', '/api/projects');
  assert.equal(status, 200);
  assert.equal(json.success, true);
  assert.ok(Array.isArray(json.projects));
});

test('POST /api/projects without a name is rejected before touching ProjectManager', async () => {
  const { status, json } = await request('POST', '/api/projects', { body: {} });
  assert.equal(status, 400);
  assert.equal(json.success, false);
});

test('GET /api/projects/{id} 404s for an unknown project', async () => {
  const { status, json } = await request('GET', '/api/projects/does-not-exist-project-id');
  assert.equal(status, 404);
  assert.equal(json.code, 'PROJECT_NOT_FOUND');
});

test('POST /api/projects/{id}/start 404s for an unknown project (no spawn attempted)', async () => {
  const { status, json } = await request('POST', '/api/projects/does-not-exist-project-id/start', { body: {} });
  assert.equal(status, 404);
  assert.equal(json.code, 'PROJECT_NOT_FOUND');
});

test('POST /api/projects/{id}/stop 404s for an unknown project', async () => {
  const { status, json } = await request('POST', '/api/projects/does-not-exist-project-id/stop', { body: {} });
  assert.equal(status, 404);
  assert.equal(json.code, 'PROJECT_NOT_FOUND');
});

test('POST /api/projects/{id}/restart 404s for an unknown project', async () => {
  const { status, json } = await request('POST', '/api/projects/does-not-exist-project-id/restart', { body: {} });
  assert.equal(status, 404);
  assert.equal(json.code, 'PROJECT_NOT_FOUND');
});

test('DELETE /api/projects/{id} 404s for an unknown project', async () => {
  const { status, json } = await request('DELETE', '/api/projects/does-not-exist-project-id');
  assert.equal(status, 404);
  assert.equal(json.code, 'PROJECT_NOT_FOUND');
});

test('GET /api/projects/{id}/health 404s for an unknown project', async () => {
  const { status, json } = await request('GET', '/api/projects/does-not-exist-project-id/health');
  assert.equal(status, 404);
  assert.equal(json.code, 'PROJECT_NOT_FOUND');
});

// ─── Compliance reporting (US7) ─────────────────────────────────────────────

test('POST /api/compliance/reports/soc2 generates a report', async () => {
  const { status, json } = await request('POST', '/api/compliance/reports/soc2', { body: { format: 'json' } });
  assert.equal(status, 200);
  assert.equal(json.success, true);
  assert.equal(json.report.reportType, 'SOC2_Type_2_Draft');
  reportFilesToCleanup.push(json.filename);
});

test('POST /api/compliance/reports/gdpr generates a report', async () => {
  const { status, json } = await request('POST', '/api/compliance/reports/gdpr', { body: { format: 'json' } });
  assert.equal(status, 200);
  assert.equal(json.success, true);
  assert.ok(json.report);
  reportFilesToCleanup.push(json.filename);
});

test('POST /api/compliance/reports/cost-allocation generates a report', async () => {
  const { status, json } = await request('POST', '/api/compliance/reports/cost-allocation', { body: { format: 'json' } });
  assert.equal(status, 200);
  assert.equal(json.success, true);
  assert.ok(json.report);
  reportFilesToCleanup.push(json.filename);
});

test('POST /api/compliance/reports/model-usage generates a report', async () => {
  const { status, json } = await request('POST', '/api/compliance/reports/model-usage', { body: { format: 'json' } });
  assert.equal(status, 200);
  assert.equal(json.success, true);
  assert.ok(json.report);
  reportFilesToCleanup.push(json.filename);
});

test('GET /api/compliance/reports lists previously generated reports', async () => {
  const { status, json } = await request('GET', '/api/compliance/reports');
  assert.equal(status, 200);
  assert.equal(json.success, true);
  assert.ok(Array.isArray(json.reports));
  for (const filename of reportFilesToCleanup) {
    assert.ok(json.reports.some((r) => r.filename === filename), `expected ${filename} in reports list`);
  }
});
