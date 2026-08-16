import { test, expect } from '@playwright/test';

const viewports = [
  [1440, 900], [1280, 800], [1024, 768], [768, 1024], [480, 800], [390, 844], [320, 568],
];

async function stubSearch(page) {
  await page.route('**/api/operations/search*', async (route) => {
    const requestUrl = new URL(route.request().url());
    const query = requestUrl.searchParams.get('q') ?? '';
    await route.fulfill({ json: {
      ok: true,
      scope: { from: requestUrl.searchParams.get('from'), to: requestUrl.searchParams.get('to'), project: requestUrl.searchParams.get('project'), provider: requestUrl.searchParams.get('provider') },
      data: { queryLength: query.length, results: query ? [
        { kind: 'route', id: 'operations', label: 'Operations', description: 'Tasks and retained runs.', href: '/app/operations/tasks', scope: { projectId: null }, command: null },
      ] : [] },
    } });
  });
}

async function stubCloud(page) {
  await page.route('**/api/cloud/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/cloud/auth/login') return route.fulfill({ json: { token: 'fixture-cloud-token', authenticatedAt: 1 } });
    if (pathname === '/api/cloud/machines') return route.fulfill({ json: { machines: [{ id: 'machine-1', name: 'fixture-laptop', os_type: 'windows', meridianos_version: '0.3.9', status: 'online', last_seen: 1 }] } });
    if (pathname === '/api/cloud/health') return route.fulfill({ json: { openai: { overall: 'ok', machines: [{ id: 'machine-1' }] } } });
    if (pathname === '/api/cloud/policy/preview') return route.fulfill({ json: { id: 'polprev-fixture', targets: [{ id: 'machine-1', eligible: true }] } });
    return route.fulfill({ json: { message: 'fixture route not found' }, status: 404 });
  });
}

test('UXF-006 palette is keyboard accessible, scoped by API, and restores focus', async ({ page }, testInfo) => {
  await stubSearch(page);
  await page.goto('/app');
  const trigger = page.getByRole('button', { name: /search routes and records/i });
  await trigger.focus(); await page.keyboard.press(process.platform === 'darwin' ? 'Meta+KeyK' : 'Control+KeyK');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible(); await expect(page.getByRole('searchbox')).toBeFocused();
  await page.getByRole('searchbox').fill('operations');
  await expect(page.getByRole('option', { name: /Operations/ })).toBeVisible();
  await page.keyboard.press('ArrowDown'); await expect(page.locator('.search-result')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape'); await expect(dialog).toBeHidden(); await expect(trigger).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('palette.png'), fullPage: true });
});

test('UXF-006 dialog fallback keeps focus inside when showModal is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: undefined });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: undefined });
  });
  await stubSearch(page);
  await page.goto('/app');
  const trigger = page.getByRole('button', { name: /search routes and records/i });
  await trigger.focus(); await page.keyboard.press(process.platform === 'darwin' ? 'Meta+KeyK' : 'Control+KeyK');
  const dialog = page.getByRole('dialog'); const searchbox = page.getByRole('searchbox');
  await expect(dialog).toHaveAttribute('open', ''); await expect(searchbox).toBeFocused();
  await dialog.focus(); await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Close' })).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(searchbox).toBeFocused();
});

test('UXF-006 shell has no page overflow across the master-plan viewport matrix', async ({ page }, testInfo) => {
  for (const [width, height] of viewports) {
    await page.setViewportSize({ width, height }); await page.goto('/app?state=idle');
    const overflow = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }));
    expect(overflow.width, `${width}x${height} has horizontal page overflow`).toBeLessThanOrEqual(overflow.viewport);
    const performanceEvidence = await page.evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0];
      const lcp = performance.getEntriesByType('largest-contentful-paint').at(-1);
      const longTasks = performance.getEntriesByType('longtask');
      return { domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? 0, lcpMs: lcp?.startTime ?? null, longTaskMs: Math.max(0, ...longTasks.map((entry) => entry.duration)) };
    });
    expect(performanceEvidence.domContentLoadedMs, `${width}x${height} shell load`).toBeLessThan(2500);
    expect(performanceEvidence.longTaskMs, `${width}x${height} initial long task`).toBeLessThanOrEqual(200);
    await page.screenshot({ path: testInfo.outputPath(`shell-${width}x${height}.png`), fullPage: true });
  }
});

test('UXF-006 cloud shell stays usable across viewport and accessibility variants', async ({ page }, testInfo) => {
  await stubCloud(page);
  const variants = [
    { width: 1440, height: 900, colorScheme: 'light', reducedMotion: 'no-preference', forcedColors: 'none' },
    { width: 1280, height: 800, colorScheme: 'dark', reducedMotion: 'no-preference', forcedColors: 'none' },
    { width: 1024, height: 768, colorScheme: 'light', reducedMotion: 'reduce', forcedColors: 'none' },
    { width: 768, height: 1024, colorScheme: 'dark', reducedMotion: 'no-preference', forcedColors: 'active' },
    { width: 480, height: 800, colorScheme: 'light', reducedMotion: 'reduce', forcedColors: 'none' },
    { width: 390, height: 844, colorScheme: 'dark', reducedMotion: 'no-preference', forcedColors: 'active' },
    { width: 320, height: 568, colorScheme: 'light', reducedMotion: 'reduce', forcedColors: 'none' },
  ];
  for (const variant of variants) {
    await page.setViewportSize({ width: variant.width, height: variant.height });
    await page.emulateMedia({ colorScheme: variant.colorScheme, reducedMotion: variant.reducedMotion, forcedColors: variant.forcedColors });
    await page.goto('/cloud/dashboard/index.html');
    const overflow = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }));
    expect(overflow.width, `${variant.width}x${variant.height} has horizontal page overflow`).toBeLessThanOrEqual(overflow.viewport);
    await expect(page.getByRole('heading', { name: 'MeridianOS Cloud Control Plane' })).toBeVisible();
    if (variant.width === 1440) {
      await page.getByLabel('Email').fill('fixture@example.test');
      await page.getByLabel('Password').fill('fixture-password');
      await page.getByRole('button', { name: 'Log in' }).click();
      await expect(page.getByRole('heading', { name: 'Connected Machines' })).toBeVisible();
      await page.getByLabel('Policy path').fill('agent_budget.warn_pct');
      await page.getByLabel('Value (JSON)').fill('90');
      await page.getByRole('button', { name: 'Preview policy change' }).click();
      await expect(page.getByText(/No policy has been pushed/)).toBeVisible();
    }
    await page.screenshot({ path: testInfo.outputPath(`cloud-${variant.width}x${variant.height}-${variant.colorScheme}-${variant.forcedColors}.png`), fullPage: true });
  }
});
