import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(import.meta.dirname, '..', 'desktop', 'main.js'), 'utf8');

test('desktop onboarding main process allow-lists credential operations and does not use .env fallback', () => {
  assert.match(source, /onboarding:validate-credential/);
  assert.match(source, /onboarding:store-credential/);
  assert.match(source, /onboarding:commit-setup/);
  assert.match(source, /credentialStore: 'keychain'/);
  assert.match(source, /secure_storage_unavailable/);
  assert.match(source, /secure_storage_existing/);
  assert.match(source, /validOnboardingCredential/);
  assert.match(source, /const expiry = onboardingValidations\.get\(providerId\);/);
  assert.match(source, /!expiry \|\| expiry < Date\.now\(\)/);
  assert.doesNotMatch(source, /unlinkSync\(envPath\)/);
});
