/**
 * watchdog — the liveness + safety loop. One `tick` (driven on a timer by the founder's schedule):
 *   1. reap every expired lease back into the pool (bumping reap_count — the SLA signal),
 *   2. compute per-agent health (active / idle / halted / offline-stalled),
 *   3. surface escalations — the "what needs you" feed (kill switch, budget, repeated reaps, blocks).
 *
 * healthStatus() emits the dashboard contract's `health` section; collectEscalations() emits its
 * `escalations[]` feed. Pure over an injected `db` + budget, so the whole matrix is unit-tested.
 * The watchdog only reaps + reports; it never spawns work (that is the runner).
 */
import { createStateStore } from './state-store.mjs';
import { budgetStatus, loadPolicy } from './budget.mjs';
import { readEvents } from './event-log.mjs';
import { decide } from './router.mjs';
import { readRuns } from './runlog.mjs';
import { runnerStatus, quotaHold } from './runner.mjs';
import { isSkipped, snoozedUntil } from './sensitive.mjs';

const leaseLive = (t, nowIso) => t.lease_expires && t.lease_expires > nowIso;
const REAP_SLA_DEFAULT = 2; // reaped this many times ⇒ an agent is likely stuck ⇒ escalate

/**
 * Is this agent inside a provider quota window? Thin adapter over the single source of truth
 * (runner.quotaHold — which keys on the TYPED run-log fields, not note prose). Kept as a named
 * function so the dashboard health payload's `session_limit` idle reason keeps working.
 */
function sessionLimitBlock(agent, { config, runs, now = Date.now() } = {}) {
  const qh = quotaHold(agent, { config, runs, now });
  return qh ? { blocked: true, resetAt: qh.resetAt } : null;
}

/** Per-agent health for the dashboard `health.agents` map. `agents` defaults to the injected
 *  `config`'s DomainPlugin roster (an explicit `agents` array still wins). `config` also threads
 *  to router.decide for the governance-aware idle reason. */
export function agentHealth(db, { config, policy = loadPolicy(undefined, config), budget, now = Date.now(), agents = undefined } = {}) {
  const store = createStateStore(db);
  const agentList = agents ?? config.domain.agents;
  const nowIso = new Date(now).toISOString();
  const b = budget ?? budgetStatus({ policy, now, config });
  const tasks = store.listTasks();
  const ttlSec = (policy?.work?.lease_ttl_min ?? 30) * 60;
  const out = {};
  for (const agent of agentList) {
    const halted = b.kill_switch || !(b.mayClaim?.[agent] ?? true);
    const lease = tasks.find((t) => leaseLive(t, nowIso) && t.lease_owner === agent);
    if (lease) {
      const heartbeatAgeSec = Math.max(0, Math.round((now - Date.parse(lease.updated_at)) / 1000));
      const state = halted ? 'halted' : (heartbeatAgeSec > ttlSec ? 'offline' : 'active');
      out[agent] = {
        state,
        reason: halted ? (b.kill_switch ? 'kill_switch' : 'budget_halt') : (state === 'offline' ? 'stale heartbeat' : null),
        lastHeartbeatTs: lease.updated_at,
        heartbeatAgeSec,
        leaseTask: lease.id,
        leaseExpiresTs: lease.lease_expires,
      };
    } else {
      let idleReason = null;
      let sessionResetAt = null;
      if (!halted) {
        try {
          // Check for session-limit block first — it's a runtime gate not visible to the router
          const sl = sessionLimitBlock(agent, { config });
          if (sl) {
            idleReason = 'session_limit';
            sessionResetAt = sl.resetAt;
          } else {
            // Check runner-level gates (max_runs, quiet_hours) — also invisible to the router
            const rs = runnerStatus({ policy, now, config });
            if (rs.holdReason) {
              idleReason = rs.holdReason; // 'max_runs' | 'quiet_hours' | 'kill_switch' | 'budget_halt'
            } else {
              const d = decide(db, { agent, now, policy, budget: b, config });
              idleReason = d.mayClaim ? 'ready' : d.reason;
            }
          }
        } catch { /* best-effort — don't crash health if router throws */ }
      }
      out[agent] = {
        state: halted ? 'halted' : 'idle',
        reason: halted ? (b.kill_switch ? 'kill_switch' : 'budget_halt') : idleReason,
        sessionResetAt,
        lastHeartbeatTs: null, heartbeatAgeSec: null, leaseTask: null, leaseExpiresTs: null,
      };
    }
  }
  return out;
}

