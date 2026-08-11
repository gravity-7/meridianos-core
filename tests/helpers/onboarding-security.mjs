import assert from 'node:assert/strict';

const escape = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Assert that a browser/API/log payload cannot contain any supplied secret. */
export function assertNoOnboardingSecret(value, secrets) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  for (const secret of secrets) assert.doesNotMatch(serialized, new RegExp(escape(secret), 'i'));
}
