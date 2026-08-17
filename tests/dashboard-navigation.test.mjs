import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('platform shell contains a left navigation rail with dashboard and observability sections', async () => {
  const html = await fs.readFile('dashboard/app.html', 'utf8');
  for (const value of ['app-sidebar', 'sidebar-toggle', 'Dashboards', 'Observability', 'Legacy fallback', 'aria-label="Primary navigation"']) assert.match(html, new RegExp(value.replace(/["']/g, '\\$&')));
});

test('navigation source includes mobile drawer and scope-aware active-route behavior', async () => {
  const source = await fs.readFile('dashboard/static/app-platform.mjs', 'utf8');
  assert.match(source, /app-sidebar/);
  assert.match(source, /is-open/);
  assert.match(source, /is-active/);
  assert.match(source, /scopedDestination/);
});