/** Recent expired-lease reaps (from the audit log). owner is recovered from the reap note. */
export function recentReaps(db, { limit = 10 } = {}) {
  const rows = db.prepare(
    `SELECT h.ts AS ts, h.task_id AS task, h.note AS note, t.reap_count AS reapCount
       FROM history h LEFT JOIN tasks t ON t.id = h.task_id
      WHERE h.op = 'reap' ORDER BY h.seq DESC LIMIT ?`,
  ).all(limit);
  return rows.map((r) => ({
    ts: r.ts,
    task: r.task,
    owner: r.note && r.note.startsWith('owner:') ? r.note.slice(6) : null,
    reapCount: r.reapCount ?? null,
    sessionAgeSec: null,
  }));
}

/** Tasks reaped at or above the SLA threshold — likely a stuck agent. */
export function slaBreaches(db, { config, policy = loadPolicy(undefined, config) } = {}) {
  const threshold = policy?.work?.reap_sla ?? REAP_SLA_DEFAULT;
  return db.prepare(
    'SELECT id AS task, reap_count AS reapCount, updated_at AS sinceTs FROM tasks WHERE reap_count >= ? ORDER BY reap_count DESC',
  ).all(threshold).map((r) => ({ task: r.task, reapCount: r.reapCount, sinceTs: r.sinceTs }));
}

/** The dashboard `health` payload. `config` threads through to agentHealth's injected default. */
export function healthStatus(db, { config, policy = loadPolicy(undefined, config), budget, now = Date.now(), intervalSec = 60, running = true, agents } = {}) {
  const b = budget ?? budgetStatus({ policy, now, config });
  return {
    watchdog: {
      running,
      lastTickTs: new Date(now).toISOString(),
      nextTickTs: new Date(now + intervalSec * 1000).toISOString(),
      intervalSec,
    },
    agents: agentHealth(db, { policy, budget: b, now, config, ...(agents ? { agents } : {}) }),
    reaps: recentReaps(db, { limit: 10 }),
    slaBreaches: slaBreaches(db, { policy, config }),
  };
}

/** The dashboard `escalations[]` feed — cross-cutting "needs you" items, newest concerns first.
 *  `agents` defaults to the injected `config`'s DomainPlugin roster (an explicit `agents` array
 *  still wins). */
export function collectEscalations(db, { config, policy = loadPolicy(undefined, config), budget, now = Date.now(), agents = undefined } = {}) {
  const store = createStateStore(db);
  const agentList = agents ?? config.domain.agents;
  const ts = new Date(now).toISOString();
  const b = budget ?? budgetStatus({ policy, now, config });
  const esc = [];
  const allTasks = store.listTasks();
  const tasksById = new Map(allTasks.map((t) => [t.id, t]));
  const openTask = { label: 'Open task', endpoint: null, payload: null };
  // Task-linked escalations carry status/owner so the dashboard's "Open task" popup can render
  // a useful summary even when the task has no spec file yet.
  const push = (severity, kind, title, detail, task = null, action = null) => {
    const t = task ? tasksById.get(task) : null;
    esc.push({ id: `esc-${kind}-${task ?? 'sys'}`, ts, severity, kind, title, detail, task, action, status: t?.status ?? null, owner: t?.owner ?? null });
  };

  if (b.kill_switch) push('critical', 'kill_switch', 'Kill switch is ON', 'Both agents are halted; no new work will be claimed.');
  for (const agent of agentList) {
    const st = b[agent]?.state;
    if (st === 'halt') push('critical', 'budget_halt', `${agent} budget exhausted`, `${agent} hit a hard cap — paused until the window rolls over or you raise the cap.`);
    else if (st === 'warn') push('warn', 'budget_warn', `${agent} budget at warn`, `${agent} crossed the warn threshold of a window cap.`);
  }
  for (const s of slaBreaches(db, { policy, config })) {
    push('warn', 'lease_reaped', `Task stalling: ${s.task}`, `Lease reaped ${s.reapCount}× — the agent may be stuck on this task.`, s.task, openTask);
  }
  // A skipped or still-snoozed blocked task is a founder decision already made (park it) — it
  // stops nagging the feed. A past-due snooze auto-resurfaces here on the next poll, no cron
  // needed. See parkedTasks() for the reversible "Snoozed / Skipped" list the dashboard shows.
  for (const t of allTasks.filter((t) => t.status === 'blocked')) {
    if (isSkipped(t)) continue;
    const until = snoozedUntil(t);
    if (until && Date.parse(until) > now) continue;
    push('warn', 'task_blocked', `Blocked: ${t.id}`, t.note || 'Task is blocked and needs a decision.', t.id, openTask);
  }

  // Bridge: recent error/fatal events → escalation feed (auto-flows to Discord/Slack)
  const recentErrors = readEvents(db, { limit: 10, level: 'error' })
    .filter(e => Date.parse(e.ts) > now - 5 * 60_000);
  for (const e of recentErrors) {
    const detail = e.detail ? (typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail)) : '';
    push('critical', 'system_error', `${e.source}: ${e.event}`, detail || `System error in ${e.source}`);
  }
  const recentFatals = readEvents(db, { limit: 5, level: 'fatal' })
    .filter(e => Date.parse(e.ts) > now - 5 * 60_000);
  for (const e of recentFatals) {
    const detail = e.detail ? (typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail)) : '';
    push('critical', 'system_fatal', `FATAL: ${e.source}: ${e.event}`, detail || `Fatal error in ${e.source}`);
  }

  return esc;
}

