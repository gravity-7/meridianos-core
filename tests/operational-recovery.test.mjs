import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db.mjs';
import { createProjectStore } from '../project-store.mjs';
import { upsertTask } from '../state.mjs';
import { executeAuditedRestart, getRecoveryEligibility, retryOperationalRun } from '../dashboard/operational-recovery.mjs';

function fixture() {
  const db = openDb(':memory:', { dbPath: ':memory:' });
  upsertTask(db, { id: 'project-a/task-a', title: 'Task A', status: 'blocked', note: 'provider timeout' }, { now: '2026-08-11T00:00:00.000Z' });
  return { db, store: createProjectStore({ db, config: { dbPath: ':memory:' } }) };
}

test('typed recovery is read-only for viewer/finance and restart is admin-only', () => {
  const run = { run_id: 'run-a', task: 'project-a/task-a', outcome: 'failed', reason: 'timeout' };
  assert.equal(getRecoveryEligibility({ run, task: { status: 'blocked' }, actor: { role: 'viewer' } }).retry.allowed, false);
  assert.equal(getRecoveryEligibility({ run, task: { status: 'blocked' }, actor: { role: 'finance' } }).retry.allowed, false);
  const operator = getRecoveryEligibility({ run, task: { status: 'blocked' }, actor: { role: 'operator' } });
  assert.equal(operator.retry.allowed, true);
  assert.equal(operator.restart.allowed, false);
  assert.equal(getRecoveryEligibility({ run, task: { status: 'blocked' }, actor: { role: 'admin' } }).restart.allowed, true);
});

test('retry requeues through the state machine, prevents duplicates, and records audit evidence', () => {
  const { db, store } = fixture();
  const input = { store, db, run: { run_id: 'run-a', task: 'project-a/task-a', outcome: 'failed', reason: 'timeout' }, actor: { id: 'operator-1', role: 'operator' }, reason: 'Transient timeout', correlationId: 'corr-a', idempotencyKey: 'retry-a', now: '2026-08-11T01:00:00.000Z' };
  const first = retryOperationalRun(input);
  const second = retryOperationalRun(input);
  assert.equal(first.ok, true);
  assert.equal(first.task.status, 'ready-for-impl');
  assert.equal(second.duplicate, true);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM history WHERE task_id=? AND actor=?").get('project-a/task-a', 'operator-1').c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM operational_recovery_requests').get().c, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM operational_audit_events WHERE event_type IN ('retry.intent','retry.outcome')").get().c, 2);
  db.close();
});

test('non-retryable and unauthorized requests return a specific safe explanation', () => {
  const { db, store } = fixture();
  assert.throws(() => retryOperationalRun({ store, db, run: { run_id: 'run-a', task: 'project-a/task-a', outcome: 'failed', reason: 'no_transition' }, actor: { id: 'viewer', role: 'viewer' }, reason: 'try', correlationId: 'c', idempotencyKey: 'x' }), (error) => error.code === 'RECOVERY_FORBIDDEN');
  assert.deepEqual(db.prepare("SELECT event_type,result FROM operational_audit_events ORDER BY created_at,id").all().map((row) => ({ ...row })), [
    { event_type: 'retry.intent', result: 'recorded' }, { event_type: 'retry.outcome', result: 'denied' },
  ]);
  db.close();
});

test('empty retry reason is denied only after correlated intent evidence is durable', () => {
  const { db, store } = fixture();
  assert.throws(() => retryOperationalRun({ store, db, run: { run_id: 'run-a', task: 'project-a/task-a', outcome: 'failed', reason: 'timeout' }, actor: { id: 'operator-1', role: 'operator' }, reason: '  ', correlationId: 'reason-correlation', idempotencyKey: 'missing-reason' }), (error) => error.code === 'RECOVERY_REASON_REQUIRED');
  assert.deepEqual(db.prepare('SELECT event_type,result,correlation_id FROM operational_audit_events ORDER BY created_at,id').all().map((row) => ({ ...row })), [
    { event_type: 'retry.intent', result: 'recorded', correlation_id: 'reason-correlation' }, { event_type: 'retry.outcome', result: 'denied', correlation_id: 'reason-correlation' },
  ]);
  db.close();
});

test('restart records correlated intent before an injected success or failure outcome', () => {
  const { db } = fixture();
  let intentsAtInvocation = 0;
  const succeeded = executeAuditedRestart({ db, restart: () => { intentsAtInvocation = db.prepare("SELECT COUNT(*) AS c FROM operational_audit_events WHERE event_type='restart.intent'").get().c; return { ok: true, message: 'scheduled' }; }, actor: { id: 'admin-1', role: 'admin' }, tenantId: 'tenant-a', projectId: 'project-a', sourceRunId: 'run-a', reason: 'Confirmed impact', correlationId: 'restart-a', now: '2026-08-11T02:00:00.000Z' });
  assert.equal(intentsAtInvocation, 1);
  assert.equal(succeeded.outcome.result, 'succeeded');
  const failed = executeAuditedRestart({ db, restart: () => { throw new Error('scheduler unavailable'); }, actor: { id: 'admin-1', role: 'admin' }, tenantId: 'tenant-a', reason: 'Second attempt', correlationId: 'restart-b', now: '2026-08-11T02:01:00.000Z' });
  assert.equal(failed.result.ok, false);
  assert.equal(failed.outcome.result, 'failed');
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM operational_audit_events WHERE event_type LIKE 'restart.%'").get().c, 4);
  db.close();
});
