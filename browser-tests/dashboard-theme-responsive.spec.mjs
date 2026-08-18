import { test, expect } from '@playwright/test';

test('theme preference persists and follows the three supported modes', async ({ page }) => {
  await page.goto('/');
  const theme = page.getByRole('button', { name: /Change color theme/ });
  await theme.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await theme.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await theme.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'system');
});

test('320px, reduced-motion, forced-colors, and keyboard navigation retain usable content', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Operational overview' })).toBeVisible();
  const toggle = page.locator('#sidebar-toggle'); await toggle.focus(); await toggle.press('Enter');
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toHaveClass(/is-open/);
  await toggle.press('Escape'); await expect(toggle).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.evaluate(() => ({ reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, forced: matchMedia('(forced-colors: active)').matches }))).toEqual({ reduced: true, forced: true });
});