/**
 * Blocked tasks the founder has parked (snoozed or skipped) — kept OUT of collectEscalations
 * so they stop nagging, but still listed here so the dashboard's "Snoozed / Skipped" section
 * can show them with an Un-snooze/Un-skip + Approve control (reversible, never silently lost).
 */
export function parkedTasks(db, { now = Date.now() } = {}) {
  const store = createStateStore(db);
  const out = [];
  for (const t of store.listTasks().filter((t) => t.status === 'blocked')) {
    const skipped = isSkipped(t);
    const until = snoozedUntil(t);
    const snoozed = !!(until && Date.parse(until) > now);
    if (!skipped && !snoozed) continue;
    out.push({ task: t.id, status: t.status, owner: t.owner, note: t.note, skipped, snoozedUntil: snoozed ? until : null });
  }
  return out;
}

/** One watchdog cycle: reap expired leases, then report health + escalations. `agents` defaults to
 *  the injected `config`'s DomainPlugin roster (an explicit `agents` array still wins); `config`
 *  also threads to healthStatus/collectEscalations. */
export function tick(db, { config, policy = loadPolicy(undefined, config), budget, now = Date.now(), intervalSec = 60, agents = undefined } = {}) {
  const store = createStateStore(db);
  const agentList = agents ?? config.domain.agents;
  const b = budget ?? budgetStatus({ policy, now, config });
  const nowIso = new Date(now).toISOString();
  const { reaped } = store.reapExpiredLeases({ now: nowIso });

  // Session-limit auto-reap: if an agent has a confirmed session-limit block, immediately
  // force-release any leases it holds — they will never be heartbeated and would just burn
  // a max_parallel slot for up to 30 min. This is defence-in-depth; the runner already
  // tries forceReleaseLease on failure, but instant exits can race ahead of that.
  const sessionReaped = [];
  const runs = readRuns({ limit: 25, config });
  for (const agent of agentList) {
    const sl = sessionLimitBlock(agent, { runs, config });
    if (!sl) continue;
    const staleLeases = store.listTasks().filter(
      (t) => t.lease_owner === agent && t.lease_expires && t.lease_expires > nowIso,
    );
    for (const t of staleLeases) {
      const r = store.forceReleaseLease({ taskId: t.id, agent, now: nowIso });
      if (r.ok) sessionReaped.push(t.id);
    }
  }

  return {
    reaped: [...reaped, ...sessionReaped],
    health: healthStatus(db, { policy, budget: b, now, intervalSec, config }),
    escalations: collectEscalations(db, { policy, budget: b, now, config }),
  };
}
