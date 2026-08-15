import { test, expect } from '@playwright/test';

const secret = 'never-persist-or-display-this-provider-credential';
const provider = { id: 'deepseek', label: 'DeepSeek', requiresCredential: true };

async function stubOnboarding(page, { configured = false, validation = 'valid', firstRun = null } = {}) {
  const requests = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/onboarding/')) requests.push(request.postData() ?? '');
  });
  await page.route('**/api/onboarding/status', (route) => route.fulfill({ json: {
    ok: true, installation: configured ? 'configured' : 'fresh', providers: [provider], compatibility: { legacySetupAvailable: true },
  } }));
  await page.route('**/api/onboarding/provider-validation', (route) => route.fulfill({ json: {
    ok: true, revision: 'safe-revision', result: {
      providerId: 'deepseek', status: validation, retryable: validation !== 'invalid',
      messageCode: validation === 'valid' ? 'provider_valid' : 'provider_auth_failed', latencyMs: 12, modelsFound: 1, testedAt: '2026-08-11T00:00:00.000Z',
    },
  } }));
  await page.route('**/api/onboarding/preview', (route) => route.fulfill({ json: {
    ok: true, review: { revision: 'safe-revision', provider: { id: 'deepseek', label: 'DeepSeek' }, agents: ['builder'], monthlyBudgetUsd: 25, budget: { monthlyBudgetUsd: 25 }, files: ['.ai/policy.yaml', '.ai/tenant.yaml', '.env'] },
  } }));
  await page.route('**/api/onboarding/commit', (route) => route.fulfill({ json: {
    ok: true, outcome: 'committed', filesWritten: ['.ai/policy.yaml', '.ai/tenant.yaml', '.env'], checklist: { firstTaskTarget: '/?workspace=admin', firstRunTarget: null },
  } }));
  await page.route('**/api/onboarding/checklist', (route) => route.fulfill({ json: { ok: true, firstRun } }));
  await page.route('**/api/run?id=first-run-012', (route) => route.fulfill({ json: { ok: true, run: { run_id: 'first-run-012', task: 'first-task-012', outcome: 'ok' }, ledgerCost: null } }));
  return requests;
}

// Phase 1 implements the safe legacy /setup bridge. The unified /app/setup flow remains a
// separately planned Phase 2 surface and must not be represented as delivered by this PR.
test.describe.skip('planned unified /app/setup onboarding (Phase 2)', () => {
test('safe browser onboarding is resumable, keyboard-accessible, and never persists the credential', async ({ page }, testInfo) => {
  const requests = await stubOnboarding(page);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/app/setup');
  await expect(page.getByRole('navigation', { name: 'Setup progress' })).toBeVisible();
  await expect(page.getByRole('listitem', { name: 'Installation, step 1 of 5' })).toHaveAttribute('aria-current', 'step');
  await page.getByLabel('Installation name').fill('Safe Test Tenant');
  await page.getByLabel('Agent roster (comma-separated)').fill('builder');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Connect a provider' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Connect a provider' })).toBeVisible();
  await expect(page.getByLabel('Provider credential')).toHaveValue('');
  await page.getByLabel('Provider credential').fill(secret);
  await page.getByRole('button', { name: 'Validate provider' }).click();
  await expect(page.getByRole('heading', { name: 'Set your budget' })).toBeVisible();
  await page.getByLabel('Monthly budget (USD)').fill('25');
  await page.getByRole('button', { name: 'Review setup' }).click();
  await expect(page.getByRole('heading', { name: 'Review setup' })).toBeVisible();
  await expect(page.getByText(secret)).toHaveCount(0);
  await page.getByLabel('I have reviewed these non-secret changes.').check();
  await page.getByRole('button', { name: 'Commit setup' }).click();
  await expect(page.getByRole('heading', { name: 'Setup complete' })).toBeVisible();
  await expect(page).toHaveURL(/\/app\/setup\/complete$/);
  await expect(page.getByRole('link', { name: 'Create or import your first task' })).toHaveAttribute('href', '/?workspace=admin');
  await expect(page.locator('[data-first-run="unavailable"]')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Setup complete' })).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(secret);
  expect(page.url()).not.toContain(secret);
  expect(requests.filter((body) => !body.includes('"credential"')).join('\n')).not.toContain(secret);
  expect(await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name).join('\n'))).not.toContain(secret);
  await page.setViewportSize({ width: 375, height: 720 });
  await page.screenshot({ path: testInfo.outputPath('onboarding-375.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('failed validation preserves safe choices, clears the input, and focuses the recovery alert', async ({ page }) => {
  await stubOnboarding(page, { validation: 'invalid' });
  await page.goto('/app/setup');
  await page.getByLabel('Installation name').fill('Retry Tenant');
  await page.getByLabel('Agent roster (comma-separated)').fill('builder');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Provider credential').fill(secret);
  await page.getByRole('button', { name: 'Validate provider' }).click();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('did not accept');
  await expect(alert).toBeFocused();
  await expect(page.getByLabel('Provider credential')).toHaveValue('');
  await expect(page.locator('#onboarding-provider')).toHaveValue('deepseek');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(secret);
});

test('configured installations show a recovery state without exposing a commit flow', async ({ page }) => {
  await stubOnboarding(page, { configured: true });
  await page.goto('/app/setup');
  await expect(page.getByRole('alert')).toContainText('existing installation');
  await expect(page.getByRole('button', { name: 'Commit setup' })).toHaveCount(0);
});

test('storage-unavailable recovery keeps the current session safe and explains the resume limitation', async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('blocked', 'SecurityError'); }; });
  await stubOnboarding(page);
  await page.goto('/app/setup');
  await page.getByLabel('Installation name').fill('No Storage Tenant');
  await page.getByLabel('Agent roster (comma-separated)').fill('builder');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('alert')).toContainText('storage is unavailable');
  await expect(page.getByRole('heading', { name: 'Connect a provider' })).toBeVisible();
});

test('completion observes a stable first-run identity only when the checklist reports one', async ({ page }) => {
  await stubOnboarding(page, { firstRun: { id: 'first-run-012', task: 'first-task-012', status: 'ok', target: '/app/setup/complete?run=first-run-012' } });
  await page.addInitScript(() => localStorage.setItem('meridianos.onboarding.completion.v1', JSON.stringify({ checklist: { firstTaskTarget: '/?workspace=admin', firstRunTarget: null } })));
  await page.goto('/app/setup/complete');
  await expect(page.getByRole('link', { name: 'View first run' })).toHaveAttribute('href', '/app/setup/complete?run=first-run-012');
  await page.getByRole('link', { name: 'View first run' }).click();
  await expect(page).toHaveURL(/run=first-run-012/);
  await expect(page.locator('[data-first-run-status="ok"]')).toContainText('first-run-012');
});
});
