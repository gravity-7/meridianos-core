/**
 * boot-guard — restore the PRIMARY working tree to `main` at daemon boot.
 *
 * INVARIANT: the primary tree (config.repoRoot) must ONLY ever hold generated board drift.
 * ALL agent work happens in isolated worktrees (worktree.mjs) — the primary tree is never a
 * workspace. Yet it has repeatedly been found STRANDED on an agent's feature branch (e.g.
 * `aios/F2-implement-post-api-image-stage-1593c7y`) after a crash / prune / merge interaction on
 * Windows, which breaks the founder's manual `git pull`/merge: fast-forward fails and the agent
 * branch can't be `--delete-branch` d because it's the checked-out HEAD.
 *
 * PR #77 fixed ONE known path (the peer reviewer now runs in a detached review worktree, never
 * REPO_ROOT). Stranding still recurred, so it comes from a DIFFERENT path — most likely a spawned
 * agent's lingering child `git`/`gh` process racing the worktree teardown (launcher's killTree is
 * async + best-effort on Windows), or a boot-prune interaction. Rather than chase every path, this
 * is a belt-and-suspenders AUTO-HEAL: at boot, if HEAD is off `main`, discard the generated board
 * drift and switch back. Because the primary tree only ever carries that drift, this is safe.
 *
 * SAFETY: acts ONLY when HEAD != main, and NEVER discards non-generated work — if the tree has
 * uncommitted changes to any file other than the two generated board files, it SKIPS (reports
 * `dirty`) so the caller can log and leave it for manual cleanup. Untracked files never block a
 * branch switch, so they are ignored. The function performs no logging itself; it returns a
 * structured result the caller (scheduler) logs to the rotating daemon logger + event-log.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Phase 0: Ensure required directory structure exists before any boot logic runs.
 * Idempotent — safe to call even when directories already exist.
 * Returns the list of directories created (empty if all existed).
 */
export function ensureDirectories(repoRoot) {
  const dirs = [
    join(repoRoot, '.ai'),
    join(repoRoot, '.ai', 'gateway'),
    join(repoRoot, '.ai', 'state'),
    join(repoRoot, '.ai', 'logs'),
    join(repoRoot, '.ai', 'runs'),
  ];
  const created = [];
  for (const dir of dirs) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // Read-only filesystem or other OS error — not fatal at this level
    }
  }
  return created;
}

/** The tracked, generated files the primary tree is allowed to carry as uncommitted drift. */
export const GENERATED_BOARD_FILES = ['.ai/board.md', '.ai/state/board.json'];

/** Normalize a git path for comparison: forward slashes, unquoted. */
const norm = (p) => p.replace(/\\/g, '/').replace(/^"|"$/g, '');

/** Default git runner: shell out in the primary tree. Injectable for tests. */
function defaultGit(repoRoot) {
  return (args) => spawnSync('git', args, { cwd: repoRoot, stdio: 'pipe', windowsHide: true, encoding: 'utf8' });
}

/**
 * Parse `git status --porcelain` → the list of TRACKED-modified paths. Untracked entries (`??`)
 * are excluded: they never block a branch switch and are not work this guard would ever discard.
 * Rename/copy entries (`orig -> new`) contribute their destination path.
 */
export function trackedModifiedPaths(porcelain) {
  const out = [];
  for (const raw of String(porcelain || '').split('\n')) {
    if (!raw.trim()) continue;
    const code = raw.slice(0, 2);
    if (code === '??') continue; // untracked — irrelevant to a branch switch
    let path = raw.slice(3).trim();
    const arrow = path.indexOf(' -> ');
    if (arrow !== -1) path = path.slice(arrow + 4); // rename/copy → destination
    out.push(norm(path));
  }
  return out;
}

/** Read the primary tree's current branch (or 'HEAD' when detached). Returns null on git error.
 *  `config` is the injected AiosConfig (REQUIRED) — its `repoRoot` supplies the default
 *  `repoRoot` when the caller doesn't pass one explicitly. */
export function primaryTreeBranch({ config, repoRoot = config.repoRoot, git = defaultGit(repoRoot) } = {}) {
  const head = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (head.status !== 0) return null;
  return String(head.stdout || '').trim();
}

/**
 * Restore the primary working tree to `main` if it is stranded on any other ref.
 *
 * @param {object} [opts]
 * @param {object}   opts.config       the injected AiosConfig (REQUIRED)
 * @param {string}   [opts.repoRoot]   primary tree root (defaults to config.repoRoot)
 * @param {Function} [opts.git]        git runner (args[]) → spawnSync-shaped result; injectable
 * @param {string}   [opts.mainBranch] the branch to restore to (default 'main')
 * @returns {{ switched: boolean, from: string|null, reason: string, dirty?: string[], error?: string }}
 *   reason ∈ 'already-main' | 'restored' | 'dirty' | 'head-unknown' | 'switch-failed'
 */
export function restorePrimaryTreeToMain({ config, repoRoot = config.repoRoot, git = defaultGit(repoRoot), mainBranch = 'main' } = {}) {
  // 1. Where is HEAD? Only act when it is NOT already on main.
  const head = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (head.status !== 0) {
    return { switched: false, from: null, reason: 'head-unknown', error: (head.stderr || head.stdout || '').toString().trim().slice(0, 200) };
  }
  const current = String(head.stdout || '').trim();
  if (current === mainBranch) {
    return { switched: false, from: current, reason: 'already-main' };
  }

  // 2. NEVER discard non-generated work: if any tracked-modified file is not one of the two
  //    generated board files, skip and let the caller surface it for manual cleanup.
  const status = git(['status', '--porcelain']);
  const modified = status.status === 0 ? trackedModifiedPaths(status.stdout) : [];
  const generated = new Set(GENERATED_BOARD_FILES.map(norm));
  const unexpected = modified.filter((p) => !generated.has(p));
  if (unexpected.length) {
    return { switched: false, from: current, reason: 'dirty', dirty: unexpected };
  }

  // 3. Discard the generated board drift (index + worktree), then switch back to main. Discarding
  //    first prevents `git switch` from refusing when board files differ between the two branches.
  const boardDrift = modified.filter((p) => generated.has(p));
  if (boardDrift.length) git(['checkout', 'HEAD', '--', ...boardDrift]);

  const sw = git(['switch', mainBranch]);
  if (sw.status !== 0) {
    // Fallback for older gits / edge states where `switch` is unavailable or refuses.
    const co = git(['checkout', mainBranch]);
    if (co.status !== 0) {
      const err = (sw.stderr || sw.stdout || co.stderr || co.stdout || '').toString().trim().slice(0, 200);
      return { switched: false, from: current, reason: 'switch-failed', error: err };
    }
  }
  return { switched: true, from: current, reason: 'restored' };
}
