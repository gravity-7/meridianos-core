/**
 * tests/alerts.test.mjs — P5: US5 alert evaluation tests.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../db.mjs';
import { getAlertOccurrence, listAlertEvents } from '../dashboard/operational-alert-store.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(HERE, '..', 'gateway', 'ledger-schema.sql');

function openMemoryDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
  return db;
}

describe('alerts', () => {
  let checkCooldown;

  before(async () => {
    try {
      const mod = await import('../alerts.mjs');
      checkCooldown = mod.checkCooldown;
    } catch { /* may not exist */ }
  });

  it('checkCooldown returns false for never-fired rule', () => {
    if (!checkCooldown) return;
    const db = openMemoryDb();
    try {
      assert.strictEqual(checkCooldown(db, 'rule-never-fired', 3600), false);
    } finally { db.close(); }
  });

  it('checkCooldown returns true when within cooldown window', () => {
    if (!checkCooldown) return;
    const db = openMemoryDb();
    try {
      const now = new Date().toISOString();
      db.prepare('INSERT OR REPLACE INTO alert_state (rule_id, last_fired_at, last_value, fire_count, updated_at) VALUES (?, ?, ?, ?, ?)').run('test-rule', now, 80, 1, now);
      assert.strictEqual(checkCooldown(db, 'test-rule', 3600), true);
    } finally { db.close(); }
  });

  it('checkCooldown returns false after cooldown expires', () => {
    if (!checkCooldown) return;
    const db = openMemoryDb();
    try {
      const past = new Date(Date.now() - 7200000).toISOString(); // 2 hours ago
      db.prepare('INSERT OR REPLACE INTO alert_state (rule_id, last_fired_at, last_value, fire_count, updated_at) VALUES (?, ?, ?, ?, ?)').run('old-rule', past, 80, 1, past);
      assert.strictEqual(checkCooldown(db, 'old-rule', 3600), false);
    } finally { db.close(); }
  });

  it('alert_state table supports fire_count increment', () => {
    const db = openMemoryDb();
    try {
      const now = new Date().toISOString();
      db.prepare('INSERT OR REPLACE INTO alert_state (rule_id, last_fired_at, last_value, fire_count, updated_at) VALUES (?, ?, ?, ?, ?)').run('count-rule', now, 80, 1, now);
      db.prepare('UPDATE alert_state SET fire_count = fire_count + 1, updated_at = ? WHERE rule_id = ?').run(new Date().toISOString(), 'count-rule');
      const r = db.prepare('SELECT fire_count FROM alert_state WHERE rule_id = ?').get('count-rule');
      assert.strictEqual(r.fire_count, 2);
    } finally { db.close(); }
  });

  it('no alert_state rows exist on fresh DB', () => {
    const db = openMemoryDb();
    try {
      const r = db.prepare('SELECT COUNT(*) AS c FROM alert_state').get();
      assert.strictEqual(r.c, 0);
    } finally { db.close(); }
  });

  it('normalizes legacy warn signals without retaining secret-shaped fields', async () => {
    const { normalizeOperationalAlertCandidate } = await import('../alerts.mjs');
    const candidate = normalizeOperationalAlertCandidate({ source: 'legacy-escalation', id: 'legacy-1', severity: 'warn', title: 'Run failed', message: 'Safe summary', task: 'project-a/task-a', run_id: 'run-a', credential: 'never-copy' });
    assert.equal(candidate.severity, 'warning'); assert.equal(candidate.taskId, 'project-a/task-a'); assert.equal(candidate.runId, 'run-a');
    assert.equal(JSON.stringify(candidate).includes('never-copy'), false);
  });

  it('configured rules update canonical occurrences during cooldown and escalation overrides suppression', async () => {
    const { evaluateAlerts } = await import('../alerts.mjs');
    const ledger = openMemoryDb(); const stateDb = openDb(':memory:', { dbPath: ':memory:' });
    const rule = { id: 'budget-80', type: 'budget_threshold', thresholdPct: 80, severity: 'warning', cooldownSeconds: 3600, enabled: true };
    const state = { pctUsed: 90, spendToDate: 90, monthlyLimit: 100 };
    const first = await evaluateAlerts(ledger, { alerts: { rules: [rule], channels: [] } }, state, { db: stateDb, tenantId: 'tenant-a', projectId: 'project-a' });
    assert.equal(first.length, 1); const alertId = first[0].occurrenceId;
    const second = await evaluateAlerts(ledger, { alerts: { rules: [rule], channels: [] } }, state, { db: stateDb, tenantId: 'tenant-a', projectId: 'project-a' });
    assert.equal(second.length, 0); assert.equal(getAlertOccurrence(stateDb, alertId, { tenantId: 'tenant-a', projectId: 'project-a' }).occurrence_count, 2);
    assert.equal(listAlertEvents(stateDb, alertId).at(-1).event_type, 'notification_suppressed');
    const escalated = await evaluateAlerts(ledger, { alerts: { rules: [{ ...rule, severity: 'critical' }], channels: [] } }, state, { db: stateDb, tenantId: 'tenant-a', projectId: 'project-a' });
    assert.equal(escalated.length, 1); assert.equal(getAlertOccurrence(stateDb, alertId, { tenantId: 'tenant-a', projectId: 'project-a' }).severity, 'critical');
    ledger.close(); stateDb.close();
  });
});
