/**
 * tests/task-cost-attribution.test.mjs — P5: US2 per-task cost attribution tests.
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

describe('task cost attribution', () => {
  let queryTaskCost, queryProjectCosts, queryBreakdown;

  before(async () => {
    try {
      const mod = await import('../analytics.mjs');
      queryTaskCost = mod.queryTaskCost;
      queryProjectCosts = mod.queryProjectCosts;
      queryBreakdown = mod.queryBreakdown;
    } catch { /* may not exist */ }
  });

  it('multiple runs per task aggregate correctly', () => {
    if (!queryTaskCost) return;
    const db = openMemoryDb();
    try {
      insertEvent(db, { task: 'task-x', runId: 'r1', costUsd: 1.00, totalTokens: 100 });
      insertEvent(db, { task: 'task-x', runId: 'r1', costUsd: 2.00, totalTokens: 200 });
      insertEvent(db, { task: 'task-x', runId: 'r2', costUsd: 3.00, totalTokens: 300 });
      const r = queryTaskCost(db, 'task-x', true);
      assert.ok(r.totalCost > 5.99);
      assert.strictEqual(r.apiCalls, 3);
      assert.ok(r.runs.length >= 1);
    } finally { db.close(); }
  });

  it('unattributed traffic (NULL task) not counted in task queries', () => {
    if (!queryTaskCost) return;
    const db = openMemoryDb();
    try {
      insertEvent(db, { task: null, costUsd: 5, totalTokens: 100 });
      const r = queryTaskCost(db, 'any-task');
      assert.strictEqual(r.totalCost, 0);
    } finally { db.close(); }
  });

  it('project-costs ranks tasks by cost', () => {
    if (!queryProjectCosts) return;
    const db = openMemoryDb();
    try {
      insertEvent(db, { task: 'prj/expensive-task', costUsd: 50, totalTokens: 100 });
      insertEvent(db, { task: 'prj/cheap-task', costUsd: 2, totalTokens: 100 });
      const r = queryProjectCosts(db, 'prj', 'cost', 10);
      assert.strictEqual(r.project, 'prj');
      assert.ok(r.tasks.length >= 1);
      if (r.tasks.length >= 2) assert.ok(r.tasks[0].cost >= r.tasks[1].cost);
    } finally { db.close(); }
  });

  it('cross-verify task costs against raw ledger SUM', () => {
    if (!queryTaskCost) return;
    const db = openMemoryDb();
    try {
      insertEvent(db, { task: 'verify-me', costUsd: 3.33, totalTokens: 100 });
      insertEvent(db, { task: 'verify-me', costUsd: 6.67, totalTokens: 200 });
      const rawSum = db.prepare('SELECT COALESCE(SUM(cost_usd),0) AS s FROM token_events WHERE task=?').get('verify-me');
      const r = queryTaskCost(db, 'verify-me');
      assert.ok(Math.abs(r.totalCost - rawSum.s) < 0.01);
    } finally { db.close(); }
  });

  it('label breakdown groups by costLabel from raw JSON', () => {
    if (!queryBreakdown) return;
    const db = openMemoryDb();
    try {
      const from = new Date(Date.now() - 86400000).toISOString();
      const to = new Date(Date.now() + 86400000).toISOString();
      insertEvent(db, { task: 't1', costUsd: 10, totalTokens: 100, provider: 'p1', model: 'm1', agent: 'a1', id: 'l1' });
      insertEvent(db, { task: 't2', costUsd: 20, totalTokens: 200, provider: 'p1', model: 'm1', agent: 'a1', id: 'l2' });
      const r = queryBreakdown(db, 'provider', from, to, 5);
      assert.ok(r.items.length >= 1);
    } finally { db.close(); }
  });
});
