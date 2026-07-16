/**
 * Tests for gateway/index.mjs — the Phase 3 assembly. Proves the FULL meter → verdict → enforce
 * loop end-to-end against an OFFLINE stub upstream (an ephemeral node:http server returning canned
 * openai-shaped usage blocks) and a ':memory:' ledger. No real provider, no network beyond
 * 127.0.0.1, no paid API.
 *
 * All three tests below share ONE assembled gateway instance (one ledger, one registry-store), so
 * they run in declared order and each uses its own agent/token to avoid cross-test cumulative-
 * usage interference on the shared ledger. The live-registry-swap test runs LAST because it
 * mutates the shared store's active route for the rest of the suite's lifetime.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assembleGateway, refreshRegistry } from '../index.mjs';
import { listEvents, queryWindow } from '../ledger.mjs';

let stub;
let stubUrl;
let hits;
let assembled;

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

before(async () => {
  hits = { routeA: 0, routeB: 0 };

  // Offline stub upstream: two "mounts" (routeA / routeB) so the live-registry-swap test can prove
  // a route change takes effect without restarting the gateway. Canned openai-wire usage blocks
  // (5 prompt + 5 completion = 10 total tokens/call) — deepseek is an openai-wire provider.
  stub = http.createServer(async (req, res) => {
    await readBody(req);
    const send = (status, obj) => {
      const payload = Buffer.from(JSON.stringify(obj));
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(payload);
    };
    if (req.url === '/routeA/chat') {
      hits.routeA += 1;
      send(200, { id: `routeA-${hits.routeA}`, usage: { prompt_tokens: 5, completion_tokens: 5 } });
      return;
    }
    if (req.url === '/routeB/chat') {
      hits.routeB += 1;
      send(200, { id: `routeB-${hits.routeB}`, usage: { prompt_tokens: 5, completion_tokens: 5 } });
      return;
    }
    send(404, { error: 'not found' });
  });
  await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve));
  stubUrl = `http://127.0.0.1:${stub.address().port}`;

  // A real BYO-key env var NAME, resolved by the gateway's default resolveKey (process.env lookup)
  // — assembleGateway doesn't override resolveKey, so this exercises the real default seam too.
  process.env.TEST_DEEPSEEK_KEY = 'sk-deepseek-test';

  const policy = {
    // Overlays deepseek's baseUrl onto the stub (routeA to start) — registry-source.mjs's
    // resolveProvider merges this over the code-default descriptor; wire stays 'openai'.
    providers: { deepseek: { baseUrl: `${stubUrl}/routeA`, keyEnv: 'TEST_DEEPSEEK_KEY' } },
    // A TINY cap for 'capagent' — just above one call's usage (10 tokens) — so the enforcement
    // test can cross it deterministically after a small, exact number of calls.
    agent_budget: { capagent: { per_5h_tokens: 11, per_week_tokens: 1_000_000 } },
  };

  assembled = await assembleGateway({ policy, tenant: 'pv', ledgerPath: ':memory:', now: Date.now() });

  assembled.runs.registerRun('tok-meter', {
    tenant: 'pv', agent: 'meterer', session: 's-meter', task: null, runId: null,
    provider: 'deepseek', model: 'deepseek-chat', tier: 'medium',
  });
  assembled.runs.registerRun('tok-cap', {
    tenant: 'pv', agent: 'capagent', session: 's-cap', task: null, runId: null,
    provider: 'deepseek', model: 'deepseek-chat', tier: 'medium',
  });
  assembled.runs.registerRun('tok-swap', {
    tenant: 'pv', agent: 'swapagent', session: 's-swap', task: null, runId: null,
    provider: 'deepseek', model: 'deepseek-chat', tier: 'medium',
  });
});

after(async () => {
  await assembled.close();
  await new Promise((resolve) => stub.close(resolve));
  delete process.env.TEST_DEEPSEEK_KEY;
});

// ─── Metering: one token-event per call, accumulated in the ledger ─────────────────────────────

test('metering: each call returns 200 and the ledger accumulates one token-event per call with parsed usage', async () => {
  for (let i = 0; i < 3; i++) {
    const res = await fetch(`${assembled.url}/chat`, {
      method: 'POST',
      headers: { 'x-gateway-token': 'tok-meter', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'deepseek-chat', messages: [] }),
    });
    assert.equal(res.status, 200);
  }

  const events = listEvents(assembled.ledger, { tenant: 'pv', agent: 'meterer' });
  assert.equal(events.length, 3);
  for (const evt of events) {
    assert.equal(evt.provider, 'deepseek');
    assert.equal(evt.wire, 'openai');
    assert.equal(evt.inputTokens, 5);
    assert.equal(evt.outputTokens, 5);
    assert.equal(evt.totalTokens, 10);
    assert.equal(evt.enforcementDecision, 'allow');
  }

  const win = queryWindow(assembled.ledger, { tenant: 'pv', agent: 'meterer' });
  assert.equal(win.runs, 3);
  assert.equal(win.totalTokens, 30);
});

// ─── Enforcement end-to-end: crossing the cap denies the NEXT call, and it never forwards ──────

test('enforcement end-to-end: exceeding the per-5h cap denies the next call with 429 and never forwards upstream', async () => {
  const hitsBefore = hits.routeA;

  // Two calls at 10 tokens each: checkVerdict is evaluated against PRIOR cumulative usage only
  // (before this request's own event is appended), so both of these are checked against 0 and 10
  // respectively — both under the 11-token cap — and both succeed.
  for (let i = 0; i < 2; i++) {
    const res = await fetch(`${assembled.url}/chat`, {
      method: 'POST',
      headers: { 'x-gateway-token': 'tok-cap', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'deepseek-chat', messages: [] }),
    });
    assert.equal(res.status, 200);
  }
  assert.equal(hits.routeA, hitsBefore + 2, 'both allowed calls reached the stub upstream');

  // Third call: prior cumulative usage is now 20, which is >= the 11-token cap → denied.
  const res3 = await fetch(`${assembled.url}/chat`, {
    method: 'POST',
    headers: { 'x-gateway-token': 'tok-cap', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'deepseek-chat', messages: [] }),
  });
  assert.equal(res3.status, 429);
  const body = await res3.json();
  // deepseek is openai-wire — denyBody's openai shape.
  assert.equal(body.error.code, 'over_budget');

  // The stub's hit-count must NOT have moved for the denied call — proves the deny short-circuited
  // BEFORE forwarding (the request never left the gateway process).
  assert.equal(hits.routeA, hitsBefore + 2, 'the denied call never reached the stub upstream');

  const events = listEvents(assembled.ledger, { tenant: 'pv', agent: 'capagent' });
  assert.equal(events.length, 3);
  const deniedEvent = events[0]; // listEvents orders newest-first; the deny was the last call made
  assert.equal(deniedEvent.enforcementDecision, 'deny');
  assert.equal(deniedEvent.capWindow, '5h');
  assert.equal(deniedEvent.upstreamStatus, null);
  assert.equal(deniedEvent.totalTokens, null);
});

// ─── Live registry swap: a request picks up a newer route with NO gateway restart ──────────────
// Runs LAST — it mutates assembled.store's active envelope for the rest of the suite.

test('live registry swap: refreshRegistry applies a newer envelope and the NEXT request uses the new route', async () => {
  const resBefore = await fetch(`${assembled.url}/chat`, {
    method: 'POST',
    headers: { 'x-gateway-token': 'tok-swap', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'deepseek-chat', messages: [] }),
  });
  assert.equal(resBefore.status, 200);
  const bodyBefore = await resBefore.json();
  assert.match(bodyBefore.id, /^routeA-/);

  const policyV2 = {
    providers: { deepseek: { baseUrl: `${stubUrl}/routeB`, keyEnv: 'TEST_DEEPSEEK_KEY' } },
  };
  const result = refreshRegistry(assembled.store, { policy: policyV2, tenant: 'pv', version: 2 });
  assert.deepEqual(result, { applied: true, version: 2 });

  // No gateway restart between these two requests — proves `registry: () => store.get()` in
  // server.mjs's handleRequest is re-resolved fresh on every request, not cached from gateway start.
  const resAfter = await fetch(`${assembled.url}/chat`, {
    method: 'POST',
    headers: { 'x-gateway-token': 'tok-swap', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'deepseek-chat', messages: [] }),
  });
  assert.equal(resAfter.status, 200);
  const bodyAfter = await resAfter.json();
  assert.match(bodyAfter.id, /^routeB-/);
});

// ─── Cost (bite: ledger cost) ───────────────────────────────────────────────
// Proves assembleGateway wires a REAL costFn end-to-end: it loads the pricing catalog from
// `config.pricingPath` once and closes over it, so a call against a priced model gets a real
// `costUsd` on its ledger event, and a call against an unpriced model gets null (never fabricated).
// Isolated in its own before/after + stub upstream so it doesn't interfere with (or depend on
// ordering of) the shared-`assembled` suite above.

let stubCost;
let stubCostUrl;
let assembledCost;
let tmpDir;
let pricingPath;

before(async () => {
  stubCost = http.createServer(async (req, res) => {
    for await (const _c of req) { /* drain the request body */ }
    const payload = Buffer.from(JSON.stringify({
      id: 'cost-1',
      usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 },
    }));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(payload);
  });
  await new Promise((resolve) => stubCost.listen(0, '127.0.0.1', resolve));
  stubCostUrl = `http://127.0.0.1:${stubCost.address().port}`;

  process.env.TEST_COST_DEEPSEEK_KEY = 'sk-deepseek-cost-test';

  tmpDir = mkdtempSync(join(tmpdir(), 'aios-gateway-cost-'));
  pricingPath = join(tmpDir, 'pricing.json');
  // $2/M input, $10/M output for the priced model; the unpriced model is deliberately absent.
  writeFileSync(pricingPath, JSON.stringify({
    deepseek: { 'deepseek-priced': { inputPerM: 2, outputPerM: 10 } },
  }));

  const policy = {
    providers: { deepseek: { baseUrl: stubCostUrl, keyEnv: 'TEST_COST_DEEPSEEK_KEY' } },
  };
  assembledCost = await assembleGateway({
    config: { pricingPath },
    policy,
    tenant: 'pv',
    ledgerPath: ':memory:',
    now: Date.now(),
  });

  assembledCost.runs.registerRun('tok-priced', {
    tenant: 'pv', agent: 'costagent', session: 's-priced', task: null, runId: null,
    provider: 'deepseek', model: 'deepseek-priced', tier: 'medium',
  });
  assembledCost.runs.registerRun('tok-unpriced', {
    tenant: 'pv', agent: 'costagent', session: 's-unpriced', task: null, runId: null,
    provider: 'deepseek', model: 'deepseek-unpriced', tier: 'medium',
  });
});

