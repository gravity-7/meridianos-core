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
