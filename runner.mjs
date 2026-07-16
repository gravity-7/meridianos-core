/**
 * runner — the trigger loop. The founder's schedule (cron / manual) calls this; it decides whether
 * a run may fire RIGHT NOW and, if so, what each agent should do — then hands the work to a
 * launcher that spawns the agent in the founder's environment.
 *
 * Gates (in order): kill_switch → quiet_hours → max_runs_per_5h → budget halt → router capacity.
 * Everything is pure + injectable (policy, budget, now, runs, db, launch) so the whole gating
 * matrix is unit-tested. SAFETY: with no `launch` callback, executeRun is a DRY RUN — it claims
 * nothing and spawns nothing. Autonomy is opt-in: the founder wires a real launcher.
 *
 * runnerStatus() emits exactly the dashboard contract's `runner` section.
 */
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { loadPolicy, budgetStatus } from './budget.mjs';
import { decide } from './router.mjs';
import { resolveProvider } from './providers.mjs';
import { createStateStore } from './state-store.mjs';
import { appendRun, readRuns, newRunId } from './runlog.mjs';
import { isQuotaText, parseResetAt, resetInstant } from './exit-classify.mjs';
import { warn as logWarn } from './event-log.mjs';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const QUOTA_COOLDOWN_MS = 30 * MIN; // fallback wait when a quota reset time can't be parsed
const CADENCE_MS = { every_15m: 15 * MIN, every_30m: 30 * MIN, every_45m: 45 * MIN, hourly: HOUR, every_2h: 2 * HOUR, every_3h: 3 * HOUR };

/** Milliseconds between scheduled runs, or null for event/manual cadences (on_handoff | off). */
export function cadenceMs(cadence) { return CADENCE_MS[cadence] ?? null; }

const toMin = (hhmm) => { const [h, m] = String(hhmm ?? '0:0').split(':').map((x) => parseInt(x, 10) || 0); return h * 60 + m; };

/** Quiet-hours state at `now` (local clock), shaped for the dashboard contract. */
export function quietHoursStatus(policy, now = Date.now()) {
  const q = policy?.quiet_hours ?? {};
  if (!q.enabled) return { enabled: false, from: q.from ?? null, to: q.to ?? null, sleepingNow: false, resumesAt: null };
  const d = new Date(now);
  const cur = d.getHours() * 60 + d.getMinutes();
  const f = toMin(q.from), e = toMin(q.to);
  const sleeping = f === e ? false : (f < e ? (cur >= f && cur < e) : (cur >= f || cur < e));
  return { enabled: true, from: q.from ?? null, to: q.to ?? null, sleepingNow: sleeping, resumesAt: sleeping ? (q.to ?? null) : null };
}

/** How many real launches happened in the trailing window (ok|failed|blocked — not noop/skipped). */
export function runsInWindow({ config, now = Date.now(), ms = 5 * HOUR, runs } = {}) {
  const list = runs ?? readRuns({ limit: 500, config });
  const cutoff = now - ms;
  return list.filter((r) => r.ts && Date.parse(r.ts) >= cutoff && ['ok', 'failed', 'blocked'].includes(r.outcome)).length;
}

/** The dashboard `runner` payload + the single `holdReason` that gates the next run. */
export function runnerStatus({ config, policy = loadPolicy(undefined, config), budget, now = Date.now(), runs } = {}) {
  const cadence = policy?.schedule?.cadence ?? 'off';
  const enabled = cadence !== 'off';
  const b = budget ?? budgetStatus({ policy, now, config });
  const qh = quietHoursStatus(policy, now);
  const list = runs ?? readRuns({ limit: 500, config });
  const runsThisWindow = runsInWindow({ now, runs: list, config });
  const maxRunsPerWindow = policy?.work?.max_runs_per_5h ?? null;
  const lastRunTs = list[0]?.ts ?? null;

  let holdReason = null;
  if (b.kill_switch) holdReason = 'kill_switch';
  else if (qh.sleepingNow) holdReason = 'quiet_hours';
  else if (maxRunsPerWindow != null && runsThisWindow >= maxRunsPerWindow) holdReason = 'max_runs';
  else if (b.mayClaim && config.domain.agents.every((a) => !b.mayClaim?.[a])) holdReason = 'budget_halt';

  const ms = cadenceMs(cadence);
  const base = lastRunTs ? Date.parse(lastRunTs) : now;
  const nextRunTs = enabled && ms ? new Date(base + ms).toISOString() : null;

  return { cadence, enabled, nextRunTs, lastRunTs, quietHours: qh, holdReason, runsThisWindow, maxRunsPerWindow };
}

/**
 * Is this agent inside a provider quota window right now? Keys on the TYPED run-log fields
 * (reason='quota' + reset_at), not on note prose — so it can't be re-broken by a wording change
 * (postmortem A3). Falls back to the note fingerprint for pre-upgrade records. Returns
 * { blocked, resumesAtMs, resetAt } while the window is closed, else null (a retry is allowed).
 */
