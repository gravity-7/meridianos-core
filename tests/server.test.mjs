import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { applyPolicyUpdates, createDashboardServer } from '../dashboard/server.mjs';
import { parseYaml } from '../yaml-lite.mjs';
import { resolvePaths } from '../config.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';
import { isUiPlatformEnabled, platformBoundary, resolvePlatformRoute } from '../dashboard/ui-platform.mjs';
import { UI_PLATFORM_API_CONTRACT_FIXTURES } from './fixtures/ui-platform-api-contracts.mjs';
import { appendRun } from '../runlog.mjs';

const config = resolvePaths({ domain: FIXTURE_DOMAIN });

const SAMPLE = `kill_switch: false
agent_budget:
  warn_pct: 80
auto_merge: founder_only
`;

test('applyPolicyUpdates writes whitelisted lever paths', () => {
  const p = join(mkdtempSync(join(tmpdir(), 'srv-')), 'policy.yaml');
  writeFileSync(p, SAMPLE);
  const r = applyPolicyUpdates({ kill_switch: true, auto_merge: 'peer_agent_review' }, { path: p, config });
  assert.deepEqual(r.wrote.sort(), ['auto_merge', 'kill_switch']);
  const y = parseYaml(readFileSync(p, 'utf8'));
  assert.equal(y.kill_switch, true);
  assert.equal(y.auto_merge, 'peer_agent_review');
});

test('applyPolicyUpdates rejects a path outside the lever set (never writes it)', () => {
  assert.throws(() => applyPolicyUpdates({ version: 9 }), /not allowed/);
  assert.throws(() => applyPolicyUpdates('nope'), /expected an object/);
});

