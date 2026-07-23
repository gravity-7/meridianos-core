/**
 * dashboard/actions — the founder's control-panel write actions beyond policy levers. Each is a
 * small, safe operation on the state DB, invoked from localhost only, pure over an injected db so
 * it's unit-tested without a socket. These back the dashboard-v2 contract's control endpoints:
 *   POST /api/run         → runNow (a DRY-RUN plan; spawning stays the founder's launcher)
 *   POST /api/task        → taskAction (block / unblock / snooze / skip / unsnooze / unskip / bounce)
 *   POST /api/verify      → verifyAction (approve → merge, reject → bounce back)
 *   POST /api/escalation  → escalationAction (ack — escalations are recomputed each poll)
 */
import { DAY } from '../state.mjs';
import { loadPolicy } from '../budget.mjs';
import { planRun } from '../runner.mjs';
import { applyVerdict } from '../verifier.mjs';

const DEFAULT_SNOOZE_DAYS = 7;

/** "Run now": show what the runner WOULD fire. It does not spawn — autonomy stays opt-in.
 *  `config` is the injected AiosConfig (REQUIRED), threaded to loadPolicy/planRun. */
export function runNow(store, { config, policy = loadPolicy(undefined, config), budget, now = Date.now(), runs } = {}) {
  const plan = planRun({ store, policy, budget, now, runs, config });
  return {
    ok: true,
    fire: plan.fire,
    reason: plan.reason,
    plan: plan.decisions.filter((d) => d.mayClaim).map((d) => ({ agent: d.agent, task: d.task?.id ?? null, model: d.model })),
  };
}