export function quotaHold(agent, { config, runs, now = Date.now(), cooldownMs = QUOTA_COOLDOWN_MS } = {}) {
  const list = runs ?? readRuns({ limit: 25, config });
  const latest = list.find((r) => r.agent === agent);
  if (!latest || latest.outcome !== 'failed') return null;
  const isQuota = latest.reason === 'quota' || (latest.reason == null && isQuotaText(latest.note));
  if (!isQuota) return null;
  const failedAtMs = latest.ts ? Date.parse(latest.ts) : now;
  const resetStr = latest.reset_at || parseResetAt(latest.note);
  const resumesAtMs = resetInstant(resetStr, failedAtMs) ?? (failedAtMs + cooldownMs);
  if (now >= resumesAtMs) return null; // window has reopened — allow one retry
  return { blocked: true, resumesAtMs, resetAt: resetStr || null };
}

/**
 * Would a run fire now, and what would each agent do? Pure — no writes.
 * Agents are decided SEQUENTIALLY so each one's assignment is excluded from the next (dispatch
 * dedupe, RCA-2), and a quota-held agent (RCA-1) is skipped with reason 'session_limit' instead of
 * being launched into a known-closed window.
 * `agents` defaults to the injected `config`'s DomainPlugin roster (an explicit `agents` array
 * still wins, matching the pre-DI default-param precedence). `config` also threads to router.decide
 * for the governance hard-stop check.
 */
export function planRun({ db, config, policy = loadPolicy(undefined, config), budget, now = Date.now(), agents = undefined, runs } = {}) {
  const agentList = agents ?? config.domain.agents;
  const status = runnerStatus({ policy, budget, now, runs, config });
  if (status.holdReason) return { fire: false, reason: status.holdReason, status, decisions: [] };
  const b = budget ?? budgetStatus({ policy, now, config });
  const runList = runs ?? readRuns({ limit: 25, config });
  const decisions = [];
  const assigned = new Set();
  for (const agent of agentList) {
    const qh = quotaHold(agent, { runs: runList, now, config });
    if (qh) {
      decisions.push({ mayClaim: false, reason: 'session_limit', agent, task: null, model: null, ttlMs: null, resumesAtMs: qh.resumesAtMs, resetAt: qh.resetAt });
      continue;
    }
    const d = decide(db, { agent, now, policy, budget: b, excludeTasks: assigned, config });
    if (d.mayClaim && d.task) assigned.add(d.task.id);
    decisions.push(d);
  }
  const claimable = decisions.filter((d) => d.mayClaim);
  const reason = claimable.length ? 'ok'
    : (decisions.some((d) => d.reason === 'session_limit') ? 'session_limit' : 'nothing_to_claim');
  return { fire: claimable.length > 0, reason, status, decisions };
}

/**
 * Fire a run if the gates allow. For each agent the router clears: claim its task, hand it to
 * `launch({agent,model,task,session,provider,harness,tier})`, and record the outcome in the run log.
 * With no `launch` callback this is a DRY RUN — nothing is claimed, nothing is spawned.
 * `config` is the injected AiosConfig (REQUIRED), threaded to planRun.
 */