after(async () => {
  await assembledCost.close();
  await new Promise((resolve) => stubCost.close(resolve));
  delete process.env.TEST_COST_DEEPSEEK_KEY;
  rmSync(tmpDir, { recursive: true, force: true });
});

test('cost end-to-end: a call against a priced model gets a real costUsd computed from the catalog', async () => {
  const res = await fetch(`${assembledCost.url}/chat`, {
    method: 'POST',
    headers: { 'x-gateway-token': 'tok-priced', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'deepseek-priced', messages: [] }),
  });
  assert.equal(res.status, 200);

  const events = listEvents(assembledCost.ledger, { tenant: 'pv', agent: 'costagent' });
  const evt = events.find((e) => e.session === 's-priced');
  assert.equal(evt.inputTokens, 1_000_000);
  assert.equal(evt.outputTokens, 1_000_000);
  // 1M in * $2/M + 1M out * $10/M = $12.
  assert.equal(evt.costUsd, 12);
});

test('cost end-to-end: a call against a model absent from the catalog gets costUsd: null, never fabricated', async () => {
  const res = await fetch(`${assembledCost.url}/chat`, {
    method: 'POST',
    headers: { 'x-gateway-token': 'tok-unpriced', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'deepseek-unpriced', messages: [] }),
  });
  assert.equal(res.status, 200);

  const events = listEvents(assembledCost.ledger, { tenant: 'pv', agent: 'costagent' });
  const evt = events.find((e) => e.session === 's-unpriced');
  assert.equal(evt.costUsd, null);
});

