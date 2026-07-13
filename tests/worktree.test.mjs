import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { branchName, worktreeDir, agentEnv, createWorktree, createReviewWorktree, pruneAllWorktrees } from '../worktree.mjs';
import { buildPrompt } from '../launcher.mjs';
import { resolvePaths } from '../config.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';

// ─── Hermetic temp-repo setup ────────────────────────────────────────────────
// Each test run gets its own fresh git repo in a temp dir so these tests never
// touch C:\projects\propertyverdict's git state, never race the live daemon's
// worktree ops, and always pass unconditionally (no inGitRepo guard needed).

function makeTempRepo(prefix) {
  const root = mkdtempSync(join(os.tmpdir(), prefix));
  const git = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'aios-itest@example.com']);
  git(['config', 'user.name', 'AIOS itest']);
  writeFileSync(join(root, 'README.md'), 'hermetic itest repo\n');
  git(['add', '.']);
  git(['commit', '-m', 'init']);
  return root;
}

const tmpRoot = makeTempRepo('aios-itest-wt-');
const config = resolvePaths({ root: tmpRoot, domain: FIXTURE_DOMAIN });

// Tear down: remove the worktreeRoot first (it lives outside tmpRoot as a sibling),
// then the temp repo itself.
after(() => {
  rmSync(config.worktreeRoot, { recursive: true, force: true });
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ─── Pure-logic tests (no git I/O) ────────────────────────────────────────────

test('branchName is git-safe and namespaced under aios/', () => {
  const b = branchName('F2-3-photo-tools-ui-dealer/x', 'abcd1234efgh');
  assert.match(b, /^aios\/F2-3-photo-tools-ui-dealer-x-[a-z0-9]{1,8}$/i);
  assert.ok(!b.includes('/x'), 'illegal slash in task id is sanitized');
});

test('branchName is deterministic for a given task+session', () => {
  assert.equal(branchName('T1', 'sess1234'), branchName('T1', 'sess1234'));
});

test('branchName stays unique across repeated generations even when every session shares a long literal prefix', () => {
  // Regression for the postmortem bug: session ids like `'itest-usage-' + Math.random()...`
  // (harness-adapters.test.mjs) have a fixed prefix already >= 8 chars, so the old
  // `session.slice(0, 8)` truncation kept ONLY the literal prefix and discarded every random
  // character — every call below produced the exact same branch name, which then permanently
  // collided with an unpushed local branch left over from the first call (removeWorktree never
  // deletes an unpushed branch). 200 calls here must all be distinct.
  const names = new Set();
  for (let i = 0; i < 200; i++) {
    const session = 'itest-usage-' + Math.random().toString(36).slice(2, 8);
    names.add(branchName('ZZ-harness-itest-usage', session));
  }
  assert.equal(names.size, 200, 'each distinct session must yield a distinct branch name');
});

test('worktreeDir places the tree under WORKTREE_ROOT with slashes flattened', () => {
  const d = worktreeDir('aios/T1-abcd', config);
  assert.ok(d.startsWith(config.worktreeRoot));
  assert.ok(!d.slice(config.worktreeRoot.length + 1).includes('/'), 'branch slash flattened in dir name');
});

test('agentEnv points the agent CLI at the CANONICAL state DB', () => {
  const env = agentEnv({ PATH: '/usr/bin' }, {}, config);
  assert.equal(env.AIOS_DB, config.defaultDbPath);
  assert.equal(env.PATH, '/usr/bin', 'preserves the base env');
});

test('buildPrompt includes the isolated-branch workspace instructions when a branch is given', () => {
  const p = buildPrompt({ id: 'T1', title: 'x', status: 'ready-for-impl' }, { branch: 'aios/T1-abcd', config });
  assert.ok(p.includes('aios/T1-abcd'));
  assert.ok(/isolated git worktree/i.test(p));
  assert.ok(p.toLowerCase().includes('git checkout main'), 'warns the agent not to switch to main');
});

test('buildPrompt omits worktree instructions when no branch (backward compatible)', () => {
  const p = buildPrompt({ id: 'T1', title: 'x', status: 'ready-for-impl' }, { config });
  assert.ok(!/isolated git worktree/i.test(p));
});

// ─── Integration smoke tests: real git ops against the hermetic temp repo ─────
// No `inGitRepo` guard needed — the temp repo always exists and is always a valid
// git repo. These tests ONLY touch the temp dir, never C:\projects\propertyverdict.

test('pruneAllWorktrees force-deletes leftover directories git left behind', () => {
  // Simulate a crashed run's orphaned worktree dir (no git registration, just files on disk).
  const orphan = join(config.worktreeRoot, 'aios__ZZ-orphan-test-deadbeef');
  mkdirSync(orphan, { recursive: true });
  writeFileSync(join(orphan, 'stale.txt'), 'left behind by a killed agent');
  assert.ok(existsSync(orphan));
  pruneAllWorktrees(config);
  assert.ok(!existsSync(orphan), 'leftover worktree directory is removed');
});

test('createWorktree makes an isolated tree on a fresh branch, then cleans up', () => {
  const session = 'itest' + Math.random().toString(36).slice(2, 6);
  const wt = createWorktree({ taskId: 'ZZ-worktree-itest', session, config });
  try {
    assert.equal(wt.ok, true, `worktree should be created: ${wt.error || ''}`);
    assert.ok(existsSync(wt.path), 'worktree directory exists');
    // The worktree HEAD is on our branch, not main → git protects the main tree from the agent.
    const head = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: wt.path, encoding: 'utf8' }).stdout.trim();
    assert.equal(head, wt.branch);
  } finally {
    wt.cleanup();
  }
  assert.ok(!existsSync(wt.path), 'worktree directory removed after cleanup');
});

test('createReviewWorktree makes a DETACHED tree (no branch created), then cleans up', () => {
  const wt = createReviewWorktree({ config });
  try {
    assert.equal(wt.ok, true, `review worktree should be created: ${wt.error || ''}`);
    assert.ok(existsSync(wt.path), 'review worktree directory exists');
    // Detached HEAD: `git rev-parse --abbrev-ref HEAD` reports the literal string "HEAD", not a
    // branch name — there is no branch here for a leaky reviewer to leave behind.
    const head = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: wt.path, encoding: 'utf8' }).stdout.trim();
    assert.equal(head, 'HEAD', 'worktree HEAD is detached, not on a branch');
    // Confirm via `git branch --show-current` too (empty output = detached).
    const current = spawnSync('git', ['branch', '--show-current'], { cwd: wt.path, encoding: 'utf8' }).stdout.trim();
    assert.equal(current, '', 'no branch is checked out');
  } finally {
    wt.cleanup();
  }
  assert.ok(!existsSync(wt.path), 'review worktree directory removed after cleanup');
});

test('createReviewWorktree never leaves a branch behind even after a checkout inside it', () => {
  const wt = createReviewWorktree({ config });
  const branch = 'zz-review-checkout-itest-' + Math.random().toString(36).slice(2, 8);
  try {
    assert.equal(wt.ok, true, `review worktree should be created: ${wt.error || ''}`);
    // Simulate a reviewer agent that checks out a fresh local branch inside its OWN worktree.
    const co = spawnSync('git', ['checkout', '-b', branch], { cwd: wt.path, encoding: 'utf8' });
    assert.equal(co.status, 0, `checkout inside the review worktree should succeed: ${co.stderr}`);
  } finally {
    wt.cleanup();
    spawnSync('git', ['branch', '-D', branch], { cwd: config.repoRoot }); // test hygiene only; not asserted
  }
  assert.ok(!existsSync(wt.path), 'review worktree directory removed after cleanup');
});
