/**
 * verify-loop — the verification cycle for the scheduler. Runs on each watchdog tick,
 * picks up `in-review` tasks, runs checks (tests, guardrails, peer-review), and
 * auto-merges on all-pass under peer_agent_review or verifier_gated modes.
 *
 * State is kept in-memory (a Map of task-id → check results). The scheduler owns
 * the lifecycle; a restart clears the map and re-evaluates from scratch (safe because
 * checks are idempotent).
 *
 * The cycle is non-blocking: synchronous checks (tests/guardrails) run inline, but
 * peer reviews are spawned asynchronously and tracked as Promises. Each tick checks
 * if pending reviews have resolved.
 */
import { createStateStore } from './state-store.mjs';
import { loadPolicy } from './budget.mjs';
import { reviewerFor } from './config.mjs';
import {
  requiredChecks, verdictFrom, applyVerdict, createCheckRunners, runCmd,
} from './verifier.mjs';
import { spawnAndWait } from './launcher.mjs';
import { createReviewWorktree } from './worktree.mjs';
import { primaryTreeBranch } from './boot-guard.mjs';
import { warn } from './event-log.mjs';
import { classifyInbound } from './bus-guard.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// In-memory cache of the CURRENT round's check results — a per-tick perf optimization only. Safe to
// lose on restart (checks are idempotent and re-run). The DURABLE safety counter lives in the DB.
const verifyState = new Map();

const MAX_VERIFY_ATTEMPTS = 3;

// --- Persistent attempt counter (postmortem A7) --------------------------------------------------
// The 3-strike "bounce then block" counter MUST survive daemon restarts, or a permanently-broken
// task resets to zero every restart and churns forever. Backed by the verify_attempts table.
function readAttempts(db, taskId) {
  try { return db.prepare('SELECT attempts FROM verify_attempts WHERE task_id=?').get(taskId)?.attempts ?? 0; }
  catch { return 0; }
}
function bumpAttempts(db, taskId, now = new Date().toISOString()) {
  const n = readAttempts(db, taskId) + 1;
  try {
    db.prepare(`INSERT INTO verify_attempts(task_id, attempts, updated_at) VALUES (?,?,?)
                ON CONFLICT(task_id) DO UPDATE SET attempts=excluded.attempts, updated_at=excluded.updated_at`)
      .run(taskId, n, now);
  } catch { /* best-effort */ }
  return n;
}
function clearAttempts(db, taskId) {
  try { db.prepare('DELETE FROM verify_attempts WHERE task_id=?').run(taskId); } catch { /* best-effort */ }
}

/**
 * A verification round failed. Move the task OUT of `in-review` so it stops being re-checked every
 * tick (the root cause of the old infinite check-fail loop): bounce it back to `in-progress` for
 * rework, or — once it has failed MAX_VERIFY_ATTEMPTS times — park it `blocked` (which the watchdog
 * surfaces to the founder). Returns the disposition for the results payload.
 */
function handleFailure(db, task, detail, results, { dryRun = false } = {}) {
  const store = createStateStore(db);
  if (dryRun) {
    // Report the disposition WITHOUT mutating state or the attempt counter.
    const projected = readAttempts(db, task.id) + 1;
    results.failed.push({ task: task.id, disposition: projected >= MAX_VERIFY_ATTEMPTS ? 'would-block' : 'would-bounce', detail });
    return;
  }
  const n = bumpAttempts(db, task.id);
  const note = `verification failed (${n}/${MAX_VERIFY_ATTEMPTS}): ${detail}`.slice(0, 300);
  verifyState.delete(task.id);
  try {
    if (n >= MAX_VERIFY_ATTEMPTS) {
      store.transition({ taskId: task.id, to: 'blocked', actor: 'verifier', note: `needs founder review — ${note}` });
      results.failed.push({ task: task.id, disposition: 'blocked', detail });
    } else {
      store.transition({ taskId: task.id, to: 'in-progress', actor: 'verifier', note });
      results.failed.push({ task: task.id, disposition: 'bounced', detail });
    }
  } catch (e) {
    // Illegal transition (task already moved) — just record it; don't loop.
    results.failed.push({ task: task.id, disposition: 'noop', detail: String(e?.message || e) });
  }
}

/**
 * Build the peer-review prompt for the reviewing agent. `config` is the injected AiosConfig
 * (REQUIRED) — its DomainPlugin supplies the review-criteria prose.
 */