// GET /healthz is an unauthenticated, dependency-free liveness probe an external watchdog polls to
// detect a "listening but wedged" daemon (a blocked event loop makes even this cheap route time out).
test('GET /healthz returns 200 {ok:true} with no auth token and touches no DB', async () => {
  const server = createDashboardServer(config);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const { status, body } = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/healthz', method: 'GET' }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(status, 200);
    const parsed = JSON.parse(body);
    assert.equal(parsed.ok, true);
    assert.equal(typeof parsed.ts, 'number');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('UI platform boundary keeps rollout, routes, and safe failures explicit', () => {
  assert.equal(isUiPlatformEnabled({ ui_platform: { enabled: true } }), true);
  assert.equal(isUiPlatformEnabled({}), false);
  assert.equal(resolvePlatformRoute('/app/foundation').id, 'foundation');
  assert.equal(resolvePlatformRoute('/app/missing'), null);
  assert.deepEqual(platformBoundary({ body: [] }), { state: 'empty', message: 'There is nothing to show yet.' });
  assert.deepEqual(platformBoundary({ status: 500, error: new Error('secret') }), { state: 'error', message: 'Unable to load this information. Try again.', recoverable: true });
});

test('GET /app is feature-flagged and serves the stable platform shell when enabled', async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'srv-app-'));
  mkdirSync(join(repoRoot, '.ai'), { recursive: true });
  writeFileSync(join(repoRoot, '.ai', 'policy.yaml'), `${SAMPLE}ui_platform:\n  enabled: true\n`);
  const server = createDashboardServer(resolvePaths({ domain: FIXTURE_DOMAIN, root: repoRoot }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: server.address().port, path: '/app/foundation' }, (res) => {
        let body = ''; res.on('data', (chunk) => body += chunk); res.on('end', () => resolve({ status: res.statusCode, body }));
      }); req.on('error', reject); req.end();
    });
    assert.equal(result.status, 200);
    assert.match(result.body, /MeridianOS/);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('GET /app falls back to the legacy dashboard while the platform flag is disabled', async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'srv-app-legacy-'));
  mkdirSync(join(repoRoot, '.ai'), { recursive: true });
  writeFileSync(join(repoRoot, '.ai', 'policy.yaml'), SAMPLE);
  const server = createDashboardServer(resolvePaths({ domain: FIXTURE_DOMAIN, root: repoRoot }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: server.address().port, path: '/app' }, (res) => resolve({ status: res.statusCode, location: res.headers.location }));
      req.on('error', reject); req.end();
    });
    assert.deepEqual(result, { status: 302, location: '/' });
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('the legacy setup bridge is available on a fresh installation and /app/setup redirects without claiming a platform route', async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'srv-onboarding-'));
  const server = createDashboardServer(resolvePaths({ domain: FIXTURE_DOMAIN, root: repoRoot }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const request = (path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path, method, headers }, (res) => {
      let data = ''; res.on('data', (chunk) => data += chunk); res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location, body: data }));
    }); req.on('error', reject); if (body) req.write(body); req.end();
  });
  try {
    const shell = await request('/app/setup');
    assert.deepEqual(shell, { status: 302, location: '/setup', body: '' });
    const bridge = await request('/setup');
    assert.equal(bridge.status, 200);
    assert.match(bridge.body, /const AIOS_TOKEN = "/);
    const status = await request('/api/onboarding/status');
    assert.equal(status.status, 200);
    assert.equal(JSON.parse(status.body).installation, 'fresh');
    const denied = await request('/api/onboarding/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential: 'never-in-response' }) });
    assert.equal(denied.status, 403);
    assert.doesNotMatch(denied.body, /never-in-response/);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('the legacy setup bridge redirects /app/setup and keeps an existing installation non-destructive', async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'srv-onboarding-existing-'));
  mkdirSync(join(repoRoot, '.ai'), { recursive: true });
  writeFileSync(join(repoRoot, '.ai', 'policy.yaml'), SAMPLE);
  const server = createDashboardServer(resolvePaths({ domain: FIXTURE_DOMAIN, root: repoRoot }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: server.address().port, path: '/app/setup' }, (res) => resolve({ status: res.statusCode, location: res.headers.location })); req.on('error', reject); req.end();
    });
    assert.deepEqual(result, { status: 302, location: '/setup' });
    const status = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: server.address().port, path: '/api/onboarding/status' }, (res) => {
        let body = ''; res.on('data', (chunk) => body += chunk); res.on('end', () => resolve(JSON.parse(body)));
      }); req.on('error', reject); req.end();
    });
    assert.equal(status.installation, 'repair_needed');
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('onboarding preview is semantic and a stale commit is secret-free and non-mutating', async () => {
  const tenantConfig = setupFreshRepoRoot();
  const server = createDashboardServer(tenantConfig);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const credential = 'never-echo-this-onboarding-credential';
  const draft = {
    installationName: 'Preview Tenant', agents: ['builder'], monthlyBudgetUsd: 25,
    provider: { id: 'deepseek' }, validation: { providerId: 'deepseek', status: 'valid', messageCode: 'provider_valid' },
    revision: 'unvalidated-revision', reviewConfirmed: true,
  };
  try {
    const token = await getDashToken(port);
    const preview = await httpRequest({ port, path: '/api/onboarding/preview', method: 'POST', token, body: { draft } });
    assert.equal(preview.status, 200);
    assert.deepEqual(Object.keys(JSON.parse(preview.body).review).sort(), ['agents', 'budget', 'files', 'monthlyBudgetUsd', 'provider', 'revision']);
    assert.doesNotMatch(preview.body, /DEEPSEEK_KEY=|never-echo/);
    assert.equal(existsSync(tenantConfig.policyPath), false);
    const commit = await httpRequest({ port, path: '/api/onboarding/commit', method: 'POST', token, body: { draft, credential } });
    assert.equal(commit.status, 409);
    assert.equal(JSON.parse(commit.body).code, 'provider_validation_required');
    assert.doesNotMatch(commit.body, /never-echo/);
    assert.equal(existsSync(tenantConfig.policyPath), false);
    assert.equal(existsSync(join(tenantConfig.repoRoot, '.env')), false);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('onboarding checklist exposes a stable run target only after a run exists', async () => {
  const tenantConfig = setupFreshRepoRoot();
  const server = createDashboardServer(tenantConfig);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const none = await httpRequest({ port, path: '/api/onboarding/checklist', method: 'GET' });
    assert.equal(JSON.parse(none.body).firstRun, null);
    appendRun({ run_id: 'first-run-012', task: 'first-task-012', outcome: 'ok' }, { config: tenantConfig });
    const available = JSON.parse((await httpRequest({ port, path: '/api/onboarding/checklist', method: 'GET' })).body);
    assert.deepEqual(available.firstRun, { id: 'first-run-012', task: 'first-task-012', status: 'ok', target: '/setup' });
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('platform rollout leaves representative legacy and public API contracts unchanged', async () => {
  const request = (server, path) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path }, (res) => {
      let body = ''; res.on('data', (chunk) => body += chunk); res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body }));
    }); req.on('error', reject); req.end();
  });
  const start = async (enabled) => {
    const root = mkdtempSync(join(tmpdir(), 'srv-platform-contract-'));
    mkdirSync(join(root, '.ai'), { recursive: true });
    writeFileSync(join(root, '.ai', 'policy.yaml'), `${SAMPLE}ui_platform:\n  enabled: ${enabled}\n`);
    const server = createDashboardServer(resolvePaths({ domain: FIXTURE_DOMAIN, root }));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return server;
  };
  const legacy = await start(false); const platform = await start(true);
  try {
    const [legacyIndex, platformIndex, legacyStatus, platformStatus] = await Promise.all([
      request(legacy, '/'), request(platform, '/'), request(legacy, '/api/status'), request(platform, '/api/status'),
    ]);
    assert.equal(legacyIndex.status, 200); assert.equal(platformIndex.status, 200);
    assert.match(legacyIndex.body, /MeridianOS/); assert.match(platformIndex.body, /MeridianOS/);
    assert.deepEqual([legacyStatus.status, legacyStatus.type], [platformStatus.status, platformStatus.type]);
    assert.deepEqual(Object.keys(JSON.parse(legacyStatus.body)).sort(), Object.keys(JSON.parse(platformStatus.body)).sort());
  } finally { await Promise.all([legacy, platform].map((server) => new Promise((resolve) => server.close(resolve)))); }
});

