/**
 * dashboard/actions — the founder's control-panel write actions beyond policy levers. Each is a
 * small, safe operation on the state DB, invoked from localhost only, pure over an injected db so
 * it's unit-tested without a socket. These back the dashboard-v2 contract's control endpoints:
 *   POST /api/run         → runNow (a DRY-RUN plan; spawning stays the founder's launcher)
 *   POST /api/task        → taskAction (block / unblock / snooze / skip / unsnooze / unskip)
 *   POST /api/verify      → verifyAction (approve → merge, reject → bounce back)
 *   POST /api/escalation  → escalationAction (ack — escalations are recomputed each poll)
 */
import { getTask, transition, blockTask, setGovernanceFlags, DAY } from '../state.mjs';
import { loadPolicy } from '../budget.mjs';
import { planRun } from '../runner.mjs';
import { applyVerdict } from '../verifier.mjs';

const DEFAULT_SNOOZE_DAYS = 7;

/** "Run now": show what the runner WOULD fire. It does not spawn — autonomy stays opt-in.
 *  `config` is the injected AiosConfig (REQUIRED), threaded to loadPolicy/planRun. */
export function runNow(db, { config, policy = loadPolicy(undefined, config), budget, now = Date.now(), runs } = {}) {
  const plan = planRun({ db, policy, budget, now, runs, config });
  return {
    ok: true,
    fire: plan.fire,
    reason: plan.reason,
    plan: plan.decisions.filter((d) => d.mayClaim).map((d) => ({ agent: d.agent, task: d.task?.id ?? null, model: d.model })),
  };
}

/** Task lifecycle nudges the founder can make from the panel. */
export function taskAction(db, { id, action, now = Date.now(), days, reason } = {}) {
  const t0 = getTask(db, id);
  if (!t0) return { ok: false, error: 'no such task' };
  const nowIso = new Date(now).toISOString();
  try {
    if (action === 'block') {
      const r = blockTask(db, { taskId: id, actor: 'founder', reason: 'blocked from dashboard', now: nowIso });
      return r && r.ok === false ? { ok: false, error: r.reason } : { ok: true, task: id, status: 'blocked' };
    }
    if (action === 'unblock') {
      // Record the founder's §6 approval in a DURABLE column (not the note) so a later
      // note-overwriting transition can't erase it and the planner/router won't re-block a
      // governance-held task (sensitive.isFounderApproved reads approved_at). Clear any park
      // state on the way out — an approved, workable task is no longer snoozed/skipped.
      const r = transition(db, { taskId: id, to: 'ready-for-impl', actor: 'founder', note: 'unblocked from dashboard', now: nowIso });
      if (!(r && r.ok)) return { ok: false, error: r?.reason ?? 'transition failed' };
      setGovernanceFlags(db, { taskId: id, approvedAt: nowIso, snoozedUntil: null, skippedAt: null, skipReason: null }, { actor: 'founder', op: 'unblock', now: nowIso });
      return { ok: true, task: id, status: 'ready-for-impl' };
    }
    // Snooze/skip park a blocked task out of the "needs you" feed WITHOUT approving the
    // underlying spend/external/deploy/schema action — status stays 'blocked' throughout, and the
    // free-text `note` (block/verify reason) is left entirely alone.
    if (action === 'snooze') {
      const d = Number(days) > 0 ? Number(days) : DEFAULT_SNOOZE_DAYS;
      const until = new Date(now + d * DAY).toISOString();
      // Setting the column REPLACES any prior snooze date outright (no stacked markers to dedupe).
      setGovernanceFlags(db, { taskId: id, snoozedUntil: until }, { actor: 'founder', op: 'snooze', now: nowIso });
      return { ok: true, task: id, snoozedUntil: until };
    }
    if (action === 'unsnooze') {
      setGovernanceFlags(db, { taskId: id, snoozedUntil: null }, { actor: 'founder', op: 'unsnooze', now: nowIso });
      return { ok: true, task: id };
    }
    if (action === 'skip') {
      setGovernanceFlags(db, { taskId: id, skippedAt: nowIso, skipReason: reason ?? null }, { actor: 'founder', op: 'skip', now: nowIso });
      return { ok: true, task: id };
    }
    if (action === 'unskip') {
      setGovernanceFlags(db, { taskId: id, skippedAt: null, skipReason: null }, { actor: 'founder', op: 'unskip', now: nowIso });
      return { ok: true, task: id };
    }
    return { ok: false, error: `unsupported action: ${action}` };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/** Verifier actions. `approve` is the founder explicitly merging, so it overrides founder_only.
 *  `config` is the injected AiosConfig (REQUIRED), threaded to loadPolicy's injected default. */
export function verifyAction(db, { config, task, action, policy = loadPolicy(undefined, config), now = Date.now() } = {}) {
  const mode = policy?.auto_merge ?? 'founder_only';
  const nowIso = new Date(now).toISOString();
  try {
    if (action === 'approve') {
      const r = applyVerdict(db, { task, verdict: 'pass', mode: mode === 'founder_only' ? 'verifier_gated' : mode, actor: 'founder', now });
      return r.ok ? { ok: true, task, merged: true } : { ok: false, error: r.reason };
    }
    if (action === 'reject') {
      const r = transition(db, { taskId: task, to: 'in-progress', actor: 'founder', note: 'changes requested from dashboard', now: nowIso });
      return r && r.ok ? { ok: true, task, status: 'in-progress' } : { ok: false, error: r?.reason ?? 'transition failed' };
    }
    if (action === 'rerun') return { ok: true, task, note: 'rerun requested' };
    return { ok: false, error: `unsupported action: ${action}` };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/** Escalations are recomputed from live state each poll, so an ack is a client-side dismissal. */
export function escalationAction(_db, { id, action } = {}) {
  if (action === 'ack' || action === 'resolve') return { ok: true, id, acked: true };
  return { ok: false, error: `unsupported action: ${action}` };
}

/** Route one control action. Returns null for an unknown path (server → 404). */
export function handleAction(db, pathname, body = {}, opts = {}) {
  switch (pathname) {
    case '/api/run': return runNow(db, opts);
    case '/api/task': return taskAction(db, { ...body, ...opts });
    case '/api/verify': return verifyAction(db, { ...body, ...opts });
    case '/api/escalation': return escalationAction(db, body);
    default: return null;
  }
}
