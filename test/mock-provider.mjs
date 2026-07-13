/**
 * mock-provider — a zero-dependency local HTTP server that speaks both LLM wire formats the
 * AIOS understands (providers.mjs's `wire`): OpenAI (`POST /v1/chat/completions`) and Anthropic
 * (`POST /v1/messages`, plus `POST /anthropic/v1/messages` — mirrors DeepSeek's real
 * `anthropicBaseUrl` layout of `<baseUrl>/anthropic` + the harness always appending `/v1/messages`).
 *
 * Exists so provider/harness integration (wire-format request shaping, response parsing, usage
 * extraction, error handling, streaming) can be exercised in CI for $0 and with no network beyond
 * localhost — no provider account, no API key, no live spend. It is a stand-in for a real
 * OpenAI-format or Anthropic-format endpoint, not a model: replies are canned, not generated.
 *
 * Two independent axes:
 *   - `stream` (per-request, from the request body) — non-streaming JSON vs SSE.
 *   - `scenario` (server-wide default via `setScenario`, or per-request via the
 *     `X-Mock-Scenario` header) — success (default/null) or a named edge shape:
 *     `401` | `402` | `429` | `500` | `malformed`. The header lets a single running server serve
 *     a normal response to one request and an injected failure to the next (conformance.mjs's
 *     error-shape check uses this) without a stop/reconfigure/restart cycle.
 *
 * Usage fields on success responses use each wire's real field names (OpenAI:
 * prompt_tokens/completion_tokens/total_tokens; Anthropic: input_tokens/output_tokens) so 1.6
 * (post-hoc token metering) can assert against this mock deterministically.
 */
import { createServer } from 'node:http';

const DEFAULT_USAGE = { promptTokens: 12, completionTokens: 34 };

// ─── Error-shape bodies (realistic per wire, per scenario) ─────────────────────────────────

const ERROR_SCENARIOS = {
  401: {
    status: 401,
    openai: { error: { message: 'Invalid API key provided', type: 'invalid_request_error', code: 'invalid_api_key' } },
    anthropic: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } },
  },
  402: {
    status: 402,
    openai: { error: { message: 'Insufficient Balance', type: 'insufficient_balance', code: 'insufficient_balance' } },
    anthropic: { type: 'error', error: { type: 'insufficient_balance', message: 'Insufficient Balance' } },
  },
  429: {
    status: 429,
    openai: { error: { message: 'Rate limit exceeded', type: 'rate_limit_error', code: 'rate_limit_exceeded' } },
    anthropic: { type: 'error', error: { type: 'rate_limit_error', message: 'Number of request tokens has exceeded your rate limit' } },
  },
  500: {
    status: 500,
    openai: { error: { message: 'Internal server error', type: 'server_error', code: null } },
    anthropic: { type: 'error', error: { type: 'api_error', message: 'Internal server error' } },
  },
};

// ─── Server ─────────────────────────────────────────────────────────────────────────────────

/**
 * Starts the mock server on an ephemeral loopback port. Returns a control handle:
 *   { url, server, setScenario(scenario), setUsage(partial), setResponseText(text), close() }
 * `scenario` is the server-wide default (used when a request carries no `X-Mock-Scenario`
 * header); pass `null` (default) for normal success behavior.
 */
export function startMockProvider({ scenario = null, usage = {}, responseText = 'Mock response.' } = {}) {
  const state = { scenario, usage: { ...DEFAULT_USAGE, ...usage }, responseText };

  const server = createServer((req, res) => {
    if (req.method !== 'POST') { res.writeHead(404).end(); return; }
    const wire = wireForPath(req.url);
    if (!wire) { res.writeHead(404).end(); return; }

    readJsonBody(req)
      .then((body) => handleRequest({ wire, body, req, res, state }))
      .catch((err) => {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: `bad request body: ${err.message}`, type: 'invalid_request_error' } }));
      });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        server,
        setScenario(s) { state.scenario = s; },
        setUsage(u) { state.usage = { ...state.usage, ...u }; },
        setResponseText(t) { state.responseText = t; },
        close() { return new Promise((res2) => server.close(() => res2())); },
      });
    });
  });
}

function wireForPath(url) {
  const path = url.split('?')[0];
  if (path === '/v1/chat/completions') return 'openai';
  if (path === '/v1/messages' || path === '/anthropic/v1/messages') return 'anthropic';
  return null;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1_000_000) req.destroy(new Error('body too large')); });
    req.on('end', () => {
      if (!raw) { resolve({}); return; }
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function handleRequest({ wire, body, req, res, state }) {
  const scenario = req.headers['x-mock-scenario'] ?? state.scenario ?? null;

  if (scenario && scenario !== 'stream' && ERROR_SCENARIOS[scenario]) {
    const edge = ERROR_SCENARIOS[scenario];
    res.writeHead(edge.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(edge[wire]));
    return;
  }

  if (scenario === 'malformed') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"not": "valid json' + Math.random()); // deliberately unparseable
    return;
  }

  const model = body?.model ?? 'mock-model';
  if (body?.stream) {
    sendStream({ wire, model, res, state });
  } else {
    sendCompletion({ wire, model, res, state });
  }
}

// ─── Non-streaming success ──────────────────────────────────────────────────────────────────

function sendCompletion({ wire, model, res, state }) {
  const body = wire === 'anthropic'
    ? {
      id: 'msg_mock_' + Math.random().toString(36).slice(2, 10),
      type: 'message',
      role: 'assistant',
      model,
      content: [{ type: 'text', text: state.responseText }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: state.usage.promptTokens, output_tokens: state.usage.completionTokens },
    }
    : {
      id: 'chatcmpl-mock-' + Math.random().toString(36).slice(2, 10),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, message: { role: 'assistant', content: state.responseText }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: state.usage.promptTokens,
        completion_tokens: state.usage.completionTokens,
        total_tokens: state.usage.promptTokens + state.usage.completionTokens,
      },
    };
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

// ─── Streaming success (SSE, usage in the final chunk) ──────────────────────────────────────

function sendStream({ wire, model, res, state }) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  const write = (eventType, data) => {
    if (eventType) res.write(`event: ${eventType}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  if (wire === 'anthropic') {
    const id = 'msg_mock_' + Math.random().toString(36).slice(2, 10);
    write('message_start', {
      type: 'message_start',
      message: { id, type: 'message', role: 'assistant', model, content: [], stop_reason: null, usage: { input_tokens: state.usage.promptTokens, output_tokens: 1 } },
    });
    write('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    write('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: state.responseText } });
    write('content_block_stop', { type: 'content_block_stop', index: 0 });
    write('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: state.usage.completionTokens } });
    write('message_stop', { type: 'message_stop' });
  } else {
    const id = 'chatcmpl-mock-' + Math.random().toString(36).slice(2, 10);
    const created = Math.floor(Date.now() / 1000);
    write(null, { id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] });
    write(null, { id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { content: state.responseText }, finish_reason: null }] });
    write(null, { id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
    // Final usage-only chunk — mirrors OpenAI's `stream_options: {include_usage: true}` shape.
    write(null, {
      id, object: 'chat.completion.chunk', created, model, choices: [],
      usage: { prompt_tokens: state.usage.promptTokens, completion_tokens: state.usage.completionTokens, total_tokens: state.usage.promptTokens + state.usage.completionTokens },
    });
    res.write('data: [DONE]\n\n');
  }
  res.end();
}
