import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS } from '../../providers.mjs';
import { validateProviderRegistry, resolveRoute } from '../provider-registry.mjs';

function fullRegistry(overrides = {}) {
  return {
    version: 1,
    generatedAt: '2026-07-14T00:00:00.000Z',
    tenant: 'pv',
    providers: { anthropic: PROVIDERS.anthropic, deepseek: PROVIDERS.deepseek },
    routes: {
      anthropic: { upstreamUrl: 'https://api.anthropic.com', wire: 'anthropic', keyEnv: null },
      deepseek: { upstreamUrl: 'https://api.deepseek.com', wire: 'openai', keyEnv: 'DEEPSEEK_KEY' },
    },
    ...overrides,
  };
}

// ─── validateProviderRegistry — happy path ─────────────────────────────────

test('validateProviderRegistry passes on a well-formed registry', () => {
  assert.equal(validateProviderRegistry(fullRegistry()), true);
});

test('validateProviderRegistry passes with no enforcement section', () => {
  const reg = fullRegistry();
  assert.equal('enforcement' in reg, false);
  assert.equal(validateProviderRegistry(reg), true);
});

test('validateProviderRegistry passes with a full enforcement section', () => {
  const reg = fullRegistry({
    enforcement: {
      default: { per5hTokens: 100000, perWeekTokens: 1000000 },
      perProvider: { deepseek: { per5hTokens: 50000 } },
    },
  });
  assert.equal(validateProviderRegistry(reg), true);
});

test('validateProviderRegistry passes with null enforcement caps', () => {
  const reg = fullRegistry({ enforcement: { default: { per5hTokens: null, perWeekTokens: null } } });
  assert.equal(validateProviderRegistry(reg), true);
});

// ─── validateProviderRegistry — throws on the first malformed field ───────

test('validateProviderRegistry throws on a non-object', () => {
  assert.throws(() => validateProviderRegistry(null), /object/);
});

test('validateProviderRegistry throws on a non-integer version', () => {
  const reg = fullRegistry({ version: 1.5 });
  assert.throws(() => validateProviderRegistry(reg), /version/);
});

test('validateProviderRegistry throws on a missing generatedAt', () => {
  const reg = fullRegistry({ generatedAt: '' });
  assert.throws(() => validateProviderRegistry(reg), /generatedAt/);
});

test('validateProviderRegistry throws on an empty tenant', () => {
  const reg = fullRegistry({ tenant: '' });
  assert.throws(() => validateProviderRegistry(reg), /tenant/);
});

test('validateProviderRegistry throws when providers is missing', () => {
  const reg = fullRegistry(); delete reg.providers;
  assert.throws(() => validateProviderRegistry(reg), /providers/);
});

test('validateProviderRegistry composes validateProviders — throws on a malformed provider descriptor', () => {
  const reg = fullRegistry({ providers: { anthropic: { ...PROVIDERS.anthropic, wire: 'grpc' } } });
  assert.throws(() => validateProviderRegistry(reg), /wire/);
});

test('validateProviderRegistry throws when routes is missing', () => {
  const reg = fullRegistry(); delete reg.routes;
  assert.throws(() => validateProviderRegistry(reg), /routes/);
});

test('validateProviderRegistry throws on a route missing upstreamUrl', () => {
  const reg = fullRegistry({ routes: { anthropic: { wire: 'anthropic', keyEnv: null } } });
  assert.throws(() => validateProviderRegistry(reg), /upstreamUrl/);
});

test('validateProviderRegistry throws on a route with an invalid wire', () => {
  const reg = fullRegistry();
  reg.routes.anthropic.wire = 'grpc';
  assert.throws(() => validateProviderRegistry(reg), /wire/);
});

test('validateProviderRegistry throws on a route whose keyEnv is a literal secret, not an env-var name', () => {
  const reg = fullRegistry();
  reg.routes.deepseek.keyEnv = 'sk-live-abc123';
  assert.throws(() => validateProviderRegistry(reg), /keyEnv/);
});

test('validateProviderRegistry throws on a route whose keyEnv is lowercase', () => {
  const reg = fullRegistry();
  reg.routes.deepseek.keyEnv = 'deepseek_key';
  assert.throws(() => validateProviderRegistry(reg), /keyEnv/);
});

test('validateProviderRegistry accepts a null keyEnv on a route', () => {
  const reg = fullRegistry();
  reg.routes.anthropic.keyEnv = null;
  assert.equal(validateProviderRegistry(reg), true);
});

test('validateProviderRegistry throws when a route references a provider absent from providers', () => {
  const reg = fullRegistry({ routes: { openrouter: { upstreamUrl: 'https://openrouter.ai/api/v1', wire: 'openai', keyEnv: 'OPENROUTER_KEY' } } });
  assert.throws(() => validateProviderRegistry(reg), /openrouter/);
});

test('validateProviderRegistry throws when enforcement is not an object', () => {
  const reg = fullRegistry({ enforcement: 'nope' });
  assert.throws(() => validateProviderRegistry(reg), /enforcement/);
});

test('validateProviderRegistry throws when enforcement.default.per5hTokens is not a number or null', () => {
  const reg = fullRegistry({ enforcement: { default: { per5hTokens: '100000' } } });
  assert.throws(() => validateProviderRegistry(reg), /per5hTokens/);
});

test('validateProviderRegistry throws when enforcement.perProvider is not an object', () => {
  const reg = fullRegistry({ enforcement: { perProvider: 'nope' } });
  assert.throws(() => validateProviderRegistry(reg), /perProvider/);
});

test('validateProviderRegistry throws when a perProvider cap entry is malformed', () => {
  const reg = fullRegistry({ enforcement: { perProvider: { deepseek: { perWeekTokens: 'lots' } } } });
  assert.throws(() => validateProviderRegistry(reg), /perWeekTokens/);
});

// ─── resolveRoute ────────────────────────────────────────────────────────

test('resolveRoute returns the route for a known provider', () => {
  const reg = fullRegistry();
  assert.deepEqual(resolveRoute(reg, 'deepseek'), { upstreamUrl: 'https://api.deepseek.com', wire: 'openai', keyEnv: 'DEEPSEEK_KEY' });
});

test('resolveRoute returns null for a provider with no route', () => {
  const reg = fullRegistry();
  assert.equal(resolveRoute(reg, 'openrouter'), null);
});

test('resolveRoute returns null on an empty/absent routes map', () => {
  assert.equal(resolveRoute({}, 'anthropic'), null);
  assert.equal(resolveRoute(null, 'anthropic'), null);
});
