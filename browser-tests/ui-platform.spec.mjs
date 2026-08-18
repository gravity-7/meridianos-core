import { test, expect } from '@playwright/test';

test('platform routes, history, themes, action states, keyboard access, and recovery', async ({ page }, testInfo) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/?from=2026-08-16T18%3A11%3A07.910Z&to=2026-08-17T18%3A11%3A07.910Z');
  await expect(page.locator('#app .scope-controls')).toBeVisible();
  await expect(page.locator('.app-header')).toHaveCSS('display', 'flex');
  await expect(page).toHaveURL(/\/\?from=.*&to=/);
  await page.goto('/app/foundation'); await expect(page.getByRole('heading', { name: 'Platform foundation' })).toBeVisible();
  await page.getByRole('link', { name: 'Overview' }).click(); await expect(page).toHaveURL(/\/\?.*from=/);
  await page.goBack(); await expect(page).toHaveURL(/\/app\/foundation\?.*from=/);
  await page.goForward(); await expect(page).toHaveURL(/\/\?.*from=/);
  await page.goto('/app/not-found'); await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  for (const state of ['idle', 'pending', 'disabled', 'success', 'loading', 'empty', 'error', 'fatal']) {
    await page.goto(`/app?state=${state}`); await expect(page.locator(`[data-state="${state}"]`)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`wide-light-${state}.png`), fullPage: true });
  }
  await page.goto('/app?state=error'); await expect(page.getByRole('alert')).toContainText('Unable to load'); await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await page.goto('/app?state=fatal'); await expect(page.getByRole('alert')).toContainText('cannot be completed'); await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  await page.getByRole('button', { name: /theme/i }).click(); await expect(page.locator('html')).toHaveAttribute('data-theme', /light|dark/);
  await page.reload(); await page.keyboard.press('Tab'); await expect(page.locator('.skip-link')).toBeFocused();
  await page.getByRole('button', { name: /theme/i }).click(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.setViewportSize({ width: 375, height: 720 });
  for (const state of ['idle', 'pending', 'disabled', 'success', 'loading', 'empty', 'error', 'fatal']) { await page.goto(`/app?state=${state}`); await page.screenshot({ path: testInfo.outputPath(`narrow-dark-${state}.png`), fullPage: true }); }
  expect(pageErrors).toEqual([]);
});
