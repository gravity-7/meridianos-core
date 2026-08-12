import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('UXF-006 native shell has the required accessibility and responsive hooks', () => {
  const css = read('dashboard/static/app-platform.css');
  const html = read('dashboard/app.html');
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /forced-colors/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /max-width:\s*320px/);
  assert.match(css, /min-width:\s*44px|target-size/);
  assert.match(html, /aria-live/);
  assert.match(html, /Skip to content/);
});

test('UXF-006 artifacts keep legacy compatibility and avoid forbidden dependency expansion', () => {
  const packageJson = read('package.json');
  const plan = read('specs/015-uxf-006-completion/plan.md');
  const cloudHtml = read('cloud/dashboard/index.html');
  const cloudApp = read('cloud/dashboard/app.js');
  assert.doesNotMatch(packageJson, /"react"|"typescript"|"lucide/);
  assert.match(plan, /native ES-module/);
  assert.match(cloudHtml, /Skip to content|main-content/);
  assert.match(cloudHtml, /policy-preview|Preview policy change/);
  assert.match(cloudApp, /auth\/login/);
  assert.match(cloudApp, /cloud\/machines/);
  assert.match(cloudApp, /cloud\/health/);
  assert.match(cloudApp, /policy\/preview/);
  assert.match(cloudApp, /policy\/.*rollback/);
  assert.ok(existsSync(new URL('../docs/legacy-parity-ledger.md', import.meta.url)));
  assert.ok(existsSync(new URL('../docs/uxf-006-rollout.md', import.meta.url)));
});
