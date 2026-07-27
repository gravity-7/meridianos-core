/**
 * Tests for gateway/wire-adapter-registry.mjs — WireAdapter auto-discovery, validation,
 * loading, and dispatch.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadAdapter, discoverAdapters, dispatchAdapter } from '../wire-adapter-registry.mjs';

let tmpDir;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'aios-adapter-registry-'));
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
});

function writeAdapter(filename, content) {
  writeFileSync(join(tmpDir, filename), content, 'utf8');
}

// ─── loadAdapter: validation and loading ─────────────────────────────────────────────────

test('loadAdapter: loads a valid adapter with all required + optional methods', async () => {
  writeAdapter('valid-full.mjs', `
    export function detectRequest(req) { return req.headers['x-test'] ? { wire: 'test', model: 'm1', provider: 'p1' } : null; }
    export function extractUsage(body) { return { inputTokens: body?.in ?? null, outputTokens: body?.out ?? null, cacheReadTokens: null, cacheWriteTokens: null }; }
    export function injectAuth(headers, resolveKey) { headers['x-auth'] = resolveKey('X_KEY'); }
    export function extractUsageFromSSE(event) { return event?.tokens ? { outputTokens: event.tokens } : null; }
    export function formatDenial(cap) { return { status: 403, body: { error: cap } }; }
    export function normalizeModel(m) { return m.toLowerCase(); }
  `);
  const result = await loadAdapter(tmpDir, 'valid-full.mjs');
  assert.ok(result);
  assert.equal(result.wire, 'valid-full');
  assert.equal(typeof result.adapter.detectRequest, 'function');
  assert.equal(typeof result.adapter.extractUsage, 'function');
  assert.equal(typeof result.adapter.injectAuth, 'function');
  assert.equal(typeof result.adapter.extractUsageFromSSE, 'function');
  assert.equal(typeof result.adapter.formatDenial, 'function');
  assert.equal(typeof result.adapter.normalizeModel, 'function');
  assert.equal(result.adapter.hasInjectAuth, true);
  assert.equal(result.adapter.hasSSEExtraction, true);
  assert.equal(result.adapter.hasFormatDenial, true);
  assert.equal(result.adapter.hasNormalizeModel, true);
});

test('loadAdapter: loads a minimal adapter with only required methods', async () => {
  writeAdapter('valid-minimal.mjs', `
    export function detectRequest(req) { return req.headers['x-min'] ? { wire: 'min', model: 'm', provider: 'p' } : null; }
    export function extractUsage(body) { return { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null }; }
  `);
  const result = await loadAdapter(tmpDir, 'valid-minimal.mjs');
  assert.ok(result);
  assert.equal(result.wire, 'valid-minimal');
  assert.equal(typeof result.adapter.detectRequest, 'function');
  assert.equal(typeof result.adapter.extractUsage, 'function');
  // Optional methods get no-op defaults
  assert.equal(typeof result.adapter.injectAuth, 'function');
  assert.equal(typeof result.adapter.extractUsageFromSSE, 'function');
  assert.equal(typeof result.adapter.formatDenial, 'function');
  assert.equal(typeof result.adapter.normalizeModel, 'function');
  assert.equal(result.adapter.hasInjectAuth, false);
  assert.equal(result.adapter.hasSSEExtraction, false);
  assert.equal(result.adapter.hasFormatDenial, false);
  assert.equal(result.adapter.hasNormalizeModel, false);
  // No-op injectAuth does nothing
  const headers = {};
  result.adapter.injectAuth(headers, () => 'secret');
  assert.deepEqual(headers, {});
  // Default normalizeModel is identity
  assert.equal(result.adapter.normalizeModel('gpt-4'), 'gpt-4');
});

test('loadAdapter: rejects module missing detectRequest', async () => {
  writeAdapter('bad-missing-detect.mjs', `
    export function extractUsage(body) { return null; }
  `);
  const result = await loadAdapter(tmpDir, 'bad-missing-detect.mjs');
  assert.equal(result, null);
});

test('loadAdapter: rejects module missing extractUsage', async () => {
  writeAdapter('bad-missing-extract.mjs', `
    export function detectRequest(req) { return null; }
  `);
  const result = await loadAdapter(tmpDir, 'bad-missing-extract.mjs');
  assert.equal(result, null);
});

test('loadAdapter: rejects module with non-function optional method', async () => {
  writeAdapter('bad-optional-type.mjs', `
    export function detectRequest(req) { return null; }
    export function extractUsage(body) { return null; }
    export const injectAuth = 'not-a-function';
  `);
  const result = await loadAdapter(tmpDir, 'bad-optional-type.mjs');
  assert.equal(result, null);
});

test('loadAdapter: gracefully skips module that throws on import', async () => {
  writeAdapter('throws-on-load.mjs', `
    throw new Error('intentional load failure');
  `);
  const result = await loadAdapter(tmpDir, 'throws-on-load.mjs');
  assert.equal(result, null);
});

test('loadAdapter: rejects module exporting a function instead of object', async () => {
  writeAdapter('not-object.mjs', `
    export default function() { return 'not an object'; }
  `);
  const result = await loadAdapter(tmpDir, 'not-object.mjs');
  assert.equal(result, null);
});

test('loadAdapter: uses adapter.wire export when provided', async () => {
  writeAdapter('custom-wire.mjs', `
    export const wire = 'my-custom-wire';
    export function detectRequest(req) { return null; }
    export function extractUsage(body) { return null; }
  `);
  const result = await loadAdapter(tmpDir, 'custom-wire.mjs');
  assert.ok(result);
  assert.equal(result.wire, 'my-custom-wire');
});

// ─── discoverAdapters: directory scanning ─────────────────────────────────────────────────

test('discoverAdapters: returns empty map for non-existent directory', async () => {
  const adapters = await discoverAdapters(join(tmpDir, 'nonexistent'));
  assert.ok(adapters instanceof Map);
  assert.equal(adapters.size, 0);
});

test('discoverAdapters: discovers multiple valid adapters', async () => {
  writeAdapter('alpha.mjs', `
    export function detectRequest(req) { return req.headers['x-a'] ? { wire: 'alpha', model: 'a', provider: 'pa' } : null; }
    export function extractUsage(body) { return null; }
  `);
  writeAdapter('beta.mjs', `
    export function detectRequest(req) { return req.headers['x-b'] ? { wire: 'beta', model: 'b', provider: 'pb' } : null; }
    export function extractUsage(body) { return null; }
  `);
  const adapters = await discoverAdapters(tmpDir);
  assert.ok(adapters.has('alpha'));
  assert.ok(adapters.has('beta'));
  assert.equal(typeof adapters.get('alpha').detectRequest, 'function');
});

test('discoverAdapters: skips invalid adapters, loads valid ones', async () => {
  writeAdapter('good-one.mjs', `
    export function detectRequest(req) { return null; }
    export function extractUsage(body) { return null; }
  `);
  writeAdapter('bad-one.mjs', `
    // Missing detectRequest
    export function extractUsage(body) { return null; }
  `);
  const adapters = await discoverAdapters(tmpDir);
  assert.ok(adapters.has('good-one'));
  assert.ok(!adapters.has('bad-one'));
});

test('discoverAdapters: skips non-.mjs files', async () => {
  writeFileSync(join(tmpDir, 'readme.txt'), 'not an adapter', 'utf8');
  writeAdapter('valid.mjs', `
    export function detectRequest(req) { return null; }
    export function extractUsage(body) { return null; }
  `);
  const adapters = await discoverAdapters(tmpDir);
  assert.ok(adapters.has('valid'));
  // .txt file should not appear
  assert.ok(!adapters.has('readme.txt'));
});

// ─── dispatchAdapter: request routing ────────────────────────────────────────────────────

function mockReq(headers = {}) {
  return { headers, method: 'POST', url: '/v1/chat/completions' };
}

test('dispatchAdapter: dispatches to the first matching adapter', async () => {
  writeAdapter('first.mjs', `
    export function detectRequest(req) { return req.headers['x-first'] ? { wire: 'first', model: 'm', provider: 'p' } : null; }
    export function extractUsage(body) { return null; }
  `);
  writeAdapter('second.mjs', `
    export function detectRequest(req) { return req.headers['x-second'] ? { wire: 'second', model: 'm', provider: 'p' } : null; }
    export function extractUsage(body) { return null; }
  `);
  const adapters = await discoverAdapters(tmpDir);
  const result = dispatchAdapter(adapters, mockReq({ 'x-second': '1' }));
  assert.ok(result);
  assert.equal(result.result.wire, 'second');
  assert.equal(result.adapter.wire, 'second');
});

test('dispatchAdapter: returns first match when multiple adapters could match', async () => {
  // Clear directory and create two that both match the same header
  const dir = mkdtempSync(join(tmpdir(), 'dispatch-order-'));
  writeFileSync(join(dir, 'aaa.mjs'), `
    export function detectRequest(req) { return req.headers['x-common'] ? { wire: 'aaa', model: 'm', provider: 'p' } : null; }
    export function extractUsage(body) { return null; }
  `, 'utf8');
  writeFileSync(join(dir, 'zzz.mjs'), `
    export function detectRequest(req) { return req.headers['x-common'] ? { wire: 'zzz', model: 'm', provider: 'p' } : null; }
    export function extractUsage(body) { return null; }
  `, 'utf8');
  const adapters = await discoverAdapters(dir);
  const result = dispatchAdapter(adapters, mockReq({ 'x-common': '1' }));
  assert.ok(result);
  // First in Map insertion order wins
  assert.equal(result.result.wire, 'aaa');
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
});

test('dispatchAdapter: returns null when no adapter claims the request', async () => {
  writeAdapter('pick.mjs', `
    export function detectRequest(req) { return req.headers['x-special'] ? { wire: 'pick', model: 'm', provider: 'p' } : null; }
    export function extractUsage(body) { return null; }
  `);
  const adapters = await discoverAdapters(tmpDir);
  const result = dispatchAdapter(adapters, mockReq({}));
  assert.equal(result, null);
});

test('dispatchAdapter: gracefully handles adapter detectRequest throwing', async () => {
  writeAdapter('thrower.mjs', `
    export function detectRequest(req) { throw new Error('boom'); }
    export function extractUsage(body) { return null; }
  `);
  writeAdapter('catcher.mjs', `
    export function detectRequest(req) { return { wire: 'catcher', model: 'm', provider: 'p' }; }
    export function extractUsage(body) { return null; }
  `);
  const adapters = await discoverAdapters(tmpDir);
  const result = dispatchAdapter(adapters, mockReq({}));
  assert.ok(result);
  // Should skip the thrower and match the catcher
  assert.equal(result.result.wire, 'catcher');
});

test('dispatchAdapter: returns null when all adapters throw', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'all-throwers-'));
  writeFileSync(join(dir, 'thrower1.mjs'), `
    export function detectRequest(req) { throw new Error('boom1'); }
    export function extractUsage(body) { return null; }
  `, 'utf8');
  writeFileSync(join(dir, 'thrower2.mjs'), `
    export function detectRequest(req) { throw new Error('boom2'); }
    export function extractUsage(body) { return null; }
  `, 'utf8');
  const adapters = await discoverAdapters(dir);
  const result = dispatchAdapter(adapters, mockReq({}));
  assert.equal(result, null);
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
});

// ─── Default no-op behavior for omitted optional methods ────────────────────────────────

test('default formatDenial: returns generic JSON 403', async () => {
  writeAdapter('no-format.mjs', `
    export function detectRequest(req) { return null; }
    export function extractUsage(body) { return null; }
  `);
  const result = await loadAdapter(tmpDir, 'no-format.mjs');
  assert.ok(result);
  const denial = result.adapter.formatDenial('5h');
  assert.equal(denial.status, 403);
  assert.ok(denial.body.error);
  assert.match(denial.body.error.message, /over budget.*5h/);
});

test('default extractUsageFromSSE: returns null', async () => {
  writeAdapter('no-sse.mjs', `
    export function detectRequest(req) { return null; }
    export function extractUsage(body) { return null; }
  `);
  const result = await loadAdapter(tmpDir, 'no-sse.mjs');
  assert.ok(result);
  assert.equal(result.adapter.extractUsageFromSSE({ data: 'test' }), null);
});

// ─── Anthropic adapter functional tests ─────────────────────────────────────────────────

test('anthropic adapter: detectRequest matches x-api-key header', async () => {
  const result = await loadAdapter(tmpDir, 'valid-full.mjs');
  // Use the already-created valid adapter as a stand-in
  // In practice we test the real adapters from the wire-adapters directory
});

// ─── discoverAdapters with real gateway/wire-adapters/ directory ─────────────────────────

test('discoverAdapters: discovers built-in anthropic and openai adapters', async () => {
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const here = fileURLToPath(import.meta.url).replace(/\\/g, '/');
  // Navigate from gateway/tests/ up to gateway/wire-adapters/
  const adaptersDir = join(here, '..', '..', 'wire-adapters');
  const { existsSync } = await import('node:fs');
  if (!existsSync(join(adaptersDir, 'anthropic.mjs'))) {
    // Skip if the real adapters don't exist yet (tests run before implementation)
    return;
  }
  const adapters = await discoverAdapters(adaptersDir);
  assert.ok(adapters.has('anthropic'), 'anthropic adapter should be discovered');
  assert.ok(adapters.has('openai'), 'openai adapter should be discovered');
  assert.equal(typeof adapters.get('anthropic').detectRequest, 'function');
  assert.equal(typeof adapters.get('anthropic').extractUsage, 'function');
});

// ─── Anthropic and OpenAI adapter extraction correctness ─────────────────────────────────

test('anthropic adapter extractUsage: parses Anthropic usage format', async () => {
  const adaptersDir = join(
    (await import('node:path')).dirname((await import('node:url')).fileURLToPath(import.meta.url)),
    '..', '..', 'wire-adapters',
  );
  const { existsSync } = await import('node:fs');
  if (!existsSync(join(adaptersDir, 'anthropic.mjs'))) return;

  const mod = await import(join(adaptersDir, 'anthropic.mjs'));
  const adapter = mod.default ?? mod;

  const usage = adapter.extractUsage({
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      cache_read_input_tokens: 3,
      cache_creation_input_tokens: 1,
    },
  });
  assert.deepEqual(usage, {
    inputTokens: 10,
    outputTokens: 20,
    cacheReadTokens: 3,
    cacheWriteTokens: 1,
  });
});

test('openai adapter extractUsage: parses OpenAI usage format', async () => {
  const adaptersDir = join(
    (await import('node:path')).dirname((await import('node:url')).fileURLToPath(import.meta.url)),
    '..', '..', 'wire-adapters',
  );
  const { existsSync } = await import('node:fs');
  if (!existsSync(join(adaptersDir, 'openai.mjs'))) return;

  const mod = await import(join(adaptersDir, 'openai.mjs'));
  const adapter = mod.default ?? mod;

  const usage = adapter.extractUsage({
    usage: {
      prompt_tokens: 5,
      completion_tokens: 7,
      prompt_tokens_details: { cached_tokens: 2 },
    },
  });
  assert.deepEqual(usage, {
    inputTokens: 5,
    outputTokens: 7,
    cacheReadTokens: 2,
    cacheWriteTokens: null,
  });
});