test('platform rollout leaves representative public v1 contract fixtures unchanged', async () => {
  const request = (server, fixture) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: fixture.path, method: fixture.method }, (res) => {
      let body = ''; res.on('data', (chunk) => body += chunk); res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body }));
    }); req.on('error', reject); req.end();
  });
  const start = async (enabled) => {
    const root = mkdtempSync(join(tmpdir(), 'srv-platform-v1-contract-'));
    mkdirSync(join(root, '.ai'), { recursive: true });
    writeFileSync(join(root, '.ai', 'policy.yaml'), `${SAMPLE}ui_platform:\n  enabled: ${enabled}\n`);
    const server = createDashboardServer(resolvePaths({ domain: FIXTURE_DOMAIN, root }));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return server;
  };
  const legacy = await start(false); const platform = await start(true);
  try {
    for (const fixture of [UI_PLATFORM_API_CONTRACT_FIXTURES.publicSpecification, UI_PLATFORM_API_CONTRACT_FIXTURES.protectedTasks]) {
      const [before, after] = await Promise.all([request(legacy, fixture), request(platform, fixture)]);
      assert.equal(after.status, fixture.status);
      assert.deepEqual([after.status, after.type, after.body], [before.status, before.type, before.body]);
    }
    assert.match((await request(platform, UI_PLATFORM_API_CONTRACT_FIXTURES.publicSpecification)).body, /openapi:/);
  } finally { await Promise.all([legacy, platform].map((server) => new Promise((resolve) => server.close(resolve)))); }
});

test('disabling the policy flag rolls an active platform route back to legacy without restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'srv-platform-rollback-'));
  mkdirSync(join(root, '.ai'), { recursive: true });
  const policyPath = join(root, '.ai', 'policy.yaml');
  writeFileSync(policyPath, `${SAMPLE}ui_platform:\n  enabled: true\n`);
  const server = createDashboardServer(resolvePaths({ domain: FIXTURE_DOMAIN, root }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const appRequest = () => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: '/app' }, (res) => resolve({ status: res.statusCode, location: res.headers.location }));
    req.on('error', reject); req.end();
  });
  try {
    assert.equal((await appRequest()).status, 200);
    writeFileSync(policyPath, `${SAMPLE}ui_platform:\n  enabled: false\n`);
    assert.deepEqual(await appRequest(), { status: 302, location: '/' });
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

// Regression: statusCache was referenced (read + reassigned) throughout this file without ever
// being declared, so GET /api/status — the dashboard's main polling endpoint — threw 500 on every
// call in a real running server (only caught while adding /api/config/backups, since no prior test
// exercised any of these routes over real HTTP; see the statusCache declaration's comment).
test('GET /api/status returns 200 with a JSON status body (was: 500, statusCache undeclared)', async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'srv-status-'));
  mkdirSync(join(repoRoot, '.ai'), { recursive: true });
  writeFileSync(join(repoRoot, '.ai', 'policy.yaml'), SAMPLE);
  const tenantConfig = resolvePaths({ domain: FIXTURE_DOMAIN, root: repoRoot });

  const server = createDashboardServer(tenantConfig);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const { status, body } = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/api/status', method: 'GET' }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(status, 200);
    assert.doesNotThrow(() => JSON.parse(body));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// Metrics export for monitoring (code-review follow-up) — dashboard/metrics.mjs was already