export function buildReviewPrompt(task, prNumber, config) {
  return [
    `## Peer Review: PR #${prNumber} (task ${task.id})`,
    '',
    'You are performing an independent peer review. The writer never approves their own work.',
    '',
    `Run: gh pr diff ${prNumber}`,
    'Read the changes carefully. Check for:',
    ...config.domain.prompts.reviewCriteria,
    '',
    'Respond with EXACTLY one line at the END of your output:',
    'VERDICT: LGTM',
    'or',
    'VERDICT: REQUEST_CHANGES',
    'REASON: <one-line explanation>',
    '',
    'Do NOT make changes. Do NOT open PRs. Only review and report your verdict.',
  ].join('\n');
}

/**
 * Parse the verdict from a peer review agent's output.
 * Looks for "VERDICT: LGTM" or "VERDICT: REQUEST_CHANGES" in the output.
 */
function parseVerdict(output) {
  if (!output) return { status: 'fail', detail: 'no output from reviewer' };
  const lines = output.split('\n').map(l => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (/^VERDICT:\s*LGTM/i.test(line)) {
      return { status: 'pass', detail: 'LGTM' };
    }
    if (/^VERDICT:\s*REQUEST_CHANGES/i.test(line)) {
      const reason = line.replace(/^VERDICT:\s*REQUEST_CHANGES\s*/i, '').trim();
      const reasonLine = lines[i + 1]?.startsWith('REASON:')
        ? lines[i + 1].replace(/^REASON:\s*/i, '').trim()
        : reason || 'changes requested';
      return { status: 'fail', detail: reasonLine };
    }
  }
  return { status: 'fail', detail: 'no structured verdict found in reviewer output' };
}

/**
 * Spawn the peer reviewer agent asynchronously. Returns a Promise that resolves to {status, detail}.
 *
 * MUST run in an ISOLATED, DETACHED worktree — never REPO_ROOT (the primary tree). The reviewer is
 * an auto-permission agent free to run `git`/`gh` itself (e.g. `gh pr checkout`); if that happened
 * in the primary tree it would strand the founder's working tree on the PR branch, breaking
 * subsequent manual merges/pulls (daemon-hygiene postmortem). If worktree setup fails, this bounces
 * the review with a `fail` verdict rather than falling back to REPO_ROOT — that fallback was the bug.
 * `_spawn`/`_createReviewWorktree` are injectable for tests. `config` is the injected AiosConfig
 * (REQUIRED), threaded to buildReviewPrompt.
 */
export async function spawnPeerReview({ task, prNumber, reviewerAgent, model, config, _spawn = spawnAndWait, _createReviewWorktree = createReviewWorktree }) {
  const prompt = buildReviewPrompt(task, prNumber, config);

  let cmd, args;
  if (reviewerAgent === 'claude') {
    args = ['-p', prompt, '--permission-mode', 'auto'];
    if (model) args.push('--model', model);
    cmd = 'claude';
  } else {
    args = ['-p', prompt, '--dangerously-skip-permissions'];
    if (model) args.push('--model', model);
    cmd = 'agy';
  }

  const wt = _createReviewWorktree({ config });
  if (!wt.ok) return { status: 'fail', detail: `review worktree setup failed: ${wt.error || 'unknown error'}` };
  try {
    const result = await _spawn(cmd, args, { cwd: wt.path, timeoutMs: 15 * 60 * 1000 });
    if (result.outcome === 'ok') {
      return parseVerdict(result.stdout || '');
    }
    return { status: 'fail', detail: result.note || 'reviewer failed' };
  } finally {
    try { wt.cleanup(); } catch { /* best-effort */ }
  }
}

/**
 * Scan a PR's untrusted title/body/diff for prompt-injection BEFORE it is fed to the reviewing
 * agent (postmortem security P1: PR/CI content reaches the verifier unscanned). Uses the same
 * bus-guard classifier as inbound bus content. Fail-open when gh is unavailable (infra flakiness
 * must never wedge the queue) — the peer review remains a gate. `fetchPr` is injectable for tests.
 * Returns { safe, reason } — reason set only when a CRITICAL injection is detected.
 */
