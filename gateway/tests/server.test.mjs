import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { PROVIDERS } from '../../providers.mjs';
import { validateProviderRegistry } from '../provider-registry.mjs';
import { createRunRegistry } from '../run-registry.mjs';
import { startGateway } from '../server.mjs';

// ─── Offline stub upstream: canned anthropic + openai responses, no real provider ever hit ────

let stub;
let stubUrl;
let gateway;
let runs;
let events;

const KEYS = { TEST_ANTHROPIC_KEY: 'sk-ant-test', TEST_DEEPSEEK_KEY: 'sk-openai-test' };

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

before(async () => {
  stub = http.createServer(async (req, res) => {
    await readBody(req);
    const send = (status, obj) => {
      const payload = Buffer.from(JSON.stringify(obj));
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(payload);
    };
    if (req.url === '/bad-json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('not-json{');
      return;
    }
    if (req.url === '/anthropic') {
      send(200, {
        id: 'msg_1',
        receivedHeaders: { xApiKey: req.headers['x-api-key'], anthropicVersion: req.headers['anthropic-version'] },
        usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 3, cache_creation_input_tokens: 1 },
      });
      return;
    }
    if (req.url === '/openai') {
      send(200, {
        id: 'chatcmpl_1',
        receivedHeaders: { authorization: req.headers['authorization'] },
        usage: { prompt_tokens: 5, completion_tokens: 7, prompt_tokens_details: { cached_tokens: 2 } },
      });
      return;
    }
    if (req.url === '/openai-no-usage') {
      send(200, { id: 'chatcmpl_2' });
      return;
    }
    send(404, { error: 'not found' });
  });
  await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve));
  stubUrl = `http://127.0.0.1:${stub.address().port}`;

  const registry = {
    version: 1,
    generatedAt: new Date().toISOString(),
    tenant: 'pv',
    providers: { anthropic: PROVIDERS.anthropic, deepseek: PROVIDERS.deepseek },
    routes: {
      anthropic: { upstreamUrl: stubUrl, wire: 'anthropic', keyEnv: 'TEST_ANTHROPIC_KEY' },
      deepseek: { upstreamUrl: stubUrl, wire: 'openai', keyEnv: 'TEST_DEEPSEEK_KEY' },
    },
  };
  assert.equal(validateProviderRegistry(registry), true);
  registry.providers.deadroute = { ...PROVIDERS.deepseek, name: 'deadroute' };
  registry.routes.deadroute = { upstreamUrl: 'http://127.0.0.1:1', wire: 'openai', keyEnv: null };

  runs = createRunRegistry();
  runs.registerRun('tok-anthropic', { tenant: 'pv', agent: 'claude', session: 's1', task: 't1', runId: 'r1', provider: 'anthropic', model: 'claude-sonnet-5', tier: 'medium' });
  runs.registerRun('tok-deepseek', { tenant: 'pv', agent: 'claude', session: 's2', task: 't2', runId: 'r2', provider: 'deepseek', model: 'deepseek-chat', tier: 'medium' });
  runs.registerRun('tok-unknown-provider', { tenant: 'pv', agent: 'claude', session: 's3', task: null, runId: null, provider: 'nope', model: 'nope-model', tier: 'medium' });
  runs.registerRun('tok-network-fail', { tenant: 'pv', agent: 'claude', session: 's4', task: null, runId: null, provider: 'deadroute', model: 'deepseek-chat', tier: 'medium' });

  events = [];
  gateway = await startGateway({
    port: 0,
    registry,
    runs,
    onTokenEvent: (evt) => events.push(evt),
    resolveKey: (k) => (k ? KEYS[k] : undefined),
    now: () => Date.now(),
  });
});

after(async () => {
  await gateway.close();
  await new Promise((resolve) => stub.close(resolve));
});

// ─── Auth ───────────────────────────────────────────────────────────────────

test('401 when no gateway token is present', async () => {
  const before_ = events.length;
  const res = await fetch(`${gateway.url}/anthropic`, { method: 'POST', body: '{}' });
  assert.equal(res.status, 401);
  assert.equal(events.length, before_);
});

test('401 when the gateway token is unknown', async () => {
  const res = await fetch(`${gateway.url}/anthropic`, {
    method: 'POST',
    headers: { 'x-gateway-token': 'bogus' },
    body: '{}',
  });
  assert.equal(res.status, 401);
});

test('accepts the token via Authorization: Bearer as well as x-gateway-token', async () => {
  const res = await fetch(`${gateway.url}/anthropic`, {
    method: 'POST',
    headers: { authorization: 'Bearer tok-anthropic' },
    body: '{}',
  });
  assert.equal(res.status, 200);
});

// ─── Anthropic wire ─────────────────────────────────────────────────────────

