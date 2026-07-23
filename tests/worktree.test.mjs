import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { branchName, worktreeDir, agentEnv, gitIdentityEnv, createWorktree, createReviewWorktree, pruneAllWorktrees } from '../worktree.mjs';
import { buildPrompt } from '../launcher.mjs';
import { resolvePaths } from '../config.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';
import { makeHermeticRepo } from './helpers/hermetic-repo.mjs';

// ─── Hermetic temp-repo setup ────────────────────────────────────────────────
// Each test run gets its own fresh git repo AND its own isolated worktree root, so these tests
// never touch the developer's git state and never race the live daemon's worktree ops. The
// isolated root matters especially here: `pruneAllWorktrees()` below sweeps EVERYTHING under it,
// which on the old shared root wiped a parallel test file's in-flight worktrees (see
// hermetic-repo.mjs).

const repo = makeHermeticRepo('aios-itest-wt-'); // MUST precede resolvePaths (sets AIOS_WORKTREE_ROOT)
const config = resolvePaths({ root: repo.root, domain: FIXTURE_DOMAIN });

after(() => repo.cleanup());

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

test('gitIdentityEnv stamps the model into the commit identity (name + plus-addressed email)', () => {
  const env = gitIdentityEnv(
    { GIT_AUTHOR_NAME: 'AIOS Builder', GIT_AUTHOR_EMAIL: 'builder@mos.dev' },
    { agent: 'claude', model: 'claude-opus-4-8' },
  );
  assert.equal(env.GIT_AUTHOR_NAME, 'AIOS Builder (claude-opus-4-8)');
  assert.equal(env.GIT_COMMITTER_NAME, 'AIOS Builder (claude-opus-4-8)');
  assert.equal(env.GIT_AUTHOR_EMAIL, 'builder+claude-opus-4-8@mos.dev', 'model slug is machine-parseable from %ae');
  assert.equal(env.GIT_COMMITTER_EMAIL, 'builder+claude-opus-4-8@mos.dev');
});

test('gitIdentityEnv prefers the model but falls back to the agent name', () => {
  const byAgent = gitIdentityEnv({ GIT_AUTHOR_EMAIL: 'b@x.io' }, { agent: 'antigravity' });
  assert.equal(byAgent.GIT_AUTHOR_NAME, 'AIOS Builder (antigravity)', 'default base name when none inherited');
  assert.equal(byAgent.GIT_AUTHOR_EMAIL, 'b+antigravity@x.io');
});

test('gitIdentityEnv leaves the identity untouched when no model/agent is given', () => {
  assert.deepEqual(gitIdentityEnv({ GIT_AUTHOR_NAME: 'x', GIT_AUTHOR_EMAIL: 'y@z.io' }, {}), {});
});

test('gitIdentityEnv never fabricates an email domain (tenant-agnostic)', () => {
  // Core ships no identity — with no inherited email, stamp only the name, never invent a domain.
  const env = gitIdentityEnv({}, { model: 'deepseek-v4-pro' });
  assert.equal(env.GIT_AUTHOR_NAME, 'AIOS Builder (deepseek-v4-pro)');
  assert.ok(!('GIT_AUTHOR_EMAIL' in env), 'no email invented');
  assert.ok(!('GIT_COMMITTER_EMAIL' in env), 'no committer email invented');
});

test('gitIdentityEnv is idempotent — a re-launch does not stack +model+model', () => {
  const once = gitIdentityEnv({ GIT_AUTHOR_EMAIL: 'builder+claude@mos.dev' }, { model: 'claude' });
  assert.ok(!('GIT_AUTHOR_EMAIL' in once), 'already plus-addressed → email left as-is');
  assert.equal(once.GIT_AUTHOR_NAME, 'AIOS Builder (claude)', 'name still stamped');
});

test('gitIdentityEnv slugifies a model id with spaces/case for the email local-part', () => {
  const env = gitIdentityEnv({ GIT_AUTHOR_EMAIL: 'b@x.io' }, { model: 'Gemini 3 Pro (High)' });
  assert.equal(env.GIT_AUTHOR_NAME, 'AIOS Builder (Gemini 3 Pro (High))', 'name keeps the human-readable form');
  assert.equal(env.GIT_AUTHOR_EMAIL, 'b+gemini-3-pro-high@x.io', 'email local-part is a clean slug');
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
