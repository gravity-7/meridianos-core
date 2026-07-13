import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startMockProvider } from '../test/mock-provider.mjs';

async function post(url, path, body, headers = {}) {
  const res = await fetch(url + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, res };
}

async function withServer(opts, fn) {
  const mock = await startMockProvider(opts);
  try {
    await fn(mock);
  } finally {
    await mock.close();
  }
}

// ─── Success — OpenAI wire ──────────────────────────────────────────────────────────────────

test('POST /v1/chat/completions returns a well-formed OpenAI completion with usage', async () => {
  await withServer({}, async (mock) => {
    const { status, res } = await post(mock.url, '/v1/chat/completions', { model: 'test-model', messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(status, 200);
    const body = await res.json();
    assert.equal(body.object, 'chat.completion');
    assert.equal(body.model, 'test-model');
    assert.equal(body.choices[0].message.role, 'assistant');
    assert.ok(body.choices[0].message.content.length > 0);
    assert.equal(body.choices[0].finish_reason, 'stop');
    assert.equal(typeof body.usage.prompt_tokens, 'number');
    assert.equal(typeof body.usage.completion_tokens, 'number');
    assert.equal(body.usage.total_tokens, body.usage.prompt_tokens + body.usage.completion_tokens);
  });
});

// ─── Success — Anthropic wire (both paths) ──────────────────────────────────────────────────

test('POST /v1/messages returns a well-formed Anthropic completion with usage', async () => {
  await withServer({}, async (mock) => {
    const { status, res } = await post(mock.url, '/v1/messages', { model: 'test-model', max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(status, 200);
    const body = await res.json();
    assert.equal(body.type, 'message');
    assert.equal(body.role, 'assistant');
    assert.equal(body.content[0].type, 'text');
    assert.ok(body.content[0].text.length > 0);
    assert.equal(body.stop_reason, 'end_turn');
    assert.equal(typeof body.usage.input_tokens, 'number');
    assert.equal(typeof body.usage.output_tokens, 'number');
  });
});

test('POST /anthropic/v1/messages serves the same Anthropic shape (mirrors a provider anthropicBaseUrl layout)', async () => {
  await withServer({}, async (mock) => {
    const { status, res } = await post(mock.url, '/anthropic/v1/messages', { model: 'test-model', max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(status, 200);
    const body = await res.json();
    assert.equal(body.type, 'message');
  });
});

// ─── Configurable usage / response text ─────────────────────────────────────────────────────

test('setUsage and setResponseText change subsequent responses', async () => {
  await withServer({}, async (mock) => {
    mock.setUsage({ promptTokens: 100, completionTokens: 7 });
    mock.setResponseText('CUSTOM_TEXT');
    const { res } = await post(mock.url, '/v1/chat/completions', { model: 'm', messages: [] });
    const body = await res.json();
    assert.equal(body.usage.prompt_tokens, 100);
    assert.equal(body.usage.completion_tokens, 7);
    assert.equal(body.choices[0].message.content, 'CUSTOM_TEXT');
  });
});

// ─── Error scenarios (server-wide default) ──────────────────────────────────────────────────

for (const [scenario, expectedStatus] of [['401', 401], ['402', 402], ['429', 429], ['500', 500]]) {
  test(`scenario '${scenario}' returns HTTP ${expectedStatus} with an OpenAI-shaped error body`, async () => {
    await withServer({ scenario }, async (mock) => {
      const { status, res } = await post(mock.url, '/v1/chat/completions', { model: 'm', messages: [] });
      assert.equal(status, expectedStatus);
      const body = await res.json();
      assert.ok(body.error && typeof body.error.message === 'string');
    });
  });

  test(`scenario '${scenario}' returns HTTP ${expectedStatus} with an Anthropic-shaped error body`, async () => {
    await withServer({ scenario }, async (mock) => {
      const { status, res } = await post(mock.url, '/v1/messages', { model: 'm', max_tokens: 8, messages: [] });
      assert.equal(status, expectedStatus);
      const body = await res.json();
      assert.equal(body.type, 'error');
      assert.ok(body.error && typeof body.error.message === 'string');
    });
  });
}

test("scenario 'malformed' returns HTTP 200 with a body that fails JSON.parse", async () => {
  await withServer({ scenario: 'malformed' }, async (mock) => {
    const { status, res } = await post(mock.url, '/v1/chat/completions', { model: 'm', messages: [] });
    assert.equal(status, 200);
    const text = await res.text();
    assert.throws(() => JSON.parse(text));
  });
});

// ─── Per-request scenario override via X-Mock-Scenario header ──────────────────────────────

test('X-Mock-Scenario header overrides the server-wide default for a single request', async () => {
  await withServer({}, async (mock) => {
    const ok = await post(mock.url, '/v1/chat/completions', { model: 'm', messages: [] });
    assert.equal(ok.status, 200);
    const bad = await post(mock.url, '/v1/chat/completions', { model: 'm', messages: [] }, { 'x-mock-scenario': '429' });
    assert.equal(bad.status, 429);
    // The server-wide default is unaffected by a per-request header.
    const okAgain = await post(mock.url, '/v1/chat/completions', { model: 'm', messages: [] });
    assert.equal(okAgain.status, 200);
  });
});

test('setScenario changes the server-wide default; passing null restores success', async () => {
  await withServer({}, async (mock) => {
    mock.setScenario('500');
    const bad = await post(mock.url, '/v1/chat/completions', { model: 'm', messages: [] });
    assert.equal(bad.status, 500);
    mock.setScenario(null);
    const ok = await post(mock.url, '/v1/chat/completions', { model: 'm', messages: [] });
    assert.equal(ok.status, 200);
  });
});

// ─── Streaming (SSE), usage in the final chunk, both wires ─────────────────────────────────

async function collectSSE(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const lines = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of block.split('\n')) if (line.startsWith('data:')) lines.push(line.slice(5).trim());
    }
  }
  return lines;
}

test('OpenAI streaming: SSE chunks assemble into the response text, final chunk carries usage, ends with [DONE]', async () => {
  await withServer({}, async (mock) => {
    const res = await fetch(mock.url + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'm', messages: [], stream: true }),
    });
    assert.equal(res.headers.get('content-type'), 'text/event-stream');
    const lines = await collectSSE(res);
    assert.equal(lines.at(-1), '[DONE]');
    const events = lines.slice(0, -1).map((l) => JSON.parse(l));
    const text = events.map((e) => e.choices?.[0]?.delta?.content ?? '').join('');
    assert.ok(text.length > 0);
    const usageEvent = events.find((e) => e.usage);
    assert.ok(usageEvent, 'expected a final chunk carrying usage');
    assert.equal(typeof usageEvent.usage.prompt_tokens, 'number');
    assert.equal(typeof usageEvent.usage.completion_tokens, 'number');
  });
});

