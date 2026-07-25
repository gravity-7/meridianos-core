import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIERS } from '../model-router.mjs';
import {
  PROVIDERS, validateProviders, resolveProvider, modelForTier, providerKeyPresent,
} from '../providers.mjs';

// ─── Shape / sanity (values are founder-tunable — assert shape, not literal ids) ───────────

test('validateProviders passes on the code defaults', () => {
  assert.equal(validateProviders(PROVIDERS), true);
});

test('every provider has a valid wire', () => {
  for (const [key, entry] of Object.entries(PROVIDERS)) {
    assert.ok(['anthropic', 'openai'].includes(entry.wire), `${key} has invalid wire: ${entry.wire}`);
  }
});

test('every provider has a complete models map over all TIERS', () => {
  for (const [key, entry] of Object.entries(PROVIDERS)) {
    for (const tier of TIERS) {
      assert.equal(typeof entry.models[tier], 'string', `${key}.models.${tier} should be a string`);
      assert.ok(entry.models[tier].length > 0, `${key}.models.${tier} should be non-empty`);
    }
  }
});

test('every provider has a keyEnv that is null or a string', () => {
  for (const [key, entry] of Object.entries(PROVIDERS)) {
    assert.ok(entry.keyEnv === null || typeof entry.keyEnv === 'string', `${key}.keyEnv must be null or string`);
  }
});

test('every provider has a baseUrl that is null or a string', () => {
  for (const [key, entry] of Object.entries(PROVIDERS)) {
    assert.ok(entry.baseUrl === null || typeof entry.baseUrl === 'string', `${key}.baseUrl must be null or string`);
  }
});

test('anthropic preserves today\'s behavior: no baseUrl, no keyEnv', () => {
  assert.equal(PROVIDERS.anthropic.baseUrl, null);
  assert.equal(PROVIDERS.anthropic.keyEnv, null);
});

test('deepseek and openrouter declare BYO-key env var names, not literal keys', () => {
  assert.equal(PROVIDERS.deepseek.keyEnv, 'DEEPSEEK_KEY');
  assert.equal(PROVIDERS.openrouter.keyEnv, 'OPENROUTER_KEY');
  assert.equal(PROVIDERS.deepseek.baseUrl, 'https://api.deepseek.com');
  assert.equal(PROVIDERS.openrouter.baseUrl, 'https://openrouter.ai/api/v1');
  assert.equal(PROVIDERS.openrouter.wire, 'openai');
});

// ─── validateProviders — negative case ──────────────────────────────────────

test('validateProviders throws on an unknown wire', () => {
  const bad = { foo: { name: 'foo', baseUrl: null, wire: 'grpc', keyEnv: null, models: {
    simple: 'a', medium: 'a', medium_high: 'a', complex: 'a', critical: 'a',
  } } };
  assert.throws(() => validateProviders(bad), /wire/);
});

test('validateProviders allows partial tier coverage (no critical tier needed)', () => {
  const ok = { foo: { name: 'foo', baseUrl: null, wire: 'openai', keyEnv: null, models: {
    simple: 'a', medium: 'a', medium_high: 'a', complex: 'a', // critical intentionally omitted
  } } };
  assert.doesNotThrow(() => validateProviders(ok));
});

test('validateProviders throws on a non-string keyEnv', () => {
  const bad = { foo: { name: 'foo', baseUrl: null, wire: 'openai', keyEnv: 123, models: {
    simple: 'a', medium: 'a', medium_high: 'a', complex: 'a', critical: 'a',
  } } };
  assert.throws(() => validateProviders(bad), /keyEnv/);
});

test('validateProviders throws when entry.name does not match its registry key', () => {
  const bad = { foo: { name: 'bar', baseUrl: null, wire: 'openai', keyEnv: null, models: {
    simple: 'a', medium: 'a', medium_high: 'a', complex: 'a', critical: 'a',
  } } };
  assert.throws(() => validateProviders(bad), /name/);
});

// ─── resolveProvider ─────────────────────────────────────────────────────────

test('resolveProvider returns the code default when no policy overlay exists', () => {
  const resolved = resolveProvider('deepseek', {});
  assert.deepEqual(resolved, PROVIDERS.deepseek);
});

test('resolveProvider returns null for a provider absent from both code and policy', () => {
  assert.equal(resolveProvider('nope', {}), null);
});

test('policy overlay wins: overrides baseUrl and keyEnv for a known provider', () => {
  const policy = { providers: { deepseek: { baseUrl: 'https://custom.example.com', keyEnv: 'CUSTOM_KEY' } } };
  const resolved = resolveProvider('deepseek', policy);
  assert.equal(resolved.baseUrl, 'https://custom.example.com');
  assert.equal(resolved.keyEnv, 'CUSTOM_KEY');
  assert.equal(resolved.wire, 'openai'); // untouched fields still come from the code default
});

test('policy overlay merges models per-tier, not wholesale', () => {
  const policy = { providers: { deepseek: { models: { complex: 'deepseek-v4' } } } };
  const resolved = resolveProvider('deepseek', policy);
  assert.equal(resolved.models.complex, 'deepseek-v4');
  assert.equal(resolved.models.simple, PROVIDERS.deepseek.models.simple); // other tiers preserved
});

test('policy overlay can extend the registry with a brand-new provider', () => {
  const policy = { providers: { groq: {
    name: 'groq', baseUrl: 'https://api.groq.com', wire: 'openai', keyEnv: 'GROQ_KEY',
    models: { simple: 'llama-3-8b', medium: 'llama-3-70b', medium_high: 'llama-3-70b', complex: 'llama-3-70b', critical: 'llama-3-70b' },
  } } };
  const resolved = resolveProvider('groq', policy);
  assert.equal(resolved.name, 'groq');
  assert.equal(resolved.keyEnv, 'GROQ_KEY');
});

// ─── modelForTier ─────────────────────────────────────────────────────────────

test('modelForTier resolves a model id for a known provider/tier', () => {
  assert.equal(modelForTier('anthropic', 'complex', {}), 'claude-opus-4-8');
});

test('modelForTier reflects a policy overlay', () => {
  const policy = { providers: { anthropic: { models: { complex: 'claude-opus-override' } } } };
  assert.equal(modelForTier('anthropic', 'complex', policy), 'claude-opus-override');
});

test('modelForTier returns null for an unknown provider', () => {
  assert.equal(modelForTier('nope', 'simple', {}), null);
});

// ─── providerKeyPresent ────────────────────────────────────────────────────────

test('providerKeyPresent is true for a null keyEnv (no key needed)', () => {
  assert.equal(providerKeyPresent(PROVIDERS.anthropic), true);
});

test('providerKeyPresent is false when the env var is unset', () => {
  delete process.env.PV_TEST_UNSET_KEY_XYZ;
  assert.equal(providerKeyPresent({ keyEnv: 'PV_TEST_UNSET_KEY_XYZ' }), false);
});

test('providerKeyPresent is true when the env var is set', () => {
  process.env.PV_TEST_SET_KEY_XYZ = 'sk-fake-for-test';
  assert.equal(providerKeyPresent({ keyEnv: 'PV_TEST_SET_KEY_XYZ' }), true);
  delete process.env.PV_TEST_SET_KEY_XYZ;
});

test('providerKeyPresent is false for a null/undefined descriptor', () => {
  assert.equal(providerKeyPresent(null), false);
  assert.equal(providerKeyPresent(undefined), false);
});
