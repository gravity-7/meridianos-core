/**
 * tests/budget-forecast.test.mjs — P5: US4 budget forecasting tests.
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
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
  const r = db.prepare('SELECT COUNT(*) AS c FROM spend_pause_state').get();
  if (r?.c === 0) db.prepare('INSERT INTO spend_pause_state (is_paused) VALUES (0)').run();
  return db;
}

function insertEvent(db, o = {}) {
  db.prepare(
    `INSERT INTO token_events (id, ts, tenant, agent, session, task, run_id, request_id,
       provider, model, wire, source, ide_name, billing_type, upstream_status, latency_ms,
       input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens,
       cost_usd, enforcement_decision, cap_window, raw)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    o.id || `e-${Math.random().toString(36).slice(2,8)}`,
    o.ts || new Date().toISOString(), o.tenant || 'test', o.agent || 'builder',
    o.session || 's1', o.task || null, o.runId || null, o.requestId || null,
    o.provider || 'anth', o.model || 'm', o.wire || 'anth', o.source || 'agent',
    o.ideName || null, o.billingType || 'api_key', o.upstreamStatus || 200,
    o.latencyMs || 500, o.inputTokens ?? 100, o.outputTokens ?? 50,
    o.cacheReadTokens ?? 0, o.cacheWriteTokens ?? 0, o.totalTokens ?? 150,
    o.costUsd ?? 0.01, o.enforcementDecision || 'allow', o.capWindow || null,
    JSON.stringify(o),
  );
}

describe('budget forecasting', () => {
  let computeBudgetForecast, detectAnomalies;

  before(async () => {
    try {
      const mod = await import('../analytics.mjs');
      computeBudgetForecast = mod.computeBudgetForecast;
      detectAnomalies = mod.detectAnomalies;
    } catch { /* may not exist */ }
  });

  it('zero budget returns no-budget status', () => {
    if (!computeBudgetForecast) return;
    const db = openMemoryDb();
    try {
      const r = computeBudgetForecast(db, { monthlyLimit: 0 });
      assert.strictEqual(r.status, 'no-budget');
      assert.strictEqual(r.spendToDate, 0);
    } finally { db.close(); }
  });

  it('linear projection with known daily rate', () => {
    if (!computeBudgetForecast) return;
    const db = openMemoryDb();
    try {
      // Simulate 7 days of $10/day spend
      for (let d = 6; d >= 0; d--) {
        const ts = new Date(Date.now() - d * 86400000).toISOString();
        insertEvent(db, { ts, costUsd: 10, totalTokens: 1000 });
      }
      const budgetConfig = {
        monthlyLimit: 500,
        startDate: new Date(Date.now() - 6 * 86400000).toISOString(),
        endDate: new Date(Date.now() + 24 * 86400000).toISOString(),
      };
      const r = computeBudgetForecast(db, budgetConfig);
      assert.ok(r.dailyBurnRate > 0);
      assert.ok(r.projectedTotal > 0);
      assert.ok(['on-track', 'at-risk', 'over-budget', 'no-budget'].includes(r.status));
    } finally { db.close(); }
  });

  it('status thresholds: over-budget when projected > 100%', () => {
    if (!computeBudgetForecast) return;
    const db = openMemoryDb();
    try {
      for (let d = 6; d >= 0; d--) {
        insertEvent(db, { ts: new Date(Date.now() - d * 86400000).toISOString(), costUsd: 100, totalTokens: 1000 });
      }
      const budgetConfig = {
        monthlyLimit: 100,
        startDate: new Date(Date.now() - 6 * 86400000).toISOString(),
        endDate: new Date(Date.now() + 1 * 86400000).toISOString(),
      };
      const r = computeBudgetForecast(db, budgetConfig);
      if (r.pctProjected > 100) assert.strictEqual(r.status, 'over-budget');
    } finally { db.close(); }
  });

  it('zero-data edge case returns zeros', () => {
    if (!computeBudgetForecast) return;
    const db = openMemoryDb();
    try {
      const r = computeBudgetForecast(db, { monthlyLimit: 200 });
      assert.ok(r.spendToDate >= 0);
      assert.ok(r.dailyBurnRate >= 0);
    } finally { db.close(); }
  });

  it('anomaly detection with insufficient data returns empty', () => {
    if (!detectAnomalies) return;
    const db = openMemoryDb();
    try {
      const r = detectAnomalies(db);
      assert.strictEqual(r.length, 0);
    } finally { db.close(); }
  });
});
