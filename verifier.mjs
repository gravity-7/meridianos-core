/**
 * verifier — the merge gate. It runs checks on a submitted task (tests, guardrails, and — in peer
 * mode — a peer-agent review), turns the results into a verdict, and (when the policy allows)
 * auto-merges by transitioning the task to `done`.
 *
 * The gate is the `auto_merge` lever:
 *   founder_only      — checks run, but the verdict never auto-passes; the founder merges by hand.
 *   peer_agent_review — the other agent's review is a required check; all-pass ⇒ pass (auto-merge).
 *   verifier_gated    — the verifier itself gates: all checks pass ⇒ pass (auto-merge).
 * Any failing check ⇒ needs_changes; any still-running check ⇒ pending.
 *
 * The verdict math (verdictFrom) and status payload (verifierStatus → the dashboard `verifier`
 * section) are pure. runChecks takes injectable runners so tests don't spawn processes and the
 * founder wires the real `npm test` / guardrail executors at the edge.
 */
import { loadPolicy } from './budget.mjs';
import { listTasks, transition as stateTransition } from './state.mjs';
import { reviewerFor } from './config.mjs';
import * as childProcess from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const VERDICTS = ['pending', 'pass', 'fail', 'needs_changes'];
export const MODES = ['founder_only', 'peer_agent_review', 'verifier_gated'];

/** The checks a submission must clear under a given mode. */
export function requiredChecks(mode) {
  const base = ['tests', 'guardrails'];
  return mode === 'peer_agent_review' ? [...base, 'peer-review'] : base;
}

/** Turn check results + the merge mode into a verdict. A `skip` (a check that's inapplicable —
 *  e.g. no guardrail configured for this tenant) is NEUTRAL: it never fails the gate, but it also
 *  doesn't mean that check actually ran and passed — it's just excluded from consideration. */
export function verdictFrom(checks, mode) {
  if (!checks || checks.length === 0) return 'pending';
  if (checks.some((c) => c.status === 'fail')) return 'needs_changes';
  if (checks.some((c) => c.status === 'pending')) return 'pending';
  // every check passed or was skipped — only the gate itself remains
  return mode === 'founder_only' ? 'pending' : 'pass';
}

/** Run injectable check functions → normalized check results. A throwing runner ⇒ a failed check. */
export function runChecks(ctx, { runners = [] } = {}) {
  return runners.map((r) => {
    try {
      const res = r.fn(ctx) || {};
      return { name: r.name, status: res.status ?? 'pass', detail: res.detail ?? '' };
    } catch (e) {
      return { name: r.name, status: 'fail', detail: String((e && e.message) || e) };
    }
  });
}

/** Evaluate one submission → { verdict, mergeable, checks, ... }. */
export function verify({ task, mode = 'founder_only', checks = [], pr = null, agent = null, now = Date.now() }) {
  const verdict = verdictFrom(checks, mode);
  return { task, pr, agent, mode, checks, verdict, submittedTs: new Date(now).toISOString(), mergeable: verdict === 'pass' };
}

/** Recently merged tasks (transitions to `done`) for the dashboard `verifier.recent`. */
export function recentVerdicts(db, { limit = 10 } = {}) {
  return db.prepare(
    `SELECT h.ts AS ts, h.task_id AS task, t.pr AS pr, h.actor AS actor
       FROM history h LEFT JOIN tasks t ON t.id = h.task_id
      WHERE h.op = 'transition' AND h.to_state = 'done' ORDER BY h.seq DESC LIMIT ?`,
  ).all(limit).map((r) => ({ task: r.task, pr: r.pr ?? null, verdict: 'pass', ts: r.ts, mergedBy: r.actor || null }));
}

/** The dashboard `verifier` payload: mode + everything in-review (with verdicts) + recent merges. */
export function verifierStatus(db, { config, policy = loadPolicy(undefined, config), now = Date.now(), checksByTask = {} } = {}) {
  const mode = policy?.auto_merge ?? 'founder_only';
  const pending = listTasks(db)
    .filter((t) => t.status === 'in-review')
    .map((t) => {
      const checks = checksByTask[t.id] ?? requiredChecks(mode).map((name) => ({ name, status: 'pending', detail: '' }));
      return { task: t.id, pr: t.pr ?? null, agent: t.lease_owner ?? t.owner ?? null, submittedTs: t.updated_at, checks, verdict: verdictFrom(checks, mode) };
    });
  return { mode, pending, recent: recentVerdicts(db) };
}

/** Act on a verdict: a `pass` under an auto-merge mode transitions the task to `done`. */
export function applyVerdict(db, { task, verdict, mode = 'founder_only', actor = 'verifier', now = Date.now() }) {
  if (verdict !== 'pass') return { ok: false, reason: `verdict is ${verdict}` };
  if (mode === 'founder_only') return { ok: false, reason: 'founder_only: merge is manual' };
  try {
    const r = stateTransition(db, { taskId: task, to: 'done', actor, note: `auto-merged by verifier (${mode})`, now: new Date(now).toISOString() });
    return r && r.ok ? { ok: true, task: r.task } : { ok: false, reason: r?.reason ?? 'transition failed' };
  } catch (e) {
    return { ok: false, reason: String((e && e.message) || e) };
  }
}

