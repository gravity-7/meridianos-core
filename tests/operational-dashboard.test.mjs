import test from 'node:test';
import assert from 'node:assert/strict';
import { meterModel } from '../dashboard/app/shared/dashboard-panels.mjs';
import { normalizeWidget, normalizeTrend } from '../dashboard/app/shared/dashboard-contracts.mjs';
import fs from 'node:fs/promises';

test('circled meter model exposes threshold status and accessible empty state', () => {
  assert.deepEqual(meterModel({ title: 'Cost', value: 75, max: 100, unit: 'USD' }), { title: 'Cost', value: 75, max: 100, unit: 'USD', percent: 75, status: 'warning', level: 'warning', label: '75 USD' });
  const empty = meterModel({ title: 'Tokens', value: null, max: 100, unit: 'tokens', empty: true });
  assert.equal(empty.level, 'empty');
  assert.equal(empty.label, 'No data');
});

test('root route includes operational trends and circled meter panels', async () => {
  const source = await fs.readFile('dashboard/app/routes/overview/index.mjs', 'utf8');
  for (const marker of ['renderCircledMeter', 'Cost used', 'Tokens used', 'Budget consumed', 'Request volume', 'Latency P95', 'Cost over time', 'Token usage', 'Open alert list', 'Error rate gauge', 'Latency heatmap', 'Budget signals', 'Recent activity']) assert.match(source, new RegExp(marker));
  const panelSource = await fs.readFile('dashboard/app/shared/dashboard-panels.mjs', 'utf8');
  for (const family of ['bar-gauge', 'heatmap', 'panel-family-table', 'panel-family-list']) assert.match(panelSource, new RegExp(family));
  const css = await fs.readFile('dashboard/static/app-platform.css', 'utf8');
  for (const token of ['.circled-meter', '.panel-bar-gauge', '.panel-heatmap-grid', '.panel-family-table']) assert.match(css, new RegExp(token.replace('.', '\\.')));
});

test('widget and trend contracts normalize bounded, truthful states', () => {
  assert.equal(normalizeWidget({ state: 'ready', title: 'Gateway' }).state, 'ready');
  assert.equal(normalizeWidget({ state: 'unknown' }).state, 'unavailable');
  assert.equal(normalizeTrend({ metric: 'cost', points: Array.from({ length: 2100 }, (_, index) => ({ at: index, value: index })) }).points.length, 2000);
});

test('operations API overview contract exposes root trend families', async () => {
  const source = await fs.readFile('dashboard/operations-api.mjs', 'utf8');
  for (const marker of ['trends:', 'requests:', 'latencyP95:', 'tokens:', 'cost:']) assert.match(source, new RegExp(marker));
});