export async function executeRun({ db, config, policy = loadPolicy(undefined, config), budget, now = Date.now(), agents, runs, launch, runsPath = undefined, sessionFor, findPr } = {}) {
  const store = createStateStore(db);
  const plan = planRun({ db, policy, budget, now, agents, runs, config });

  // Missing-key skips (router.decide()'s cost-safety guard) are denials, not claimable — but the
  // founder still needs to see them, so log + warn even when nothing else fires this cycle.
  const missingKeyRuns = [];
  for (const d of plan.decisions) {
    if (d.mayClaim || typeof d.reason !== 'string' || !d.reason.startsWith('missing_key:')) continue;
    const providerName = d.reason.slice('missing_key:'.length);
    const note = `${d.agent}: task ${d.task?.id ?? '?'} routed to '${providerName}' but its key env is unset — set it or change model_routing (on_missing_key=skip)`;
    console.warn(`[aios] ${note}`);
    missingKeyRuns.push(appendRun({ agent: d.agent, model: d.model, provider: d.provider, harness: d.harness, task: d.task?.id ?? null, outcome: 'skipped', note }, { path: runsPath, now, config }));
  }

  if (!plan.fire) return { fired: false, reason: plan.reason, status: plan.status, runs: missingKeyRuns };
  if (typeof launch !== 'function') {
    return { fired: false, reason: 'dry_run', status: plan.status, plan: plan.decisions.filter((d) => d.mayClaim), runs: missingKeyRuns };
  }

  const nowIso = new Date(now).toISOString();
  const results = [];
  for (const d of plan.decisions.filter((x) => x.mayClaim)) {
    const session = sessionFor ? sessionFor(d) : randomUUID();
    const claimed = store.claimTask({ taskId: d.task.id, agent: d.agent, session, ttlMs: d.ttlMs, now: nowIso });
    if (!claimed.won) {
      results.push(appendRun({ agent: d.agent, model: d.model, provider: d.provider, harness: d.harness, session, task: d.task.id, outcome: 'skipped', reason: 'lost_claim', note: `lost claim: ${claimed.reason}` }, { path: runsPath, now, config }));
      continue;
    }
    let outcome = 'ok', note = 'launched', tokens = null, usage = null, reason = 'ok', resetAt = null;
    try {
      const providerDescriptor = resolveProvider(d.provider, policy, config);
      // `config` MUST be forwarded to the launch callback — launchAgent needs it for createWorktree
      // (config.worktreeRoot), buildPrompt (config.domain), the spawn env (agentEnv), and the
      // opt-in gateway injection (config.gateway). Omitting it makes a real daemon launch throw
      // `Cannot read properties of undefined (reading 'worktreeRoot')` — latent until an agent is
      // actually launched through the daemon (unit tests inject a mock launch that ignores config).
      const r = (await launch({ agent: d.agent, model: d.model, task: d.task, session, provider: providerDescriptor, harness: d.harness, tier: d.modelTier, config })) || {};
      outcome = r.outcome ?? 'ok';
      note = r.note ?? note;
      tokens = r.tokens ?? null;
      usage = r.usage ?? null;
      reason = r.reason ?? (outcome === 'ok' ? 'ok' : 'nonzero');
      resetAt = r.resetAt ?? null;
      if (outcome === 'ok') {
        const taskAfter = store.getTask(d.task.id);
        if (taskAfter && taskAfter.status === d.task.status) {
          // RCA-3: the agent finished but never transitioned the task. Before treating this as lost
          // work, try to RECOVER a PR it opened but forgot to record — the honor-system gap must not
          // silently drop a real PR (which would strand or re-duplicate the work).
          const rec = recoverPr(db, { task: d.task, branch: r.branch, actor: d.agent, now: nowIso, findPr });
          if (rec.ok) {
            note = `recovered PR #${rec.pr} → in-review (agent skipped its own transition)`;
          } else {
            outcome = 'failed';
            reason = 'no_transition';
            note = `agent exited ok but did not transition the task from ${d.task.status}${rec.reason ? ` (${rec.reason})` : ''}`;
          }
        }
      }
    } catch (e) {
      outcome = 'failed';
      reason = 'spawn_error';
      note = String((e && e.message) || e);
    }
    if (outcome === 'failed') {
      try {
        const rel = store.releaseLease({ taskId: d.task.id, session });
        // Fallback: if session UUID doesn't match (instant exit race), force-release by agent name
        if (!rel.ok) store.forceReleaseLease({ taskId: d.task.id, agent: d.agent });
      } catch { /* best-effort */ }
    }
    // Post-hoc per_task_tokens actuator (RCA-5): the lever finally does something — a run that
    // burned more than the cap raises a warn event (which the watchdog surfaces as an escalation).
    const cap = policy?.agent_budget?.per_task_tokens;
    if (db && tokens != null && cap && tokens > cap) {
      try { logWarn(db, 'runner', 'per-task-over-budget', { task: d.task.id, agent: d.agent, tokens, cap }); } catch { /* best-effort */ }
    }
    results.push(appendRun({ agent: d.agent, model: d.model, provider: d.provider, harness: d.harness, session, task: d.task.id, tokens, usage, outcome, reason, reset_at: resetAt, note }, { path: runsPath, now, config }));
  }
  return { fired: true, reason: 'ok', status: plan.status, runs: [...missingKeyRuns, ...results] };
}

/**
 * Recover a PR the agent opened but never recorded on the task (the honor-system gap, RCA-3).
 * Only meaningful for implement-stage tasks (ready-for-impl / in-progress) whose transition target
 * is in-review. Looks up an OPEN PR on the run's branch via `gh`; if found, records it and walks
 * the task to `in-review` through legal transitions so the verifier can pick it up. Best-effort —
 * returns { ok:false, reason } when there is no branch, no gh, or no open PR (caller then fails).
 */
function recoverPr(db, { task, branch, actor, now = new Date().toISOString(), findPr } = {}) {
  const store = createStateStore(db);
  if (task.status !== 'ready-for-impl' && task.status !== 'in-progress') return { ok: false, reason: 'not an implement stage' };
  if (!branch) return { ok: false, reason: 'no branch to inspect' };
  const lookup = findPr ?? ((b) => {
    try {
      const r = spawnSync('gh', ['pr', 'list', '--head', b, '--state', 'open', '--json', 'number'], { timeout: 30_000, stdio: 'pipe', windowsHide: true, encoding: 'utf8' });
      const arr = JSON.parse(r.stdout || '[]');
      return Array.isArray(arr) && arr[0]?.number != null ? arr[0].number : null;
    } catch { return null; }
  });
  let pr = null;
  try { pr = lookup(branch); } catch { /* best-effort */ }
  if (pr == null) return { ok: false, reason: 'no open PR on branch' };
  try {
    if (task.status === 'ready-for-impl') {
      store.transition({ taskId: task.id, to: 'in-progress', actor, note: 'auto: PR recovery (agent skipped transition)', now });
    }
    store.transition({ taskId: task.id, to: 'in-review', actor, pr: String(pr), note: 'auto-recovered PR — agent skipped its own transition', now });
    return { ok: true, pr };
  } catch (e) {
    return { ok: false, reason: String((e && e.message) || e) };
  }
}
