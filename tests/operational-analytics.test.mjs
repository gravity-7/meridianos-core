import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openOperationalLedger, insertOperationalEvent } from './fixtures/operational-overview.mjs';
import { queryGatewayMetrics, queryUsageMetrics, queryCostMetrics, queryUsageRecords } from '../dashboard/operational-analytics.mjs';

const scope = { tenantId: 'tenant-a', projectId: 'project-a', provider: 'openai', from: '2026-08-01T00:00:00.000Z', to: '2026-08-12T00:00:00.000Z' };

test('operational metrics use one tenant/project/provider/window and disclose errors/missing cost', () => {
  const db = openOperationalLedger();
  insertOperationalEvent(db, { id: 'a', costUsd: 10, totalTokens: 100, upstreamStatus: 200, latencyMs: 100 });
  insertOperationalEvent(db, { id: 'b', costUsd: 5, totalTokens: 50, upstreamStatus: 500, latencyMs: 300 });
  insertOperationalEvent(db, { id: 'unknown', costUsd: null, totalTokens: null, upstreamStatus: 403, enforcementDecision: 'deny' });
  insertOperationalEvent(db, { id: 'other-project', projectId: 'project-b', costUsd: 100 });
  insertOperationalEvent(db, { id: 'other-tenant', tenant: 'tenant-b', costUsd: 100 });
  const gateway = queryGatewayMetrics(db, scope);
  assert.equal(gateway.summary.requests, 3);
  assert.equal(gateway.summary.errors, 2);
  assert.equal(gateway.summary.errorRate, 66.67);
  assert.equal(gateway.summary.latencyP50, 100);
  assert.equal(gateway.summary.latencyP95, 300);
  const cost = queryCostMetrics(db, scope, { monthlyLimit: 100 });
  assert.equal(cost.summary.spend, 15);
  assert.equal(cost.summary.unknownCostEvents, 1);
  assert.equal(cost.breakdowns.provider[0].key, 'openai');
  db.close();
});

test('usage/cost breakdowns reconcile deterministically and expose scoped drill-downs', () => {
  const db = openOperationalLedger();
  insertOperationalEvent(db, { id: 'b', provider: 'zeta', model: 'm2', task: null, runId: null, costUsd: 2, totalTokens: 20 });
  insertOperationalEvent(db, { id: 'a', provider: 'alpha', model: 'm1', costUsd: 2, totalTokens: 30 });
  const cost = queryCostMetrics(db, { ...scope, provider: null });
  assert.deepEqual(cost.breakdowns.provider.map((row) => row.key), ['alpha', 'zeta']);
  assert.equal(cost.breakdowns.provider.reduce((sum, row) => sum + row.cost, 0), cost.summary.spend);
  assert.match(cost.breakdowns.provider[0].drilldown.href, /\/app\/observability\/usage/);
  const usage = queryUsageMetrics(db, { ...scope, provider: null });
  assert.equal(usage.summary.totalTokens, 50);
  assert.equal(usage.breakdowns.task.some((row) => row.key === 'unattributed'), true);
  db.close();
});

test('metric series are deterministically bounded to 2,000 points', () => {
  const db = openOperationalLedger();
  const start = Date.parse('2026-08-01T00:00:00Z');
  for (let i = 0; i < 2100; i++) insertOperationalEvent(db, { id: `p-${i}`, ts: new Date(start + i * 1000).toISOString(), costUsd: 0.001 });
  const gateway = queryGatewayMetrics(db, scope);
  assert.equal(gateway.series.requests.points.length <= 2000, true);
  assert.match(gateway.series.requests.aggregation, /bucket/);
  db.close();
});

test('usage records are newest-first, allowlisted, and cursor-paged', () => {
  const db = openOperationalLedger();
  insertOperationalEvent(db, { id: 'one', ts: '2026-08-10T00:00:00Z' });
  insertOperationalEvent(db, { id: 'two', ts: '2026-08-11T00:00:00Z' });
  const page = queryUsageRecords(db, scope, { limit: 1 });
  assert.equal(page.items[0].id, 'two');
  assert.ok(page.nextCursor);
  assert.equal('raw' in page.items[0], false);
  const next = queryUsageRecords(db, scope, { limit: 1, cursor: page.nextCursor });
  assert.equal(next.items[0].id, 'one');
  db.close();
});
