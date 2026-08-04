/**
 * cloud-chaos.test.mjs — code-review follow-up: "Add chaos engineering tests for cloud
 * connectivity." Deliberately injects the failure modes a real network/cloud service produces —
 * timeouts, resets, malformed responses, a server that's actually gone — into
 * cloud/local-agent.mjs, and asserts the ONE invariant that matters for a background agent: it
 * never throws, never corrupts local state, and recovers cleanly the moment things work again.
 * (tests/cloud-agent.test.mjs already covers the HAPPY path end-to-end; this file is only the
 * unhappy ones.)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createLocalAgent } from '../cloud/local-agent.mjs';
import { createCloudServer, openCloudDb } from '../cloud/cloud-server.mjs';
import { createOrganization, registerMachine } from '../cloud/cloud-control-plane.mjs';
import { resolvePaths } from '../config.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';

function makeConfig() {
  const repoRoot = mkdtempSync(join(tmpdir(), 'cloud-chaos-'));
  mkdirSync(join(repoRoot, '.ai'), { recursive: true });
  return resolvePaths({ root: repoRoot, domain: FIXTURE_DOMAIN });
}

function fakeLogger() {
  const errors = [];
  return { log() {}, error: (_tag, msg, err) => errors.push({ msg, err }), errors };
}

describe('chaos: local agent vs. a broken network', () => {
  test('an intermittently failing network recovers automatically on its own next cycle', async () => {
    const config = makeConfig();
    let call = 0;
    const flaky = async () => {
      call++;
      if (call <= 2) throw new Error('ECONNREFUSED: connection refused');
      return { ok: true, json: async () => ({ ok: true, policyUpdates: [] }) };
    };
    const logger = fakeLogger();
    const agent = createLocalAgent({ config, cloudUrl: 'http://cloud.example', machineApiKey: 'mck-x', fetchImpl: flaky, logger });

    await agent.reportOnce();
    assert.equal(agent.getStatus().connected, false);
    await agent.reportOnce();
    assert.equal(agent.getStatus().connected, false);
    await agent.reportOnce();
    assert.equal(agent.getStatus().connected, true, 'the 3rd cycle should succeed and flip connected back to true');
    assert.equal(agent.getStatus().lastError, null);
  });

  test('a malformed (non-JSON) response body is treated as a failed report, not a crash', async () => {
    const config = makeConfig();
    const brokenJson = async () => ({ ok: true, json: async () => { throw new SyntaxError('Unexpected token < in JSON at position 0'); } });
    const agent = createLocalAgent({ config, cloudUrl: 'http://cloud.example', machineApiKey: 'mck-x', fetchImpl: brokenJson });

    await assert.doesNotReject(() => agent.reportOnce());
    const status = agent.getStatus();
    assert.equal(status.connected, false);
    assert.match(status.lastError, /Unexpected token/);
  });

  test('the cloud server returning {ok:false} (e.g. an unknown machine key) is a graceful failure', async () => {
    const config = makeConfig();
    const rejected = async () => ({ ok: true, json: async () => ({ ok: false, error: 'unknown machine API key' }) });
    const agent = createLocalAgent({ config, cloudUrl: 'http://cloud.example', machineApiKey: 'mck-revoked', fetchImpl: rejected });

    await agent.reportOnce();
    assert.equal(agent.getStatus().connected, false);
    assert.match(agent.getStatus().lastError, /unknown machine API key/);
  });

  test('a mid-request connection reset (ECONNRESET) does not throw out of reportOnce', async () => {
    const config = makeConfig();
    const reset = async () => { const e = new Error('socket hang up'); e.code = 'ECONNRESET'; throw e; };
    const agent = createLocalAgent({ config, cloudUrl: 'http://cloud.example', machineApiKey: 'mck-x', fetchImpl: reset });

    await assert.doesNotReject(() => agent.reportOnce());
    assert.match(agent.getStatus().lastError, /ECONNRESET|socket hang up/);
  });

  test('a request that times out (AbortError) is handled the same as any other failure', async () => {
    const config = makeConfig();
    const timeout = async () => { const e = new Error('This operation was aborted'); e.name = 'AbortError'; throw e; };
    const agent = createLocalAgent({ config, cloudUrl: 'http://cloud.example', machineApiKey: 'mck-x', fetchImpl: timeout });

    await assert.doesNotReject(() => agent.reportOnce());
    assert.equal(agent.getStatus().connected, false);
    assert.match(agent.getStatus().lastError, /aborted/i);
  });

  test('a malformed policyUpdates entry (missing path/value) is skipped without crashing the report', async () => {
    const config = makeConfig();
    const weird = async () => ({ ok: true, json: async () => ({ ok: true, policyUpdates: [{ id: 'u1' }, { path: 'agent_budget.warn_pct', value: 77 }] }) });
    const logger = fakeLogger();
    const agent = createLocalAgent({ config, cloudUrl: 'http://cloud.example', machineApiKey: 'mck-x', fetchImpl: weird, logger });

    await assert.doesNotReject(() => agent.reportOnce());
    assert.equal(agent.getStatus().connected, true, 'a bad policyUpdates entry must not fail the WHOLE report — only that one update');

    const { loadPolicy } = await import('../budget.mjs');
    const policy = loadPolicy(undefined, config);
    assert.equal(policy.agent_budget.warn_pct, 77, 'the well-formed sibling update must still apply');
  });

  test('repeated failures across many cycles never leak unhandled rejections or throw', async () => {
    const config = makeConfig();
    let n = 0;
    const alwaysFails = async () => { n++; throw new Error(`simulated outage #${n}`); };
    const agent = createLocalAgent({ config, cloudUrl: 'http://cloud.example', machineApiKey: 'mck-x', fetchImpl: alwaysFails });

    for (let i = 0; i < 10; i++) {
      await assert.doesNotReject(() => agent.reportOnce());
    }
    assert.equal(n, 10);
    assert.equal(agent.getStatus().connected, false);
  });

  test('a ledger that cannot be opened does not prevent the (empty-metadata) report from being attempted', async () => {
    const config = makeConfig();
    // Make .ai a FILE instead of a directory so openLedger inside reportOnce cannot create its DB.
    const { writeFileSync, rmSync } = await import('node:fs');
    rmSync(join(config.repoRoot, '.ai'), { recursive: true, force: true });
    writeFileSync(join(config.repoRoot, '.ai'), 'not a directory');

    let captured;
    const capture = async (url, opts) => { captured = JSON.parse(opts.body); return { ok: true, json: async () => ({ ok: true, policyUpdates: [] }) }; };
    const agent = createLocalAgent({ config, cloudUrl: 'http://cloud.example', machineApiKey: 'mck-x', fetchImpl: capture });

    await assert.doesNotReject(() => agent.reportOnce());
    assert.deepEqual(captured.metadata, [], 'an unreadable ledger degrades to an empty metadata batch, not a crash');
  });
});

describe('chaos: local agent vs. a cloud server that actually goes away', () => {
  test('a real server, live for one successful report, then genuinely gone — the agent survives both', async () => {
    const config = makeConfig();
    const db = openCloudDb(':memory:');
    const server = createCloudServer(db);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const org = createOrganization(db, 'Chaos Co');
    const machine = registerMachine(db, { orgId: org.id });

    const agent = createLocalAgent({ config, cloudUrl: `http://127.0.0.1:${port}`, machineApiKey: machine.apiKey, reportingIntervalSec: 30 });

    await agent.reportOnce();
    assert.equal(agent.getStatus().connected, true, 'sanity check: the real server answers while it is up');

    // Force-close every live connection (not just stop accepting new ones) — plain server.close()
    // waits for keep-alive sockets to end on their own, which a pooled fetch() client can hold
    // open well past the point a real "the service is gone" scenario would. closeAllConnections()
    // (Node 18.2+) is the actual "the process died" simulation.
    await new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); });

    await assert.doesNotReject(() => agent.reportOnce());
    // `connected` is intentionally debounced against a single blip (it's true if ANY report
    // succeeded within the last 3 reporting intervals — see getStatusSnapshot — so the dashboard
    // indicator doesn't flap to "disconnected" on one transient failure right after a success).
    // `lastError`, in contrast, reflects the MOST RECENT attempt precisely — that's the field this
    // chaos scenario actually needs to prove got captured.
    assert.ok(agent.getStatus().lastError, 'a connection-refused error must be captured, not silently swallowed');
    assert.match(agent.getStatus().lastError, /fetch failed|ECONNREFUSED|ECONNRESET/i);
  });
});
