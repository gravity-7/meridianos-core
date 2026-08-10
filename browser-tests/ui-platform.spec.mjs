import { test, expect } from '@playwright/test';

test('platform routes, history, themes, action states, keyboard access, and recovery', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/app/foundation'); await expect(page.getByRole('heading', { name: 'Platform foundation' })).toBeVisible();
  await page.getByRole('link', { name: 'Overview' }).click(); await expect(page).toHaveURL(/\/app$/);
  await page.goBack(); await expect(page).toHaveURL(/\/app\/foundation$/);
  await page.goto('/app/not-found'); await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await page.goto('/app?state=error'); await expect(page.getByRole('alert')).toContainText('Unable to load');
  await page.getByRole('button', { name: /theme/i }).click(); await expect(page.locator('html')).toHaveAttribute('data-theme', /light|dark/);
  await page.reload(); await page.keyboard.press('Tab'); await expect(page.locator('.skip-link')).toBeFocused();
  await page.screenshot({ path: 'artifacts/browser/ui-platform.png', fullPage: true });
  expect(pageErrors).toEqual([]);
});
