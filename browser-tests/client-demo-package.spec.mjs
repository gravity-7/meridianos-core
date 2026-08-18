import { test, expect } from '@playwright/test';
import { createClientDemoFixture } from '../tests/fixtures/client-demo-fixture.mjs';
import { createOnboardingFixture, ONBOARDING_MODEL_ID, ONBOARDING_PROVIDER_ID, SYNTHETIC_CREDENTIAL_SENTINEL } from '../tests/fixtures/onboarding-fixture.mjs';

let fixture;

test.beforeEach(async () => {
  fixture = await createClientDemoFixture({ port: 0 });
});

test.afterEach(async () => {
  if (fixture) {
    await fixture.close();
    fixture = null;
  }
});

test('client demo uses the local root route for fixture sign-in, health, preview, and confirmation boundary', async ({ page }) => {
  await page.goto(fixture.dashboardUrl);
  await expect(page).toHaveURL(fixture.dashboardUrl);
  await expect(page.getByRole('heading', { name: 'MeridianOS Cloud Control Plane' })).toBeVisible();
  await page.getByLabel('Email').fill(fixture.credentials.email);
  await page.getByLabel('Password').fill(fixture.credentials.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Connected Machines' })).toBeVisible();
  await expect(page.getByText('aurora-console')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Provider Health (aggregate)' })).toBeVisible();
  await expect(page.getByText('synthetic_control')).toBeVisible();
  await page.getByLabel('Policy path').fill(fixture.policyExample.path);
  await page.getByLabel('Value (JSON)').fill(String(fixture.policyExample.value));
  await page.getByRole('button', { name: 'Preview policy change' }).click();
  await expect(page.getByText(/No policy has been pushed/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm with APPLY POLICY' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rollback boundary' })).toBeDisabled();
});

test('client demo stays usable at narrow and wide viewports without static test routing', async ({ page }) => {
  for (const [width, height] of [[1280, 800], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.goto(fixture.dashboardUrl);
    await expect(page).toHaveURL(fixture.dashboardUrl);
    const overflow = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }));
    expect(overflow.width).toBeLessThanOrEqual(overflow.viewport);
  }
});

test('existing onboarding baseline remains a synthetic headed /setup journey with review before commit', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const onboarding = await createOnboardingFixture({ dashboardPort: 0 });
  try {
    await page.goto(`${onboarding.dashboardUrl}/setup`);
    await expect(page).toHaveURL(/\/setup$/);
    await expect(page.getByText('Synthetic and disposable lab environment.')).toBeVisible();
    await page.getByLabel('What should we call this installation?').fill('Synthetic Founder Lab');
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByLabel('Comma-separated agent names').fill('builder,reviewer');
    await page.getByRole('button', { name: 'Next' }).click();
    await page.locator('#providerId').selectOption(ONBOARDING_PROVIDER_ID);
    await expect(page.locator('#modelId')).toHaveValue(ONBOARDING_MODEL_ID);
    await page.getByLabel(/Provider key for/).fill(SYNTHETIC_CREDENTIAL_SENTINEL);
    await page.getByRole('button', { name: 'Validate connection' }).click();
    await expect(page.getByText('Connection verified. Continue to budget.')).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Monthly budget (USD)').fill('25');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible();
    await expect(page.getByText('Reviewing writes nothing. Only the final confirmation writes setup files.')).toBeVisible();
    await page.getByRole('button', { name: 'Confirm and write files' }).click();
    await expect(page.getByRole('heading', { name: 'Setup complete' })).toBeVisible();
    await page.getByRole('button', { name: 'Go to dashboard' }).click();
    await expect(page.locator('#app .scope-controls')).toBeVisible();
    await page.getByLabel('Time preset').selectOption('24h');
    await expect(page).toHaveURL(/preset=24h/);
    await expect(page.getByLabel('Time preset')).toHaveValue('24h');
    await expect(page.locator('#realtime-state')).toContainText('Showing last 24 hours.');
    await page.getByLabel('Project').fill('synthetic-project');
    await page.getByRole('button', { name: 'Apply scope' }).click();
    await expect(page).toHaveURL(/project=synthetic-project/);
    await expect(page.locator('#realtime-state')).toContainText('Scope applied.');
    await page.getByRole('button', { name: 'Refresh now' }).click();
    await expect(page.locator('#realtime-state')).toContainText('Refresh complete.');
    expect(pageErrors).toEqual([]);
  } finally {
    await page.goto('about:blank').catch(() => {});
    await onboarding.close();
  }
});

test('client demo exposes a safe local sign-in failure without retaining fixture credentials', async ({ page }) => {
  await page.goto(fixture.dashboardUrl);
  await page.getByLabel('Email').fill('wrong@synthetic.invalid');
  await page.getByLabel('Password').fill('not-the-fixture-password');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('alert')).toContainText('Invalid email or password');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('not-the-fixture-password');
});
