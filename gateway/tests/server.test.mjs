import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { PROVIDERS } from '../../providers.mjs';
import { validateProviderRegistry } from '../provider-registry.mjs';
import { createRunRegistry } from '../run-registry.mjs';
import { startGateway, applyThinkingToBody } from '../server.mjs';

// ─── Offline stub upstream: canned anthropic + openai responses, no real provider ever hit ────

let stub;
let stubUrl;
let gateway;
let runs;
let events;

// ─── Enforcement (bite 3.2c): a SECOND gateway sharing the same registry/runs, but with a
// controllable `checkVerdict` stub (the main `gateway` above keeps the always-allow default, so
// every test above this comment is unaffected by anything below it). ───────────────────────────
let gatewayEnf;
let eventsEnf;
let verdictMode = { decision: 'allow', capWindow: null };

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
    const receivedRawBody = await readBody(req);
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
        receivedHeaders: { xApiKey: req.headers['x-api-key'], anthropicVersion: req.headers['anthropic-version'], acceptEncoding: req.headers['accept-encoding'] },
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
    // ─── Thinking-mode injection (echoes the RAW forwarded body back so tests can assert on
    // exactly what the gateway sent upstream, not just what it received from the client).
    if (req.url === '/echo-body') {
      send(200, { id: 'echo_1', receivedBodyRaw: receivedRawBody.toString('utf8') });
      return;
    }
    // Base-path preservation: an upstream mounted under '/prefix' must still receive the client's
    // '/v1/messages' as '/prefix/v1/messages' (see the /base-path route + token below).
    if (req.url === '/prefix/v1/messages') {
      send(200, { id: 'msg_bp', usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
      return;
    }
    // ─── SSE streaming stubs (bite 3.2b) — flush a couple of chunks with small delays to genuinely
    // simulate an incrementally-arriving stream, never buffering the whole body upstream-side either.
    const sseWrite = (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    if (req.url === '/anthropic-stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      sseWrite({ type: 'message_start', message: { id: 'msg_stream1', usage: { input_tokens: 10, cache_read_input_tokens: 3, cache_creation_input_tokens: 1, output_tokens: 1 } } });
      await delay(20);
      sseWrite({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } });
      sseWrite({ type: 'message_delta', delta: {}, usage: { output_tokens: 10 } });
      await delay(20);
      sseWrite({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'lo' } });
      sseWrite({ type: 'message_delta', delta: {}, usage: { output_tokens: 20 } });
      sseWrite({ type: 'message_stop' });
      res.end();
      return;
    }
    if (req.url === '/openai-stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      sseWrite({ id: 'chatcmpl_stream1', choices: [{ delta: { content: 'Hel' } }] });
      await delay(20);
      sseWrite({ id: 'chatcmpl_stream1', choices: [{ delta: { content: 'lo' } }] });
      await delay(20);
      sseWrite({ id: 'chatcmpl_stream1', choices: [], usage: { prompt_tokens: 5, completion_tokens: 7, prompt_tokens_details: { cached_tokens: 2 } } });
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    if (req.url === '/anthropic-stream-no-usage') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      sseWrite({ type: 'ping' });
      await delay(20);
      sseWrite({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } });
      sseWrite({ type: 'message_stop' });
      res.end();
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
    providers: { anthropic: PROVIDERS.anthropic, deepseek: PROVIDERS.deepseek, basepath: { ...PROVIDERS.anthropic, name: 'basepath' } },
    routes: {
      anthropic: { upstreamUrl: stubUrl, wire: 'anthropic', keyEnv: 'TEST_ANTHROPIC_KEY' },
      deepseek: { upstreamUrl: stubUrl, wire: 'openai', keyEnv: 'TEST_DEEPSEEK_KEY' },
      // A provider whose upstream is mounted under a base path (like DeepSeek's '…/anthropic').
      basepath: { upstreamUrl: `${stubUrl}/prefix`, wire: 'anthropic', keyEnv: 'TEST_ANTHROPIC_KEY' },
    },
  };
  assert.equal(validateProviderRegistry(registry), true);
  registry.providers.deadroute = { ...PROVIDERS.deepseek, name: 'deadroute' };
  registry.routes.deadroute = { upstreamUrl: 'http://127.0.0.1:1', wire: 'openai', keyEnv: null };

  // ─── Thinking-mode injection fixtures (gateway/server.mjs's applyThinkingToBody) — all point at
  // the '/echo-body' stub route so tests can assert on exactly what body reached the upstream.
  registry.providers['deepseek-think-openai'] = { ...PROVIDERS.deepseek, name: 'deepseek-think-openai' };
  registry.routes['deepseek-think-openai'] = { upstreamUrl: stubUrl, wire: 'openai', keyEnv: 'TEST_DEEPSEEK_KEY', thinking: { effort: 'high' } };
  registry.providers['deepseek-think-bool'] = { ...PROVIDERS.deepseek, name: 'deepseek-think-bool' };
  registry.routes['deepseek-think-bool'] = { upstreamUrl: stubUrl, wire: 'openai', keyEnv: 'TEST_DEEPSEEK_KEY', thinking: true };
  registry.providers['deepseek-think-anthropic'] = { ...PROVIDERS.deepseek, name: 'deepseek-think-anthropic' };
  registry.routes['deepseek-think-anthropic'] = { upstreamUrl: stubUrl, wire: 'anthropic', keyEnv: 'TEST_ANTHROPIC_KEY', thinking: { effort: 'high' } };
  registry.providers['echo-plain'] = { ...PROVIDERS.deepseek, name: 'echo-plain' };
  registry.routes['echo-plain'] = { upstreamUrl: stubUrl, wire: 'openai', keyEnv: 'TEST_DEEPSEEK_KEY' };
  assert.equal(validateProviderRegistry(registry), true);

  runs = createRunRegistry();
  runs.registerRun('tok-anthropic', { tenant: 'pv', agent: 'claude', session: 's1', task: 't1', runId: 'r1', provider: 'anthropic', model: 'claude-sonnet-5', tier: 'medium' });
  runs.registerRun('tok-deepseek', { tenant: 'pv', agent: 'claude', session: 's2', task: 't2', runId: 'r2', provider: 'deepseek', model: 'deepseek-chat', tier: 'medium' });
  runs.registerRun('tok-unknown-provider', { tenant: 'pv', agent: 'claude', session: 's3', task: null, runId: null, provider: 'nope', model: 'nope-model', tier: 'medium' });
  runs.registerRun('tok-network-fail', { tenant: 'pv', agent: 'claude', session: 's4', task: null, runId: null, provider: 'deadroute', model: 'deepseek-chat', tier: 'medium' });
  runs.registerRun('tok-basepath', { tenant: 'pv', agent: 'claude', session: 's5', task: null, runId: null, provider: 'basepath', model: 'claude-sonnet-5', tier: 'medium' });
  runs.registerRun('tok-think-openai', { tenant: 'pv', agent: 'claude', session: 's6', task: null, runId: null, provider: 'deepseek-think-openai', model: 'deepseek-v4-flash', tier: 'medium' });
  runs.registerRun('tok-think-bool', { tenant: 'pv', agent: 'claude', session: 's7', task: null, runId: null, provider: 'deepseek-think-bool', model: 'deepseek-v4-flash', tier: 'medium' });
  runs.registerRun('tok-think-anthropic', { tenant: 'pv', agent: 'claude', session: 's8', task: null, runId: null, provider: 'deepseek-think-anthropic', model: 'deepseek-v4-flash', tier: 'medium' });
  runs.registerRun('tok-echo-plain', { tenant: 'pv', agent: 'claude', session: 's9', task: null, runId: null, provider: 'echo-plain', model: 'deepseek-v4-flash', tier: 'medium' });

  events = [];
  gateway = await startGateway({
    port: 0,
    registry,
    runs,
    onTokenEvent: (evt) => events.push(evt),
    resolveKey: (k) => (k ? KEYS[k] : undefined),
    now: () => Date.now(),
  });

  eventsEnf = [];
  gatewayEnf = await startGateway({
    port: 0,
    registry,
    runs, // shared with `gateway` — the runs map is just data, not bound to one gateway instance
    onTokenEvent: (evt) => eventsEnf.push(evt),
    resolveKey: (k) => (k ? KEYS[k] : undefined),
    now: () => Date.now(),
    checkVerdict: (ctx) => verdictMode,
  });
});

