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
