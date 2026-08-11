import { recordOperationalAudit } from './operational-audit.mjs';

const RETRYABLE_REASONS = new Set(['quota', 'timeout', 'signal', 'spawn_error', 'nonzero']);
const after = (instant) => { const value = Date.parse(instant); return Number.isFinite(value) ? new Date(value + 1).toISOString() : new Date().toISOString(); };

export class OperationalRecoveryError extends Error {
  constructor(code, message, httpStatus = 422) { super(message); this.name = 'OperationalRecoveryError'; this.code = code; this.httpStatus = httpStatus; }
}

export function getRecoveryEligibility({ run, task, actor } = {}) {
  const canMutate = ['operator', 'admin'].includes(actor?.role);
  const failed = run?.outcome === 'failed' || run?.outcome === 'blocked';
  const typedRetryable = RETRYABLE_REASONS.has(run?.reason);
  const taskRetryable = task && task.status !== 'done';
  let explanation = 'This run is not classified as retryable. Inspect its evidence and escalate if needed.';
  if (!canMutate) explanation = 'Your current role is read-only for recovery actions.';
  else if (!failed) explanation = 'Only failed or blocked runs can be retried.';
  else if (!taskRetryable) explanation = 'The related task is already complete and cannot be requeued.';
  else if (typedRetryable) explanation = 'This typed transient failure can be safely requeued.';
  return {
    retry: { allowed: Boolean(canMutate && failed && typedRetryable && taskRetryable), explanation },
    restart: { allowed: actor?.role === 'admin', explanation: actor?.role === 'admin' ? 'Administrator restart requires impact preview and explicit confirmation.' : 'Restart is administrator-only and is never automatic.' },
  };
}

