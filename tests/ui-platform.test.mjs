import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolvePlatformRoute, PLATFORM_ROUTES, platformBoundary } from '../dashboard/ui-platform.mjs';

test('platform route inventory covers direct, recovery, and history destinations', () => {
  assert.deepEqual(Object.keys(PLATFORM_ROUTES), ['/app', '/app/foundation']);
  assert.equal(resolvePlatformRoute('/app').id, 'overview');
  assert.equal(resolvePlatformRoute('/app/foundation').id, 'foundation');
  assert.equal(resolvePlatformRoute('/app/unknown'), null);
});

test('platform boundary provides loading-adjacent content, empty, and safe recoverable failures', () => {
  assert.deepEqual(platformBoundary({ body: { ok: true } }), { state: 'content', data: { ok: true } });
  assert.equal(platformBoundary({ body: null }).state, 'empty');
  const error = platformBoundary({ status: 503, error: new Error('internal stack trace') });
  assert.deepEqual(error, { state: 'error', message: 'Unable to load this information. Try again.', recoverable: true });
});

test('browser shell evidence declares keyboard, theme, history, and responsive foundations', () => {
  const html = readFileSync(new URL('../dashboard/app.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../dashboard/static/app-platform.css', import.meta.url), 'utf8');
  const client = readFileSync(new URL('../dashboard/static/app-platform.mjs', import.meta.url), 'utf8');
  assert.match(html, /Skip to content/);
  assert.match(html, /aria-label="Application"/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media\(max-width:600px\)/);
  assert.match(css, /\[data-theme=dark\]/);
  assert.match(client, /history\.pushState/);
  assert.match(client, /addEventListener\('popstate'/);
  assert.match(client, /localStorage/);
  assert.match(client, /loading: 'Loading application information/);
  assert.match(client, /role', state === 'error' \? 'alert' : 'status'/);
  assert.match(client, /Try again/);
});

test('accessible primitive source covers actions, inputs, feedback, overlays, and empty states', () => {
  const source = readFileSync(new URL('../dashboard/static/ui-primitives.mjs', import.meta.url), 'utf8');
  assert.match(source, /button\.disabled = disabled \|\| pending/);
  assert.match(source, /label\.htmlFor = id/);
  assert.match(source, /role', error \? 'alert' : 'status'/);
  assert.match(source, /document\.createElement\('dialog'\)/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /empty-state/);
});
