import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS } from '../../providers.mjs';
import { validateProviderRegistry } from '../provider-registry.mjs';
import { buildProviderRegistry, serializeRegistry } from '../registry-source.mjs';

const NOW = Date.parse('2026-07-14T00:00:00.000Z');

// ─── buildProviderRegistry — happy path ────────────────────────────────────

test('buildProviderRegistry produces a valid envelope from code defaults alone', () => {
  const reg = buildProviderRegistry({ policy: {}, tenant: 'pv', now: NOW });
  assert.equal(validateProviderRegistry(reg), true);
  assert.equal(reg.version, 1);
  assert.equal(reg.generatedAt, '2026-07-14T00:00:00.000Z');
  assert.equal(reg.tenant, 'pv');
});

test('buildProviderRegistry includes every code-default provider in `providers`', () => {
  const reg = buildProviderRegistry({ policy: {}, now: NOW });
  assert.deepEqual(Object.keys(reg.providers).sort(), Object.keys(PROVIDERS).sort());
});

// ─── native-anthropic omission ─────────────────────────────────────────────

test('buildProviderRegistry omits the native anthropic provider from routes but keeps it in providers', () => {
  const reg = buildProviderRegistry({ policy: {}, now: NOW });
  assert.ok('anthropic' in reg.providers);
  assert.equal('anthropic' in reg.routes, false);
});

// ─── BYO-key routes ─────────────────────────────────────────────────────────

test('buildProviderRegistry routes deepseek via its openai-wire baseUrl (not anthropicBaseUrl)', () => {
  const reg = buildProviderRegistry({ policy: {}, now: NOW });
  assert.deepEqual(reg.routes.deepseek, {
    upstreamUrl: 'https://api.deepseek.com',
    wire: 'openai',
    keyEnv: 'DEEPSEEK_KEY',
  });
});

test('buildProviderRegistry routes openrouter via its openai-wire baseUrl', () => {
  const reg = buildProviderRegistry({ policy: {}, now: NOW });
  assert.deepEqual(reg.routes.openrouter, {
    upstreamUrl: 'https://openrouter.ai/api/v1',
    wire: 'openai',
    keyEnv: 'OPENROUTER_KEY',
  });
});

test('buildProviderRegistry routes an anthropic-wire BYO provider via anthropicBaseUrl when present', () => {
  // None of the code defaults naturally hit the anthropic-wire branch (only `anthropic` itself
  // has wire:'anthropic', and it's native) — overlay deepseek's wire to exercise it instead.
  const policy = { providers: { deepseek: { wire: 'anthropic' } } };
  const reg = buildProviderRegistry({ policy, now: NOW });
  assert.deepEqual(reg.routes.deepseek, {
    upstreamUrl: 'https://api.deepseek.com/anthropic',
    wire: 'anthropic',
    keyEnv: 'DEEPSEEK_KEY',
  });
});

// ─── enforcement derivation ─────────────────────────────────────────────────

test('buildProviderRegistry derives enforcement.default from agent_budget.default caps', () => {
  const policy = { agent_budget: { default: { per_5h_tokens: 100000, per_week_tokens: 1000000 } } };
  const reg = buildProviderRegistry({ policy, now: NOW });
  assert.deepEqual(reg.enforcement, { default: { per5hTokens: 100000, perWeekTokens: 1000000 } });
});

test('buildProviderRegistry fills a missing cap field with null rather than fabricating it', () => {
  const policy = { agent_budget: { default: { per_5h_tokens: 100000 } } };
  const reg = buildProviderRegistry({ policy, now: NOW });
  assert.deepEqual(reg.enforcement, { default: { per5hTokens: 100000, perWeekTokens: null } });
});

test('buildProviderRegistry omits enforcement entirely when no agent_budget.default caps are set', () => {
  const policy = { agent_budget: { claude: { per_5h_tokens: 800000 } } };
  const reg = buildProviderRegistry({ policy, now: NOW });
  assert.equal('enforcement' in reg, false);
});

test('buildProviderRegistry omits enforcement when policy has no agent_budget at all', () => {
  const reg = buildProviderRegistry({ policy: {}, now: NOW });
  assert.equal('enforcement' in reg, false);
});

// ─── keyEnv guarantee — both halves ─────────────────────────────────────────

test('buildProviderRegistry throws when a policy overlay sneaks a literal secret into a routable provider keyEnv', () => {
  const policy = { providers: { deepseek: { keyEnv: 'sk-live-abc123' } } };
  assert.throws(() => buildProviderRegistry({ policy, now: NOW }), /keyEnv/);
});

test('buildProviderRegistry throws when a policy overlay sets a lowercase keyEnv', () => {
  const policy = { providers: { openrouter: { keyEnv: 'openrouter_key' } } };
  assert.throws(() => buildProviderRegistry({ policy, now: NOW }), /keyEnv/);
});

test('buildProviderRegistry catches a bad keyEnv on the providers half even when it makes the provider (non-)routable', () => {
  // Overlaying a non-null keyEnv onto the native anthropic descriptor makes it no longer
  // "native" (isNativeAnthropic requires baseUrl===null && keyEnv===null) — it still must be
  // caught by the keyEnv guarantee before validateProviderRegistry ever runs.
  const policy = { providers: { anthropic: { keyEnv: 'sk-oops' } } };
  assert.throws(() => buildProviderRegistry({ policy, now: NOW }), /keyEnv/);
});

// ─── self-check ─────────────────────────────────────────────────────────────

test('buildProviderRegistry throws (via its own validateProviderRegistry self-check) on a malformed overlay', () => {
  const policy = { providers: { deepseek: { wire: 'grpc' } } };
  assert.throws(() => buildProviderRegistry({ policy, now: NOW }), /wire/);
});

// ─── serializeRegistry ──────────────────────────────────────────────────────

test('serializeRegistry produces a JSON string', () => {
  const reg = buildProviderRegistry({ policy: {}, now: NOW });
  const out = serializeRegistry(reg);
  assert.equal(typeof out, 'string');
  assert.deepEqual(JSON.parse(out), reg);
});

test('serializeRegistry is deterministic regardless of source key insertion order', () => {
  const a = { version: 1, tenant: 'pv', generatedAt: 'x', providers: { b: 2, a: 1 }, routes: {} };
  const b = { tenant: 'pv', version: 1, providers: { a: 1, b: 2 }, generatedAt: 'x', routes: {} };
  assert.equal(serializeRegistry(a), serializeRegistry(b));
});

test('serializeRegistry sorts nested object keys too (e.g. a provider\'s `models` map)', () => {
  const nested = { z: { z: 1, a: 2 }, a: 1 };
  const out = JSON.parse(serializeRegistry(nested));
  assert.deepEqual(Object.keys(out), ['a', 'z']);
  assert.deepEqual(Object.keys(out.z), ['a', 'z']);
});
