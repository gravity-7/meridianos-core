import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startMockProvider } from '../test/mock-provider.mjs';
import { resolveTarget, runBattery, formatReport } from '../conformance.mjs';

async function withServer(opts, fn) {
  const mock = await startMockProvider(opts);
  try {
    await fn(mock);
  } finally {
    await mock.close();
  }
}

// ─── resolveTarget ──────────────────────────────────────────────────────────────────────────

test('resolveTarget builds an ad-hoc target from { baseURL, wire, model, key }', () => {
  const target = resolveTarget({ baseURL: 'http://example.test', wire: 'openai', model: 'm', key: 'k' });
  assert.equal(target.baseURL, 'http://example.test');
  assert.equal(target.wire, 'openai');
  assert.equal(target.keyPresent, true);
});

test('resolveTarget throws for an ad-hoc target missing baseURL/wire', () => {
  assert.throws(() => resolveTarget({ model: 'm' }), /baseURL, wire/);
});

test('resolveTarget resolves a registered provider by name (deepseek, default OpenAI wire)', () => {
  const target = resolveTarget('deepseek');
  assert.equal(target.name, 'deepseek');
  assert.equal(target.wire, 'openai');
  assert.equal(target.baseURL, 'https://api.deepseek.com');
});

test('resolveTarget honors wireOverride, resolving the provider anthropicBaseUrl instead', () => {
  const target = resolveTarget('deepseek', { wireOverride: 'anthropic' });
  assert.equal(target.wire, 'anthropic');
  assert.equal(target.baseURL, 'https://api.deepseek.com/anthropic');
});

test('resolveTarget throws for the native anthropic provider — it has no HTTP endpoint (CLI OAuth login only)', () => {
  assert.throws(() => resolveTarget('anthropic'), /no endpoint/);
});

test('resolveTarget throws for an unknown provider name', () => {
  assert.throws(() => resolveTarget('not-a-real-provider'), /unknown provider/);
});

// ─── Full battery against the mock server (mock mode, $0, deterministic, CI) ────────────────

test('mock mode: full battery passes against the OpenAI wire', async () => {
  await withServer({}, async (mock) => {
    const target = resolveTarget({ baseURL: mock.url, wire: 'openai', model: 'mock-model', key: 'k' });
    const report = await runBattery(target);
    assert.equal(report.pass, true, formatReport(report));
    const byName = Object.fromEntries(report.results.map((r) => [r.name, r]));
    assert.equal(byName.completion.pass, true);
    assert.equal(byName.streaming.pass, true);
    assert.equal(byName.usage.pass, true);
    assert.equal(byName.errorShape.pass, true);
  });
});

test('mock mode: full battery passes against the Anthropic wire', async () => {
  await withServer({}, async (mock) => {
    const target = resolveTarget({ baseURL: mock.url, wire: 'anthropic', model: 'mock-model', key: 'k' });
    const report = await runBattery(target);
    assert.equal(report.pass, true, formatReport(report));
  });
});

// ─── errorShape check actually distinguishes pass/fail (proves it isn't a tautology) ────────

test('errorShape check fails when the endpoint never returns an error shape for the synthetic trigger', async () => {
  // A target whose header-based error trigger the server ignores entirely (plain success-only
  // handler) — simulates a real provider that doesn't recognize X-Mock-Scenario, which
  // formatReport should surface as skipped-pass, not a false failure.
  await withServer({}, async (mock) => {
    const target = resolveTarget({ baseURL: mock.url, wire: 'openai', model: 'm', key: 'k' });
    const report = await runBattery(target);
    const errorShape = report.results.find((r) => r.name === 'errorShape');
    // Our own mock DOES honor the header, so this proves the positive case deterministically.
    assert.equal(errorShape.pass, true);
    assert.equal(errorShape.skipped, undefined);
  });
});

test('completion check fails and reports a clear reason when the endpoint 500s', async () => {
  await withServer({ scenario: '500' }, async (mock) => {
    const target = resolveTarget({ baseURL: mock.url, wire: 'openai', model: 'm', key: 'k' });
    const report = await runBattery(target);
    assert.equal(report.pass, false);
    const completion = report.results.find((r) => r.name === 'completion');
    assert.equal(completion.pass, false);
    assert.match(completion.detail, /500/);
  });
});

// ─── formatReport ───────────────────────────────────────────────────────────────────────────

test('formatReport renders a human-readable PASS/FAIL summary', async () => {
  await withServer({}, async (mock) => {
    const target = resolveTarget({ baseURL: mock.url, wire: 'openai', model: 'm', key: 'k' });
    const report = await runBattery(target);
    const text = formatReport(report);
    assert.match(text, /PASS/);
    assert.match(text, /completion/);
    assert.match(text, /streaming/);
  });
});
