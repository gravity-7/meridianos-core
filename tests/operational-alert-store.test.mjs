import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db.mjs';
import { upsertAlertOccurrence, transitionAlertOccurrence, getAlertOccurrence, queryAlertOccurrences, listAlertEvents, pruneAlertOccurrences, pruneOperationalEvidence } from '../dashboard/operational-alert-store.mjs';
import { recordOperationalAudit } from '../dashboard/operational-audit.mjs';

const context = { tenantId: 'tenant-a', projectId: 'project-a', actor: { id: 'system', type: 'system', role: null }, correlationId: 'corr-1', now: '2026-08-01T00:00:00.000Z' };
const candidate = { source: 'run', ruleId: 'failed-run', fingerprint: 'fp-1', severity: 'warn', title: 'Run failed', summary: 'Provider timeout', taskId: 'project-a/task-1', runId: 'run-1' };

test('canonical alert upsert normalizes warn, deduplicates active occurrence, and writes immutable events', () => {
  const db = openDb(':memory:', { dbPath: ':memory:' });
  const created = upsertAlertOccurrence(db, candidate, context);
  assert.equal(created.occurrence.severity, 'warning');
  assert.equal(created.occurrence.status, 'open');
  const observed = upsertAlertOccurrence(db, candidate, { ...context, now: '2026-08-01T00:01:00.000Z' });
  assert.equal(observed.occurrence.id, created.occurrence.id);
  assert.equal(observed.occurrence.occurrence_count, 2);
  assert.deepEqual(listAlertEvents(db, created.occurrence.id).map((event) => event.event_type), ['created', 'observed']);
  db.close();
});

test('acknowledgement suppresses same-severity notification while escalation reopens', () => {
  const db = openDb(':memory:', { dbPath: ':memory:' });
  const created = upsertAlertOccurrence(db, candidate, context).occurrence;
  const ack = transitionAlertOccurrence(db, created.id, { type: 'acknowledge', expectedVersion: created.version, reason: 'Investigating' }, { ...context, actor: { id: 'operator-1', type: 'user', role: 'operator' } }).occurrence;
  assert.equal(ack.status, 'acknowledged');
  const recurring = upsertAlertOccurrence(db, candidate, { ...context, now: '2026-08-01T00:02:00.000Z' }).occurrence;
  assert.equal(recurring.status, 'acknowledged');
  assert.match(recurring.notification_suppression_reason, /acknowledged/);
  const escalated = upsertAlertOccurrence(db, { ...candidate, severity: 'critical' }, { ...context, now: '2026-08-01T00:03:00.000Z' }).occurrence;
  assert.equal(escalated.status, 'open');
  assert.equal(escalated.severity, 'critical');
  assert.equal(escalated.notification_suppression_reason, null);
  db.close();
});

test('resolution creates an immutable episode boundary and stale mutations are rejected', () => {
  const db = openDb(':memory:', { dbPath: ':memory:' });
  const created = upsertAlertOccurrence(db, candidate, context).occurrence;
  const actorContext = { ...context, actor: { id: 'operator-1', type: 'user', role: 'operator' } };
  const resolved = transitionAlertOccurrence(db, created.id, { type: 'resolve', expectedVersion: created.version, reason: 'Recovered' }, actorContext).occurrence;
  assert.equal(resolved.status, 'resolved');
  assert.throws(() => transitionAlertOccurrence(db, created.id, { type: 'reopen', expectedVersion: created.version, reason: 'stale' }, actorContext), (error) => error.code === 'ALERT_VERSION_CONFLICT');
  const denied = listAlertEvents(db, created.id, { tenantId: 'tenant-a' }).filter((event) => event.result === 'denied');
  assert.equal(denied.length, 1);
  assert.equal(denied[0].metadata.code, 'ALERT_VERSION_CONFLICT');
  const next = upsertAlertOccurrence(db, candidate, { ...context, now: '2026-08-02T00:00:00.000Z' }).occurrence;
  assert.notEqual(next.id, resolved.id);
  assert.equal(next.previous_occurrence_id, resolved.id);
  db.close();
});

