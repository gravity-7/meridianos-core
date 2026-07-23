/**
 * worktree — isolated git worktrees for autonomous agent runs.
 *
 * PROBLEM: the daemon spawns agents that each run git (checkout / branch / commit / push). If they
 * all operate in the ONE main working tree, concurrent agents — and ANY manual git the founder or
 * Claude does — collide: an agent's `git checkout main` can clobber another run's committed branch
 * (this actually happened). Two agents at `max_parallel: 2` can race the same index.
 *
 * FIX: give each run its own `git worktree` on a fresh branch off the freshest origin/main. Worktrees
 * share the repo's object store but have independent HEAD / index / files, so N agents never touch
 * each other's (or the founder's) working tree. Git itself forbids checking out `main` in two trees,
 * so the main tree is structurally protected. The AIOS state DB stays CANONICAL — agents reach it via
 * $AIOS_DB (see db.openDb), not a per-worktree copy.
 *
 * Pure-ish: the name/dir helpers are pure; the git operations shell out and are covered by an
 * integration smoke test (they need a real repo).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const git = (args, opts = {}, config) =>
  spawnSync('git', args, { cwd: config.repoRoot, stdio: 'pipe', windowsHide: true, encoding: 'utf8', ...opts });

/**
 * A short, deterministic hash of a string (FNV-1a, 32-bit) rendered as lowercase base36 — used
 * below so `branchName`'s suffix depends on EVERY character of the session id, not just a
 * truncated prefix of it (see the bug note there).
 */
