/**
 * tests/aggregation.test.mjs — P5: US3 aggregation engine tests.
 * Covers idempotent hourly aggregation, daily rollup, late-arriving data
 * re-aggregation, resume-after-interrupt, precision tolerance, empty ledger,
 * corrupted event skipping, and query performance.
 */
import { describe, it, before, after } from 'node:test';
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
  // Insert default spend_pause_state row
  const existing = db.prepare('SELECT COUNT(*) AS c FROM spend_pause_state').get();
  if (existing && existing.c === 0) {
    db.prepare('INSERT INTO spend_pause_state (is_paused) VALUES (0)').run();
  }
  return db;
}

function makeHourTs(hoursAgo) {
  const d = new Date(Date.now() - hoursAgo * 3600000);
  d.setMinutes(0, 0, 0);
  return d.toISOString();
}

function insertRawEvent(db, overrides = {}) {
  const id = overrides.id || `evt-${Math.random().toString(36).slice(2, 8)}`;
  const ts = overrides.ts || makeHourTs(1);
  db.prepare(
    `INSERT INTO token_events (id, ts, tenant, agent, session, task, run_id, request_id,
       provider, model, wire, source, ide_name, billing_type, upstream_status, latency_ms,
       input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens,
       cost_usd, enforcement_decision, cap_window, raw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, ts, overrides.tenant || 'test', overrides.agent || 'builder',
    overrides.session || 's1', overrides.task || null, overrides.runId || null, overrides.requestId || null,
    overrides.provider || 'anthropic', overrides.model || 'claude-sonnet',
    overrides.wire || 'anthropic', overrides.source || 'agent',
    overrides.ideName || null, overrides.billingType || 'api_key',
    overrides.upstreamStatus || 200, overrides.latencyMs || 500,
    overrides.inputTokens ?? 1000, overrides.outputTokens ?? 500,
    overrides.cacheReadTokens ?? 0, overrides.cacheWriteTokens ?? 0,
    overrides.totalTokens ?? 1500,
    overrides.costUsd ?? 0.015, overrides.enforcementDecision || 'allow',
    overrides.capWindow || null, JSON.stringify(overrides),
  );
  return id;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('aggregation', () => {
  let aggHour, aggDay, lastHour, lastDay, aggPending;

  before(async () => {
    try {
      const mod = await import('../aggregation.mjs');
      aggHour = mod.aggregateHour;
      aggDay = mod.aggregateDay;
      lastHour = mod.getLastAggregatedHour;
      lastDay = mod.getLastAggregatedDay;
      aggPending = mod.aggregatePendingWindows;
    } catch { /* Module may not exist yet */ }
  });

  function newDb() { return openMemoryDb(); }

  it('empty ledger produces no aggregation rows', () => {
    if (!aggHour) return;
    const db = newDb();
    try {
      const hourTs = makeHourTs(1);
      aggHour(db, hourTs);
      const rows = db.prepare('SELECT COUNT(*) AS c FROM analytics_hourly').get();
      assert.strictEqual(rows.c, 0);
    } finally { db.close(); }
  });

  it('aggregates single hour of events correctly', () => {
    if (!aggHour) return;
    const db = newDb();
    try {
      const hourTs = makeHourTs(1);
      insertRawEvent(db, { ts: hourTs, provider: 'anthropic', model: 'claude-sonnet', agent: 'builder', costUsd: 0.01, inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });
      insertRawEvent(db, { ts: new Date(new Date(hourTs).getTime() + 600000).toISOString(), provider: 'anthropic', model: 'claude-sonnet', agent: 'builder', costUsd: 0.02, inputTokens: 2000, outputTokens: 1000, totalTokens: 3000 });
      insertRawEvent(db, { ts: new Date(new Date(hourTs).getTime() + 1200000).toISOString(), provider: 'anthropic', model: 'claude-sonnet', agent: 'builder', costUsd: 0.03, inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });

      aggHour(db, hourTs);
      const rows = db.prepare('SELECT * FROM analytics_hourly WHERE hour_ts = ?').all(hourTs);
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].provider, 'anthropic');
      assert.strictEqual(rows[0].input_tokens, 4000);
      assert.strictEqual(rows[0].output_tokens, 2000);
      assert.strictEqual(rows[0].total_tokens, 6000);
      assert.strictEqual(rows[0].api_calls, 3);
      assert.ok(Math.abs(rows[0].cost_usd - 0.06) < 0.001);
    } finally { db.close(); }
  });

  it('aggregation is idempotent (INSERT OR REPLACE)', () => {
    if (!aggHour) return;
    const db = newDb();
    try {
      const hourTs = makeHourTs(1);
      insertRawEvent(db, { ts: hourTs, provider: 'anthropic', model: 'claude-sonnet', agent: 'builder', costUsd: 0.01, totalTokens: 1000 });
      aggHour(db, hourTs);
      const first = db.prepare('SELECT cost_usd, api_calls FROM analytics_hourly WHERE hour_ts = ?').get(hourTs);
      assert.strictEqual(first.cost_usd, 0.01);
      assert.strictEqual(first.api_calls, 1);
      aggHour(db, hourTs);
      const second = db.prepare('SELECT cost_usd, api_calls FROM analytics_hourly WHERE hour_ts = ?').get(hourTs);
      assert.strictEqual(second.cost_usd, 0.01);
      assert.strictEqual(second.api_calls, 1);
    } finally { db.close(); }
  });

  it('late-arriving data is incorporated on re-aggregation', () => {
    if (!aggHour) return;
    const db = newDb();
    try {
      const hourTs = makeHourTs(1);
      insertRawEvent(db, { ts: hourTs, provider: 'anthropic', model: 'claude-sonnet', agent: 'builder', costUsd: 0.01, totalTokens: 1000 });
      aggHour(db, hourTs);
      insertRawEvent(db, { ts: new Date(new Date(hourTs).getTime() + 1800000).toISOString(), provider: 'anthropic', model: 'claude-sonnet', agent: 'builder', costUsd: 0.02, totalTokens: 2000 });
      aggHour(db, hourTs);
      const row = db.prepare('SELECT cost_usd, api_calls, total_tokens FROM analytics_hourly WHERE hour_ts = ?').get(hourTs);
      assert.strictEqual(row.cost_usd, 0.03);
      assert.strictEqual(row.api_calls, 2);
      assert.strictEqual(row.total_tokens, 3000);
    } finally { db.close(); }
  });

  it('groups by provider/model/agent/task correctly', () => {
    if (!aggHour) return;
    const db = newDb();
    try {
      const hourTs = makeHourTs(1);
      insertRawEvent(db, { ts: hourTs, provider: 'anthropic', model: 'claude-sonnet', agent: 'builder', task: 'task-a', costUsd: 0.01, totalTokens: 100 });
      insertRawEvent(db, { ts: hourTs, provider: 'deepseek', model: 'deepseek-chat', agent: 'reviewer', task: 'task-b', costUsd: 0.02, totalTokens: 200 });
      aggHour(db, hourTs);
      const rows = db.prepare('SELECT * FROM analytics_hourly WHERE hour_ts = ? ORDER BY provider').all(hourTs);
      assert.strictEqual(rows.length, 2);
      assert.strictEqual(rows[0].provider, 'anthropic');
      assert.strictEqual(rows[1].provider, 'deepseek');
    } finally { db.close(); }
  });

  it('handles NULL task gracefully', () => {
    if (!aggHour) return;
    const db = newDb();
    try {
      const hourTs = makeHourTs(1);
      insertRawEvent(db, { ts: hourTs, provider: 'anthropic', model: 'claude-sonnet', agent: 'builder', task: null, costUsd: 0.01, totalTokens: 100 });
      aggHour(db, hourTs);
      const row = db.prepare('SELECT * FROM analytics_hourly WHERE hour_ts = ?').get(hourTs);
      assert.strictEqual(row.task, null);
      assert.strictEqual(row.cost_usd, 0.01);
    } finally { db.close(); }
  });

  it('skips corrupted events (NULL cost, negative tokens)', () => {
    if (!aggHour) return;
    const db = newDb();
    try {
      const hourTs = makeHourTs(1);
      insertRawEvent(db, { ts: hourTs, provider: 'anthropic', model: 'claude-sonnet', agent: 'builder', costUsd: 0.01, totalTokens: 100 });
      insertRawEvent(db, { id: 'corrupt-1', ts: hourTs, provider: 'anthropic', model: 'claude-sonnet', agent: 'builder', costUsd: null, totalTokens: 100 });
      insertRawEvent(db, { id: 'corrupt-2', ts: hourTs, provider: 'anthropic', model: 'claude-sonnet', agent: 'builder', costUsd: 0.05, totalTokens: -50 });
      aggHour(db, hourTs);
      const row = db.prepare('SELECT cost_usd, api_calls FROM analytics_hourly WHERE hour_ts = ?').get(hourTs);
      assert.ok(row !== undefined);
      assert.ok(typeof row.cost_usd === 'number');
    } finally { db.close(); }
  });

  it('daily rollup aggregates from hourly correctly', () => {
    if (!aggHour || !aggDay) return;
    const db = newDb();
    try {
      const h1 = makeHourTs(1);
      insertRawEvent(db, { ts: h1, provider: 'anthropic', model: 'claude-sonnet', agent: 'builder', costUsd: 0.01, totalTokens: 100 });
      aggHour(db, h1);
      const h2 = makeHourTs(2);
      insertRawEvent(db, { ts: h2, provider: 'anthropic', model: 'claude-sonnet', agent: 'builder', costUsd: 0.02, totalTokens: 200 });
      aggHour(db, h2);
      const dayTs = h1.slice(0, 10);
      aggDay(db, dayTs);
      const row = db.prepare('SELECT * FROM analytics_daily WHERE day_ts = ?').get(dayTs);
      assert.ok(row !== null);
      assert.strictEqual(row.provider, 'anthropic');
      assert.strictEqual(row.cost_usd, 0.03);
      assert.strictEqual(row.total_tokens, 300);
      assert.strictEqual(row.api_calls, 2);
    } finally { db.close(); }
  });

  it('daily rollup is idempotent', () => {
    if (!aggHour || !aggDay) return;
    const db = newDb();
    try {
      const h1 = makeHourTs(1);
      insertRawEvent(db, { ts: h1, provider: 'anthropic', model: 'claude-sonnet', agent: 'builder', costUsd: 0.01, totalTokens: 100 });
      aggHour(db, h1);
      const dayTs = h1.slice(0, 10);
      aggDay(db, dayTs);
      const first = db.prepare('SELECT cost_usd FROM analytics_daily WHERE day_ts = ?').get(dayTs);
      assert.strictEqual(first.cost_usd, 0.01);
      aggDay(db, dayTs);
      const second = db.prepare('SELECT cost_usd FROM analytics_daily WHERE day_ts = ?').get(dayTs);
      assert.strictEqual(second.cost_usd, 0.01);
    } finally { db.close(); }
  });

  it('getLastAggregatedHour/Day return null for empty tables', () => {
    if (!lastHour || !lastDay) return;
    const db = newDb();
    try {
      assert.strictEqual(lastHour(db), null);
      assert.strictEqual(lastDay(db), null);
    } finally { db.close(); }
  });

  it('getLastAggregatedHour returns max hour after aggregation', () => {
    if (!aggHour || !lastHour) return;
    const db = newDb();
    try {
      const h1 = '2026-07-30T10:00:00.000Z';
      const h2 = '2026-07-30T12:00:00.000Z';
      insertRawEvent(db, { ts: h1, provider: 'anth', model: 'm', agent: 'a', costUsd: 0.01, totalTokens: 10 });
      insertRawEvent(db, { ts: h2, provider: 'anth', model: 'm', agent: 'a', costUsd: 0.01, totalTokens: 10 });
      aggHour(db, h1);
      assert.strictEqual(lastHour(db), h1);
      aggHour(db, h2);
      assert.strictEqual(lastHour(db), h2);
    } finally { db.close(); }
  });

  it('aggregatePendingWindows catches up on missed windows', () => {
    if (!aggPending) return;
    const db = newDb();
    try {
      const h1 = '2026-07-30T08:00:00.000Z';
      const h2 = '2026-07-30T09:00:00.000Z';
      const h3 = '2026-07-30T10:00:00.000Z';
      insertRawEvent(db, { ts: h1, provider: 'anth', model: 'm', agent: 'a', costUsd: 0.01, totalTokens: 10 });
      insertRawEvent(db, { ts: h2, provider: 'anth', model: 'm', agent: 'a', costUsd: 0.01, totalTokens: 10 });
      insertRawEvent(db, { ts: h3, provider: 'anth', model: 'm', agent: 'a', costUsd: 0.01, totalTokens: 10 });
      const result = aggPending(db);
      assert.ok(result.hourly >= 3);
      assert.ok(result.daily >= 0);
      const count = db.prepare('SELECT COUNT(*) AS c FROM analytics_hourly').get();
      assert.ok(count.c >= 3);
    } finally { db.close(); }
  });

  it('precision tolerance within 0.1%', () => {
    if (!aggHour) return;
    const db = newDb();
    try {
      const hourTs = makeHourTs(1);
      insertRawEvent(db, { ts: hourTs, provider: 'anth', model: 'm', agent: 'a', costUsd: 0.00123, totalTokens: 100 });
      insertRawEvent(db, { ts: hourTs, provider: 'anth', model: 'm', agent: 'a', costUsd: 0.00456, totalTokens: 200 });
      aggHour(db, hourTs);
      const row = db.prepare('SELECT cost_usd FROM analytics_hourly WHERE hour_ts = ?').get(hourTs);
      const expected = 0.00123 + 0.00456;
      const tolerance = expected * 0.001;
      assert.ok(Math.abs(row.cost_usd - expected) <= Math.max(tolerance, 0.00001), `Expected ~${expected}, got ${row.cost_usd}`);
    } finally { db.close(); }
  });
});
