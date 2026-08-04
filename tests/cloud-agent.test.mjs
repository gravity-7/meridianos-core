/**
 * cloud-agent.test.mjs — User Story 6 (Hybrid Cloud Control Plane) coverage:
 *   T082 — the local cloud agent (cloud/local-agent.mjs)
 *   T083 — cloud metadata reporting end-to-end, through a real cloud-server.mjs HTTP server
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import { createLocalAgent, statusFilePath } from '../cloud/local-agent.mjs';
import { createCloudServer, openCloudDb } from '../cloud/cloud-server.mjs';
import {
  migrateCloudDb, createOrganization, createUser, registerMachine,
  reportMetadata, pushPolicy, aggregateProviderHealth, pruneOldMetadata, RETENTION,
} from '../cloud/cloud-control-plane.mjs';
import { resolvePaths } from '../config.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';
import { openLedger, appendEvent } from '../gateway/ledger.mjs';
import { makeTokenEvent } from '../gateway/token-event.mjs';
import { loadPolicy } from '../budget.mjs';

function makeConfig() {
  const repoRoot = mkdtempSync(join(tmpdir(), 'cloud-agent-'));
  mkdirSync(join(repoRoot, '.ai'), { recursive: true });
  return resolvePaths({ root: repoRoot, domain: FIXTURE_DOMAIN });
}

// ─── T082: local cloud agent ─────────────────────────────────────────────────────────────────
describe('T082 — local cloud agent (cloud/local-agent.mjs)', () => {
  test('rejects a reporting interval outside 30-300 seconds (FR-020)', () => {
    const config = makeConfig();
    assert.throws(() => createLocalAgent({ config, cloudUrl: 'http://x', machineApiKey: 'k', reportingIntervalSec: 10 }), /between 30 and 300/);
    assert.throws(() => createLocalAgent({ config, cloudUrl: 'http://x', machineApiKey: 'k', reportingIntervalSec: 301 }), /between 30 and 300/);
    assert.doesNotThrow(() => createLocalAgent({ config, cloudUrl: 'http://x', machineApiKey: 'k', reportingIntervalSec: 60 }));
  });

  test('reportOnce posts anonymized metadata, applies returned policy updates, and persists status', async () => {
    const config = makeConfig();

    // Seed the local ledger with a couple of token events (this is what gets read + anonymized).
    const ledger = openLedger(undefined, { config });
    appendEvent(ledger, makeTokenEvent({
      tenant: 'default', agent: 'claude', session: 'test-session', requestId: randomUUID(),
      provider: 'anthropic', model: 'claude-sonnet-5', wire: 'anthropic',
      inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.01,
    }));
    ledger.close();

    let capturedRequest = null;
    const fakeFetch = async (url, opts) => {
      capturedRequest = { url, headers: opts.headers, body: JSON.parse(opts.body) };
      return { ok: true, json: async () => ({ ok: true, policyUpdates: [{ id: 'u1', path: 'agent_budget.warn_pct', value: 95 }] }) };
    };

    const agent = createLocalAgent({ config, cloudUrl: 'http://cloud.example', machineApiKey: 'mck-test', fetchImpl: fakeFetch });
    await agent.reportOnce();

    assert.equal(capturedRequest.url, 'http://cloud.example/api/cloud/report');
    assert.equal(capturedRequest.headers['x-machine-key'], 'mck-test');
    assert.equal(capturedRequest.body.metadata.length, 1);
    assert.deepEqual(Object.keys(capturedRequest.body.metadata[0]).sort(), ['cost', 'model', 'provider', 'timestamp', 'tokens'].sort());
    assert.equal(capturedRequest.body.metadata[0].provider, 'anthropic');
    // Privacy: no api key, no prompt/response content anywhere in the outbound payload.
    const serialized = JSON.stringify(capturedRequest.body);
    assert.ok(!serialized.includes('mck-test'), 'the machine credential itself must never appear in the request body');

    // The policy update the fake cloud server "pushed back" must be applied to policy.yaml.
    const policy = loadPolicy(undefined, config);
    assert.equal(policy.agent_budget.warn_pct, 95);

    // Status persisted to disk for the (separate-process) dashboard to read (T094).
    const status = JSON.parse(readFileSync(statusFilePath(config), 'utf8'));
    assert.equal(status.connected, true);
    assert.equal(status.lastError, null);
    assert.equal(agent.getStatus().connected, true);
  });

  test('a failed report is reflected in status (connected: false, lastError set) without throwing', async () => {
    const config = makeConfig();
    const agent = createLocalAgent({
      config, cloudUrl: 'http://cloud.example', machineApiKey: 'mck-test',
      fetchImpl: async () => { throw new Error('network unreachable'); },
    });
    await assert.doesNotReject(() => agent.reportOnce());
    const status = agent.getStatus();
    assert.equal(status.connected, false);
    assert.match(status.lastError, /network unreachable/);
  });

  test('start()/stop() schedule and cancel periodic reporting', async () => {
    const config = makeConfig();
    let calls = 0;
    const fakeFetch = async () => { calls++; return { ok: true, json: async () => ({ ok: true, policyUpdates: [] }) }; };
    const agent = createLocalAgent({ config, cloudUrl: 'http://x', machineApiKey: 'k', reportingIntervalSec: 30, fetchImpl: fakeFetch });
    agent.start();
    await new Promise((r) => setImmediate(r)); // let the immediate first report's microtasks flush
    assert.equal(calls, 1);
    agent.stop();
  });
});

// ─── T083: cloud metadata reporting end-to-end (real HTTP server) ──────────────────────────
describe('T083 — cloud metadata reporting end-to-end', () => {
  let db, server, port;

  before(async () => {
    db = openCloudDb(':memory:');
    server = createCloudServer(db);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });
  after(async () => { await new Promise((resolve) => server.close(resolve)); });

  async function callApi(path, { method = 'GET', headers = {}, body } = {}) {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers: { 'content-type': 'application/json', ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  }

  test('the dashboard static UI is served at / and /app.js', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /MeridianOS Cloud Control Plane/);
  });

  test('full flow: org → user → login → machine → report → machine list shows updated metadata', async () => {
    const org = await callApi('/api/cloud/organizations', { method: 'POST', body: { name: 'Acme Corp' } });
    assert.equal(org.status, 201);

    const user = await callApi('/api/cloud/auth/register', { method: 'POST', body: { orgId: org.body.id, email: 'op@acme.com', password: 'hunter22', role: 'admin' } });
    assert.equal(user.status, 201);

    const badLogin = await callApi('/api/cloud/auth/login', { method: 'POST', body: { email: 'op@acme.com', password: 'wrong' } });
    assert.equal(badLogin.status, 401);

    const login = await callApi('/api/cloud/auth/login', { method: 'POST', body: { email: 'op@acme.com', password: 'hunter22' } });
    assert.equal(login.status, 200);
    const token = login.body.token;

    const machine = await callApi('/api/cloud/machines', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: { name: 'laptop-1', osType: 'windows', meridianosVersion: '0.3.9' } });
    assert.equal(machine.status, 201);
    assert.match(machine.body.apiKey, /^mck-/);

    // Unauthenticated machine list is rejected; unknown report key is rejected.
    assert.equal((await callApi('/api/cloud/machines')).status, 401);
    const badReport = await callApi('/api/cloud/report', { method: 'POST', headers: { 'x-machine-key': 'mck-bogus' }, body: {} });
    assert.equal(badReport.status, 401);

    const report = await callApi('/api/cloud/report', {
      method: 'POST', headers: { 'x-machine-key': machine.body.apiKey },
      body: { metadata: [{ provider: 'anthropic', model: 'claude-sonnet-5', tokens: 500, cost: 0.02 }], providerHealth: [{ provider: 'anthropic', status: 'ok' }] },
    });
    assert.equal(report.status, 200);
    assert.equal(report.body.ok, true);

    const machines = await callApi('/api/cloud/machines', { headers: { authorization: `Bearer ${token}` } });
    assert.equal(machines.body.machines.length, 1);
    assert.equal(machines.body.machines[0].status, 'online');
    assert.ok(machines.body.machines[0].last_seen, 'last_seen must be updated after a report');

    const health = await callApi('/api/cloud/health', { headers: { authorization: `Bearer ${token}` } });
    assert.equal(health.body.anthropic.overall, 'ok');

    // Policy push round-trip: pushed now, delivered on the machine's NEXT report.
    const push = await callApi('/api/cloud/policy', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: { updates: { 'agent_budget.warn_pct': 85 } } });
    assert.equal(push.body.pushed.length, 1);
    const nextReport = await callApi('/api/cloud/report', { method: 'POST', headers: { 'x-machine-key': machine.body.apiKey }, body: {} });
    assert.equal(nextReport.body.policyUpdates.length, 1);
    assert.equal(nextReport.body.policyUpdates[0].path, 'agent_budget.warn_pct');
  });

  test('SC-013: the cloud database never stores API keys or prompt/response content', async () => {
    const org = createOrganization(db, 'Privacy Co');
    const machine = registerMachine(db, { orgId: org.id, name: 'm1' });
    reportMetadata(db, machine.apiKey, {
      metadata: [{ provider: 'anthropic', model: 'claude-sonnet-5', tokens: 42, cost: 0.001, latency_ms: 120 }],
    });

    const row = db.prepare('SELECT * FROM cloud_metadata WHERE machine_id = ?').get(machine.id);
    assert.deepEqual(Object.keys(row).sort(), ['cost', 'id', 'latency_ms', 'machine_id', 'model', 'provider', 'timestamp', 'tokens'].sort());
    // Structural guarantee: the table has no column that COULD hold a key or content — not just
    // "we didn't put one in this row."
    const columns = db.prepare('PRAGMA table_info(cloud_metadata)').all().map((c) => c.name);
    assert.ok(!columns.some((c) => /key|prompt|content|response/i.test(c)));
  });

  test('90-day retention deletes old metadata but keeps recent rows (T089/FR-024)', () => {
    const org = createOrganization(db, 'Retention Co');
    const machine = registerMachine(db, { orgId: org.id });
    const now = Date.now();
    const oldTs = Math.floor((now - 91 * 24 * 60 * 60 * 1000) / 1000);
    const recentTs = Math.floor(now / 1000);
    db.prepare('INSERT INTO cloud_metadata (machine_id, timestamp, provider, tokens, cost) VALUES (?, ?, ?, ?, ?)').run(machine.id, oldTs, 'anthropic', 10, 0.01);
    db.prepare('INSERT INTO cloud_metadata (machine_id, timestamp, provider, tokens, cost) VALUES (?, ?, ?, ?, ?)').run(machine.id, recentTs, 'anthropic', 10, 0.01);

    const deleted = pruneOldMetadata(db, { retentionDays: RETENTION.DEFAULT_RETENTION_DAYS, now });
    assert.equal(deleted, 1);
    const remaining = db.prepare('SELECT timestamp FROM cloud_metadata WHERE machine_id = ?').all(machine.id);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].timestamp, recentTs);
  });

  test('every mutating action lands in the audit log (T096)', async () => {
    const org = createOrganization(db, 'Audit Co');
    await createUser(db, { orgId: org.id, email: 'audit@co.com', password: 'x'.repeat(8) });
    const rows = db.prepare("SELECT action FROM cloud_audit_log WHERE org_id = ? ORDER BY id").all(org.id);
    assert.deepEqual(rows.map((r) => r.action), ['organization.create', 'user.create']);
  });
});
