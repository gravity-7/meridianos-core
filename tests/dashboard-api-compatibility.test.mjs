import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('legacy fallback and API compatibility boundaries remain explicit', async () => {
  const source = await fs.readFile('dashboard/server.mjs', 'utf8');
  for (const marker of ["url.pathname === '/legacy'", "url.pathname === '/index.html'", "url.pathname.startsWith('/api/v1/')", "url.pathname.startsWith('/api/operations/')", "url.pathname === '/setup'"]) assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('root is the live dashboard and legacy remains an explicit rollback surface', async () => {
  const source = await fs.readFile('dashboard/server.mjs', 'utf8');
  assert.match(source, /GET\s+\/\s+.*live dashboard/);
  assert.match(source, /explicit founder-approved rollback boundary/);
  assert.doesNotMatch(source, /cloud\/dashboard\/index\.html/);
});
