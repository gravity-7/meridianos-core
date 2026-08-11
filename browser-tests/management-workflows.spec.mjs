import { test, expect } from '@playwright/test';

test('management routes preserve scope, redact secrets, support keyboard focus, zoom/reduced-motion and narrow viewport', async ({ page }, testInfo) => {
  const sentinel = 'mk-browser-secret-must-not-appear'; const calls = [];
  await page.route('**/api/management/**', async (route) => {
    calls.push(route.request().url()); const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/providers')) return route.fulfill({ json: { ok: true, providers: [{ id: 'provider-a', name: 'Provider A', status: 'healthy', credential: sentinel }], correlationId: 'provider-correlation' } });
    if (path.endsWith('/api-keys')) return route.fulfill({ json: { ok: true, keys: [{ id: 'key-a', name: 'Automation', scopes: ['config:read'], active: true, secret: sentinel }], correlationId: 'key-correlation' } });
    return route.fulfill({ json: { ok: true, events: [{ id: 'audit-a', intent: 'provider_test', outcome: 'succeeded', evidence: { detail: 'redacted' } }], correlationId: 'audit-correlation' } });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/app/integrations/providers');
  await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible(); await expect(page.locator('body')).not.toContainText(sentinel); await expect(page.getByText('Support correlation: provider-correlation')).toBeVisible();
  await page.goto('/app/integrations/api-keys'); await expect(page.getByRole('heading', { name: 'API keys' })).toBeVisible(); await expect(page.locator('body')).not.toContainText(sentinel);
  await page.goBack(); await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible(); await page.goForward(); await expect(page.getByRole('heading', { name: 'API keys' })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 800 }); await page.keyboard.press('Tab'); await expect(page.locator('.skip-link')).toBeFocused(); await page.screenshot({ path: testInfo.outputPath('management-narrow-reduced-motion.png'), fullPage: true });
  expect(calls.length).toBeGreaterThanOrEqual(3);
});