export async function scanPrForInjection(prNumber, { fetchPr } = {}) {
  const fetch = fetchPr ?? (async (n) => {
    try {
      const meta = await runCmd('gh', ['pr', 'view', String(n), '--json', 'title,body'], { cwd: REPO_ROOT, timeout: 30_000 });
      const diff = await runCmd('gh', ['pr', 'diff', String(n)], { cwd: REPO_ROOT, timeout: 30_000, maxBuffer: 10 * 1024 * 1024 });
      let title = '', body = '';
      try { const j = JSON.parse(meta.stdout || '{}'); title = j.title || ''; body = j.body || ''; } catch { /* not JSON */ }
      return `${title}\n${body}\n${diff.stdout || ''}`;
    } catch { return null; }
  });
  const content = await fetch(prNumber);
  if (content == null) return { safe: true, reason: null }; // gh unavailable → fail open
  const { severity, findings } = classifyInbound(content);
  if (severity === 'critical') {
    const f = findings.find((x) => x.severity === 'critical');
    return { safe: false, reason: `prompt-injection in PR content: ${f.id} — "${f.excerpt}"` };
  }
  return { safe: true, reason: null };
}

/**
 * Merge a PR via gh CLI. Returns {ok, detail}.
 */
async function mergePr(prNumber) {
  const r = await runCmd('gh', ['pr', 'merge', String(prNumber), '--squash', '--delete-branch'], { cwd: REPO_ROOT, timeout: 60_000 });
  if (r.status === 0) {
    return { ok: true, detail: `PR #${prNumber} merged` };
  }
  const stderr = r.stderr?.toString()?.slice(0, 300) || '';
  return { ok: false, detail: `gh pr merge failed (exit ${r.status}): ${stderr}` };
}

/**
 * Run one verification cycle. Called by the scheduler on each watchdog tick.
 *
 * @param {object} db - the SQLite database
 * @param {object} opts
 * @param {object} opts.policy - parsed policy (or loaded from disk)
 * @param {object} opts.selectModel - function(agent) → model string
 * @param {boolean} opts.dryRun - if true, don't actually merge
 * @param {object} opts.config - the injected AiosConfig (REQUIRED), threaded to
 *   createCheckRunners / reviewerFor / spawnPeerReview
 * @returns {object} { checked: number, merged: [], failed: [], pending: [] }
 */
