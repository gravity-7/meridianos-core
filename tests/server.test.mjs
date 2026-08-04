import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { applyPolicyUpdates, createDashboardServer } from '../dashboard/server.mjs';
import { parseYaml } from '../yaml-lite.mjs';
import { resolvePaths } from '../config.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';

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
