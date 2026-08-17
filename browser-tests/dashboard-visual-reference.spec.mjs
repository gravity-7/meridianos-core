import { test, expect } from '@playwright/test';

test('desktop root board matches the Grafana-inspired hierarchy and keeps the left rail usable', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Operational overview' })).toBeVisible();
  const rail = page.getByRole('navigation', { name: 'Primary navigation' });
  await expect(rail).toBeVisible();
  await expect(rail.getByText('Dashboards')).toBeVisible();
  await expect(rail.getByRole('link', { name: 'Cost' })).toBeVisible();
  await expect(page.locator('.dashboard-grid')).toBeVisible();
  await expect(page.locator('.meter-panel')).toHaveCount(3);
  await expect(page.locator('.panel-graph')).toHaveCount(4);
  await expect(page.locator('.panel-bar-gauge')).toBeVisible();
  await expect(page.locator('.panel-heatmap')).toBeVisible();
  await expect(page.locator('.panel-table')).toHaveCount(2);
  await expect(page.locator('.panel-list')).toHaveCount(2);
  await page.getByRole('button', { name: /Change color theme/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: /Change color theme/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: /Change color theme/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'system');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('mobile rail opens as a drawer, returns focus, and the board has no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/');
  const toggle = page.locator('#sidebar-toggle');
  await toggle.click();
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toHaveClass(/is-open/);
  await page.keyboard.press('Escape');
  await expect(toggle).toBeFocused();
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).not.toHaveClass(/is-open/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