test('in-scope missing-reason and read-only lifecycle attempts append denied audit evidence', () => {
  const db = openDb(':memory:', { dbPath: ':memory:' });
  const created = upsertAlertOccurrence(db, candidate, context).occurrence;
  assert.throws(() => transitionAlertOccurrence(db, created.id, { type: 'acknowledge', expectedVersion: created.version, reason: '' }, { ...context, actor: { id: 'operator-1', type: 'user', role: 'operator' }, correlationId: 'missing-reason' }), (error) => error.code === 'ALERT_REASON_REQUIRED');
  assert.throws(() => transitionAlertOccurrence(db, created.id, { type: 'acknowledge', expectedVersion: created.version, reason: 'Attempted read-only change' }, { ...context, actor: { id: 'finance-1', type: 'user', role: 'finance' }, correlationId: 'role-denial' }), (error) => error.code === 'ALERT_FORBIDDEN');
  const denied = listAlertEvents(db, created.id, { tenantId: 'tenant-a' }).filter((event) => event.result === 'denied');
  assert.deepEqual(denied.map((event) => [event.metadata.code, event.actor_role, event.correlation_id]).sort((a, b) => a[0].localeCompare(b[0])), [
    ['ALERT_FORBIDDEN', 'finance', 'role-denial'], ['ALERT_REASON_REQUIRED', 'operator', 'missing-reason'],
  ]);
  db.close();
});

test('alert pages use snapshot cursors bound to authorized filters', () => {
  const db = openDb(':memory:', { dbPath: ':memory:' });
  for (let index = 0; index < 3; index++) upsertAlertOccurrence(db, { ...candidate, id: `alert-${index}`, fingerprint: `page-${index}`, severity: index === 0 ? 'critical' : 'warning' }, { ...context, now: `2026-08-01T00:0${index}:00.000Z` });
  const first = queryAlertOccurrences(db, { tenantId: 'tenant-a', projectId: 'project-a', limit: 1 });
  const second = queryAlertOccurrences(db, { tenantId: 'tenant-a', projectId: 'project-a', cursor: first.nextCursor, limit: 1 });
  assert.equal(first.items.length, 1); assert.equal(second.items.length, 1); assert.notEqual(first.items[0].id, second.items[0].id); assert.equal(first.snapshot, second.snapshot); assert.deepEqual(first.page, { nextCursor: first.nextCursor, snapshot: first.snapshot, limit: 1 });
  assert.throws(() => queryAlertOccurrences(db, { tenantId: 'tenant-a', projectId: 'project-a', severity: 'critical', cursor: first.nextCursor, limit: 1 }), (error) => error.code === 'INVALID_CURSOR');
  db.close();
});

test('alert scope isolation and retention never touch unrelated state', () => {
  const db = openDb(':memory:', { dbPath: ':memory:' });
  const old = upsertAlertOccurrence(db, candidate, { ...context, now: '2024-01-01T00:00:00.000Z' }).occurrence;
  transitionAlertOccurrence(db, old.id, { type: 'resolve', expectedVersion: old.version, reason: 'old' }, { ...context, now: '2024-01-02T00:00:00.000Z', actor: { id: 'operator', type: 'user', role: 'operator' } });
  upsertAlertOccurrence(db, { ...candidate, fingerprint: 'other' }, { ...context, tenantId: 'tenant-b', projectId: null });
  assert.equal(getAlertOccurrence(db, old.id, { tenantId: 'tenant-b' }), null);
  assert.equal(pruneAlertOccurrences(db, { tenantId: 'tenant-a', before: '2025-01-01T00:00:00.000Z' }), 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM alert_occurrences WHERE tenant_id = ?').get('tenant-b').c, 1);
  recordOperationalAudit(db, { tenantId: 'tenant-a', eventType: 'retry.outcome', actor: { id: 'operator', role: 'operator' }, targetType: 'run', targetId: 'run-old', reason: 'old', result: 'succeeded', correlationId: 'old', now: '2024-01-01T00:00:00.000Z' });
  recordOperationalAudit(db, { tenantId: 'tenant-b', eventType: 'retry.outcome', actor: { id: 'operator', role: 'operator' }, targetType: 'run', targetId: 'run-other', reason: 'other', result: 'succeeded', correlationId: 'other', now: '2024-01-01T00:00:00.000Z' });
  const swept = pruneOperationalEvidence(db, { tenantId: 'tenant-a', now: Date.parse('2026-01-01T00:00:00.000Z'), alertRetentionDays: 365, auditRetentionDays: 365 });
  assert.equal(swept.auditEvents, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM operational_audit_events WHERE tenant_id=?').get('tenant-b').c, 1);
  db.close();
});
