import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { normalizeModelsDev, normalizeOpenRouter, mergeCatalog, diffCatalogs, refresh } from '../pricing-refresh.mjs';

// Fixtures mirror the real shapes fetched from models.dev/api.json and openrouter.ai/api/v1/models
// (verified by hand against both live endpoints) — no network access here, ever.

const modelsDevFixture = {
  anthropic: {
    models: {
      'claude-sonnet-5': { id: 'claude-sonnet-5', cost: { input: 2, output: 10, cache_read: 0.2, cache_write: 2.5 } },
      'claude-opus-4-8': { id: 'claude-opus-4-8', cost: { input: 5, output: 25, cache_read: 0.5 } },
      'no-cost-model': { id: 'no-cost-model' }, // missing cost entirely — must be skipped, not guessed
    },
  },
  deepseek: {
    models: {
      'deepseek-chat': { id: 'deepseek-chat', cost: { input: 0.14, output: 0.28, cache_read: 0.0028 } },
    },
  },
  'some-other-provider-we-dont-track': {
    models: { 'x': { id: 'x', cost: { input: 1, output: 1 } } },
  },
};

const openRouterFixture = {
  data: [
    { id: 'openai/gpt-5.6-luna-pro', pricing: { prompt: '0.000001', completion: '0.000006', input_cache_read: '0.0000001' } },
    { id: 'free/model', pricing: { prompt: '0', completion: '0' } },
    { id: 'malformed/model', pricing: { prompt: 'not-a-number', completion: '0.000002' } },
  ],
};

test('normalizeModelsDev reshapes cost.{input,output,cache_read} into {inputPerM,outputPerM,cachedInputPerM}, scoped to given providers', () => {
  const out = normalizeModelsDev(modelsDevFixture, ['anthropic', 'deepseek']);
  assert.deepEqual(out.anthropic['claude-sonnet-5'], { inputPerM: 2, outputPerM: 10, cachedInputPerM: 0.2 });
  assert.deepEqual(out.anthropic['claude-opus-4-8'], { inputPerM: 5, outputPerM: 25, cachedInputPerM: 0.5 });
  assert.deepEqual(out.deepseek['deepseek-chat'], { inputPerM: 0.14, outputPerM: 0.28, cachedInputPerM: 0.0028 });
});

test('normalizeModelsDev skips a model with no numeric cost rather than fabricating one', () => {
  const out = normalizeModelsDev(modelsDevFixture, ['anthropic']);
  assert.ok(!('no-cost-model' in out.anthropic));
});

test('normalizeModelsDev ignores providers not in the requested list', () => {
  const out = normalizeModelsDev(modelsDevFixture, ['anthropic']);
  assert.ok(!('some-other-provider-we-dont-track' in out));
  assert.ok(!('deepseek' in out));
});

test('normalizeOpenRouter converts USD-per-token decimal strings to USD-per-1M', () => {
  const out = normalizeOpenRouter(openRouterFixture);
  assert.deepEqual(out['openai/gpt-5.6-luna-pro'], { inputPerM: 1, outputPerM: 6, cachedInputPerM: 0.1 });
});

test('normalizeOpenRouter keeps a genuinely free model at zero rather than dropping it', () => {
  const out = normalizeOpenRouter(openRouterFixture);
  assert.deepEqual(out['free/model'], { inputPerM: 0, outputPerM: 0 });
});

test('normalizeOpenRouter skips a model with a non-numeric price', () => {
  const out = normalizeOpenRouter(openRouterFixture);
  assert.ok(!('malformed/model' in out));
});

test('mergeCatalog replaces named provider sections wholesale and leaves others untouched', () => {
  const previous = { anthropic: { old: { inputPerM: 1, outputPerM: 1 } }, openrouter: { stale: { inputPerM: 9, outputPerM: 9 } } };
  const fresh = { anthropic: { 'claude-sonnet-5': { inputPerM: 2, outputPerM: 10 } } };
  const next = mergeCatalog(previous, fresh);
  assert.deepEqual(next.anthropic, { 'claude-sonnet-5': { inputPerM: 2, outputPerM: 10 } }, 'old is fully replaced, not merged model-by-model');
  assert.deepEqual(next.openrouter, { stale: { inputPerM: 9, outputPerM: 9 } }, 'a provider absent from fresh is left alone');
});

test('diffCatalogs reports added, removed, and changed entries', () => {
  const previous = { anthropic: { a: { inputPerM: 1, outputPerM: 1 }, b: { inputPerM: 2, outputPerM: 2 } } };
  const next = { anthropic: { a: { inputPerM: 1, outputPerM: 1 }, c: { inputPerM: 3, outputPerM: 3 } } };
  const changes = diffCatalogs(previous, next);
  const byModel = Object.fromEntries(changes.map((c) => [c.model, c]));
  assert.ok(!('a' in byModel), 'unchanged entries produce no diff line');
  assert.equal(byModel.b.to, null);
  assert.equal(byModel.c.from, null);
});

test('refresh() only ever talks to the injected fetchImpl (never a real network call), merges + writes the result', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('models.dev')) return { ok: true, json: async () => modelsDevFixture };
    if (url.includes('openrouter')) return { ok: true, json: async () => openRouterFixture };
    throw new Error(`unexpected fetch: ${url}`);
  };
  const dir = mkdtempSync(join(tmpdir(), 'aios-pricing-refresh-'));
  const path = join(dir, 'pricing.json');
  writeFileSync(path, JSON.stringify({ anthropic: { stale: { inputPerM: 1, outputPerM: 1 } } }));

  const result = await refresh({ path, fetchImpl, includeOpenRouter: true });

  assert.deepEqual(result.previous.anthropic, { stale: { inputPerM: 1, outputPerM: 1 } });
  assert.ok(result.next.anthropic['claude-sonnet-5'], 'fresh models.dev data replaces the anthropic section');
  assert.ok(!('stale' in result.next.anthropic), 'the stale model is gone once the section is replaced');
  assert.ok(result.next.openrouter['openai/gpt-5.6-luna-pro']);
  assert.ok(result.changes.length > 0);

  const written = JSON.parse(readFileSync(path, 'utf8'));
  assert.deepEqual(written, result.next, 'the file on disk matches what refresh() reports it wrote');
});

test('refresh() skips the OpenRouter fetch when includeOpenRouter is false', async () => {
  let openRouterCalled = false;
  const fetchImpl = async (url) => {
    if (url.includes('models.dev')) return { ok: true, json: async () => modelsDevFixture };
    openRouterCalled = true;
    return { ok: true, json: async () => openRouterFixture };
  };
  const dir = mkdtempSync(join(tmpdir(), 'aios-pricing-refresh-'));
  const path = join(dir, 'pricing.json');
  writeFileSync(path, JSON.stringify({}));

  const result = await refresh({ path, fetchImpl, includeOpenRouter: false });

  assert.equal(openRouterCalled, false);
  assert.ok(!('openrouter' in result.next) || Object.keys(result.next.openrouter ?? {}).length === 0);
});