// --- Real check executors (wired at the edge by the scheduler/CLI) ---

/**
 * Create the standard check runners for tests and guardrails. Wired at the edge by the scheduler
 * (never used in unit tests — those inject mock runners).
 *
 * `tests`      — CI is the source of truth, NOT a local run. The full monorepo `npm test` OOMs on
 *                the founder's Windows box (React suites), so a local run would fail every task
 *                forever. Instead we read the PR's GitHub Actions rollup via `gh pr checks`. A PR
 *                is therefore REQUIRED to reach `done`. If gh/CI is unreachable we fail OPEN (the
 *                peer review remains a hard gate) rather than looping — infra flakiness must never
 *                permanently wedge the queue.
 * `guardrails` — the domain's content guardrail (REPO-AUDIT.md §1.2, coupling point #2), read from
 *                `config.domain.guardrailCheck` ({cmd, script} or `null`). This must NEVER report
 *                'pass' unless it actually ran and exited 0 — a reused AIOS with no guardrail
 *                script configured, or missing on disk, or whose interpreter isn't installed, is
 *                honestly `skip` (inapplicable), not the old silent fail-open `pass`. For PV
 *                (default config, script present) behavior is unchanged: spawn python, pass/fail
 *                on exit code.
 *
 * @param {string} repoRoot - absolute path to the repo root
 * @param {object} [opts]
 * @param {{cmd:string,script:string}|null} [opts.guardrailCheck] - defaults to the injected
 *   `config`'s DomainPlugin guardrailCheck
 * @param {object} opts.config - the injected AiosConfig (REQUIRED); only matters when
 *   `guardrailCheck` itself is omitted
 */
export function createCheckRunners(repoRoot, opts = {}) {
  const { guardrailCheck, config } = opts;
  // `guardrailCheck` supports an explicit `null` ("this tenant has no guardrail check") distinct
  // from being OMITTED (fall back to the injected config's DomainPlugin default) — so this can't
  // be a `??` fallback (that would silently turn an explicit null back into the default). Mirrors
  // default-param semantics (which only apply on `undefined`) via an explicit presence check.
  const check = 'guardrailCheck' in opts ? guardrailCheck : config.domain.guardrailCheck;
  const { spawnSync } = childProcess;
  return [
    {
      name: 'tests',
      fn: (ctx) => {
        const pr = ctx?.task?.pr;
        if (!pr) return { status: 'fail', detail: 'no PR recorded — agent must open a PR and record it (cli transition --pr <n>)' };
        const r = spawnSync('gh', ['pr', 'checks', String(pr), '--json', 'name,state,bucket'], { cwd: repoRoot, timeout: 60_000, stdio: 'pipe', windowsHide: true });
        // gh exits non-zero when checks are failing/pending OR when there are none — parse to disambiguate.
        let buckets = [];
        try { buckets = JSON.parse(r.stdout?.toString() || '[]'); } catch { /* not JSON */ }
        if (!Array.isArray(buckets) || buckets.length === 0) {
          return { status: 'pass', detail: 'no CI checks reported — relying on peer review (fail-open)' };
        }
        const failed = buckets.filter((b) => b.bucket === 'fail' || b.bucket === 'cancel');
        const pending = buckets.filter((b) => b.bucket === 'pending');
        if (failed.length) return { status: 'fail', detail: `CI failing: ${failed.map((b) => b.name).join(', ')}` };
        if (pending.length) return { status: 'pending', detail: `CI running: ${pending.map((b) => b.name).join(', ')}` };
        return { status: 'pass', detail: `CI green (${buckets.length} checks)` };
      },
    },
    {
      name: 'guardrails',
      fn: () => {
        if (check == null) return { status: 'skip', detail: 'no guardrail check configured' };
        if (!existsSync(join(repoRoot, check.script))) {
          return { status: 'skip', detail: 'guardrail script not found — inapplicable' };
        }
        const r = spawnSync(check.cmd, [check.script], { cwd: repoRoot, timeout: 60_000, stdio: 'pipe', windowsHide: true });
        if (r.error) return { status: 'skip', detail: `guardrail runner unavailable (${r.error.code})` };
        return { status: r.status === 0 ? 'pass' : 'fail', detail: r.status === 0 ? 'clean' : (r.stdout?.toString().slice(-300) || `exit ${r.status}`) };
      },
    },
  ];
}

/**
 * Create a peer-review check runner. It spawns the OTHER agent headlessly with a review prompt.
 * This is async — it returns {status:'pending'} and the scheduler must poll for completion.
 * @param {Function} launchAgent - the launcher.launchAgent function
 * @param {object} config - the injected AiosConfig (REQUIRED); its DomainPlugin roster is passed
 *   explicitly to reviewerFor (which itself now requires a roster).
 */
export function createPeerReviewRunner(launchAgent, config) {
  return {
    name: 'peer-review',
    fn: (ctx) => {
      const reviewer = reviewerFor(ctx.agent, config.domain.agents);
      // For now, report pending — the scheduler will drive the peer review asynchronously
      return { status: 'pending', detail: `awaiting ${reviewer} review` };
    },
  };
}