function hash36(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * A git-safe branch name for a run: `aios/<task>-<short-session>`.
 *
 * `short` used to be `session.slice(0, 8)` — safe when the caller's session ids are already
 * high-entropy up front (e.g. a bare `randomUUID()`), but a session with a fixed literal PREFIX
 * of 8+ characters (e.g. test helpers building sessions like `'itest-usage-' + Math.random()...`)
 * had every one of its random characters sliced away, leaving the SAME suffix every run. Since
 * `removeWorktree` only deletes the local branch once it's confirmed pushed to origin (unpushed
 * work is never destroyed), that identical branch name never gets cleaned up — the next run's
 * `git worktree add -b <branch>` then fails outright because the branch already exists. Hashing
 * the full cleaned session instead of truncating it means every character participates, so two
 * different sessions essentially never collide, while the SAME (taskId, session) pair still maps
 * to the same branch (this is deliberate — see "clear any stale worktree/branch" in
 * createWorktree, which reuses/replaces a retried run's own branch).
 */
export function branchName(taskId, session) {
  const cleanedSession = String(session ?? '').replace(/[^a-zA-Z0-9]/g, '');
  const short = cleanedSession ? hash36(cleanedSession) : Math.random().toString(36).slice(2, 10);
  return `${branchPrefix(taskId)}${short}`;
}

/**
 * The `aios/<taskId>-` prefix that EVERY branch for a task shares, whatever the session. A task
 * re-claimed after a failed run gets a fresh session and therefore a fresh branch, so this prefix
 * is the only way to recognize a PR opened by an EARLIER run of the same task — which is what
 * stops the runner from re-doing work that is already up for review (see recoverPr in runner.mjs).
 */
export function branchPrefix(taskId) {
  const id = String(taskId ?? 'task').replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'task';
  return `aios/${id}-`;
}

/** Filesystem-safe worktree directory for a branch (branch slashes → `__`). `config` is the
 *  injected AiosConfig (REQUIRED). */
export function worktreeDir(branch, config) {
  return join(config.worktreeRoot, branch.replace(/[/\\]/g, '__'));
}

/** The env an agent needs so its own `cli.mjs` writes the CANONICAL state DB, not a worktree copy.
 *  `config` is the injected AiosConfig (REQUIRED). */
export function agentEnv(base = process.env, extra = {}, config) {
  return { ...base, AIOS_DB: config.defaultDbPath, ...extra };
}

/**
 * Stamp WHICH model produced a commit into the git identity, so an agent-opened PR is
 * self-attributing: `git log --format='%an %ae'` (and the commit list on GitHub) answers "which
 * model wrote this?" without a run-log cross-reference. This closed a real provenance gap — every
 * autonomous `aios/*` commit landed as the same `AIOS Builder` regardless of the model, and the one
 * artifact that mapped session→model (the run log) was incomplete and unlinkable (the branch suffix
 * is a one-way hash of the session), so which model authored a given F-PR was unrecoverable.
 *
 * Returns GIT_AUTHOR_ / GIT_COMMITTER_ overrides to merge into the agent's spawn env. Git reads
 * these natively in whatever `git commit` the agent runs, so this is fully daemon-controlled and
 * agent-independent — it needs no cooperation from claude/agy/opencode — and it is scoped to the
 * agent's own subprocess env, so it never touches the founder's working tree.
 *
 * Design choices:
 *  - The model is appended to the NAME as `<base> (<model>)` so it shows everywhere a name shows.
 *  - The email is plus-addressed (`local+<slug>@domain`) so `%ae` is machine-parseable — but ONLY
 *    when the daemon already supplied an email. Core is tenant-agnostic (ships no identity), so it
 *    must never FABRICATE an email domain; if none is inherited, only the name is stamped.
 *  - No model/agent tag ⇒ returns `{}` (identity untouched), so nothing changes for callers that
 *    don't pass one.
 */
export function gitIdentityEnv(base = process.env, { agent, model } = {}) {
  const tag = String(model || agent || '').trim();
  if (!tag) return {};
  const baseName = base.GIT_AUTHOR_NAME || base.GIT_COMMITTER_NAME || 'AIOS Builder';
  const name = `${baseName} (${tag})`;
  const out = { GIT_AUTHOR_NAME: name, GIT_COMMITTER_NAME: name };

  const baseEmail = base.GIT_AUTHOR_EMAIL || base.GIT_COMMITTER_EMAIL || '';
  const slug = tag.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  // Skip if already plus-addressed (idempotent — a re-launch must not stack `+a+b`).
  if (slug && baseEmail.includes('@') && !baseEmail.includes('+')) {
    const [local, domain] = baseEmail.split('@');
    out.GIT_AUTHOR_EMAIL = out.GIT_COMMITTER_EMAIL = `${local}+${slug}@${domain}`;
  }
  return out;
}

/**
 * Create an isolated worktree on a fresh branch based on the freshest origin/main (falls back to
 * local HEAD when origin is unreachable). Returns { ok, path, branch, base, error, cleanup }.
 * `cleanup()` removes the worktree (and the local branch once it is safely on origin). `config` is
 * the injected AiosConfig (REQUIRED).
 */
export function createWorktree({ taskId, session, base, config } = {}) {
  const branch = branchName(taskId, session);
  const dir = worktreeDir(branch, config);
  try {
    mkdirSync(config.worktreeRoot, { recursive: true });

    // Freshen origin/main so the agent branches from the latest merged code (best-effort — offline is fine).
    git(['fetch', 'origin', 'main', '--quiet'], {}, config);
    const baseRef = base
      || (git(['rev-parse', '--verify', '--quiet', 'origin/main'], {}, config).status === 0 ? 'origin/main' : 'HEAD');

    // Clear any stale worktree/branch of the same name (e.g. a prior crashed run) before recreating.
    removeWorktree(dir, branch, config);

    const add = git(['worktree', 'add', '-b', branch, dir, baseRef], {}, config);
    if (add.status !== 0) {
      removeWorktree(dir, branch, config);
      return { ok: false, branch, base: baseRef, error: (add.stderr || add.stdout || 'git worktree add failed').slice(0, 300), cleanup: () => {} };
    }
    return { ok: true, path: dir, branch, base: baseRef, cleanup: () => removeWorktree(dir, branch, config) };
  } catch (e) {
    return { ok: false, branch, error: String(e?.message || e), cleanup: () => {} };
  }
}

/** rmSync a directory, but ONLY if it lives under config.worktreeRoot (never delete outside that tree). */
function forceRmDir(dir, config) {
  const abs = resolve(dir);
  if (!abs.startsWith(resolve(config.worktreeRoot))) return false;
  try { if (existsSync(abs)) { rmSync(abs, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } return true; }
  catch { return false; }
}

/**
 * Remove a worktree directory and prune its metadata. The local branch is deleted ONLY if it is
 * already on origin (i.e. pushed as a PR) — so we never destroy unpushed work; an unpushed branch
 * is left for recovery and the task simply gets a fresh worktree on its next run. On Windows
 * `git worktree remove` can leave the directory behind if a file was momentarily locked, so we
 * force-delete any leftover dir and re-prune. `config` is the injected AiosConfig (REQUIRED).
 */
export function removeWorktree(dir, branch, config) {
  git(['worktree', 'remove', dir, '--force'], {}, config);
  if (existsSync(dir)) forceRmDir(dir, config);   // git left it (locked file) → delete the dir ourselves
  git(['worktree', 'prune'], {}, config);
  if (branch) {
    const pushed = git(['rev-parse', '--verify', '--quiet', `origin/${branch}`], {}, config).status === 0;
    if (pushed) git(['branch', '-D', branch], {}, config);
  }
}

/**
 * Create an ISOLATED, DETACHED worktree for read-only agent work (peer review) that must never
 * create or leave behind a branch. `createWorktree`'s branch is deliberately left behind when
 * unpushed (recovery), but a reviewer has nothing worth keeping — `--detach` means there's no
 * branch to leak in the first place. This exists because `spawnPeerReview` used to run the
 * reviewer (an auto-permission agent free to run `git`/`gh` itself, e.g. `gh pr checkout`) with
 * cwd:config.repoRoot — the PRIMARY tree — so a reviewer that checked out the PR branch stranded
 * the founder's working tree there, breaking subsequent manual merges/pulls (daemon-hygiene
 * postmortem). Returns { ok, path, base, error, cleanup }. `config` is the injected AiosConfig
 * (REQUIRED).
 */
export function createReviewWorktree({ base, config } = {}) {
  const id = `review-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = join(config.worktreeRoot, id);
  try {
    mkdirSync(config.worktreeRoot, { recursive: true });

    // Freshen origin/main so the reviewer sees the latest merged code (best-effort — offline is fine).
    git(['fetch', 'origin', 'main', '--quiet'], {}, config);
    const baseRef = base
      || (git(['rev-parse', '--verify', '--quiet', 'origin/main'], {}, config).status === 0 ? 'origin/main' : 'HEAD');

    const add = git(['worktree', 'add', '--detach', dir, baseRef], {}, config);
    if (add.status !== 0) {
      forceRmDir(dir, config);
      git(['worktree', 'prune'], {}, config);
      return { ok: false, error: (add.stderr || add.stdout || 'git worktree add --detach failed').slice(0, 300), cleanup: () => {} };
    }
    return {
      ok: true,
      path: dir,
      base: baseRef,
      cleanup: () => {
        git(['worktree', 'remove', dir, '--force'], {}, config);
        if (existsSync(dir)) forceRmDir(dir, config); // git left it (locked file) → delete the dir ourselves
        git(['worktree', 'prune'], {}, config);
      },
    };
  } catch (e) {
    return { ok: false, error: String(e?.message || e), cleanup: () => {} };
  }
}

/**
 * Best-effort cleanup of ALL aios worktrees — called at daemon start so a crash that orphaned
 * worktrees doesn't leak disk. Safe on restart because any in-flight agent was killed with the daemon.
 * Handles both git-registered worktrees AND leftover directories the registration-based prune missed.
 * `config` is the injected AiosConfig (REQUIRED).
 */
export function pruneAllWorktrees(config) {
  let removed = 0;
  // 1. Unregister any git-tracked aios worktrees.
  const list = git(['worktree', 'list', '--porcelain'], {}, config);
  if (list.status === 0) {
    for (const line of String(list.stdout || '').split('\n')) {
      const m = line.match(/^worktree\s+(.+)$/);
      if (m && m[1].replace(/\\/g, '/').includes('/.aios-worktrees/')) git(['worktree', 'remove', m[1].trim(), '--force'], {}, config);
    }
  }
  git(['worktree', 'prune'], {}, config);
  // 2. Force-delete every leftover directory under config.worktreeRoot (crashed runs, locked files).
  try {
    if (existsSync(config.worktreeRoot)) for (const name of readdirSync(config.worktreeRoot)) {
      if (forceRmDir(join(config.worktreeRoot, name), config)) removed++;
    }
  } catch { /* best-effort */ }
  git(['worktree', 'prune'], {}, config);
  return { removed };
}