/** Task lifecycle nudges the founder can make from the panel. */
export function taskAction(store, { id, action, now = Date.now(), days, reason } = {}) {
  const t0 = store.state.getTask(id);
  if (!t0) return { ok: false, error: 'no such task' };
  const nowIso = new Date(now).toISOString();
  try {
    if (action === 'block') {
      const r = store.state.blockTask({ taskId: id, actor: 'founder', reason: 'blocked from dashboard', now: nowIso });
      return r && r.ok === false ? { ok: false, error: r.reason } : { ok: true, task: id, status: 'blocked' };
    }
    if (action === 'unblock') {
      // Record the founder's §6 approval in a DURABLE column (not the note) so a later
      // note-overwriting transition can't erase it and the planner/router won't re-block a
      // governance-held task (sensitive.isFounderApproved reads approved_at). Clear any park
      // state on the way out — an approved, workable task is no longer snoozed/skipped.
      const r = store.state.transition({ taskId: id, to: 'ready-for-impl', actor: 'founder', note: 'unblocked from dashboard', now: nowIso });
      if (!(r && r.ok)) return { ok: false, error: r?.reason ?? 'transition failed' };
      store.state.setGovernanceFlags({ taskId: id, approvedAt: nowIso, snoozedUntil: null, skippedAt: null, skipReason: null }, { actor: 'founder', op: 'unblock', now: nowIso });
      return { ok: true, task: id, status: 'ready-for-impl' };
    }
    // Snooze/skip park a blocked task out of the "needs you" feed WITHOUT approving the
    // underlying spend/external/deploy/schema action — status stays 'blocked' throughout, and the
    // free-text `note` (block/verify reason) is left entirely alone.
    if (action === 'snooze') {
      const d = Number(days) > 0 ? Number(days) : DEFAULT_SNOOZE_DAYS;
      const until = new Date(now + d * DAY).toISOString();
      // Setting the column REPLACES any prior snooze date outright (no stacked markers to dedupe).
      store.state.setGovernanceFlags({ taskId: id, snoozedUntil: until }, { actor: 'founder', op: 'snooze', now: nowIso });
      return { ok: true, task: id, snoozedUntil: until };
    }
    if (action === 'unsnooze') {
      store.state.setGovernanceFlags({ taskId: id, snoozedUntil: null }, { actor: 'founder', op: 'unsnooze', now: nowIso });
      return { ok: true, task: id };
    }
    if (action === 'skip') {
      store.state.setGovernanceFlags({ taskId: id, skippedAt: nowIso, skipReason: reason ?? null }, { actor: 'founder', op: 'skip', now: nowIso });
      return { ok: true, task: id };
    }
    if (action === 'unskip') {
      store.state.setGovernanceFlags({ taskId: id, skippedAt: null, skipReason: null }, { actor: 'founder', op: 'unskip', now: nowIso });
      return { ok: true, task: id };
    }
    // G2: Bounce — send a task ONE stage backward so the agent gets another pass. The system picks
    // it up again on the next runner cycle without founder intervention (both targets are
    // claimable, so an unleased bounced task is re-eligible immediately).
    //
    // This map must mirror machine.mjs's backward edges EXACTLY — it may never advertise a move the
    // state machine will refuse, or the founder gets `illegal transition` instead of a clean no.
    // Deliberately absent: designing→spec and spec→proposed. plannerCycle auto-promotes
    // proposed→spec (on spec-entry) and spec→designing (once a spec file exists) on every watchdog
    // tick, so either bounce would be silently reverted before the agent it was meant for could
    // claim the task — worse than refusing it. See the note in machine.mjs.
    if (action === 'bounce') {
      const bounceMap = {
        'in-review': 'in-progress',
        'ready-for-impl': 'designing',
      };
      const to = bounceMap[t0.status];
      if (!to) return { ok: false, error: `cannot bounce from status '${t0.status}'` };
      const note = reason ? `bounced by founder: ${reason}` : 'bounced from dashboard';
      // Free any live lease: the founder has just declared this work invalid, so "an agent is
      // working this" is no longer true. Without it a bounced ready-for-impl task sits unclaimable
      // behind its own stale lease until the TTL reaper frees it (inflating reap_count and raising
      // a false "stalling" escalation on the way). A no-op for in-review, which already frees the
      // lease on entry.
      const r = store.state.transition({ taskId: id, to, actor: 'founder', note, releaseLease: true, now: nowIso });
      return (r && r.ok) ? { ok: true, task: id, status: to } : { ok: false, error: r?.reason ?? 'transition failed' };
    }
    return { ok: false, error: `unsupported action: ${action}` };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/** Verifier actions. `approve` is the founder explicitly merging, so it overrides founder_only.
 *  `config` is the injected AiosConfig (REQUIRED), threaded to loadPolicy's injected default. */
export function verifyAction(store, { config, task, action, policy = loadPolicy(undefined, config), now = Date.now() } = {}) {
  const mode = policy?.auto_merge ?? 'founder_only';
  const nowIso = new Date(now).toISOString();
  try {
    if (action === 'approve') {
      const r = applyVerdict(store, { task, verdict: 'pass', mode: mode === 'founder_only' ? 'verifier_gated' : mode, actor: 'founder', now });
      return r.ok ? { ok: true, task, merged: true } : { ok: false, error: r.reason };
    }
    if (action === 'reject') {
      const r = store.state.transition({ taskId: task, to: 'in-progress', actor: 'founder', note: 'changes requested from dashboard', now: nowIso });
      return r && r.ok ? { ok: true, task, status: 'in-progress' } : { ok: false, error: r?.reason ?? 'transition failed' };
    }
    if (action === 'rerun') return { ok: true, task, note: 'rerun requested' };
    return { ok: false, error: `unsupported action: ${action}` };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/** Escalations are recomputed from live state each poll, so an ack is a client-side dismissal. */
export function escalationAction(_store, { id, action } = {}) {
  if (action === 'ack' || action === 'resolve') return { ok: true, id, acked: true };
  return { ok: false, error: `unsupported action: ${action}` };
}

/** Route one control action. Returns null for an unknown path (server → 404). */
export function handleAction(store, pathname, body = {}, opts = {}) {
  switch (pathname) {
    case '/api/run': return runNow(store, opts);
    case '/api/task': return taskAction(store, { ...body, ...opts });
    case '/api/verify': return verifyAction(store, { ...body, ...opts });
    case '/api/escalation': return escalationAction(store, body);
    default: return null;
  }
}