// built (T-something in an earlier pass) but never wired to a route; these prove it now is.
test('GET /api/metrics and GET /metrics both reflect a request that was just made', async () => {
  const server = createDashboardServer(config);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  function get(path) {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      });
      req.on('error', reject);
      req.end();
    });
  }

  try {
    await get('/healthz'); // generate at least one tracked request

    const jsonMetrics = await get('/api/metrics');
    assert.equal(jsonMetrics.status, 200);
    const parsed = JSON.parse(jsonMetrics.body);
    assert.ok(parsed.summary.api.totalRequests >= 1);

    const prom = await get('/metrics');
    assert.equal(prom.status, 200);
    assert.match(prom.headers['content-type'], /text\/plain/);
    assert.match(prom.body, /^meridianos_api_requests_total \d+$/m);
    assert.match(prom.body, /^meridianos_process_uptime_seconds \d+$/m);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// GET /api/config/backups + POST /api/config/restore/:timestamp (008 — End-User Configurability, US1/FR-003)

function httpRequest({ port, path, method, token, body }) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const req = http.request({
      host: '127.0.0.1', port, path, method,
      headers: {
        ...(token ? { 'x-aios-token': token } : {}),
        ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let out = '';
      res.on('data', (c) => (out += c));
      res.on('end', () => resolve({ status: res.statusCode, body: out, headers: res.headers }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function getDashToken(port) {
  const page = await httpRequest({ port, path: '/', method: 'GET' });
  return /AIOS_TOKEN = "([^"]+)"/.exec(page.body)[1];
}

/** Set up a fresh temp repoRoot with `.ai/policy.yaml` seeded (the fixture domain's default,
 *  unresolved `policyPath` location — see config.mjs's resolvePaths), and return its config. */
function setupTenantConfig() {
  const repoRoot = mkdtempSync(join(tmpdir(), 'srv-backups-'));
  mkdirSync(join(repoRoot, '.ai'), { recursive: true });
  writeFileSync(join(repoRoot, '.ai', 'policy.yaml'), SAMPLE);
  return resolvePaths({ domain: FIXTURE_DOMAIN, root: repoRoot });
}

test('GET /api/config/backups lists a backup created by a prior Settings save', async () => {
  const tenantConfig = setupTenantConfig();

  const server = createDashboardServer(tenantConfig);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const token = await getDashToken(port);
    applyPolicyUpdates({ kill_switch: true }, { config: tenantConfig });

    const res = await httpRequest({ port, path: '/api/config/backups', method: 'GET' });
    assert.equal(res.status, 200);
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.backups.length, 1);
    void token; // GET is unauthenticated by design (read-only, matches /api/status)
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /api/config/restore/:timestamp requires the dashboard auth token', async () => {
  const tenantConfig = setupTenantConfig();

  const server = createDashboardServer(tenantConfig);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const res = await httpRequest({ port, path: '/api/config/restore/anything', method: 'POST' });
    assert.equal(res.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /api/config/restore/:timestamp restores a prior backup with a valid token', async () => {
  const tenantConfig = setupTenantConfig();

  const server = createDashboardServer(tenantConfig);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const token = await getDashToken(port);
    applyPolicyUpdates({ kill_switch: true }, { config: tenantConfig }); // backs up kill_switch: false

    const listRes = await httpRequest({ port, path: '/api/config/backups', method: 'GET' });
    const [backup] = JSON.parse(listRes.body).backups;

    const restoreRes = await httpRequest({
      port, path: `/api/config/restore/${encodeURIComponent(backup.timestamp)}`, method: 'POST', token,
    });
    assert.equal(restoreRes.status, 200);
    const parsed = JSON.parse(restoreRes.body);
    assert.equal(parsed.ok, true);
    assert.equal(parseYaml(readFileSync(tenantConfig.policyPath, 'utf8')).kill_switch, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// GET /api/config/profiles (008 — End-User Configurability, US2/FR-007)

test('GET /api/config/profiles returns an empty list + null active on a policy.yaml with no profiles', async () => {
  const tenantConfig = setupTenantConfig();
  const server = createDashboardServer(tenantConfig);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const res = await httpRequest({ port, path: '/api/config/profiles', method: 'GET' });
    assert.equal(res.status, 200);
    const parsed = JSON.parse(res.body);
    assert.deepEqual(parsed, { ok: true, profiles: [], active: null });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /api/config/profiles lists defined profiles and reports the active one', async () => {
  const tenantConfig = setupTenantConfig();
  writeFileSync(tenantConfig.policyPath, `${SAMPLE}profiles:\n  base:\n    kill_switch: false\n  dev:\n    extends: base\nactive_profile: dev\n`);

  const server = createDashboardServer(tenantConfig);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const res = await httpRequest({ port, path: '/api/config/profiles', method: 'GET' });
    assert.equal(res.status, 200);
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.active, 'dev');
    assert.deepEqual(parsed.profiles.sort((a, b) => a.name.localeCompare(b.name)), [
      { name: 'base', extends: null },
      { name: 'dev', extends: 'base' },
    ]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// GET /api/config/routing (008 — End-User Configurability, US1/FR-014)

test('GET /api/config/routing returns the roster, tiers, and current model_routing config', async () => {
  const tenantConfig = setupTenantConfig();
  writeFileSync(tenantConfig.policyPath, `${SAMPLE}model_routing:\n  claude:\n    simple: deepseek-chat\n`);

  const server = createDashboardServer(tenantConfig);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const res = await httpRequest({ port, path: '/api/config/routing', method: 'GET' });
    assert.equal(res.status, 200);
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.ok, true);
    assert.ok(Array.isArray(parsed.agents) && parsed.agents.length > 0);
    assert.ok(Array.isArray(parsed.tiers) && parsed.tiers.includes('simple'));
    assert.equal(parsed.routing.claude.simple, 'deepseek-chat');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// GET /setup + POST /api/setup/* (008 — End-User Configurability, US3)

/** A repoRoot with NO .ai/ at all — the "fresh checkout" case the setup wizard exists for. */
function setupFreshRepoRoot() {
  const repoRoot = mkdtempSync(join(tmpdir(), 'srv-setup-'));
  return resolvePaths({ domain: FIXTURE_DOMAIN, root: repoRoot });
}

function setupSyntheticSetupConfig() {
  const config = setupFreshRepoRoot();
  config.setupProviderValidator = async () => ({ status: 'valid', summary: 'Connection verified. Continue to budget.' });
  return config;
}

async function validateSyntheticSetupRoute(port, token) {
  const sessionId = await issueSyntheticSetupSession(port);
  const response = await httpRequest({
    port, path: '/api/setup/provider-validation', method: 'POST', token,
    body: {
      providerId: 'deepseek', modelId: 'deepseek-v4-flash', secret: 'synthetic-onboarding-sentinel',
      sessionId,
    },
  });
  const parsed = JSON.parse(response.body);
  assert.equal(response.status, 200);
  assert.equal(parsed.ok, true);
  assert.doesNotMatch(response.body, /synthetic-onboarding-sentinel/);
  return { sessionId, validationId: parsed.validation.id };
}

async function issueSyntheticSetupSession(port) {
  const page = await httpRequest({ port, path: '/setup', method: 'GET' });
  assert.equal(page.status, 200);
  const match = page.body.match(/const SETUP_SESSION_ID = "([^"]+)"/);
  assert.ok(match, 'setup page should contain a browser-scoped session identifier');
  return match[1];
}

async function createSyntheticSetupReview(port, token, validation, overrides = {}) {
  const response = await httpRequest({
    port, path: '/api/setup/plan', method: 'POST', token,
    body: {
      tenantName: 'Test Co', agents: ['builder'], monthlyBudgetUsd: 100,
      providerId: 'deepseek', modelId: 'deepseek-v4-flash', ...validation, ...overrides,
    },
  });
  const parsed = JSON.parse(response.body);
  assert.equal(response.status, 200);
  assert.equal(parsed.ok, true);
  return { ...validation, reviewId: parsed.review.id };
}

test('GET /setup serves the wizard page with the dashboard token injected', async () => {
  const tenantConfig = setupFreshRepoRoot();
  const server = createDashboardServer(tenantConfig);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const res = await httpRequest({ port, path: '/setup', method: 'GET' });
    assert.equal(res.status, 200);
    assert.doesNotMatch(res.body, /__AIOS_TOKEN__/);
    assert.doesNotMatch(res.body, /__SETUP_SESSION_ID__/);
    assert.match(res.body, /AIOS_TOKEN = "/);
    assert.match(res.body, /SETUP_SESSION_ID = "setup-/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /api/setup/status reports exists:false on a fresh repoRoot', async () => {
  const tenantConfig = setupFreshRepoRoot();
  const server = createDashboardServer(tenantConfig);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const res = await httpRequest({ port, path: '/api/setup/status', method: 'GET' });
    assert.equal(res.status, 200);
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.exists, false);
    assert.ok(Array.isArray(parsed.providers));
    assert.ok(parsed.providers.some((provider) => provider.id === 'deepseek'));
    assert.equal(parsed.providers.some((provider) => /z\.ai|glm/i.test(`${provider.id} ${provider.displayName}`)), false);
    assert.equal('setupSessionId' in parsed, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /api/setup/status reports exists:true once a policy.yaml is written', async () => {
  const tenantConfig = setupTenantConfig();
  const server = createDashboardServer(tenantConfig);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const res = await httpRequest({ port, path: '/api/setup/status', method: 'GET' });
    assert.equal(JSON.parse(res.body).exists, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /api/setup/plan and /api/setup/commit require the dashboard auth token', async () => {
  const tenantConfig = setupFreshRepoRoot();
  const server = createDashboardServer(tenantConfig);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const planRes = await httpRequest({ port, path: '/api/setup/plan', method: 'POST', body: { tenantName: 'x', agents: ['a'], monthlyBudgetUsd: 50 } });
    assert.equal(planRes.status, 403);
    const commitRes = await httpRequest({ port, path: '/api/setup/commit', method: 'POST', body: { tenantName: 'x', agents: ['a'], monthlyBudgetUsd: 50 } });
    assert.equal(commitRes.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /api/setup/plan returns a redacted validated review without writing any file', async () => {
  const tenantConfig = setupSyntheticSetupConfig();
  const server = createDashboardServer(tenantConfig);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const token = await getDashToken(port);
    const validation = await validateSyntheticSetupRoute(port, token);
    const res = await httpRequest({
      port, path: '/api/setup/plan', method: 'POST', token,
      body: {
        tenantName: 'Test Co', agents: ['builder'], monthlyBudgetUsd: 100,
        providerId: 'deepseek', modelId: 'deepseek-v4-flash', ...validation,
      },
    });
    assert.equal(res.status, 200);
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.review.files.map((file) => file.name), ['.ai/policy.yaml', '.ai/tenant.yaml', '.env']);
    assert.equal(parsed.review.route.modelId, 'deepseek-v4-flash');
    assert.ok(typeof parsed.review.id === 'string' && parsed.review.id.length > 0);
    assert.doesNotMatch(res.body, /synthetic-onboarding-sentinel|DEEPSEEK_KEY=/);
    assert.equal(existsSync(join(tenantConfig.repoRoot, '.ai', 'policy.yaml')), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /api/setup/commit consumes a validated review and writes only to tenant repoRoot', async () => {
  const tenantConfig = setupSyntheticSetupConfig();
  const server = createDashboardServer(tenantConfig);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const token = await getDashToken(port);
    const validation = await validateSyntheticSetupRoute(port, token);
    const reviewed = await createSyntheticSetupReview(port, token, validation);
    const res = await httpRequest({
      port, path: '/api/setup/commit', method: 'POST', token,
      body: {
        tenantName: 'Test Co', agents: ['builder'], monthlyBudgetUsd: 100, confirmed: true,
        providerId: 'deepseek', modelId: 'deepseek-v4-flash', ...reviewed,
      },
    });
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.body).ok, true);
    assert.doesNotMatch(res.body, /synthetic-onboarding-sentinel/);
    assert.ok(existsSync(tenantConfig.policyPath));
    assert.equal(parseYaml(readFileSync(tenantConfig.policyPath, 'utf8')).kill_switch, false);
    const replay = await httpRequest({
      port, path: '/api/setup/commit', method: 'POST', token,
      body: {
        tenantName: 'Test Co', agents: ['builder'], monthlyBudgetUsd: 100, confirmed: true,
        providerId: 'deepseek', modelId: 'deepseek-v4-flash', ...validation,
      },
    });
    assert.equal(JSON.parse(replay.body).ok, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /api/setup/commit requires an explicit confirmation without consuming its review', async () => {
  const tenantConfig = setupSyntheticSetupConfig();
  const server = createDashboardServer(tenantConfig);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const token = await getDashToken(port);
    const validation = await validateSyntheticSetupRoute(port, token);
    const reviewed = await createSyntheticSetupReview(port, token, validation);
    const body = {
      tenantName: 'Test Co', agents: ['builder'], monthlyBudgetUsd: 100,
      providerId: 'deepseek', modelId: 'deepseek-v4-flash', ...reviewed,
    };
    const rejected = await httpRequest({ port, path: '/api/setup/commit', method: 'POST', token, body: { ...body, confirmed: false } });
    assert.equal(rejected.status, 400);
    assert.equal(existsSync(tenantConfig.policyPath), false);

    const accepted = await httpRequest({ port, path: '/api/setup/commit', method: 'POST', token, body: { ...body, confirmed: true } });
    assert.equal(accepted.status, 200);
    assert.equal(JSON.parse(accepted.body).ok, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /app/setup paths explicitly redirect to the implemented legacy setup bridge', async () => {
  const tenantConfig = setupFreshRepoRoot();
  const server = createDashboardServer(tenantConfig);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const res = await httpRequest({ port, path: '/app/setup', method: 'GET' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/setup');
    const nested = await httpRequest({ port, path: '/app/setup/complete', method: 'GET' });
    assert.equal(nested.status, 302);
    assert.equal(nested.headers.location, '/setup');
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('POST /api/setup/commit refuses every existing installation target', async () => {
  const tenantConfig = setupTenantConfig(); // seeds .ai/policy.yaml already
  const server = createDashboardServer(tenantConfig);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const token = await getDashToken(port);
    const res = await httpRequest({
      port, path: '/api/setup/commit', method: 'POST', token,
      body: { tenantName: 'Test Co', agents: ['builder'], monthlyBudgetUsd: 100 },
    });
    assert.equal(res.status, 409);
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.ok, false);
    assert.match(parsed.error, /new installation/i);
    assert.equal(parseYaml(readFileSync(tenantConfig.policyPath, 'utf8')).kill_switch, false); // SAMPLE's original value, untouched
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('provider-validation revoke destroys a cancelled browser validation without affecting another browser session', async () => {
  const tenantConfig = setupSyntheticSetupConfig();
  const server = createDashboardServer(tenantConfig);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const token = await getDashToken(port);
    const first = await validateSyntheticSetupRoute(port, token);
    const second = await validateSyntheticSetupRoute(port, token);
    assert.notEqual(first.sessionId, second.sessionId);

    const revoke = await httpRequest({
      port, path: '/api/setup/provider-validation/revoke', method: 'POST', token,
      body: { validationId: first.validationId, sessionId: first.sessionId },
    });
    assert.deepEqual(JSON.parse(revoke.body), { ok: true });

    const cancelledPlan = await httpRequest({
      port, path: '/api/setup/plan', method: 'POST', token,
      body: { tenantName: 'Test Co', agents: ['builder'], monthlyBudgetUsd: 100, providerId: 'deepseek', modelId: 'deepseek-v4-flash', ...first },
    });
    assert.equal(cancelledPlan.status, 400);
    const unaffectedReview = await createSyntheticSetupReview(port, token, second);
    assert.ok(unaffectedReview.reviewId);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('browser-session expiry revokes validation and blocks review or commit', async () => {
  let now = 1_000;
  const tenantConfig = setupSyntheticSetupConfig();
  tenantConfig.setupSessionNow = () => now;
  tenantConfig.setupValidationNow = () => now;
  tenantConfig.setupSessionTtlMs = 50;
  tenantConfig.setupValidationTtlMs = 50;
  const server = createDashboardServer(tenantConfig);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const token = await getDashToken(port);
    const validation = await validateSyntheticSetupRoute(port, token);
    const reviewed = await createSyntheticSetupReview(port, token, validation);
    now += 51;
    const body = {
      tenantName: 'Test Co', agents: ['builder'], monthlyBudgetUsd: 100,
      providerId: 'deepseek', modelId: 'deepseek-v4-flash', ...reviewed,
    };
    const plan = await httpRequest({ port, path: '/api/setup/plan', method: 'POST', token, body });
    const commit = await httpRequest({ port, path: '/api/setup/commit', method: 'POST', token, body: { ...body, confirmed: true } });
    assert.equal(plan.status, 403);
    assert.equal(commit.status, 403);
    assert.equal(existsSync(tenantConfig.policyPath), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('secret-facing setup validation and revoke endpoints reject unauthenticated requests before validation', async () => {
  const tenantConfig = setupFreshRepoRoot();
  let validatorCalls = 0;
  tenantConfig.setupProviderValidator = async () => {
    validatorCalls += 1;
    return { status: 'valid', summary: 'Connection verified. Continue to budget.' };
  };
  const server = createDashboardServer(tenantConfig);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const sessionId = await issueSyntheticSetupSession(port);
    const validation = await httpRequest({
      port, path: '/api/setup/provider-validation', method: 'POST',
      body: { providerId: 'deepseek', modelId: 'deepseek-v4-flash', secret: 'synthetic-onboarding-sentinel', sessionId },
    });
    const revoke = await httpRequest({
      port, path: '/api/setup/provider-validation/revoke', method: 'POST',
      body: { validationId: 'opaque-synthetic-id', sessionId },
    });
    assert.equal(validation.status, 403);
    assert.equal(revoke.status, 403);
    assert.equal(validatorCalls, 0);
    assert.doesNotMatch(validation.body, /synthetic-onboarding-sentinel/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /api/setup/commit requires the exact prior redacted review', async () => {
  const tenantConfig = setupSyntheticSetupConfig();
  const server = createDashboardServer(tenantConfig);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const token = await getDashToken(port);
    const validation = await validateSyntheticSetupRoute(port, token);
    const directCommit = await httpRequest({
      port, path: '/api/setup/commit', method: 'POST', token,
      body: { tenantName: 'Test Co', agents: ['builder'], monthlyBudgetUsd: 100, confirmed: true, providerId: 'deepseek', modelId: 'deepseek-v4-flash', ...validation },
    });
    assert.equal(JSON.parse(directCommit.body).ok, false);
    assert.equal(existsSync(tenantConfig.policyPath), false);

    const reviewed = await createSyntheticSetupReview(port, token, validation);
    const changedCommit = await httpRequest({
      port, path: '/api/setup/commit', method: 'POST', token,
      body: { tenantName: 'Test Co', agents: ['builder'], monthlyBudgetUsd: 101, confirmed: true, providerId: 'deepseek', modelId: 'deepseek-v4-flash', ...reviewed },
    });
    assert.equal(JSON.parse(changedCommit.body).ok, false);
    assert.equal(existsSync(tenantConfig.policyPath), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

for (const target of ['.ai/tenant.yaml', '.env']) {
  test(`setup status blocks an existing ${target} without reading or replacing it`, async () => {
    const tenantConfig = setupFreshRepoRoot();
    const existing = join(tenantConfig.repoRoot, target);
    mkdirSync(join(existing, '..'), { recursive: true });
    writeFileSync(existing, 'pre-existing setup target\n');
    const server = createDashboardServer(tenantConfig);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    try {
      const status = JSON.parse((await httpRequest({ port, path: '/api/setup/status', method: 'GET' })).body);
      assert.equal(status.exists, true);
      const token = await getDashToken(port);
      const commit = await httpRequest({ port, path: '/api/setup/commit', method: 'POST', token, body: { confirmed: true } });
      assert.equal(commit.status, 409);
      assert.equal(readFileSync(existing, 'utf8'), 'pre-existing setup target\n');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
}

test('provider validation returns a safe recoverable error without exposing submitted data', async () => {
  const tenantConfig = setupFreshRepoRoot();
  tenantConfig.setupProviderValidator = async () => ({ status: 'invalid', code: 'AUTH_FAILED', summary: 'Authentication failed. Check the key and try again.' });
  const server = createDashboardServer(tenantConfig);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const token = await getDashToken(port);
    const sessionId = await issueSyntheticSetupSession(port);
    const response = await httpRequest({
      port, path: '/api/setup/provider-validation', method: 'POST', token,
      body: { providerId: 'deepseek', modelId: 'deepseek-v4-flash', secret: 'synthetic-onboarding-sentinel', sessionId },
    });
    const parsed = JSON.parse(response.body);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.code, 'AUTH_FAILED');
    assert.doesNotMatch(response.body, /synthetic-onboarding-sentinel/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('provider validation rejects an unregistered provider before it can invoke the validator', async () => {
  const tenantConfig = setupFreshRepoRoot();
  let validatorCalls = 0;
  tenantConfig.setupProviderValidator = async () => {
    validatorCalls += 1;
    return { status: 'valid', summary: 'Connection verified. Continue to budget.' };
  };
  const server = createDashboardServer(tenantConfig);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const token = await getDashToken(port);
    const sessionId = await issueSyntheticSetupSession(port);
    const response = await httpRequest({
      port, path: '/api/setup/provider-validation', method: 'POST', token,
      body: { providerId: 'unregistered-provider', modelId: 'synthetic-model', secret: 'synthetic-onboarding-sentinel', sessionId },
    });
    assert.equal(response.status, 400);
    assert.equal(validatorCalls, 0);
    assert.doesNotMatch(response.body, /synthetic-onboarding-sentinel|unregistered-provider/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('provider validation rejects an unsupported model before it can invoke the validator', async () => {
  const tenantConfig = setupFreshRepoRoot();
  let validatorCalls = 0;
  tenantConfig.setupProviderValidator = async () => {
    validatorCalls += 1;
    return { status: 'valid', summary: 'Connection verified. Continue to budget.' };
  };
  const server = createDashboardServer(tenantConfig);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const token = await getDashToken(port);
    const sessionId = await issueSyntheticSetupSession(port);
    const response = await httpRequest({
      port, path: '/api/setup/provider-validation', method: 'POST', token,
      body: { providerId: 'deepseek', modelId: 'unsupported-synthetic-model', secret: 'synthetic-onboarding-sentinel', sessionId },
    });
    assert.equal(response.status, 400);
    assert.equal(validatorCalls, 0);
    assert.doesNotMatch(response.body, /synthetic-onboarding-sentinel|unsupported-synthetic-model|validationId/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('the synthetic/disposable setup label is enabled only by an injected fixture', async () => {
  const tenantConfig = setupFreshRepoRoot();
  tenantConfig.setupFixture = { synthetic: true };
  const server = createDashboardServer(tenantConfig);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const status = JSON.parse((await httpRequest({ port, path: '/api/setup/status', method: 'GET' })).body);
    assert.equal(status.synthetic, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
