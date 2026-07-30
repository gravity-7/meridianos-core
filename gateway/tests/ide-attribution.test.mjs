/**
 * Integration test: gateway IDE traffic attribution and subscription billing end-to-end.
 *
 * Boots the full gateway HTTP server with a stub upstream, drives requests through
 * handleRequest → emitEvent, and asserts token events are correctly recorded with
 * ideName, billingType, and source fields.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { PROVIDERS } from '../../providers.mjs';
import { validateProviderRegistry } from '../../gateway/provider-registry.mjs';
import { createRunRegistry } from '../../gateway/run-registry.mjs';
import { startGateway } from '../../gateway/server.mjs';

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
    const send = (status, obj) => {
      const payload = Buffer.from(JSON.stringify(obj));
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(payload);
    };
    // All upstream requests get a valid Anthropic response with usage
    send(200, {
      id: 'msg_ide_1',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello from test' }],
      model: 'claude-sonnet-5-20250915',
      usage: { input_tokens: 50, output_tokens: 30 },
      stop_reason: 'end_turn',
    });
  });

  await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve));
  stubUrl = `http://127.0.0.1:${stub.address().port}`;

  // Build registry with subscription provider
  const registry = {
    version: 1,
    generatedAt: new Date().toISOString(),
    tenant: 'pv',
    providers: {
      anthropic: PROVIDERS.anthropic,
      'anthropic-sub': { ...PROVIDERS.anthropic, name: 'anthropic-sub' },
    },
    routes: {
      anthropic: { upstreamUrl: stubUrl, wire: 'anthropic', keyEnv: 'TEST_ANTHROPIC_KEY' },
      'anthropic-sub': {
        upstreamUrl: stubUrl,
        wire: 'anthropic',
        keyEnv: 'TEST_ANTHROPIC_KEY',
        auth: { mode: 'subscription', planName: 'Claude Pro', monthlyCostUsd: 20 },
      },
    },
  };
  assert.equal(validateProviderRegistry(registry), true);

  runs = createRunRegistry();
  runs.registerRun('tok-agent', { tenant: 'pv', agent: 'builder', session: 's1', task: 't1', runId: 'r1', provider: 'anthropic', model: 'claude-sonnet-5', tier: 'medium' });
  runs.registerRun('tok-ide-copilot', { tenant: 'pv', agent: 'vscode', session: 's2', task: null, runId: null, provider: 'anthropic', model: 'claude-sonnet-5', tier: 'medium' });
  runs.registerRun('tok-ide-claude', { tenant: 'pv', agent: 'claude-code', session: 's3', task: null, runId: null, provider: 'anthropic', model: 'claude-sonnet-5', tier: 'medium' });
  runs.registerRun('tok-sub', { tenant: 'pv', agent: 'claude-code', session: 's4', task: null, runId: null, provider: 'anthropic-sub', model: 'claude-sonnet-5', tier: 'medium' });

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

// ─── Helper ─────────────────────────────────────────────────────────────────

function req(token, headers = {}) {
  const body = JSON.stringify({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: 'hi' }], max_tokens: 10 });
  return fetch(`${gateway.url}/anthropic`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...headers },
    body,
  });
}

function reqSub(token, headers = {}) {
  const body = JSON.stringify({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: 'hi' }], max_tokens: 10 });
  return fetch(`${gateway.url}/anthropic-sub`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...headers },
    body,
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

test('agent traffic records source=agent, ideName=null, billingType=api_key', async () => {
  const before = events.length;
  const res = await req('tok-agent');
  assert.equal(res.status, 200);
  assert.ok(events.length > before, 'should emit at least one token event');
  const evt = events[events.length - 1];
  assert.equal(evt.source, 'agent');
  assert.equal(evt.ideName, null);
  assert.equal(evt.billingType, 'api_key');
});

test('IDE traffic with x-meridianos-source=ide and x-meridianos-ide-name=vscode-copilot', async () => {
  const before = events.length;
  const res = await req('tok-ide-copilot', {
    'x-meridianos-source': 'ide',
    'x-meridianos-ide-name': 'vscode-copilot',
  });
  assert.equal(res.status, 200);
  assert.ok(events.length > before);
  const evt = events[events.length - 1];
  assert.equal(evt.source, 'ide');
  assert.equal(evt.ideName, 'vscode-copilot');
  assert.equal(evt.billingType, 'api_key');
});

test('IDE traffic with claude-code ide name', async () => {
  const before = events.length;
  const res = await req('tok-ide-claude', {
    'x-meridianos-source': 'ide',
    'x-meridianos-ide-name': 'claude-code',
  });
  assert.equal(res.status, 200);
  assert.ok(events.length > before);
  const evt = events[events.length - 1];
  assert.equal(evt.source, 'ide');
  assert.equal(evt.ideName, 'claude-code');
});

test('unknown ide name falls back to unknown-ide', async () => {
  const before = events.length;
  const res = await req('tok-ide-copilot', {
    'x-meridianos-source': 'ide',
    'x-meridianos-ide-name': 'random-editor',
  });
  assert.equal(res.status, 200);
  assert.ok(events.length > before);
  const evt = events[events.length - 1];
  assert.equal(evt.source, 'ide');
  assert.equal(evt.ideName, 'unknown-ide');
});

test('subscription route records billing_type=subscription', async () => {
  const before = events.length;
  const res = await reqSub('tok-sub', {
    'x-meridianos-source': 'ide',
    'x-meridianos-ide-name': 'claude-code',
  });
  assert.equal(res.status, 200);
  assert.ok(events.length > before);
  const evt = events[events.length - 1];
  assert.equal(evt.source, 'ide');
  assert.equal(evt.ideName, 'claude-code');
  assert.equal(evt.billingType, 'subscription');
});

test('unknown token returns 401', async () => {
  const res = await req('tok-nonexistent');
  assert.equal(res.status, 401);
});

test('event has all required fields populated', async () => {
  const before = events.length;
  const res = await req('tok-agent');
  assert.equal(res.status, 200);
  assert.ok(events.length > before);
  const evt = events[events.length - 1];
  assert.ok(evt.id);
  assert.ok(evt.ts);
  assert.equal(evt.tenant, 'pv');
  assert.equal(evt.provider, 'anthropic');
  assert.equal(evt.wire, 'anthropic');
  assert.ok('source' in evt);
  assert.ok('ideName' in evt);
  assert.ok('billingType' in evt);
  assert.equal(evt.inputTokens, 50);
  assert.equal(evt.outputTokens, 30);
});
