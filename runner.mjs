/**
 * runner — the trigger loop. The founder's schedule (cron / manual) calls this; it decides whether
 * a run may fire RIGHT NOW and, if so, what each agent should do — then hands the work to a
 * launcher that spawns the agent in the founder's environment.
 *
 * Gates (in order): kill_switch → quiet_hours → max_runs_per_5h → budget halt → router capacity.
 * Everything is pure + injectable (policy, budget, now, runs, store, launch) so the whole gating
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
import { appendRun, readRuns, newRunId } from './runlog.mjs';
import { isQuotaText, parseResetAt, resetInstant } from './exit-classify.mjs';
import { pushPrLink } from './azure-devops-source.mjs';
import { branchPrefix } from './worktree.mjs';

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
export function planRun({ store, config, policy = loadPolicy(undefined, config), budget, now = Date.now(), agents = undefined, runs } = {}) {
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
    const d = decide(store, { agent, now, policy, budget: b, excludeTasks: assigned, config });
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
export async function executeRun({ store, config, policy = loadPolicy(undefined, config), budget, now = Date.now(), agents, runs, launch, runsPath = undefined, sessionFor, findPr, findTaskPr } = {}) {
  const plan = planRun({ store, policy, budget, now, agents, runs, config });

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
    const claimed = store.state.claimTask({ taskId: d.task.id, agent: d.agent, session, ttlMs: d.ttlMs, now: nowIso });
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
        const taskAfter = store.state.getTask(d.task.id);
        if (taskAfter && taskAfter.status === d.task.status) {
          // RCA-3: the agent finished but never transitioned the task. Before treating this as lost
          // work, try to RECOVER a PR it opened but forgot to record — the honor-system gap must not
          // silently drop a real PR (which would strand or re-duplicate the work).
          const rec = recoverPr(store, { task: d.task, branch: r.branch, actor: d.agent, now: nowIso, findPr, findTaskPr });
          if (rec.ok) {
            note = rec.fromEarlierRun
              ? `duplicate run — task already had open PR #${rec.pr} from an earlier run; adopted it → in-review`
              : `recovered PR #${rec.pr} → in-review (agent skipped its own transition)`;
          } else {
            outcome = 'failed';
            reason = 'no_transition';
            note = `agent exited ok but did not transition the task from ${d.task.status}${rec.reason ? ` (${rec.reason})` : ''}`;
          }
        }
        const finalTask = store.state.getTask(d.task.id);
        
        // T122: Auto-assign PR reviewer on PR creation
        if (finalTask && finalTask.pr && finalTask.pr !== d.task.pr) {
          const projectId = process.env.MERIDIANOS_PROJECT_ID;
          if (projectId) {
            try {
              const { getReviewerAssigner } = await import('./control-plane.mjs');
              const assigner = getReviewerAssigner();
              const repo = policy?.github?.repo ?? 'org/repo';
              const prUrl = finalTask.pr.startsWith('http') ? finalTask.pr : `https://github.com/${repo}/pull/${finalTask.pr}`;
              
              // Assign 1 reviewer by default
              const result = await assigner.assign(projectId, prUrl, 1);
              if (result && result.reviewers && result.reviewers.length > 0) {
                const usernames = result.reviewers.map(r => r.username);
                spawnSync('gh', ['pr', 'edit', finalTask.pr, '--add-reviewer', usernames.join(',')], {
                  timeout: 30_000, stdio: 'pipe', windowsHide: true, encoding: 'utf8'
                });
                try { store.events.info('runner', 'pr-reviewers-assigned', { task: finalTask.id, pr: finalTask.pr, reviewers: usernames }); } catch { /* best-effort */ }
              }
            } catch (err) {
              console.warn(`[aios] PR reviewer assignment failed for ${finalTask.id}: ${err.message}`);
            }
          }
        }

        if (finalTask && finalTask.pr && (finalTask.id.startsWith('ADO-') || finalTask.adoId)) {
          const adoCfg = policy?.integrations?.azure_devops;
          if (adoCfg?.enabled && adoCfg.write_back_pr !== false) {
            const patEnv = adoCfg.pat_env || 'ADO_PAT';
            const pat = process.env[patEnv];
            if (pat) {
              const adoId = finalTask.adoId || finalTask.id.replace(/^ADO-/, '');
              const repo = policy?.github?.repo ?? 'org/repo';
              const prUrl = finalTask.pr.startsWith('http') ? finalTask.pr : `https://github.com/${repo}/pull/${finalTask.pr}`;
              try {
                await pushPrLink({ org: adoCfg.org, project: adoCfg.project, pat, id: adoId, prUrl, state: 'Resolved' });
              } catch (prErr) {
                console.warn(`[aios] ADO PR write-back failed for ${finalTask.id}: ${prErr.message}`);
              }
            }
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
        const rel = store.state.releaseLease({ taskId: d.task.id, session });
        // Fallback: if session UUID doesn't match (instant exit race), force-release by agent name
        if (!rel.ok) store.state.forceReleaseLease({ taskId: d.task.id, agent: d.agent });
      } catch { /* best-effort */ }
    }
    // Post-hoc per_task_tokens actuator (RCA-5): the lever finally does something — a run that
    // burned more than the cap raises a warn event (which the watchdog surfaces as an escalation).
    const cap = policy?.agent_budget?.per_task_tokens;
    if (store && tokens != null && cap && tokens > cap) {
      try { store.events.warn('runner', 'per-task-over-budget', { task: d.task.id, agent: d.agent, tokens, cap }); } catch { /* best-effort */ }
    }
    results.push(appendRun({ agent: d.agent, model: d.model, provider: d.provider, harness: d.harness, session, task: d.task.id, tokens, usage, outcome, reason, reset_at: resetAt, note }, { path: runsPath, now, config }));
  }
  return { fired: true, reason: 'ok', status: plan.status, runs: [...missingKeyRuns, ...results] };
}

