import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createOnboardingFixture,
  ONBOARDING_MODEL_ID,
  ONBOARDING_PROVIDER_ID,
  SYNTHETIC_CREDENTIAL_SENTINEL,
} from './fixtures/onboarding-fixture.mjs';
import { assertBrowserOrigin, assertLoopbackEndpoint, assertNoInheritedProviderKeys, createLoopbackFetch } from './fixtures/persona-network-guard.mjs';

async function setupClient(fixture) {
  const page = await fetch(`${fixture.dashboardUrl}/setup`);
  assert.equal(page.status, 200);
  const html = await page.text();
  const token = html.match(/const AIOS_TOKEN = "([^"]+)"/)?.[1];
  const sessionId = html.match(/const SETUP_SESSION_ID = "([^"]+)"/)?.[1];
  assert.ok(token);
  assert.ok(sessionId);
  const call = async (path, body) => {
    const response = await fetch(`${fixture.dashboardUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'origin': fixture.dashboardUrl, 'x-aios-token': token },
      body: JSON.stringify({ ...body, sessionId }),
    });
    return { status: response.status, body: await response.json() };
  };
  return { sessionId, call };
}

test('isolated fixture serves the real /setup page with synthetic status and no inherited provider keys', async () => {
  const fixture = await createOnboardingFixture();
  try {
    const response = await fetch(`${fixture.dashboardUrl}/api/setup/status`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.synthetic, true);
    assert.equal(body.providers.some((provider) => provider.id === ONBOARDING_PROVIDER_ID), true);
    assert.doesNotMatch(JSON.stringify(body), new RegExp(SYNTHETIC_CREDENTIAL_SENTINEL));
    assert.equal(existsSync(join(fixture.root, '.ai', 'policy.yaml')), false);
    assert.equal(Object.keys(fixture.environment).some((key) => /API_KEY|DEEPSEEK_KEY/.test(key)), false);
    assert.equal(fixture.attemptLedger().length, 0);
  } finally {
    const root = fixture.root;
    const result = await fixture.close();
    assert.equal(result.rootRemoved, true);
    assert.equal(existsSync(root), false);
  }
});

test('fixture allowlists the exact browser origin and rejects external/redirect dependency paths', async () => {
  const fixture = await createOnboardingFixture();
  try {
    assertBrowserOrigin(`${fixture.dashboardUrl}/setup`, fixture.dashboardUrl);
    assert.throws(() => assertBrowserOrigin('https://example.invalid/setup', fixture.dashboardUrl), /loopback|origin/i);
    assert.throws(() => assertLoopbackEndpoint('http://127.0.0.1.evil.invalid/models'), /loopback/i);
    assert.throws(() => assertNoInheritedProviderKeys({ DEEPSEEK_KEY: 'not-read' }), /provider key/i);
    const guarded = createLoopbackFetch(async () => ({ status: 200, redirected: false }));
    await assert.rejects(() => guarded('https://example.invalid/provider'), /loopback/i);
    assert.equal(guarded.externalAttemptCount, 1);
    assert.equal(guarded.attempts[0].allowed, false);
  } finally {
    await fixture.close();
  }
});

test('loopback provider failure modes are classified safely and never expose the sentinel', async () => {
  const fixture = await createOnboardingFixture({ validationTimeoutMs: 50 });
  try {
    const client = await setupClient(fixture);
    const base = { providerId: ONBOARDING_PROVIDER_ID, modelId: ONBOARDING_MODEL_ID, secret: SYNTHETIC_CREDENTIAL_SENTINEL };
    for (const [mode, code] of [['auth', 'AUTH_FAILED'], ['timeout', 'TIMEOUT'], ['unavailable', 'UNAVAILABLE']]) {
      fixture.setProviderMode(mode);
      const response = await client.call('/api/setup/provider-validation', base);
      assert.equal(response.status, 200);
      assert.equal(response.body.ok, false);
      assert.equal(response.body.code, code);
      assert.doesNotMatch(JSON.stringify(response.body), new RegExp(SYNTHETIC_CREDENTIAL_SENTINEL));
    }
    assert.equal(fixture.externalAttemptCount, 0);
    assert.equal(fixture.providerAttempts.every((attempt) => attempt.sentinelSeen === true), true);
  } finally {
    await fixture.close();
  }
});

test('a loopback provider redirect is rejected before any external destination is contacted', async () => {
  const fixture = await createOnboardingFixture({ validationTimeoutMs: 50 });
  try {
    const client = await setupClient(fixture);
    fixture.setProviderMode('redirect');
    const response = await client.call('/api/setup/provider-validation', {
      providerId: ONBOARDING_PROVIDER_ID, modelId: ONBOARDING_MODEL_ID, secret: SYNTHETIC_CREDENTIAL_SENTINEL,
    });
    assert.equal(response.body.ok, false);
    assert.equal(response.body.code, 'UNAVAILABLE');
    assert.equal(fixture.externalAttemptCount, 0);
    assert.equal(fixture.providerAttempts.at(-1).status, 302);
  } finally {
    await fixture.close();
  }
});

test('review is non-writing, invalid completion is blocked, and explicit commit writes only the fixture root', async () => {
  const fixture = await createOnboardingFixture();
  try {
    const client = await setupClient(fixture);
    const base = { providerId: ONBOARDING_PROVIDER_ID, modelId: ONBOARDING_MODEL_ID, secret: SYNTHETIC_CREDENTIAL_SENTINEL };
    fixture.setProviderMode('auth');
    const failed = await client.call('/api/setup/provider-validation', base);
    assert.equal(failed.body.ok, false);
    const blocked = await client.call('/api/setup/commit', { ...base, validationId: 'missing', reviewId: 'missing', confirmed: true });
    assert.equal(blocked.body.ok, false);
    assert.equal(existsSync(join(fixture.root, '.ai', 'policy.yaml')), false);

    fixture.setProviderMode('success');
    const validated = await client.call('/api/setup/provider-validation', base);
    assert.equal(validated.body.ok, true);
    const review = await client.call('/api/setup/plan', {
      tenantName: 'Synthetic Fixture', agents: ['builder'], monthlyBudgetUsd: 25,
      providerId: ONBOARDING_PROVIDER_ID, modelId: ONBOARDING_MODEL_ID, validationId: validated.body.validation.id,
    });
    assert.equal(review.body.ok, true);
    assert.equal(existsSync(join(fixture.root, '.ai', 'policy.yaml')), false);
    assert.doesNotMatch(JSON.stringify(review.body), new RegExp(SYNTHETIC_CREDENTIAL_SENTINEL));
    const notConfirmed = await client.call('/api/setup/commit', {
      tenantName: 'Synthetic Fixture', agents: ['builder'], monthlyBudgetUsd: 25,
      providerId: ONBOARDING_PROVIDER_ID, modelId: ONBOARDING_MODEL_ID, validationId: validated.body.validation.id,
      reviewId: review.body.review.id, confirmed: false,
    });
    assert.equal(notConfirmed.body.ok, false);
    assert.equal(existsSync(join(fixture.root, '.env')), false);
    const committed = await client.call('/api/setup/commit', {
      tenantName: 'Synthetic Fixture', agents: ['builder'], monthlyBudgetUsd: 25,
      providerId: ONBOARDING_PROVIDER_ID, modelId: ONBOARDING_MODEL_ID, validationId: validated.body.validation.id,
      reviewId: review.body.review.id, confirmed: true,
    });
    assert.equal(committed.body.ok, true);
    assert.deepEqual(committed.body.filesWritten.sort(), ['.ai/policy.yaml', '.ai/tenant.yaml', '.env'].sort());
    assert.equal(existsSync(join(fixture.root, '.ai', 'policy.yaml')), true);
    assert.equal(existsSync(join(fixture.root, '.ai', 'tenant.yaml')), true);
    assert.equal(readFileSync(join(fixture.root, '.env'), 'utf8').includes(SYNTHETIC_CREDENTIAL_SENTINEL), true);
  } finally {
    await fixture.close();
  }
});

test('redacted evidence includes safe triage for a non-pass run and survives fixture cleanup', async () => {
  const fixture = await createOnboardingFixture();
  try {
    assert.equal(fixture.scanRedaction({ values: [Buffer.from(SYNTHETIC_CREDENTIAL_SENTINEL)] }).passed, false);
    const evidence = fixture.writeEvidence({
      status: 'failed',
      checkpoints: [{ id: 'provider-recovery', expected: 'focused recovery', actual: 'timeout', outcome: 'failed' }],
      diagnostics: { browser_error_count: 0, external_attempt_count: 0 },
      redactionValues: ['DOM has no sentinel', 'storage has no sentinel'],
    });
    assert.equal(existsSync(evidence.manifestPath), true);
    assert.equal(existsSync(evidence.resultPath), true);
    assert.equal(existsSync(evidence.triagePath), true);
    assert.doesNotMatch(readFileSync(evidence.manifestPath, 'utf8'), new RegExp(SYNTHETIC_CREDENTIAL_SENTINEL));
    assert.doesNotMatch(readFileSync(evidence.resultPath, 'utf8'), new RegExp(SYNTHETIC_CREDENTIAL_SENTINEL));
    assert.equal(evidence.result.safety.raw_trace_retained, false);
  } finally {
    const evidenceDir = fixture.evidenceDir;
    await fixture.close();
    assert.equal(existsSync(evidenceDir), true);
  }
});