export function retryOperationalRun({ store, db, run, actor, scope = {}, reason, correlationId, idempotencyKey, now = new Date().toISOString() } = {}) {
  if (!idempotencyKey || !correlationId) throw new OperationalRecoveryError('RECOVERY_INVALID', 'idempotency and correlation identifiers are required', 400);
  const safeReason = String(reason || '').trim().slice(0, 1000);
  const existing = db.prepare('SELECT result_json FROM operational_recovery_requests WHERE idempotency_key=?').get(idempotencyKey);
  if (existing) {
    const prior = JSON.parse(existing.result_json);
    const audit = recordOperationalAudit(db, { tenantId: scope.tenantId ?? 'default', projectId: scope.projectId, eventType: 'retry.duplicate', actor, targetType: 'run', targetId: run?.run_id, reason, result: 'duplicate', correlationId, now, metadata: { idempotencyKey } });
    return { ...prior, duplicate: true, audit };
  }
  const intent = recordOperationalAudit(db, { tenantId: scope.tenantId ?? 'default', projectId: scope.projectId, eventType: 'retry.intent', actor, targetType: 'run', targetId: run?.run_id, before: { outcome: run?.outcome, reason: run?.reason, taskId: run?.task }, reason: safeReason, result: 'recorded', correlationId, now, metadata: { idempotencyKey } });
  const outcomeNow = after(now);
  if (!safeReason) {
    recordOperationalAudit(db, { tenantId: scope.tenantId ?? 'default', projectId: scope.projectId, eventType: 'retry.outcome', actor, targetType: 'run', targetId: run?.run_id, reason: null, result: 'denied', correlationId, now: outcomeNow, metadata: { code: 'RECOVERY_REASON_REQUIRED', intentAuditId: intent.id } });
    throw new OperationalRecoveryError('RECOVERY_REASON_REQUIRED', 'A reason is required before retrying this run.', 400);
  }
  const task = store.state.getTask(run?.task);
  const eligibility = getRecoveryEligibility({ run, task, actor });
  if (!['operator','admin'].includes(actor?.role) || !eligibility.retry.allowed) {
    const code = !['operator','admin'].includes(actor?.role) ? 'RECOVERY_FORBIDDEN' : 'RECOVERY_INELIGIBLE';
    recordOperationalAudit(db, { tenantId: scope.tenantId ?? 'default', projectId: scope.projectId, eventType: 'retry.outcome', actor, targetType: 'run', targetId: run?.run_id, reason: safeReason, result: 'denied', correlationId, now: outcomeNow, metadata: { code, intentAuditId: intent.id } });
    throw new OperationalRecoveryError(code, eligibility.retry.explanation, code === 'RECOVERY_FORBIDDEN' ? 403 : 422);
  }
  const note = `retry requested for ${run.run_id}: ${safeReason.slice(0, 500)}`;
  const target = task.status === 'blocked' ? 'ready-for-impl' : task.status === 'in-review' ? 'in-progress' : task.status;
  const transition = store.state.transition({ taskId: task.id, to: target, actor: actor.id, note, releaseLease: true, now });
  if (!transition?.ok) {
    recordOperationalAudit(db, { tenantId: scope.tenantId ?? 'default', projectId: scope.projectId, eventType: 'retry.outcome', actor, targetType: 'run', targetId: run.run_id, reason: safeReason, result: 'failed', correlationId, now: outcomeNow, metadata: { code: 'RECOVERY_FAILED', intentAuditId: intent.id } });
    throw new OperationalRecoveryError('RECOVERY_FAILED', transition?.reason ?? 'task could not be requeued', 409);
  }
  const outcome = recordOperationalAudit(db, { tenantId: scope.tenantId ?? 'default', projectId: scope.projectId, eventType: 'retry.outcome', actor, targetType: 'run', targetId: run.run_id, before: { taskStatus: task.status }, after: { taskStatus: transition.task.status }, reason: safeReason, result: 'succeeded', correlationId, now: outcomeNow, metadata: { intentAuditId: intent.id, idempotencyKey } });
  const result = {
    ok: true, duplicate: false, correlationId, retryRequestId: idempotencyKey, sourceRunId: run.run_id,
    task: transition.task, taskUrl: `/app/operations/tasks/${encodeURIComponent(task.id)}`, newRunUrl: `/app/operations/runs?task=${encodeURIComponent(task.id)}&retryRequest=${encodeURIComponent(idempotencyKey)}`,
    audit: { id: outcome.id, kind: 'operational-audit', correlationId },
  };
  try {
    db.prepare(`INSERT INTO operational_recovery_requests(idempotency_key,correlation_id,run_id,task_id,actor_id,actor_role,reason,result_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(idempotencyKey, correlationId, run.run_id, task.id, actor.id, actor.role, safeReason, JSON.stringify(result), now);
  } catch (error) {
    const raced = db.prepare('SELECT result_json FROM operational_recovery_requests WHERE idempotency_key=?').get(idempotencyKey);
    if (raced) return { ...JSON.parse(raced.result_json), duplicate: true };
    throw error;
  }
  return result;
}

export function executeAuditedRestart({ db, restart, actor, tenantId = 'default', projectId = null, sourceRunId = null, reason, correlationId, now = new Date().toISOString() } = {}) {
  const targetType = sourceRunId ? 'run' : 'daemon';
  const targetId = sourceRunId ?? 'local-daemon';
  const intent = recordOperationalAudit(db, { tenantId, projectId, eventType: 'restart.intent', actor, targetType, targetId, reason, result: 'recorded', correlationId, now, metadata: { impact: 'daemon restart and approximately ten seconds of dashboard downtime' } });
  let result;
  try { result = restart(); }
  catch (error) { result = { ok: false, error: String(error?.message ?? error) }; }
  const outcome = recordOperationalAudit(db, { tenantId, projectId, eventType: 'restart.outcome', actor, targetType, targetId, reason, result: result.ok ? 'succeeded' : 'failed', correlationId, now: after(now), metadata: { intentAuditId: intent.id, message: result.ok ? 'restart requested' : String(result.error || 'restart failed').slice(0, 500) } });
  return { result, intent, outcome };
}
