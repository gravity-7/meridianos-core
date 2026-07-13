import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fetchWithCassette, cassetteFile, loadCassette } from '../test/cassette.mjs';

// ─── Replay the committed real cassette (recorded against local Ollama — free, no key) ────────

test('replay mode serves the committed ollama-chat-completion cassette with no network call', async () => {
  const res = await fetchWithCassette('ollama-chat-completion', {
    url: 'http://127.0.0.1:1/would-fail-if-actually-called', // proves replay never touches the network
  }, { mode: 'replay' });
  assert.equal(res.status, 200);
  assert.equal(res.body.choices[0].message.content, 'MOCK_CASSETTE_OK');
  assert.equal(res.body.model, 'gemma4:e4b');
  assert.equal(typeof res.body.usage.prompt_tokens, 'number');
  assert.equal(typeof res.body.usage.completion_tokens, 'number');
});

test('the committed cassette carries no secrets — auth header is redacted', () => {
  const entry = loadCassette('ollama-chat-completion');
  assert.equal(entry.request.headers.authorization, '[REDACTED]');
});

test('loadCassette throws a clear error for a cassette that was never recorded', () => {
  assert.throws(() => loadCassette('does-not-exist-xyz'), /record it first/);
});

// ─── Record mode sanitizes before writing (proven against the local zero-dep mock server —
// keeps this test $0 and network-free while still exercising a REAL fetch + REAL file write) ──

test('record mode performs a real fetch, strips auth headers, and writes a cassette that replay can read back', async (t) => {
  const { startMockProvider } = await import('../test/mock-provider.mjs');
  const mock = await startMockProvider({});
  t.after(() => mock.close());

  const name = 'tmp-cassette-record-test';
  try {
    const recorded = await fetchWithCassette(name, {
      url: mock.url + '/v1/chat/completions',
      headers: { authorization: 'Bearer sk-should-not-be-written' },
      body: { model: 'record-test', messages: [{ role: 'user', content: 'hi' }] },
    }, { mode: 'record' });
    assert.equal(recorded.status, 200);

    assert.ok(existsSync(cassetteFile(name)));
    const onDisk = JSON.parse(readFileSync(cassetteFile(name), 'utf8'));
    assert.equal(onDisk.request.headers.authorization, '[REDACTED]');
    assert.doesNotMatch(readFileSync(cassetteFile(name), 'utf8'), /sk-should-not-be-written/);

    const replayed = await fetchWithCassette(name, {}, { mode: 'replay' });
    assert.deepEqual(replayed, recorded);
  } finally {
    const { rmSync } = await import('node:fs');
    rmSync(cassetteFile(name), { force: true });
  }
});