export async function verifyCycle(db, { policy, selectModel, dryRun = false, checkRunners, fetchPr, config } = {}) {
  const store = createStateStore(db);
  const opts = { fetchPr };
  policy = policy ?? loadPolicy(undefined, config);
  const mode = policy?.auto_merge ?? 'founder_only';
  const tasks = store.listTasks().filter(t => t.status === 'in-review');
  const results = { checked: tasks.length, merged: [], failed: [], pending: [] };

  if (tasks.length === 0) return results;
  if (mode === 'founder_only') {
    // Nothing to do — founder merges manually
    results.pending = tasks.map(t => t.id);
    return results;
  }

  checkRunners = checkRunners ?? createCheckRunners(REPO_ROOT, { config });

  // Drop cached state for anything that is no longer in-review (merged, bounced, blocked) so the
  // map never grows unbounded and a re-submitted task re-runs its checks fresh.
  const inReview = new Set(tasks.map(t => t.id));
  for (const id of [...verifyState.keys()]) if (!inReview.has(id)) verifyState.delete(id);

  for (const task of tasks) {
    const prNumber = task.pr;
    let state = verifyState.get(task.id);

    // Reset the cache if the PR changed (a new push) — otherwise we trust the cached result and do
    // NOT re-run the heavy checks (tests/guardrails/peer) every single 60s tick.
    if (state && state.pr !== prNumber) { verifyState.delete(task.id); state = undefined; }

    if (!state) {
      // First time seeing this task/PR — run synchronous checks once.
      const checks = await Promise.all(checkRunners.map(async (runner) => {
        try {
          const res = (await runner.fn({ task, agent: task.lease_owner || task.owner })) || {};
          return { name: runner.name, status: res.status ?? 'pass', detail: res.detail ?? '' };
        } catch (e) {
          return { name: runner.name, status: 'fail', detail: String(e?.message || e) };
        }
      }));

      state = { checks, pr: prNumber, peerStarted: false, peerPromise: null, peerResult: null };
      verifyState.set(task.id, state);
    }

    // If any sync check failed → bounce/block out of in-review (stops the per-tick churn).
    const failedCheck = state.checks.find(c => c.status === 'fail');
    if (failedCheck) {
      handleFailure(db, task, `${failedCheck.name}: ${failedCheck.detail}`, results, { dryRun });
      continue;
    }
    // A sync check still pending (e.g. CI running) → wait, don't re-run.
    if (state.checks.some(c => c.status === 'pending')) {
      results.pending.push(task.id);
      continue;
    }

    // Peer review handling (only in peer_agent_review mode)
    if (mode === 'peer_agent_review') {
      if (!state.peerStarted && prNumber) {
        // Security gate (P1): scan the untrusted PR content for prompt-injection BEFORE any agent
        // reads it. A poisoned PR is bounced with a security note, never handed to the reviewer.
        const scan = await scanPrForInjection(prNumber, { fetchPr: opts.fetchPr });
        if (!scan.safe) {
          handleFailure(db, task, scan.reason, results, { dryRun });
          continue;
        }
        // Start the peer review
        const writerAgent = task.lease_owner || task.owner || 'claude';
        const reviewerAgent = reviewerFor(writerAgent, config.domain.agents);
        const model = selectModel ? selectModel(reviewerAgent) : null;

        state.peerStarted = true;
        state.peerPromise = spawnPeerReview({ task, prNumber, reviewerAgent, model, config })
          .then(r => { state.peerResult = r; })
          .catch(e => { state.peerResult = { status: 'fail', detail: String(e?.message || e) }; });
        verifyState.set(task.id, state);
        results.pending.push(task.id);
        continue;
      }

      if (state.peerStarted && !state.peerResult) {
        // Still waiting for peer review
        results.pending.push(task.id);
        continue;
      }

      if (state.peerResult) {
        // Peer review is done — add to checks
        const peerCheck = { name: 'peer-review', status: state.peerResult.status, detail: state.peerResult.detail };
        state.checks.push(peerCheck);
      }
    }

    // Compute final verdict
    const allChecks = state.checks;
    const verdict = verdictFrom(allChecks, mode);

    if (verdict === 'pass') {
      // Merge!
      if (!dryRun && prNumber) {
        // Root-cause trace: `gh pr merge --delete-branch` runs local git with cwd=REPO_ROOT (the
        // PRIMARY tree) and is the strongest suspect for the recurring off-main stranding. Snapshot
        // the primary tree's branch around the merge — if it goes from main → a feature branch, this
        // is the smoking gun. The boot guard heals the strand; this pinpoints WHERE it happened.
        const beforeMerge = primaryTreeBranch({ config });
        const mergeResult = await mergePr(prNumber);
        const afterMerge = primaryTreeBranch({ config });
        if (beforeMerge === 'main' && afterMerge && afterMerge !== 'main') {
          warn(db, 'verifier', 'primary-tree-stranded-by-merge', { pr: prNumber, from: beforeMerge, to: afterMerge });
        }
        if (mergeResult.ok) {
          applyVerdict(db, { task: task.id, verdict: 'pass', mode, actor: 'verifier' });
          clearAttempts(db, task.id);
          results.merged.push({ task: task.id, pr: prNumber });
          verifyState.delete(task.id);
        } else {
          // Merge itself failed (conflict, branch protection) — bounce for rework, don't churn.
          handleFailure(db, task, `merge failed: ${mergeResult.detail}`, results, { dryRun });
        }
      } else if (dryRun) {
        // Dry run: report what WOULD merge without touching state.
        results.merged.push({ task: task.id, pr: prNumber ?? null });
        verifyState.delete(task.id);
      } else {
        results.pending.push(task.id);
      }
    } else if (verdict === 'needs_changes') {
      const failed = allChecks.find(c => c.status === 'fail');
      handleFailure(db, task, failed ? `${failed.name}: ${failed.detail}` : 'changes requested', results, { dryRun });
    } else {
      results.pending.push(task.id);
    }
  }

  return results;
}

/** Clear verify state for a specific task (e.g., when it transitions away from in-review). The
 *  durable attempt counter is cleared separately via the DB (clearAttempts) on merge. */
export function clearVerifyState(taskId, db = null) {
  verifyState.delete(taskId);
  if (db) clearAttempts(db, taskId);
}

/** Get current verify state (for the dashboard). */
export function getVerifyState() {
  const out = {};
  for (const [id, state] of verifyState) {
    out[id] = {
      checks: state.checks,
      peerStarted: state.peerStarted,
      peerDone: !!state.peerResult,
    };
  }
  return out;
}
