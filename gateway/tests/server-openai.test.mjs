/**
 * server-openai.test.mjs — OpenAI wire server forwarding tests for Phase 0 (P0-F1.2)
 *
 * Tests that gateway server correctly constructs Authorization: Bearer headers
 * and forwards OpenAI-wire requests to upstream providers with token-event emission.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startGateway } from '../server.mjs';
import { makeTokenEvent } from '../token-event.mjs';

/** Create a minimal mock upstream that echoes back received headers + body */
function mockUpstream(port = 0) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          headers: req.headers,
          body: Buffer.concat(chunks).toString(),
        }));
      });
    });
    s.listen(port, '127.0.0.1', () => resolve(s));
  });
}

test('openai wire: gateway forwards with Bearer authorization header', async () => {
  const upstream = await mockUpstream(0);
  const upstreamPort = upstream.address().port;
  const upstreamUrl = `http://127.0.0.1:${upstreamPort}`;

  const registry = () => ({
    tenant: 'pv',
    generatedAt: Date.now(),
    routes: {
      deepseek: {
        upstreamUrl,
        wire: 'openai',
        keyEnv: 'DEEPSEEK_KEY',
      },
    },
  });

  const runs = {
    registerRun() {},
    resolveRun() { return { tenant: 'pv', agent: 'test-agent', session: 'test-session', task: null, runId: null, provider: 'deepseek', model: 'deepseek-chat', keyEnv: 'DEEPSEEK_KEY' }; },
    unregisterRun() {},
  };

  const events = [];
  const gw = await startGateway({
    port: 0,
    registry,
    runs,
    onTokenEvent: (evt) => events.push(evt),
    checkVerdict: () => ({ decision: 'allow' }),
    resolveKey: () => 'sk-test-openai-key',
  });

  const gwUrl = gw.url;

  try {
    // Send an OpenAI-shaped request through the gateway
    const body = JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'hello' }],
    });

    const resp = await fetch(`${gwUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-gateway-token': 'test-run-token',
      },
      body,
    });

    assert.equal(resp.status, 200);
    const echo = await resp.json();

    // The upstream should have received a Bearer token header (OpenAI auth style)
    const forwardedAuth = echo.headers['authorization'];
    assert.ok(forwardedAuth, 'Authorization header was forwarded');
    assert.ok(forwardedAuth.startsWith('Bearer '), 'Authorization uses Bearer scheme for OpenAI wire');

    // A token event should have been emitted
    assert.ok(events.length >= 1, 'at least one token event emitted');
    const evt = events[0];
    assert.equal(evt.wire, 'openai');
    assert.equal(evt.provider, 'deepseek');
    // source defaults to 'agent'
    assert.equal(evt.source, 'agent');
  } finally {
    gw.close();
    upstream.close();
  }
});

test('openai wire: unknown run token returns 401 before forwarding', async () => {
  const upstream = await mockUpstream(0);
  const upstreamPort = upstream.address().port;

  const registry = () => ({
    tenant: 'pv',
    generatedAt: Date.now(),
    routes: {
      deepseek: { upstreamUrl: `http://127.0.0.1:${upstreamPort}`, wire: 'openai', keyEnv: 'DEEPSEEK_KEY' },
    },
  });

  const events = [];
  const gw = await startGateway({
    port: 0,
    registry,
    runs: {
      registerRun() {},
      resolveRun() { return null; }, // unknown token
      unregisterRun() {},
    },
    onTokenEvent: (evt) => events.push(evt),
    checkVerdict: () => ({ decision: 'allow' }),
  });

  try {
    const resp = await fetch(`${gw.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-gateway-token': 'bad-token' },
      body: JSON.stringify({ model: 'deepseek-chat', messages: [] }),
    });

    assert.equal(resp.status, 401, 'unknown token returns 401');
  } finally {
    gw.close();
    upstream.close();
  }
});
