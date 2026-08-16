/**
 * Focused security contract for the legacy /setup compatibility bridge.
 * All credentials in this file are inert synthetic sentinels.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listSetupProviders } from '../provider-wizard.mjs';
import { createSetupValidationSessionStore } from '../setup-validation-session.mjs';
import { buildSetupReview } from '../setup-wizard-core.mjs';
import { validateSetupProviderConnection } from '../provider-conformance.mjs';

const SYNTHETIC_SECRET = 'synthetic-onboarding-sentinel';
const CHOICE = {
  providerId: 'deepseek',
  displayName: 'DeepSeek',
  keyEnv: 'DEEPSEEK_KEY',
  modelId: 'deepseek-v4-flash',
};

test('setup catalog exposes registered provider metadata only and excludes Z.ai GLM', () => {
  const providers = listSetupProviders();
  const deepseek = providers.find((provider) => provider.id === 'deepseek');

  assert.deepEqual(deepseek, {
    id: 'deepseek',
    displayName: 'DeepSeek',
    keyEnv: 'DEEPSEEK_KEY',
    models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
  });
  assert.equal(providers.some((provider) => /z\.ai|glm/i.test(`${provider.id} ${provider.displayName}`)), false);
  assert.doesNotMatch(JSON.stringify(providers), new RegExp(SYNTHETIC_SECRET));
});

test('live-canary provider scope follows the registry and keeps Z.ai GLM unsupported', () => {
  const providers = listSetupProviders();
  assert.ok(providers.some((provider) => provider.id === 'deepseek' && provider.models.includes('deepseek-v4-flash')));
  assert.equal(providers.some((provider) => provider.id === 'zai' || /z\.ai|glm/i.test(`${provider.id} ${provider.displayName}`)), false);
});

test('validation sessions expire, bind to one setup session, and are consumed only by commit', () => {
  let now = 1_000;
  const sessions = createSetupValidationSessionStore({ now: () => now, ttlMs: 50, randomId: () => 'opaque-id' });
  const validation = sessions.createValidated({ choice: CHOICE, secret: SYNTHETIC_SECRET, sessionId: 'browser-a' });

  assert.deepEqual(validation, {
    id: 'opaque-id',
    status: 'valid',
    summary: 'Connection verified. Continue to budget.',
  });
  assert.throws(() => sessions.getValidatedChoice({ validationId: validation.id, sessionId: 'browser-b' }), /validation/i);
  assert.deepEqual(
    sessions.consumeValidatedChoice({ validationId: validation.id, sessionId: 'browser-a' }).choice,
    CHOICE,
  );
  assert.throws(() => sessions.getValidatedChoice({ validationId: validation.id, sessionId: 'browser-a' }), /validation/i);

  const expiring = sessions.createValidated({ choice: CHOICE, secret: SYNTHETIC_SECRET, sessionId: 'browser-a' });
  now += 51;
  assert.throws(() => sessions.getValidatedChoice({ validationId: expiring.id, sessionId: 'browser-a' }), /validation/i);
});

test('a replacement validation promptly revokes the previous session credential and review', () => {
  let sequence = 0;
  const sessions = createSetupValidationSessionStore({
    ttlMs: 60_000,
    randomId: () => `opaque-${sequence += 1}`,
  });
  const first = sessions.createValidated({ choice: CHOICE, secret: SYNTHETIC_SECRET, sessionId: 'browser-a' });
  const reviewId = sessions.createReviewedSetup({
    validationId: first.id,
    sessionId: 'browser-a',
    review: { installationName: 'Synthetic Lab' },
  });
  const replacement = sessions.createValidated({ choice: CHOICE, secret: `${SYNTHETIC_SECRET}-replacement`, sessionId: 'browser-a' });

  assert.throws(() => sessions.getValidatedChoice({ validationId: first.id, sessionId: 'browser-a' }), /validation/i);
  assert.throws(() => sessions.getReviewedChoice({
    reviewId,
    validationId: first.id,
    sessionId: 'browser-a',
    review: { installationName: 'Synthetic Lab' },
  }), /validation/i);
  assert.equal(sessions.getValidatedChoice({ validationId: replacement.id, sessionId: 'browser-a' }).secret, `${SYNTHETIC_SECRET}-replacement`);
});

test('cancelling a validation promptly removes its server-side credential', () => {
  const sessions = createSetupValidationSessionStore({ ttlMs: 60_000 });
  const validation = sessions.createValidated({ choice: CHOICE, secret: SYNTHETIC_SECRET, sessionId: 'browser-a' });

  assert.equal(sessions.revokeValidatedChoice({ validationId: validation.id, sessionId: 'browser-a' }), true);
  assert.equal(sessions.revokeValidatedChoice({ validationId: validation.id, sessionId: 'browser-a' }), false);
  assert.throws(() => sessions.getValidatedChoice({ validationId: validation.id, sessionId: 'browser-a' }), /validation/i);
});

test('review is pure and redacted even when a server-side validation retains a synthetic key', () => {
  const review = buildSetupReview({
    tenantName: 'Synthetic Lab',
    agents: ['builder'],
    choice: CHOICE,
    monthlyBudgetUsd: 25,
  });
  const encoded = JSON.stringify(review);

  assert.equal(review.route.providerId, 'deepseek');
  assert.equal(review.route.modelId, 'deepseek-v4-flash');
  assert.deepEqual(review.files.map((file) => file.name), ['.ai/policy.yaml', '.ai/tenant.yaml', '.env']);
  assert.doesNotMatch(encoded, new RegExp(SYNTHETIC_SECRET));
  assert.doesNotMatch(encoded, /DEEPSEEK_KEY=/);
});

test('legacy setup source has accessible provider controls and does not persist credentials', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../dashboard/setup.html', import.meta.url), 'utf8');

  assert.match(source, /for="providerId"/);
  assert.match(source, /for="modelId"/);
  assert.match(source, /for="providerKey"/);
  assert.match(source, /type="password"/);
  assert.match(source, /\/api\/setup\/provider-validation/);
  assert.match(source, /\/api\/setup\/provider-validation\/revoke/);
  assert.match(source, /pagehide/);
  assert.match(source, /role="alert"/);
  const savedState = source.match(/localStorage\.setItem\(STORAGE_KEY, JSON\.stringify\(\{([\s\S]*?)\}\)\);/);
  assert.ok(savedState, 'setup state persistence should have an explicit whitelist');
  for (const field of ['step', 'tenantName', 'agentsRaw', 'monthlyBudgetUsd', 'providerId', 'modelId']) {
    assert.match(savedState[1], new RegExp(`\\b${field}\\b`));
  }
  assert.doesNotMatch(savedState[1], /providerKey|secret|validationId|reviewId|sessionId/);
});

test('provider recovery maps authorization, timeout, and unavailable results without secret reflection', async () => {
  const provider = { name: 'deepseek', wire: 'openai', baseUrl: 'http://127.0.0.1:9', keyEnv: 'DEEPSEEK_KEY' };
  const cases = [
    [{ ok: false, errorCode: 'AUTH_FAILED' }, 'invalid', 'AUTH_FAILED'],
    [{ ok: false, errorCode: 'TIMEOUT' }, 'timeout', 'TIMEOUT'],
    [{ ok: false, errorCode: 'CONNECTION_FAILED' }, 'unavailable', 'UNAVAILABLE'],
  ];
  for (const [result, status, code] of cases) {
    const recovery = await validateSetupProviderConnection(provider, SYNTHETIC_SECRET, {
      testConnection: async (_provider, secret) => {
        assert.equal(secret, SYNTHETIC_SECRET);
        return result;
      },
    });
    assert.equal(recovery.status, status);
    if (status !== 'valid') assert.equal(recovery.code, code);
    assert.doesNotMatch(JSON.stringify(recovery), new RegExp(SYNTHETIC_SECRET));
  }
});

test('an invalid provider result cannot create a validation handle or pass the browser completion gate', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('../dashboard/setup.html', import.meta.url), 'utf8');
  assert.match(source, /if \(step === 'providers' && !transient\.validationId\)/);
  assert.match(source, /Validate the selected provider and model before continuing/);
  const sessions = createSetupValidationSessionStore({ ttlMs: 60_000 });
  assert.throws(() => sessions.getValidatedChoice({ validationId: 'invalid', sessionId: 'browser-a' }), /validation/i);
});