test('anthropic wire: injects x-api-key, passes through client anthropic-version, meters usage', async () => {
  const startCount = events.length;
  const res = await fetch(`${gateway.url}/anthropic`, {
    method: 'POST',
    headers: { 'x-gateway-token': 'tok-anthropic', 'content-type': 'application/json', 'anthropic-version': '2024-01-01' },
    body: JSON.stringify({ model: 'claude-sonnet-5', messages: [] }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.receivedHeaders.xApiKey, 'sk-ant-test');
  assert.equal(body.receivedHeaders.anthropicVersion, '2024-01-01');

  assert.equal(events.length, startCount + 1);
  const evt = events.at(-1);
  assert.equal(evt.provider, 'anthropic');
  assert.equal(evt.wire, 'anthropic');
  assert.equal(evt.model, 'claude-sonnet-5');
  assert.equal(evt.agent, 'claude');
  assert.equal(evt.session, 's1');
  assert.equal(evt.upstreamStatus, 200);
  assert.equal(typeof evt.latencyMs, 'number');
  assert.equal(evt.inputTokens, 10);
  assert.equal(evt.outputTokens, 20);
  assert.equal(evt.cacheReadTokens, 3);
  assert.equal(evt.cacheWriteTokens, 1);
  assert.equal(evt.totalTokens, 34);
  assert.equal(evt.enforcementDecision, 'allow');
  assert.equal(typeof evt.requestId, 'string');
});

test('anthropic wire: defaults anthropic-version to 2023-06-01 when the client omits it', async () => {
  const res = await fetch(`${gateway.url}/anthropic`, {
    method: 'POST',
    headers: { 'x-gateway-token': 'tok-anthropic' },
    body: '{}',
  });
  const body = await res.json();
  assert.equal(body.receivedHeaders.anthropicVersion, '2023-06-01');
});

// ─── OpenAI wire ────────────────────────────────────────────────────────────

test('openai wire: injects Authorization Bearer, meters usage including cached_tokens', async () => {
  const res = await fetch(`${gateway.url}/openai`, {
    method: 'POST',
    headers: { 'x-gateway-token': 'tok-deepseek' },
    body: '{}',
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.receivedHeaders.authorization, 'Bearer sk-openai-test');

  const evt = events.at(-1);
  assert.equal(evt.wire, 'openai');
  assert.equal(evt.provider, 'deepseek');
  assert.equal(evt.inputTokens, 5);
  assert.equal(evt.outputTokens, 7);
  assert.equal(evt.cacheReadTokens, 2);
  assert.equal(evt.cacheWriteTokens, null);
  // openai has no cache-write concept: one component (cacheWriteTokens) is always unknown, so
  // per the null-is-unknown contract totalTokens stays null rather than guessing a partial sum.
  assert.equal(evt.totalTokens, null);
});

test('null-is-unknown: usage fields are null (never 0) when the upstream response has no usage block', async () => {
  const res = await fetch(`${gateway.url}/openai-no-usage`, {
    method: 'POST',
    headers: { 'x-gateway-token': 'tok-deepseek' },
    body: '{}',
  });
  assert.equal(res.status, 200);
  const evt = events.at(-1);
  assert.equal(evt.inputTokens, null);
  assert.equal(evt.outputTokens, null);
  assert.equal(evt.cacheReadTokens, null);
  assert.equal(evt.cacheWriteTokens, null);
  assert.equal(evt.totalTokens, null);
});

// ─── Failure paths ──────────────────────────────────────────────────────────

test('502 when the run ctx points at a provider with no route, and no token-event is fabricated', async () => {
  const startCount = events.length;
  const res = await fetch(`${gateway.url}/anything`, {
    method: 'POST',
    headers: { 'x-gateway-token': 'tok-unknown-provider' },
    body: '{}',
  });
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.match(body.error, /no route/);
  assert.equal(events.length, startCount);
});

test('502 + a null-usage token-event on an upstream network failure (metering never silently skipped)', async () => {
  const startCount = events.length;
  const res = await fetch(`${gateway.url}/anything`, {
    method: 'POST',
    headers: { 'x-gateway-token': 'tok-network-fail' },
    body: '{}',
  });
  assert.equal(res.status, 502);
  assert.equal(events.length, startCount + 1);
  const evt = events.at(-1);
  assert.equal(evt.provider, 'deadroute');
  assert.equal(evt.wire, 'openai');
  assert.equal(evt.upstreamStatus, null);
  assert.equal(evt.inputTokens, null);
  assert.equal(evt.totalTokens, null);
  assert.equal(typeof evt.latencyMs, 'number');
});

test('502 + a null-usage token-event when the upstream response body cannot be parsed', async () => {
  const startCount = events.length;
  const res = await fetch(`${gateway.url}/bad-json`, {
    method: 'POST',
    headers: { 'x-gateway-token': 'tok-anthropic' },
    body: '{}',
  });
  assert.equal(res.status, 502);
  assert.equal(events.length, startCount + 1);
  const evt = events.at(-1);
  assert.equal(evt.upstreamStatus, 200);
  assert.equal(evt.inputTokens, null);
  assert.equal(evt.totalTokens, null);
});
