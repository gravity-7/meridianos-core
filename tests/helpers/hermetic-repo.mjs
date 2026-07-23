/**
 * Hermetic git repo + ISOLATED worktree root for tests that perform real `git worktree` I/O.
 *
 * A throwaway repo in os.tmpdir() keeps these tests off the developer's real git state and away
 * from the live daemon's worktree ops. But the temp repo alone is NOT enough isolation: config.mjs
 * derives `worktreeRoot` as a SIBLING of the repo root (deliberately outside it, so the main tree's
 * `git status` never sees agent worktrees), and every hermetic temp repo lives in os.tmpdir() — so
 * every one of their siblings collapses onto the SAME shared `<tmp>/.aios-worktrees`.
 *
 * `node --test` runs test FILES in parallel processes, so a shared root means one file's teardown
 * (`rmSync(worktreeRoot)`) or `pruneAllWorktrees()` deletes another file's worktrees mid-flight.
 * That surfaced as a genuinely confusing flake: `git worktree add` failing with any of
 * "Invalid path '<tmp>/.aios-worktrees': No such file or directory", "not a git repository", or
 * "this operation must be run in a work tree", depending on exactly when the directory vanished.
 *
 * This is the same collision config.mjs already warns about for multi-tenant installs, with the
 * same fix: pin `$AIOS_WORKTREE_ROOT` to a unique per-caller directory.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import os from 'node:os';

/**
 * Create a fresh git repo in a temp dir AND claim an isolated worktree root for this process.
 *
 * ⚠️ MUST be called BEFORE `resolvePaths()` — it sets `process.env.AIOS_WORKTREE_ROOT`, which
 * resolvePaths reads at call time. Setting a process-global env var is safe precisely because the
 * test runner gives each file its own process; within one file it is the isolation we want.
 *
 * Returns `{ root, worktreeRoot, cleanup }`. Call `cleanup()` from the file's `after()` hook —
 * it removes the worktree root FIRST (it lives outside the repo), then the repo itself.
 */
export function makeHermeticRepo(prefix) {
  const root = mkdtempSync(join(os.tmpdir(), prefix));
  const git = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'aios-itest@example.com']);
  git(['config', 'user.name', 'AIOS itest']);
  writeFileSync(join(root, 'README.md'), 'hermetic itest repo\n');
  git(['add', '.']);
  git(['commit', '-m', 'init']);

  const worktreeRoot = mkdtempSync(join(os.tmpdir(), `${prefix}wt-`));
  process.env.AIOS_WORKTREE_ROOT = worktreeRoot;

  return {
    root,
    worktreeRoot,
    cleanup() {
      rmSync(worktreeRoot, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    },
  };
}
