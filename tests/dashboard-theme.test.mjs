import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveTheme, parseThemePreference, THEME_VALUES } from '../dashboard/app/shared/theme-preference.mjs';

test('theme preference accepts exactly system, light, and dark', () => {
  assert.deepEqual(THEME_VALUES, ['system', 'light', 'dark']);
  assert.equal(parseThemePreference('dark'), 'dark');
  assert.equal(parseThemePreference('light'), 'light');
  assert.equal(parseThemePreference('invalid'), 'system');
  assert.equal(effectiveTheme('system', true), 'dark');
  assert.equal(effectiveTheme('system', false), 'light');
});

test('theme source exposes all semantic visual states without relying on a framework', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile('dashboard/static/app-platform.css', 'utf8'));
  for (const token of ['--good', '--warn', '--bad', '--focus', '--accent', '--sidebar', '--panel-gap', '--panel-radius', '--grid-line', '.circled-meter', '[data-theme=dark]', '[data-theme=light]', 'forced-colors', 'prefers-reduced-motion']) assert.match(source, new RegExp(token.replace(/[()[\]=.]/g, '\\$&')));
});
