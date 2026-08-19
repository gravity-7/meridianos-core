import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('overview refreshes reuse the mounted shell to preserve scroll and prevent redraw flashes', async () => {
  const source = await fs.readFile('dashboard/static/app-platform.mjs', 'utf8');
  assert.match(source, /renderCurrent\(\{ preserveView = false \} = \{\}\)/);
  assert.match(source, /const canReuseShell = preserveView && activeRouteId === route\.id/);
  assert.match(source, /refresh: \(\) => renderCurrent\(\{ preserveView: true \}\)/);
  assert.match(source, /const controls = canReuseShell \? activeControls : scopeControls\(\)/);
  assert.match(source, /const root = canReuseShell \? activeRoot : make\('div', null, 'route-root'\)/);
});

test('overview scope and KPI markup support the founder-approved home-page layout', async () => {
  const platform = await fs.readFile('dashboard/static/app-platform.mjs', 'utf8');
  assert.match(platform, /scope-row-actions/);
  const overview = await fs.readFile('dashboard/app/routes/overview/index.mjs', 'utf8');
  assert.match(overview, /panel-stat-footer/);
  assert.match(overview, /panel-drilldown/);
  const css = await fs.readFile('dashboard/static/app-platform.css', 'utf8');
  for (const marker of ['.scope-submit-row', '.panel-stat-footer', '.circled-meter']) {
    assert.match(css, new RegExp(marker.replace('.', '\\.')));
  }
});

test('navigation uses the local icon sprite and the dashboard serves SVG assets', async () => {
  const shell = await fs.readFile('dashboard/app.html', 'utf8');
  const server = await fs.readFile('dashboard/server.mjs', 'utf8');
  const sprite = await fs.readFile('dashboard/static/icons/nav-sprite.svg', 'utf8');
  assert.match(shell, /nav-sprite\.svg#layout-dashboard/);
  assert.match(shell, /nav-sprite\.svg#settings/);
  assert.doesNotMatch(shell, /<span class="nav-icon"/);
  assert.match(sprite, /<symbol id="layout-dashboard"/);
  assert.match(sprite, /<symbol id="shield-check"/);
  assert.match(server, /['"]\.svg['"]\s*:\s*['"]image\/svg\+xml/);
});