/**
 * Recover a PR the agent opened but never recorded on the task (the honor-system gap, RCA-3).
 * Only meaningful for implement-stage tasks (ready-for-impl / in-progress) whose transition target
 * is in-review. Looks up an OPEN PR via `gh`; if found, records it and walks the task to
 * `in-review` through legal transitions so the verifier can pick it up. Best-effort — returns
 * { ok:false, reason } when there is no gh or no open PR at all (caller then fails the run).
 *
 * TWO lookups, in order, and the second one is what stops duplicate PRs:
 *   1. the CURRENT run's branch — the agent just opened it and forgot to record it;
 *   2. ANY open PR on an earlier branch for the SAME TASK (`aios/<taskId>-*`).
 *
 * Without (2) the runner had a duplication loop: a run that ends `no_transition` releases the lease
 * (by design — unrecorded work must not be stranded), the next cycle re-claims the task, the agent
 * redoes the whole job on a FRESH session/branch, and opens ANOTHER PR. Observed in the wild as 5
 * open PRs for DOG-1 and 3 for F006 — each a full, paid agent run producing a redundant PR. Since
 * every branch for a task shares the `aios/<taskId>-` prefix, an earlier run's PR is findable, so
 * the task can be walked to `in-review` instead of being worked a second time.
 */
function recoverPr(store, { task, branch, actor, now = new Date().toISOString(), findPr, findTaskPr } = {}) {
  if (task.status !== 'ready-for-impl' && task.status !== 'in-progress') return { ok: false, reason: 'not an implement stage' };
  const ghPrList = (args) => {
    try {
      const r = spawnSync('gh', ['pr', 'list', ...args, '--state', 'open', '--json', 'number,headRefName'], { timeout: 30_000, stdio: 'pipe', windowsHide: true, encoding: 'utf8' });
      const arr = JSON.parse(r.stdout || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  };
  const lookup = findPr ?? ((b) => ghPrList(['--head', b])[0]?.number ?? null);
  // Lowest PR number = the EARLIEST run's PR, so a task with several strays converges on one.
  const lookupByTask = findTaskPr ?? ((id) => {
    const prefix = branchPrefix(id);
    const nums = ghPrList(['--limit', '100'])
      .filter((p) => typeof p.headRefName === 'string' && p.headRefName.startsWith(prefix))
      .map((p) => p.number)
      .filter((n) => n != null);
    return nums.length ? Math.min(...nums) : null;
  });

  let pr = null;
  if (branch) { try { pr = lookup(branch); } catch { /* best-effort */ } }
  let fromEarlierRun = false;
  if (pr == null) {
    try { pr = lookupByTask(task.id); } catch { /* best-effort */ }
    fromEarlierRun = pr != null;
  }
  if (pr == null) return { ok: false, reason: branch ? 'no open PR on branch or for this task' : 'no open PR for this task' };
  try {
    if (task.status === 'ready-for-impl') {
      store.state.transition({ taskId: task.id, to: 'in-progress', actor, note: 'auto: PR recovery (agent skipped transition)', now });
    }
    const note = fromEarlierRun
      ? `auto-recovered PR #${pr} from an EARLIER run of this task — this run's work is a duplicate`
      : 'auto-recovered PR — agent skipped its own transition';
    store.state.transition({ taskId: task.id, to: 'in-review', actor, pr: String(pr), note, now });
    // A duplicate run is not free — surface it so the founder sees the waste rather than only the
    // stray PRs it leaves on GitHub.
    if (fromEarlierRun) {
      try { store.events.warn('runner', 'duplicate-run-recovered', { task: task.id, pr, branch: branch ?? null }); } catch { /* best-effort */ }
    }
    return { ok: true, pr, fromEarlierRun };
  } catch (e) {
    return { ok: false, reason: String((e && e.message) || e) };
  }
}