test('assembleGateway with no config at all still assembles fine and yields costUsd: null (no crash on a missing pricing path)', async () => {
  const stubNoConfig = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'nc-1', usage: { prompt_tokens: 5, completion_tokens: 5 } }));
  });
  await new Promise((resolve) => stubNoConfig.listen(0, '127.0.0.1', resolve));
  const noConfigUrl = `http://127.0.0.1:${stubNoConfig.address().port}`;
  process.env.TEST_NOCONFIG_KEY = 'sk-noconfig-test';

  const assembledNoConfig = await assembleGateway({
    // NO `config` passed at all — matches the shared-`assembled` fixture above.
    policy: { providers: { deepseek: { baseUrl: noConfigUrl, keyEnv: 'TEST_NOCONFIG_KEY' } } },
    tenant: 'pv',
    ledgerPath: ':memory:',
    now: Date.now(),
  });
  try {
    assembledNoConfig.runs.registerRun('tok-nc', {
      tenant: 'pv', agent: 'ncagent', session: 's-nc', task: null, runId: null,
      provider: 'deepseek', model: 'deepseek-chat', tier: 'medium',
    });
    const res = await fetch(`${assembledNoConfig.url}/chat`, {
      method: 'POST',
      headers: { 'x-gateway-token': 'tok-nc', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'deepseek-chat', messages: [] }),
    });
    assert.equal(res.status, 200);
    const events = listEvents(assembledNoConfig.ledger, { tenant: 'pv', agent: 'ncagent' });
    assert.equal(events[0].costUsd, null);
  } finally {
    await assembledNoConfig.close();
    await new Promise((resolve) => stubNoConfig.close(resolve));
    delete process.env.TEST_NOCONFIG_KEY;
  }
});
