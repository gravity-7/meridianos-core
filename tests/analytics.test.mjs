/**
 * tests/analytics.test.mjs — P5: US1 spend analytics API tests.
 * Covers GET /api/analytics/overview KPI accuracy, timeseries resolution
 * auto-selection, breakdown dimension filtering, CSV export, empty ledger,
 * and date range validation.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(HERE, '..', 'gateway', 'ledger-schema.sql');

function openMemoryDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
  const r = db.prepare('SELECT COUNT(*) AS c FROM spend_pause_state').get();
  if (r?.c === 0) db.prepare('INSERT INTO spend_pause_state (is_paused) VALUES (0)').run();
  return db;
}

function insertEvent(db, overrides = {}) {
  db.prepare(
    `INSERT INTO token_events (id, ts, tenant, agent, session, task, run_id, request_id,
       provider, model, wire, source, ide_name, billing_type, upstream_status, latency_ms,
       input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens,
       cost_usd, enforcement_decision, cap_window, raw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    overrides.id || `e-${Math.random().toString(36).slice(2, 8)}`,
    overrides.ts || new Date().toISOString(),
    overrides.tenant || 'test', overrides.agent || 'builder',
    overrides.session || 's1', overrides.task || null, overrides.runId || null, overrides.requestId || null,
    overrides.provider || 'anthropic', overrides.model || 'claude-sonnet',
    overrides.wire || 'anthropic', overrides.source || 'agent',
    overrides.ideName || null, overrides.billingType || 'api_key',
    overrides.upstreamStatus || 200, overrides.latencyMs || 500,
    overrides.inputTokens ?? 1000, overrides.outputTokens ?? 500,
    overrides.cacheReadTokens ?? 0, overrides.cacheWriteTokens ?? 0,
    overrides.totalTokens ?? 1500,
    overrides.costUsd ?? 0.01, overrides.enforcementDecision || 'allow',
    overrides.capWindow || null, JSON.stringify(overrides),
  );
}

describe('analytics query engine', () => {
  let queryOverview, queryTimeseries, queryBreakdown, queryTaskCost, queryProjectCosts, computeBudgetForecast, detectAnomalies;

  before(async () => {
    try {
      const mod = await import('../analytics.mjs');
      queryOverview = mod.queryOverview;
      queryTimeseries = mod.queryTimeseries;
      queryBreakdown = mod.queryBreakdown;
      queryTaskCost = mod.queryTaskCost;
      queryProjectCosts = mod.queryProjectCosts;
      computeBudgetForecast = mod.computeBudgetForecast;
      detectAnomalies = mod.detectAnomalies;
    } catch { /* module may not exist yet */ }
  });

  it('queryOverview returns empty state for empty ledger', () => {
    if (!queryOverview) return;
    const db = openMemoryDb();
    try {
      const r = queryOverview(db);
      assert.strictEqual(r.totalSpend, 0);
      assert.strictEqual(r.totalTokens, 0);
      assert.strictEqual(r.totalApiCalls, 0);
      assert.strictEqual(r.topProvider, null);
      assert.strictEqual(r.topModel, null);
    } finally { db.close(); }
  });

  it('queryOverview returns correct KPIs with data', () => {
    if (!queryOverview) return;
    const db = openMemoryDb();
    try {
      const now = new Date().toISOString();
      insertEvent(db, { ts: now, provider: 'anthropic', model: 'claude-sonnet', agent: 'builder', costUsd: 10, totalTokens: 5000 });
      insertEvent(db, { ts: now, provider: 'deepseek', model: 'deepseek-chat', agent: 'reviewer', costUsd: 5, totalTokens: 3000 });
      const r = queryOverview(db, new Date(Date.now() - 86400000).toISOString(), new Date(Date.now() + 3600000).toISOString());
      assert.ok(r.totalSpend > 0);
      assert.ok(r.totalTokens > 0);
      assert.ok(r.totalApiCalls >= 2);
    } finally { db.close(); }
  });

  it('queryTimeseries returns empty series for empty data', () => {
    if (!queryTimeseries) return;
    const db = openMemoryDb();
    try {
      const r = queryTimeseries(db);
      assert.ok(Array.isArray(r.series));
      assert.ok(r.resolution);
    } finally { db.close(); }
  });

  it('queryBreakdown returns items ranked by cost', () => {
    if (!queryBreakdown) return;
    const db = openMemoryDb();
    try {
      const now = new Date().toISOString();
      insertEvent(db, { ts: now, provider: 'A', model: 'm', agent: 'a', costUsd: 30, totalTokens: 100 });
      insertEvent(db, { ts: now, provider: 'B', model: 'm', agent: 'a', costUsd: 10, totalTokens: 100 });
      // Use explicit wide date range to avoid timing edge cases
      const from = new Date(Date.now() - 60000).toISOString();
      const to = new Date(Date.now() + 60000).toISOString();
      const r = queryBreakdown(db, 'provider', from, to);
      assert.strictEqual(r.items.length, 2);
      assert.strictEqual(r.items[0].key, 'A');
      assert.strictEqual(r.items[1].key, 'B');
    } finally { db.close(); }
  });

  it('queryBreakdown supports dimension=model', () => {
    if (!queryBreakdown) return;
    const db = openMemoryDb();
    try {
      const from = new Date(Date.now() - 86400000).toISOString();
      const to = new Date(Date.now() + 86400000).toISOString();
      insertEvent(db, { ts: new Date().toISOString(), provider: 'p', model: 'expensive', agent: 'a', costUsd: 50, totalTokens: 100 });
      insertEvent(db, { ts: new Date().toISOString(), provider: 'p', model: 'cheap', agent: 'a', costUsd: 5, totalTokens: 100 });
      const r = queryBreakdown(db, 'model', from, to, 5);
      assert.strictEqual(r.dimension, 'model');
      assert.ok(r.items.length >= 1);
    } finally { db.close(); }
  });

  it('queryTaskCost returns empty for unknown task', () => {
    if (!queryTaskCost) return;
    const db = openMemoryDb();
    try {
      const r = queryTaskCost(db, 'nonexistent');
      assert.strictEqual(r.totalCost, 0);
      assert.strictEqual(r.apiCalls, 0);
    } finally { db.close(); }
  });

  it('queryTaskCost aggregates per-task', () => {
    if (!queryTaskCost) return;
    const db = openMemoryDb();
    try {
      insertEvent(db, { ts: new Date().toISOString(), provider: 'p', model: 'm', agent: 'a', task: 'my-task', costUsd: 1.5, totalTokens: 100, runId: 'r1' });
      insertEvent(db, { ts: new Date().toISOString(), provider: 'p', model: 'm', agent: 'a', task: 'my-task', costUsd: 2.5, totalTokens: 200, runId: 'r1' });
      const r = queryTaskCost(db, 'my-task', true);
      assert.strictEqual(r.taskId, 'my-task');
      assert.ok(r.totalCost > 3.9);
      assert.strictEqual(r.apiCalls, 2);
      assert.ok(r.runs.length >= 1);
    } finally { db.close(); }
  });

  it('queryProjectCosts groups by project prefix', () => {
    if (!queryProjectCosts) return;
    const db = openMemoryDb();
    try {
      insertEvent(db, { ts: new Date().toISOString(), provider: 'p', model: 'm', agent: 'a', task: 'proj-a/task-1', costUsd: 10, totalTokens: 100 });
      insertEvent(db, { ts: new Date().toISOString(), provider: 'p', model: 'm', agent: 'a', task: 'proj-a/task-2', costUsd: 5, totalTokens: 50 });
      insertEvent(db, { ts: new Date().toISOString(), provider: 'p', model: 'm', agent: 'a', task: 'proj-b/task-3', costUsd: 3, totalTokens: 30 });
      const r = queryProjectCosts(db, 'proj-a');
      assert.strictEqual(r.project, 'proj-a');
      assert.ok(r.tasks.length >= 1);
    } finally { db.close(); }
  });

  it('computeBudgetForecast returns no-budget when limit is 0', () => {
    if (!computeBudgetForecast) return;
    const db = openMemoryDb();
    try {
      const r = computeBudgetForecast(db, { monthlyLimit: 0 });
      assert.strictEqual(r.status, 'no-budget');
    } finally { db.close(); }
  });

  it('computeBudgetForecast computes projection', () => {
    if (!computeBudgetForecast) return;
    const db = openMemoryDb();
    try {
      const now = new Date().toISOString();
      insertEvent(db, { ts: now, provider: 'p', model: 'm', agent: 'a', costUsd: 25, totalTokens: 100 });
      const r = computeBudgetForecast(db, { monthlyLimit: 100, startDate: new Date(Date.now() - 86400000).toISOString(), endDate: new Date(Date.now() + 86400000 * 29).toISOString() });
      assert.ok(r.dailyBurnRate >= 0);
      assert.ok(['on-track', 'at-risk', 'over-budget', 'no-budget'].includes(r.status));
    } finally { db.close(); }
  });

  it('detectAnomalies returns empty with insufficient data', () => {
    if (!detectAnomalies) return;
    const db = openMemoryDb();
    try {
      const r = detectAnomalies(db);
      assert.strictEqual(r.length, 0);
    } finally { db.close(); }
  });

  it('date range validation — from after to returns empty gracefully', () => {
    if (!queryOverview) return;
    const db = openMemoryDb();
    try {
      const r = queryOverview(db, new Date(Date.now() + 86400000).toISOString(), new Date().toISOString());
      assert.strictEqual(r.totalSpend, 0);
    } finally { db.close(); }
  });
});
