import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toSafeProviderValidationResult } from '../provider-conformance.mjs';
import { createOnboardingLifecycleEvent } from '../setup-wizard-core.mjs';
import { logOnboardingLifecycleEvent } from '../daemon-logger.mjs';
import { assertNoOnboardingSecret } from './helpers/onboarding-security.mjs';

test('provider validation UI result redacts upstream errors, URLs, and credentials', () => {
  const result = toSafeProviderValidationResult({
    ok: false, latencyMs: 12, errorCode: 'CONNECTION_FAILED',
    errorMessage: 'https://example.test/?key=not-for-ui',
  }, 'deepseek');
  assert.deepEqual(result, {
    providerId: 'deepseek', status: 'unreachable', retryable: true,
    messageCode: 'provider_unreachable', latencyMs: 12, modelsFound: null,
  });
  assertNoOnboardingSecret(result, ['example.test', 'not-for-ui', 'https://']);
});

test('onboarding lifecycle events allow-list timing and outcome metadata only', () => {
  const event = createOnboardingLifecycleEvent({
    event: 'onboarding_completed', providerId: 'deepseek', agentCount: 2,
    outcome: 'committed', elapsedMs: 9_999_999, credential: 'never-log-me',
  });
  assert.deepEqual(event, {
    event: 'onboarding_completed', providerId: 'deepseek', agentCount: 2,
    outcome: 'committed', elapsedMs: 3_600_000,
  });
  const calls = [];
  logOnboardingLifecycleEvent({ log: (...args) => calls.push(args) }, event);
  assert.deepEqual(calls, [['onboarding', JSON.stringify(event)]]);
  assertNoOnboardingSecret(calls, ['never-log-me']);
  assert.throws(() => createOnboardingLifecycleEvent({ event: 'credential_captured' }), /unsupported/i);
});
