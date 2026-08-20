import { test, expect } from '@playwright/test';

test('desktop home shell aligns the fixed left rail with the main header and board', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Operational overview' })).toBeVisible();
  const geometry = await page.evaluate(() => {
    const sidebar = document.querySelector('.app-sidebar')?.getBoundingClientRect();
    const header = document.querySelector('.app-header')?.getBoundingClientRect();
    const main = document.querySelector('main')?.getBoundingClientRect();
    return { sidebar, header, main };
  });
  expect(geometry.sidebar.x).toBe(0);
  expect(geometry.sidebar.y).toBe(0);
  expect(geometry.header.x).toBeGreaterThanOrEqual(geometry.sidebar.width - 1);
  expect(geometry.main.x).toBeGreaterThanOrEqual(geometry.sidebar.width - 1);
  await page.screenshot({ path: testInfo.outputPath('home-page-desktop.png'), fullPage: true });
});

test('manual overview refresh reuses the mounted board and preserves the viewport', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Operational overview' })).toBeVisible();
  await page.evaluate(() => {
    window.__overviewRoot = document.querySelector('.route-root');
    window.scrollTo(0, 600);
  });
  const before = await page.evaluate(() => ({ scrollY: window.scrollY, maxScrollY: Math.max(0, document.documentElement.scrollHeight - window.innerHeight) }));
  await page.evaluate(() => [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Refresh now')?.click());
  await expect(page.locator('.route-root')).toHaveAttribute('aria-busy', 'false');
  const after = await page.evaluate(() => ({ sameRoot: window.__overviewRoot === document.querySelector('.route-root'), scrollY: window.scrollY }));
  expect(after.sameRoot).toBe(true);
  expect(after.scrollY).toBeGreaterThanOrEqual(Math.min(before.scrollY, before.maxScrollY));
});

test('observability export links use the browser download route instead of SPA navigation', async ({ page }) => {
  await page.goto('/app/observability/cost');
  await expect(page.getByRole('link', { name: 'Export scoped cost evidence' })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export scoped cost evidence' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('meridianos-cost.csv');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toHaveCount(0);
});
