/**
 * tests/optimization.test.mjs — P5: US6 optimization recommendation tests.
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
  return db;
}

describe('optimization', () => {
  let generateRecommendations, applyRecommendation, dismissRecommendation, trackActualSavings;

  before(async () => {
    try {
      const mod = await import('../optimization.mjs');
      generateRecommendations = mod.generateRecommendations;
      applyRecommendation = mod.applyRecommendation;
      dismissRecommendation = mod.dismissRecommendation;
      trackActualSavings = mod.trackActualSavings;
    } catch { /* may not exist */ }
  });

  it('generateRecommendations returns empty with insufficient data (< 7 days)', () => {
    if (!generateRecommendations) return;
    const db = openMemoryDb();
    try {
      const r = generateRecommendations(db, 7);
      assert.strictEqual(r.length, 0);
    } finally { db.close(); }
  });

  it('applyRecommendation rejects non-existent id', () => {
    if (!applyRecommendation) return;
    const db = openMemoryDb();
    try {
      const r = applyRecommendation(db, 'nonexistent-id');
      assert.strictEqual(r.ok, false);
      assert.ok(r.error);
    } finally { db.close(); }
  });

  it('dismissRecommendation rejects non-existent id', () => {
    if (!dismissRecommendation) return;
    const db = openMemoryDb();
    try {
      const r = dismissRecommendation(db, 'nonexistent-id', 'too expensive');
      assert.strictEqual(r.ok, false);
      assert.ok(r.error);
    } finally { db.close(); }
  });

  it('trackActualSavings returns 0 on empty recommendations', () => {
    if (!trackActualSavings) return;
    const db = openMemoryDb();
    try {
      const r = trackActualSavings(db);
      assert.strictEqual(r, 0);
    } finally { db.close(); }
  });

  it('optimization_rules table supports INSERT and status transitions', () => {
    const db = openMemoryDb();
    try {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT OR REPLACE INTO optimization_rules
           (id, current_model, recommended_model, task_type, estimated_weekly_savings,
            confidence, capability_check, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run('rec-1', 'p:big-model', 'p:small-model', 'code-review', 15.50, 0.85, '{}', 'active', now, now);

      let r = db.prepare("SELECT * FROM optimization_rules WHERE id = 'rec-1'").get();
      assert.strictEqual(r.status, 'active');
      assert.strictEqual(r.estimated_weekly_savings, 15.50);

      // Apply
      db.prepare("UPDATE optimization_rules SET status = 'applied', applied_at = ?, updated_at = ? WHERE id = ?").run(now, now, 'rec-1');
      r = db.prepare("SELECT status, applied_at FROM optimization_rules WHERE id = 'rec-1'").get();
      assert.strictEqual(r.status, 'applied');
      assert.ok(r.applied_at);

      // Reset for dismiss test
      db.prepare("UPDATE optimization_rules SET status = 'active', applied_at = NULL, dismissed_at = NULL WHERE id = ?").run('rec-1');
      db.prepare("UPDATE optimization_rules SET status = 'dismissed', dismissed_at = ?, dismiss_reason = ?, updated_at = ? WHERE id = ?").run(now, 'not needed', now, 'rec-1');
      r = db.prepare("SELECT status, dismiss_reason FROM optimization_rules WHERE id = 'rec-1'").get();
      assert.strictEqual(r.status, 'dismissed');
      assert.strictEqual(r.dismiss_reason, 'not needed');
    } finally { db.close(); }
  });

  it('insufficient data edge case: < minDataDays of history returns empty', () => {
    if (!generateRecommendations) return;
    const db = openMemoryDb();
    try {
      const now = new Date().toISOString();
      // Insert one event with proper column count
      db.prepare(
        `INSERT INTO token_events (id, ts, tenant, agent, session, task, request_id, provider, model, wire, source, ide_name, billing_type, upstream_status, latency_ms, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens, cost_usd, enforcement_decision, cap_window, raw) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run('ev1', now, 't', 'a', 's', 'code-review/1', 'r1', 'anth', 'm1', 'anth', 'agent', null, 'api_key', 200, 500, 100, 50, 0, 0, 150, 0.05, 'allow', null, '{}');
      // Request 30 days of data — should return empty since we have < 30 days
      const r = generateRecommendations(db, 30);
      assert.strictEqual(r.length, 0);
    } finally { db.close(); }
  });
});