after(async () => {
  await gateway.close();
  await gatewayEnf.close();
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

// A claude-code (anthropic-wire) run sends its ANTHROPIC_API_KEY as the x-api-key header — 3.2d's
// launcher wiring rewrites that env var to the minted gateway token, so the gateway must accept
// the token riding on x-api-key too (see gateway/inject.mjs's applyGatewayInjection).
test('accepts the token via x-api-key (the header claude-code/anthropic-wire sends its key on)', async () => {
  const res = await fetch(`${gateway.url}/anthropic`, {
    method: 'POST',
    headers: { 'x-api-key': 'tok-anthropic', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-5', messages: [] }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  // The inbound x-api-key (the gateway TOKEN) must not leak upstream as-is — the gateway resolves
  // and forwards the REAL provider key instead (buildForwardHeaders strips + re-adds x-api-key).
  assert.equal(body.receivedHeaders.xApiKey, KEYS.TEST_ANTHROPIC_KEY);
});

test('x-gateway-token takes precedence over x-api-key when both are present', async () => {
  const res = await fetch(`${gateway.url}/anthropic`, {
    method: 'POST',
    headers: { 'x-gateway-token': 'tok-anthropic', 'x-api-key': 'bogus-should-be-ignored', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-5', messages: [] }),
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

test('forces accept-encoding: identity upstream even when the client asks for gzip (so the metering parse never hits compressed bytes)', async () => {
  const res = await fetch(`${gateway.url}/anthropic`, {
    method: 'POST',
    headers: { 'x-gateway-token': 'tok-anthropic', 'accept-encoding': 'gzip, deflate, br' },
    body: '{}',
  });
  const body = await res.json();
  assert.equal(body.receivedHeaders.acceptEncoding, 'identity');
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
  // openai has no cache-write concept: a null cacheWriteTokens means "no cache-write" (0), NOT
  // "unknown", so the total is real (input+output+cacheRead+0) — it must NOT be nulled, or all
  // openai spend would vanish from downstream caps math.
  assert.equal(evt.totalTokens, 14);
});

test('preserves the upstream base path: a route mounted under /prefix gets /prefix + the request path', async () => {
  const res = await fetch(`${gateway.url}/v1/messages`, {
    method: 'POST',
    headers: { 'x-gateway-token': 'tok-basepath' },
    body: '{}',
  });
  // If the base path were dropped, the stub would 404 (it only answers '/prefix/v1/messages').
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.id, 'msg_bp');
  const evt = events.at(-1);
  assert.equal(evt.provider, 'basepath');
  assert.equal(evt.totalTokens, 3);
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

// ─── Streaming (bite 3.2b) ──────────────────────────────────────────────────
// The stub SSE routes above simulate a real streaming upstream: multiple chunks separated by a
// few ms of delay, `text/event-stream` content-type. These tests prove (a) the client receives
// the full SSE body byte-for-byte, (b) usage is parsed from the terminal event(s) per wire and
// metered EXACTLY once, and (c) bytes genuinely arrive incrementally rather than being buffered
// upstream-side and flushed as one write.

async function readStreamChunks(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push({ t: Date.now(), text: decoder.decode(value, { stream: true }) });
  }
  return chunks;
}

test('anthropic SSE streaming: client gets the full stream, usage (input/output/cache) metered exactly once', async () => {
  const startCount = events.length;
  const res = await fetch(`${gateway.url}/anthropic-stream`, {
    method: 'POST',
    headers: { 'x-gateway-token': 'tok-anthropic', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-5', messages: [], stream: true }),
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);

  const chunks = await readStreamChunks(res);
  const fullBody = chunks.map((c) => c.text).join('');
  assert.match(fullBody, /message_start/);
  assert.match(fullBody, /message_delta/);
  assert.match(fullBody, /message_stop/);

  assert.equal(events.length, startCount + 1);
  const evt = events.at(-1);
  assert.equal(evt.wire, 'anthropic');
  assert.equal(evt.upstreamStatus, 200);
  assert.equal(evt.inputTokens, 10);
  assert.equal(evt.outputTokens, 20);
  assert.equal(evt.cacheReadTokens, 3);
  assert.equal(evt.cacheWriteTokens, 1);
  assert.equal(evt.totalTokens, 34);
});

test('openai SSE streaming: client gets the full stream, usage metered exactly once', async () => {
  const startCount = events.length;
  const res = await fetch(`${gateway.url}/openai-stream`, {
    method: 'POST',
    headers: { 'x-gateway-token': 'tok-deepseek', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'deepseek-chat', messages: [], stream: true }),
  });
  assert.equal(res.status, 200);
  const chunks = await readStreamChunks(res);
  const fullBody = chunks.map((c) => c.text).join('');
  assert.match(fullBody, /\[DONE\]/);

  assert.equal(events.length, startCount + 1);
  const evt = events.at(-1);
  assert.equal(evt.wire, 'openai');
  assert.equal(evt.inputTokens, 5);
  assert.equal(evt.outputTokens, 7);
  assert.equal(evt.cacheReadTokens, 2);
  assert.equal(evt.cacheWriteTokens, null);
  assert.equal(evt.totalTokens, 14);
});

test('streaming with no usage event: all usage fields null, exactly one token-event still emitted', async () => {
  const startCount = events.length;
  const res = await fetch(`${gateway.url}/anthropic-stream-no-usage`, {
    method: 'POST',
    headers: { 'x-gateway-token': 'tok-anthropic', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-5', messages: [], stream: true }),
  });
  assert.equal(res.status, 200);
  const chunks = await readStreamChunks(res);
  assert.match(chunks.map((c) => c.text).join(''), /message_stop/);

  assert.equal(events.length, startCount + 1);
  const evt = events.at(-1);
  assert.equal(evt.inputTokens, null);
  assert.equal(evt.outputTokens, null);
  assert.equal(evt.cacheReadTokens, null);
  assert.equal(evt.cacheWriteTokens, null);
  assert.equal(evt.totalTokens, null);
});

test('streaming truly streams: the client receives bytes incrementally, not as one buffered flush', async () => {
  const reqStart = Date.now();
  const res = await fetch(`${gateway.url}/anthropic-stream`, {
    method: 'POST',
    headers: { 'x-gateway-token': 'tok-anthropic', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-5', messages: [], stream: true }),
  });
  const chunks = await readStreamChunks(res);
  assert.ok(chunks.length >= 2, `expected multiple discrete reads, got ${chunks.length}`);
  const firstT = chunks[0].t - reqStart;
  const lastT = chunks.at(-1).t - reqStart;
  // The stub spaces its writes with 20ms delays before its final write. If the gateway buffered
  // the whole upstream body before forwarding (like the non-streaming path), the client couldn't
  // start reading until the upstream had already finished — collapsing this gap to ~0. Streaming
  // means the FIRST chunk (message_start) arrives well before the LAST (message_stop).
  assert.ok(lastT - firstT >= 10, `expected a streaming gap, first=${firstT}ms last=${lastT}ms`);
});

test('non-streaming still works unchanged: a plain-JSON route still buffers+parses (regression guard)', async () => {
  const res = await fetch(`${gateway.url}/anthropic`, {
    method: 'POST',
    headers: { 'x-gateway-token': 'tok-anthropic', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-5', messages: [] }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/json');
  const body = await res.json();
  assert.equal(body.id, 'msg_1');
});

test('enforcement over streaming: a deny verdict still 429s before any streaming/forward', async () => {
  verdictMode = { decision: 'deny', capWindow: '5h' };
  const startCount = eventsEnf.length;
  const res = await fetch(`${gatewayEnf.url}/anthropic-stream`, {
    method: 'POST',
    headers: { 'x-gateway-token': 'tok-anthropic', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-5', messages: [], stream: true }),
  });
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('content-type'), 'application/json');
  const body = await res.json();
  assert.equal(body.error.type, 'rate_limit_error');

  assert.equal(eventsEnf.length, startCount + 1);
  const evt = eventsEnf.at(-1);
  assert.equal(evt.enforcementDecision, 'deny');
  assert.equal(evt.upstreamStatus, null);
  assert.equal(evt.totalTokens, null);
  verdictMode = { decision: 'allow', capWindow: null };
});

// ─── Enforcement (bite 3.2c) ────────────────────────────────────────────────
// Uses `gatewayEnf`, the second gateway instance whose `checkVerdict` reads the mutable
// `verdictMode` set in each test below. `gateway` (the always-allow default) is untouched by any
// of this, proving the default stays permissive.

test('deny verdict: anthropic wire gets a 429 in anthropic error-shape, upstream never hit, null-usage event emitted', async () => {
  verdictMode = { decision: 'deny', capWindow: '5h' };
  const startCount = eventsEnf.length;
  const res = await fetch(`${gatewayEnf.url}/anthropic`, {
    method: 'POST',
    headers: { 'x-gateway-token': 'tok-anthropic', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-5', messages: [] }),
  });
  assert.equal(res.status, 429);
  const body = await res.json();
  assert.deepEqual(body, { type: 'error', error: { type: 'rate_limit_error', message: 'gateway: over budget (5h)' } });

  assert.equal(eventsEnf.length, startCount + 1);
  const evt = eventsEnf.at(-1);
  assert.equal(evt.enforcementDecision, 'deny');
  assert.equal(evt.capWindow, '5h');
  assert.equal(evt.upstreamStatus, null);
  assert.equal(evt.inputTokens, null);
  assert.equal(evt.outputTokens, null);
  assert.equal(evt.cacheReadTokens, null);
  assert.equal(evt.cacheWriteTokens, null);
  assert.equal(evt.totalTokens, null);
  assert.equal(typeof evt.latencyMs, 'number');
  verdictMode = { decision: 'allow', capWindow: null };
});

test('deny verdict: openai wire gets a 429 in openai error-shape, upstream never hit, null-usage event emitted', async () => {
  verdictMode = { decision: 'deny', capWindow: 'week' };
  const startCount = eventsEnf.length;
  const res = await fetch(`${gatewayEnf.url}/openai`, {
    method: 'POST',
    headers: { 'x-gateway-token': 'tok-deepseek' },
    body: '{}',
  });
  assert.equal(res.status, 429);
  const body = await res.json();
  assert.deepEqual(body, {
    error: { message: 'gateway: over budget (week)', type: 'rate_limit_exceeded', code: 'over_budget' },
  });

  assert.equal(eventsEnf.length, startCount + 1);
  const evt = eventsEnf.at(-1);
  assert.equal(evt.enforcementDecision, 'deny');
  assert.equal(evt.capWindow, 'week');
  assert.equal(evt.upstreamStatus, null);
  assert.equal(evt.totalTokens, null);
  verdictMode = { decision: 'allow', capWindow: null };
});

test('deny verdict: the upstream is genuinely never contacted (a deny on a dead-address route still returns 429, not 502)', async () => {
  verdictMode = { decision: 'deny', capWindow: '5h' };
  // 'tok-network-fail' points at the 'deadroute' route, whose upstreamUrl is an address nothing
  // listens on (http://127.0.0.1:1). If the gateway forwarded despite the deny, the connection
  // failure would surface as a 502 (see the "upstream network failure" test above) — a 429 here
  // is only possible if the request never left the gateway.
  const res = await fetch(`${gatewayEnf.url}/anything`, {
    method: 'POST',
    headers: { 'x-gateway-token': 'tok-network-fail' },
    body: '{}',
  });
  assert.equal(res.status, 429);
  const body = await res.json();
  assert.equal(body.error.type, 'rate_limit_exceeded');
  verdictMode = { decision: 'allow', capWindow: null };
});

test('allow verdict: forwards normally and stamps the event with the real decision', async () => {
  verdictMode = { decision: 'allow', capWindow: null };
  const startCount = eventsEnf.length;
  const res = await fetch(`${gatewayEnf.url}/anthropic`, {
    method: 'POST',
    headers: { 'x-gateway-token': 'tok-anthropic', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-5', messages: [] }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.id, 'msg_1');

  assert.equal(eventsEnf.length, startCount + 1);
  const evt = eventsEnf.at(-1);
  assert.equal(evt.enforcementDecision, 'allow');
  assert.equal(evt.capWindow, null);
  assert.equal(evt.upstreamStatus, 200);
  assert.equal(evt.inputTokens, 10);
});

test('checkVerdict is called exactly once per request (no double ledger query)', async () => {
  let calls = 0;
  const runsOnce = createRunRegistry();
  runsOnce.registerRun('tok-once', { tenant: 'pv', agent: 'claude', session: 'sOnce', task: null, runId: null, provider: 'anthropic', model: 'claude-sonnet-5', tier: 'medium' });
  const gatewayOnce = await startGateway({
    port: 0,
    registry: {
      version: 1,
      generatedAt: new Date().toISOString(),
      tenant: 'pv',
      providers: { anthropic: PROVIDERS.anthropic },
      routes: { anthropic: { upstreamUrl: stubUrl, wire: 'anthropic', keyEnv: 'TEST_ANTHROPIC_KEY' } },
    },
    runs: runsOnce,
    onTokenEvent: () => {},
    resolveKey: (k) => (k ? KEYS[k] : undefined),
    now: () => Date.now(),
    checkVerdict: () => {
      calls += 1;
      return { decision: 'allow', capWindow: null };
    },
  });
  try {
    const res = await fetch(`${gatewayOnce.url}/anthropic`, {
      method: 'POST',
      headers: { 'x-gateway-token': 'tok-once', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-5', messages: [] }),
    });
    assert.equal(res.status, 200);
    assert.equal(calls, 1);
  } finally {
    await gatewayOnce.close();
  }
});

// ─── registry as a function (gateway/index.mjs's assembly wires a live registry-store here) ────

test('registry as a zero-arg function is resolved FRESH on every request (a live registry-store)', async () => {
  let registryValue = {
    version: 1,
    generatedAt: new Date().toISOString(),
    tenant: 'pv',
    providers: { anthropic: PROVIDERS.anthropic },
    routes: { anthropic: { upstreamUrl: stubUrl, wire: 'anthropic', keyEnv: 'TEST_ANTHROPIC_KEY' } },
  };
  const runsFn = createRunRegistry();
  runsFn.registerRun('tok-fn', { tenant: 'pv', agent: 'claude', session: 'sFn', task: null, runId: null, provider: 'anthropic', model: 'claude-sonnet-5', tier: 'medium' });
  const gatewayFn = await startGateway({
    port: 0,
    registry: () => registryValue,
    runs: runsFn,
    onTokenEvent: () => {},
    resolveKey: (k) => (k ? KEYS[k] : undefined),
    now: () => Date.now(),
  });
  try {
    const res1 = await fetch(`${gatewayFn.url}/anthropic`, {
      method: 'POST',
      headers: { 'x-gateway-token': 'tok-fn', 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(res1.status, 200);

    // Swap the underlying registry object (simulating a registry-store update) — no gateway
    // restart, no re-call to startGateway. The new route points at a dead address.
    registryValue = {
      ...registryValue,
      version: 2,
      routes: { anthropic: { upstreamUrl: 'http://127.0.0.1:1', wire: 'anthropic', keyEnv: 'TEST_ANTHROPIC_KEY' } },
    };
    const res2 = await fetch(`${gatewayFn.url}/anthropic`, {
      method: 'POST',
      headers: { 'x-gateway-token': 'tok-fn', 'content-type': 'application/json' },
      body: '{}',
    });
    // A 502 here (upstream connection failure) is only possible if handleRequest re-called the
    // registry function and picked up the NEW dead-address route — proving it isn't cached from
    // the first request (which would have returned 200 again against the still-live stub route).
    assert.equal(res2.status, 502);
  } finally {
    await gatewayFn.close();
  }
});

test('registry as a plain object still works UNCHANGED (backward compatibility)', async () => {
  const res = await fetch(`${gateway.url}/anthropic`, {
    method: 'POST',
    headers: { 'x-gateway-token': 'tok-anthropic', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-5', messages: [] }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.receivedHeaders.xApiKey, KEYS.TEST_ANTHROPIC_KEY);
});

// ─── Thinking-mode injection (policy-driven, per-provider, off-by-default) ─────────────────────
// applyThinkingToBody's unit-level contract, plus end-to-end proof (via the '/echo-body' stub
// route) that the injected body is what actually reaches the upstream.

// ─── applyThinkingToBody — unit level ──────────────────────────────────────

test('applyThinkingToBody: off by default — no route.thinking leaves the body byte-identical', () => {
  const body = Buffer.from(JSON.stringify({ model: 'x', messages: [] }));
  const out = applyThinkingToBody(body, { wire: 'openai' });
  assert.strictEqual(out, body); // same Buffer instance, not just equal bytes
});

test('applyThinkingToBody: openai wire + thinking:true injects {type:"enabled"}, no reasoning_effort', () => {
  const body = Buffer.from(JSON.stringify({ model: 'x' }));
  const out = applyThinkingToBody(body, { wire: 'openai', thinking: true });
  const parsed = JSON.parse(out.toString('utf8'));
  assert.deepEqual(parsed.thinking, { type: 'enabled' });
  assert.equal('reasoning_effort' in parsed, false);
});

test('applyThinkingToBody: openai wire + thinking:{effort} injects both thinking and reasoning_effort', () => {
  const body = Buffer.from(JSON.stringify({ model: 'x' }));
  const out = applyThinkingToBody(body, { wire: 'openai', thinking: { effort: 'high' } });
  const parsed = JSON.parse(out.toString('utf8'));
  assert.deepEqual(parsed.thinking, { type: 'enabled' });
  assert.equal(parsed.reasoning_effort, 'high');
});

test('applyThinkingToBody: anthropic wire + thinking:{effort} injects thinking but NEVER reasoning_effort or budget_tokens', () => {
  const body = Buffer.from(JSON.stringify({ model: 'x' }));
  const out = applyThinkingToBody(body, { wire: 'anthropic', thinking: { effort: 'high' } });
  const parsed = JSON.parse(out.toString('utf8'));
  assert.deepEqual(parsed.thinking, { type: 'enabled' });
  assert.equal('reasoning_effort' in parsed, false);
  assert.equal('budget_tokens' in parsed, false);
});

test('applyThinkingToBody: a client-set thinking key is never overridden', () => {
  const body = Buffer.from(JSON.stringify({ model: 'x', thinking: { type: 'custom' } }));
  const out = applyThinkingToBody(body, { wire: 'openai', thinking: { effort: 'high' } });
  assert.strictEqual(out, body);
  const parsed = JSON.parse(out.toString('utf8'));
  assert.deepEqual(parsed.thinking, { type: 'custom' });
  assert.equal('reasoning_effort' in parsed, false);
});

test('applyThinkingToBody: non-JSON body is forwarded unchanged, never throws', () => {
  const body = Buffer.from('not-json{');
  assert.doesNotThrow(() => applyThinkingToBody(body, { wire: 'openai', thinking: true }));
  const out = applyThinkingToBody(body, { wire: 'openai', thinking: true });
  assert.strictEqual(out, body);
});

test('applyThinkingToBody: empty body is forwarded unchanged, never throws', () => {
  const body = Buffer.alloc(0);
  assert.doesNotThrow(() => applyThinkingToBody(body, { wire: 'openai', thinking: true }));
  const out = applyThinkingToBody(body, { wire: 'openai', thinking: true });
  assert.strictEqual(out, body);
});

test('applyThinkingToBody: a JSON array body (not an object) is forwarded unchanged, never throws', () => {
  const body = Buffer.from(JSON.stringify([1, 2, 3]));
  const out = applyThinkingToBody(body, { wire: 'openai', thinking: true });
  assert.strictEqual(out, body);
});

test('applyThinkingToBody: a route with no `thinking` key at all is the fast off path', () => {
  const body = Buffer.from(JSON.stringify({ model: 'x' }));
  const out = applyThinkingToBody(body, {});
  assert.strictEqual(out, body);
  const out2 = applyThinkingToBody(body, undefined);
  assert.strictEqual(out2, body);
});

// ─── end-to-end through the gateway (proves what actually reaches the upstream) ────────────────

test('e2e: thinking off by default — a plain route forwards the body byte-identical', async () => {
  const sentBody = JSON.stringify({ model: 'deepseek-v4-flash', messages: [] });
  const res = await fetch(`${gateway.url}/echo-body`, {
    method: 'POST',
    headers: { 'x-gateway-token': 'tok-echo-plain', 'content-type': 'application/json' },
    body: sentBody,
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.receivedBodyRaw, sentBody);
});

test('e2e: openai-wire thinking:{effort} route injects thinking + reasoning_effort into the forwarded body', async () => {
  const res = await fetch(`${gateway.url}/echo-body`, {
    method: 'POST',
    headers: { 'x-gateway-token': 'tok-think-openai', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'deepseek-v4-flash', messages: [] }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  const forwarded = JSON.parse(body.receivedBodyRaw);
  assert.deepEqual(forwarded.thinking, { type: 'enabled' });
  assert.equal(forwarded.reasoning_effort, 'high');
});

test('e2e: openai-wire thinking:true route injects thinking with no reasoning_effort', async () => {
  const res = await fetch(`${gateway.url}/echo-body`, {
    method: 'POST',
    headers: { 'x-gateway-token': 'tok-think-bool', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'deepseek-v4-flash', messages: [] }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  const forwarded = JSON.parse(body.receivedBodyRaw);
  assert.deepEqual(forwarded.thinking, { type: 'enabled' });
  assert.equal('reasoning_effort' in forwarded, false);
});

test('e2e: anthropic-wire thinking:{effort} route injects thinking but never reasoning_effort or budget_tokens', async () => {
  const res = await fetch(`${gateway.url}/echo-body`, {
    method: 'POST',
    headers: { 'x-gateway-token': 'tok-think-anthropic', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'deepseek-v4-pro', messages: [] }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  const forwarded = JSON.parse(body.receivedBodyRaw);
  assert.deepEqual(forwarded.thinking, { type: 'enabled' });
  assert.equal('reasoning_effort' in forwarded, false);
  assert.equal('budget_tokens' in forwarded, false);
});

test('e2e: a client-set thinking value survives untouched even on a thinking-enabled route', async () => {
  const res = await fetch(`${gateway.url}/echo-body`, {
    method: 'POST',
    headers: { 'x-gateway-token': 'tok-think-openai', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'deepseek-v4-flash', messages: [], thinking: { type: 'client-chosen' } }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  const forwarded = JSON.parse(body.receivedBodyRaw);
  assert.deepEqual(forwarded.thinking, { type: 'client-chosen' });
  assert.equal('reasoning_effort' in forwarded, false);
});

// ─── Cost (bite: ledger cost) ───────────────────────────────────────────────
// `costFn` is a pricing SEAM injected into startGateway (never a pricing.mjs import in server.mjs
// itself — see assembleGateway in index.mjs for the real wiring). Default is `() => null`, so a
// gateway started without one stays byte-identical to before `costUsd` existed.

test('default (no costFn): costUsd stays null — byte-identical to before cost existed', async () => {
  // `gateway` (the shared fixture above) is started with no costFn at all.
  const res = await fetch(`${gateway.url}/anthropic`, {
    method: 'POST',
    headers: { 'x-gateway-token': 'tok-anthropic', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-5', messages: [] }),
  });
  assert.equal(res.status, 200);
  const evt = events.at(-1);
  assert.equal(evt.costUsd, null);
});

test('a costFn(): => null (explicit) also yields costUsd null', async () => {
  const runsCost = createRunRegistry();
  runsCost.registerRun('tok-cost-null', { tenant: 'pv', agent: 'claude', session: 'sCostNull', task: null, runId: null, provider: 'anthropic', model: 'claude-sonnet-5', tier: 'medium' });
  const eventsCost = [];
  const gatewayCost = await startGateway({
    port: 0,
    registry: {
      version: 1,
      generatedAt: new Date().toISOString(),
      tenant: 'pv',
      providers: { anthropic: PROVIDERS.anthropic },
      routes: { anthropic: { upstreamUrl: stubUrl, wire: 'anthropic', keyEnv: 'TEST_ANTHROPIC_KEY' } },
    },
    runs: runsCost,
    onTokenEvent: (evt) => eventsCost.push(evt),
    resolveKey: (k) => (k ? KEYS[k] : undefined),
    now: () => Date.now(),
    costFn: () => null,
  });
  try {
    const res = await fetch(`${gatewayCost.url}/anthropic`, {
      method: 'POST',
      headers: { 'x-gateway-token': 'tok-cost-null', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-5', messages: [] }),
    });
    assert.equal(res.status, 200);
    assert.equal(eventsCost.at(-1).costUsd, null);
  } finally {
    await gatewayCost.close();
  }
});

test('a real costFn computes costUsd from the metered usage on the buffered path', async () => {
  const runsCost = createRunRegistry();
  runsCost.registerRun('tok-cost-buf', { tenant: 'pv', agent: 'claude', session: 'sCostBuf', task: null, runId: null, provider: 'anthropic', model: 'claude-sonnet-5', tier: 'medium' });
  const eventsCost = [];
  const seen = [];
  const gatewayCost = await startGateway({
    port: 0,
    registry: {
      version: 1,
      generatedAt: new Date().toISOString(),
      tenant: 'pv',
      providers: { anthropic: PROVIDERS.anthropic },
      routes: { anthropic: { upstreamUrl: stubUrl, wire: 'anthropic', keyEnv: 'TEST_ANTHROPIC_KEY' } },
    },
    runs: runsCost,
    onTokenEvent: (evt) => eventsCost.push(evt),
    resolveKey: (k) => (k ? KEYS[k] : undefined),
    now: () => Date.now(),
    // The /anthropic stub route returns usage: { input_tokens: 10, output_tokens: 20, ... }.
    costFn: (provider, model, usage) => {
      seen.push({ provider, model, usage });
      return (usage.outputTokens ?? 0) * 0.001;
    },
  });
  try {
    const res = await fetch(`${gatewayCost.url}/anthropic`, {
      method: 'POST',
      headers: { 'x-gateway-token': 'tok-cost-buf', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-5', messages: [] }),
    });
    assert.equal(res.status, 200);
    const evt = eventsCost.at(-1);
    assert.equal(evt.outputTokens, 20);
    assert.equal(evt.costUsd, 0.02); // 20 * 0.001
    assert.equal(seen.length, 1);
    assert.equal(seen[0].provider, 'anthropic');
    assert.equal(seen[0].model, 'claude-sonnet-5');
    assert.equal(seen[0].usage.inputTokens, 10);
    assert.equal(seen[0].usage.outputTokens, 20);
  } finally {
    await gatewayCost.close();
  }
});

test('a real costFn computes costUsd from the metered usage on the streaming path', async () => {
  const runsCost = createRunRegistry();
  runsCost.registerRun('tok-cost-stream', { tenant: 'pv', agent: 'claude', session: 'sCostStream', task: null, runId: null, provider: 'anthropic', model: 'claude-sonnet-5', tier: 'medium' });
  const eventsCost = [];
  const gatewayCost = await startGateway({
    port: 0,
    registry: {
      version: 1,
      generatedAt: new Date().toISOString(),
      tenant: 'pv',
      providers: { anthropic: PROVIDERS.anthropic },
      routes: { anthropic: { upstreamUrl: stubUrl, wire: 'anthropic', keyEnv: 'TEST_ANTHROPIC_KEY' } },
    },
    runs: runsCost,
    onTokenEvent: (evt) => eventsCost.push(evt),
    resolveKey: (k) => (k ? KEYS[k] : undefined),
    now: () => Date.now(),
    // /anthropic-stream terminates with input=10, output=20 (see the stub's message_delta events).
    costFn: (provider, model, usage) => (usage.outputTokens ?? 0) * 0.001,
  });
  try {
    const res = await fetch(`${gatewayCost.url}/anthropic-stream`, {
      method: 'POST',
      headers: { 'x-gateway-token': 'tok-cost-stream', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-5', messages: [], stream: true }),
    });
    assert.equal(res.status, 200);
    // Drain the stream so the terminal usage is captured and the token-event emitted.
    const reader = res.body.getReader();
    while (!(await reader.read()).done) {}
    const evt = eventsCost.at(-1);
    assert.equal(evt.outputTokens, 20);
    assert.equal(evt.costUsd, 0.02);
  } finally {
    await gatewayCost.close();
  }
});

test('a throwing costFn does not break the request: costUsd is null but the event still emits and the response still succeeds', async () => {
  const runsCost = createRunRegistry();
  runsCost.registerRun('tok-cost-throw', { tenant: 'pv', agent: 'claude', session: 'sCostThrow', task: null, runId: null, provider: 'anthropic', model: 'claude-sonnet-5', tier: 'medium' });
  const eventsCost = [];
  const gatewayCost = await startGateway({
    port: 0,
    registry: {
      version: 1,
      generatedAt: new Date().toISOString(),
      tenant: 'pv',
      providers: { anthropic: PROVIDERS.anthropic },
      routes: { anthropic: { upstreamUrl: stubUrl, wire: 'anthropic', keyEnv: 'TEST_ANTHROPIC_KEY' } },
    },
    runs: runsCost,
    onTokenEvent: (evt) => eventsCost.push(evt),
    resolveKey: (k) => (k ? KEYS[k] : undefined),
    now: () => Date.now(),
    costFn: () => { throw new Error('boom: bad pricing catalog'); },
  });
  try {
    const res = await fetch(`${gatewayCost.url}/anthropic`, {
      method: 'POST',
      headers: { 'x-gateway-token': 'tok-cost-throw', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-5', messages: [] }),
    });
    assert.equal(res.status, 200);
    assert.equal(eventsCost.length, 1);
    const evt = eventsCost.at(-1);
    assert.equal(evt.costUsd, null);
    assert.equal(evt.outputTokens, 20); // metering itself is unaffected by the costFn failure
  } finally {
    await gatewayCost.close();
  }
});

test('a throwing costFn on a deny verdict still emits a null-cost event (costFn threading covers the deny path too)', async () => {
  const runsCost = createRunRegistry();
  runsCost.registerRun('tok-cost-deny', { tenant: 'pv', agent: 'claude', session: 'sCostDeny', task: null, runId: null, provider: 'anthropic', model: 'claude-sonnet-5', tier: 'medium' });
  const eventsCost = [];
  const gatewayCost = await startGateway({
    port: 0,
    registry: {
      version: 1,
      generatedAt: new Date().toISOString(),
      tenant: 'pv',
      providers: { anthropic: PROVIDERS.anthropic },
      routes: { anthropic: { upstreamUrl: stubUrl, wire: 'anthropic', keyEnv: 'TEST_ANTHROPIC_KEY' } },
    },
    runs: runsCost,
    onTokenEvent: (evt) => eventsCost.push(evt),
    resolveKey: (k) => (k ? KEYS[k] : undefined),
    now: () => Date.now(),
    checkVerdict: () => ({ decision: 'deny', capWindow: '5h' }),
    costFn: () => { throw new Error('boom'); },
  });
  try {
    const res = await fetch(`${gatewayCost.url}/anthropic`, {
      method: 'POST',
      headers: { 'x-gateway-token': 'tok-cost-deny', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-5', messages: [] }),
    });
    assert.equal(res.status, 429);
    assert.equal(eventsCost.length, 1);
    assert.equal(eventsCost.at(-1).costUsd, null);
    assert.equal(eventsCost.at(-1).enforcementDecision, 'deny');
  } finally {
    await gatewayCost.close();
  }
});
