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
import { budgetStatus, loadPolicy } from './budget.mjs';
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
export function agentHealth(store, { config, policy = loadPolicy(undefined, config), budget, now = Date.now(), agents = undefined } = {}) {
  const agentList = agents ?? config.domain.agents;
  const nowIso = new Date(now).toISOString();
  const b = budget ?? budgetStatus({ policy, now, config });
  const tasks = store.state.listTasks();
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
              const d = decide(store, { agent, now, policy, budget: b, config });
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

// recentReaps moved to state.mjs (D2 bite #2, stage 2a — promoted read-queries; see
// state-store.mjs's DB_BOUND_FNS). Re-exported here by name so existing importers
// (`import { recentReaps } from './watchdog.mjs'`) keep working unchanged.
export { recentReaps } from './state.mjs';

/** Tasks reaped at or above the SLA threshold — likely a stuck agent. Body moved to
 *  state.mjs (D2 bite #2, stage 2b) — reached here via store.state so the flipped watchdog never
 *  touches a raw db. */
export function slaBreaches(store, { config, policy = loadPolicy(undefined, config) } = {}) {
  const threshold = policy?.work?.reap_sla ?? REAP_SLA_DEFAULT;
  return store.state.slaBreaches(threshold);
}

/** The dashboard `health` payload. `config` threads through to agentHealth's injected default. */
export function healthStatus(store, { config, policy = loadPolicy(undefined, config), budget, now = Date.now(), intervalSec = 60, running = true, agents } = {}) {
  const b = budget ?? budgetStatus({ policy, now, config });
  return {
    watchdog: {
      running,
      lastTickTs: new Date(now).toISOString(),
      nextTickTs: new Date(now + intervalSec * 1000).toISOString(),
      intervalSec,
    },
    agents: agentHealth(store, { policy, budget: b, now, config, ...(agents ? { agents } : {}) }),
    reaps: store.state.recentReaps({ limit: 10 }),
    slaBreaches: slaBreaches(store, { policy, config }),
  };
}

/** The dashboard `escalations[]` feed — cross-cutting "needs you" items, newest concerns first.
 *  `agents` defaults to the injected `config`'s DomainPlugin roster (an explicit `agents` array
 *  still wins). */
export function collectEscalations(store, { config, policy = loadPolicy(undefined, config), budget, now = Date.now(), agents = undefined } = {}) {
  const agentList = agents ?? config.domain.agents;
  const ts = new Date(now).toISOString();
  const b = budget ?? budgetStatus({ policy, now, config });
  const esc = [];
  const allTasks = store.state.listTasks();
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
  for (const s of slaBreaches(store, { policy, config })) {
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
  const events = store.events;
  const recentErrors = events.readEvents({ limit: 10, level: 'error' })
    .filter(e => Date.parse(e.ts) > now - 5 * 60_000);
  for (const e of recentErrors) {
    const detail = e.detail ? (typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail)) : '';
    push('critical', 'system_error', `${e.source}: ${e.event}`, detail || `System error in ${e.source}`);
  }
  const recentFatals = events.readEvents({ limit: 5, level: 'fatal' })
    .filter(e => Date.parse(e.ts) > now - 5 * 60_000);
  for (const e of recentFatals) {
    const detail = e.detail ? (typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail)) : '';
    push('critical', 'system_fatal', `FATAL: ${e.source}: ${e.event}`, detail || `Fatal error in ${e.source}`);
  }

  return esc;
}

// parkedTasks moved to state.mjs (D2 bite #2, stage 2a — promoted read-queries; see
// state-store.mjs's DB_BOUND_FNS). Re-exported here by name so existing importers
// (`import { parkedTasks } from './watchdog.mjs'`) keep working unchanged.
export { parkedTasks } from './state.mjs';

/** One watchdog cycle: reap expired leases, then report health + escalations. `agents` defaults to
 *  the injected `config`'s DomainPlugin roster (an explicit `agents` array still wins); `config`
 *  also threads to healthStatus/collectEscalations. */
export function tick(store, { config, policy = loadPolicy(undefined, config), budget, now = Date.now(), intervalSec = 60, agents = undefined } = {}) {
  const agentList = agents ?? config.domain.agents;
  const b = budget ?? budgetStatus({ policy, now, config });
  const nowIso = new Date(now).toISOString();
  const { reaped } = store.state.reapExpiredLeases({ now: nowIso });

  // Session-limit auto-reap: if an agent has a confirmed session-limit block, immediately
  // force-release any leases it holds — they will never be heartbeated and would just burn
  // a max_parallel slot for up to 30 min. This is defence-in-depth; the runner already
  // tries forceReleaseLease on failure, but instant exits can race ahead of that.
  const sessionReaped = [];
  const runs = readRuns({ limit: 25, config });
  for (const agent of agentList) {
    const sl = sessionLimitBlock(agent, { runs, config });
    if (!sl) continue;
    const staleLeases = store.state.listTasks().filter(
      (t) => t.lease_owner === agent && t.lease_expires && t.lease_expires > nowIso,
    );
    for (const t of staleLeases) {
      const r = store.state.forceReleaseLease({ taskId: t.id, agent, now: nowIso });
      if (r.ok) sessionReaped.push(t.id);
    }
  }

  return {
    reaped: [...reaped, ...sessionReaped],
    health: healthStatus(store, { policy, budget: b, now, intervalSec, config }),
    escalations: collectEscalations(store, { policy, budget: b, now, config }),
  };
}