test('Anthropic streaming: SSE events assemble into text via content_block_delta, message_delta carries output usage', async () => {
  await withServer({}, async (mock) => {
    const res = await fetch(mock.url + '/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'm', max_tokens: 64, messages: [], stream: true }),
    });
    const lines = await collectSSE(res);
    const events = lines.map((l) => JSON.parse(l));
    assert.equal(events[0].type, 'message_start');
    assert.equal(typeof events[0].message.usage.input_tokens, 'number');
    const text = events.filter((e) => e.type === 'content_block_delta').map((e) => e.delta.text).join('');
    assert.ok(text.length > 0);
    const messageDelta = events.find((e) => e.type === 'message_delta');
    assert.equal(typeof messageDelta.usage.output_tokens, 'number');
    assert.equal(events.at(-1).type, 'message_stop');
  });
});

// ─── Unknown paths / methods ─────────────────────────────────────────────────────────────────

test('unknown path returns 404', async () => {
  await withServer({}, async (mock) => {
    const res = await fetch(mock.url + '/v1/not-a-real-endpoint', { method: 'POST', body: '{}' });
    assert.equal(res.status, 404);
  });
});

test('GET on a known path returns 404 (only POST is supported)', async () => {
  await withServer({}, async (mock) => {
    const res = await fetch(mock.url + '/v1/chat/completions');
    assert.equal(res.status, 404);
  });
});
