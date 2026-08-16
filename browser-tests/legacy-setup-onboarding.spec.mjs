import { test, expect } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  createOnboardingFixture,
  ONBOARDING_MODEL_ID,
  ONBOARDING_PROVIDER_ID,
  SYNTHETIC_CREDENTIAL_SENTINEL,
} from '../tests/fixtures/onboarding-fixture.mjs';

// Raw Playwright traces can retain request headers and bodies. The dedicated onboarding config
// and this file-level setting keep this journey on explicitly redacted screenshots/JSON only.
test.use({ trace: 'off' });

test.describe('legacy /setup onboarding journey', () => {
  let fixture;
  let checkpoints;
  let observations;
  let screenshotNames;
  let consoleErrors;

  test.beforeEach(async ({ page }) => {
    fixture = await createOnboardingFixture();
    mkdirSync(fixture.evidenceDir, { recursive: true });
    checkpoints = [];
    observations = [];
    screenshotNames = [];
    consoleErrors = [];
    page.on('console', (message) => consoleErrors.push(message.text()));
    page.on('pageerror', (error) => consoleErrors.push(error.message));
  });

  test.afterEach(async ({ page }, testInfo) => {
    if (!fixture) return;
    const runFixture = fixture;
    const expectedPass = testInfo.status === testInfo.expectedStatus;
    let cleanup = 'failed';
    try {
      if (page && !page.isClosed()) {
        observations.push(await page.evaluate(() => ({
          html: document.documentElement.outerHTML,
          url: window.location.href,
          storage: JSON.stringify(localStorage),
          resources: performance.getEntriesByType('resource').map((entry) => entry.name),
        })));
      }
    } finally {
      const cleanupResult = await runFixture.close();
      cleanup = cleanupResult.rootRemoved ? 'removed' : 'failed';
      fixture = null;
    }
    try {
      runFixture.writeEvidence({
        status: expectedPass ? 'passed' : 'failed',
        checkpoints,
        screenshots: screenshotNames,
        redactionValues: [observations, consoleErrors],
        cleanup,
        diagnostics: {
          browser_error_count: consoleErrors.length,
          checkpoint_count: checkpoints.length,
          external_attempt_count: runFixture.externalAttemptCount,
          provider_attempt_count: runFixture.providerAttempts.length,
        },
      });
    } catch (error) {
      // Evidence validation is part of the journey contract, so surface unsafe evidence as a test failure.
      throw error;
    }
  });

  async function openSetup(page, { width = 1280, height = 800 } = {}) {
    await page.setViewportSize({ width, height });
    const target = `${fixture.dashboardUrl}/setup`;
    fixture.assertBrowserOrigin(target);
    await page.goto(target);
    await expect(page).toHaveURL(/\/setup$/);
    await expect(page.getByRole('heading', { name: 'MeridianOS Setup' })).toBeVisible();
    await expect(page.getByText('Synthetic and disposable lab environment.')).toBeVisible();
    checkpoints.push({ id: 'welcome', expected: 'welcome and synthetic label', actual: 'visible', outcome: 'passed' });
  }

  async function chooseDeepSeek(page) {
    await page.locator('#providerId').selectOption(ONBOARDING_PROVIDER_ID);
    await expect(page.locator('#providerId')).toHaveValue(ONBOARDING_PROVIDER_ID);
    await expect(page.locator('#modelId')).toHaveValue(ONBOARDING_MODEL_ID);
    checkpoints.push({ id: 'provider-choice', expected: 'registered DeepSeek route', actual: 'selected', outcome: 'passed' });
  }

  async function enterSafeDraft(page) {
    await page.getByLabel('What should we call this installation?').fill('Synthetic Founder Lab');
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByLabel('Comma-separated agent names').fill('builder,reviewer');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('heading', { name: 'Provider connection' })).toBeVisible();
    await chooseDeepSeek(page);
  }

  async function validateWithSentinel(page) {
    const requests = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/setup/')) requests.push(request.postData() ?? '');
    });
    await page.getByLabel(/Provider key for/).fill(SYNTHETIC_CREDENTIAL_SENTINEL);
    await page.getByRole('button', { name: 'Validate connection' }).click();
    return requests;
  }

  test('runs the visible wide/narrow/keyboard happy path with review before commit', async ({ page }) => {
    await openSetup(page);
    await page.keyboard.press('Tab');
    await expect(page.locator('#tenantName')).toBeFocused();
    await enterSafeDraft(page);
    const requestBodies = await validateWithSentinel(page);
    await expect(page.getByText('Connection verified. Continue to budget.')).toBeVisible();
    expect(requestBodies.filter((body) => body.includes(SYNTHETIC_CREDENTIAL_SENTINEL))).toHaveLength(1);
    expect(await page.locator('#providerKey').inputValue()).toBe('');
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(SYNTHETIC_CREDENTIAL_SENTINEL);
    observations.push(await page.evaluate(() => ({ html: document.documentElement.outerHTML, storage: JSON.stringify(localStorage) })));
    checkpoints.push({ id: 'provider-valid', expected: 'safe validation result', actual: 'visible', outcome: 'passed' });

    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Monthly budget (USD)').fill('25');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible();
    await expect(page.getByText('DeepSeek / deepseek-v4-flash')).toBeVisible();
    await expect(page.getByText('.env')).toBeVisible();
    expect(existsSync(join(fixture.root, '.ai', 'policy.yaml'))).toBe(false);
    expect(existsSync(join(fixture.root, '.ai', 'tenant.yaml'))).toBe(false);
    expect(existsSync(join(fixture.root, '.env'))).toBe(false);
    expect(await page.locator('body').innerText()).not.toContain(SYNTHETIC_CREDENTIAL_SENTINEL);
    checkpoints.push({ id: 'review-before-commit', expected: 'redacted review with no files written', actual: 'visible and fresh root', outcome: 'passed' });

    const widePath = fixture.evidencePath('setup-wide.png');
    await page.screenshot({ path: widePath, fullPage: true });
    screenshotNames.push('setup-wide.png');
    await page.getByRole('button', { name: 'Confirm and write files' }).click();
    await expect(page.getByRole('heading', { name: 'Setup complete' })).toBeVisible();
    expect(existsSync(join(fixture.root, '.ai', 'policy.yaml'))).toBe(true);
    expect(existsSync(join(fixture.root, '.ai', 'tenant.yaml'))).toBe(true);
    expect(existsSync(join(fixture.root, '.env'))).toBe(true);
    checkpoints.push({ id: 'explicit-commit', expected: 'fresh setup files after confirmation', actual: 'written', outcome: 'passed' });

    await page.setViewportSize({ width: 375, height: 720 });
    const narrowPath = fixture.evidencePath('setup-narrow.png');
    await page.screenshot({ path: narrowPath, fullPage: true });
    screenshotNames.push('setup-narrow.png');
    await expect(page.getByRole('heading', { name: 'Setup complete' })).toBeVisible();
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(SYNTHETIC_CREDENTIAL_SENTINEL);
    expect(page.url()).not.toContain(SYNTHETIC_CREDENTIAL_SENTINEL);
    checkpoints.push({ id: 'completion', expected: 'setup complete at narrow width', actual: 'visible', outcome: 'passed' });
  });

  test('shows safe authorization recovery, preserves choices, and retries successfully', async ({ page }) => {
    fixture.setProviderMode('auth');
    await openSetup(page, { width: 375, height: 720 });
    await enterSafeDraft(page);
    await validateWithSentinel(page);
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Authentication failed');
    await expect(alert).toBeFocused();
    await expect(page.getByLabel(/Provider key for/)).toHaveValue('');
    await expect(page.locator('#providerId')).toHaveValue(ONBOARDING_PROVIDER_ID);
    await expect(page.locator('#modelId')).toHaveValue(ONBOARDING_MODEL_ID);
    await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(alert).toContainText('Validate the selected provider and model');
    expect(existsSync(join(fixture.root, '.ai', 'policy.yaml'))).toBe(false);
    checkpoints.push({ id: 'provider-auth-failure', expected: 'focused non-secret recovery and blocked progression', actual: 'visible', outcome: 'passed' });

    fixture.setProviderMode('success');
    await page.getByLabel(/Provider key for/).fill(SYNTHETIC_CREDENTIAL_SENTINEL);
    await page.getByRole('button', { name: 'Validate connection' }).click();
    await expect(page.getByText('Connection verified. Continue to budget.')).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Monthly budget (USD)').fill('25');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible();
    expect(await page.locator('body').innerText()).not.toContain(SYNTHETIC_CREDENTIAL_SENTINEL);
    await page.getByRole('button', { name: 'Confirm and write files' }).click();
    await expect(page.getByRole('heading', { name: 'Setup complete' })).toBeVisible();
    const recoveryPath = fixture.evidencePath('setup-recovery-narrow.png');
    await page.screenshot({ path: recoveryPath, fullPage: true });
    screenshotNames.push('setup-recovery-narrow.png');
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(SYNTHETIC_CREDENTIAL_SENTINEL);
    checkpoints.push({ id: 'provider-retry-success', expected: 'same safe choices retry to completion', actual: 'committed', outcome: 'passed' });
  });
});
