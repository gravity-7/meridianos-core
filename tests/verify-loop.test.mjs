import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { buildReviewPrompt } from '../verify-loop.mjs';
import { resolvePaths } from '../config.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';

const config = resolvePaths({ domain: FIXTURE_DOMAIN });

// We test the exported helpers that don't require a real DB or child_process.
// The full integration (spawning agents, merging PRs) is tested via dry-run mode.

// --- parseVerdict (imported via dynamic structure test) ---
// Since parseVerdict is not exported, we test the verify loop's behavior through
// the exported verifyCycle with mocked dependencies.

test('verifyCycle returns empty results when no tasks are in-review', async () => {
  // Minimal mock DB
  const db = {
    prepare: () => ({ all: () => [], get: () => null, run: () => ({}) }),
  };
  const policy = { auto_merge: 'peer_agent_review', capability_matrix: {} };

  const { verifyCycle } = await import('../verify-loop.mjs');
  const result = await verifyCycle(db, { policy, dryRun: true });

  assert.equal(result.checked, 0);
  assert.deepEqual(result.merged, []);
  assert.deepEqual(result.failed, []);
  assert.deepEqual(result.pending, []);
});

test('verifyCycle skips everything in founder_only mode', async () => {
  const tasks = [
    { id: 'T1', status: 'in-review', pr: '42', lease_owner: 'claude', owner: 'claude', updated_at: new Date().toISOString() },
  ];
  const db = {
    prepare: (sql) => ({
      all: (...args) => {
        if (sql.includes('FROM tasks')) return tasks;
        return [];
      },
      get: () => null,
      run: () => ({}),
    }),
  };
  const policy = { auto_merge: 'founder_only' };

  const { verifyCycle } = await import('../verify-loop.mjs');
  const result = await verifyCycle(db, { policy, dryRun: true });

  assert.equal(result.checked, 1);
  assert.deepEqual(result.pending, ['T1']);
  assert.deepEqual(result.merged, []);
});

test('clearVerifyState removes tracked task', async () => {
  const { clearVerifyState, getVerifyState } = await import('../verify-loop.mjs');
  clearVerifyState('T1');
  const state = getVerifyState();
  assert.equal(state['T1'], undefined);
});

// --- spawnPeerReview daemon-hygiene regression (postmortem: reviewer ran with cwd:config.repoRoot) ------
const inGitRepo = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: config.repoRoot, encoding: 'utf8' }).status === 0;
const currentBranch = () => spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: config.repoRoot, encoding: 'utf8' }).stdout.trim();

test('spawnPeerReview never runs the reviewer in the primary tree', { skip: !inGitRepo }, async () => {
  const { spawnPeerReview } = await import('../verify-loop.mjs');
  const branchBefore = currentBranch();
  const scratchBranch = 'zz-peer-review-itest-' + Math.random().toString(36).slice(2, 8);

  // A "checkout-happy" reviewer: instead of just reading/reporting, it runs `git checkout` in
  // whatever cwd it was spawned with. If spawnPeerReview still passed cwd:config.repoRoot (the bug),
  // this would strand the PRIMARY tree on scratchBranch.
  let capturedCwd = null;
  const _spawn = async (cmd, args, opts) => {
    capturedCwd = opts.cwd;
    const co = spawnSync('git', ['checkout', '-b', scratchBranch], { cwd: opts.cwd, encoding: 'utf8' });
    assert.equal(co.status, 0, `simulated reviewer checkout should succeed: ${co.stderr}`);
    return { outcome: 'ok', stdout: 'reviewed the diff\nVERDICT: LGTM' };
  };

  const result = await spawnPeerReview({
    task: { id: 'ZZ-hygiene-itest' },
    prNumber: '1',
    reviewerAgent: 'claude',
    model: null,
    config,
    _spawn,
  });

  assert.equal(result.status, 'pass', 'verdict still parses correctly from the isolated run');
  assert.notEqual(capturedCwd, config.repoRoot, 'reviewer must NOT be spawned with cwd:config.repoRoot');
  assert.ok(String(capturedCwd).startsWith(config.worktreeRoot), 'reviewer runs inside an isolated worktree');
  assert.equal(currentBranch(), branchBefore, "primary tree's HEAD branch is unchanged after a checkout-happy reviewer");

  spawnSync('git', ['branch', '-D', scratchBranch], { cwd: config.repoRoot }); // test hygiene only
});

test('spawnPeerReview bounces without falling back to config.repoRoot when worktree setup fails', async () => {
  const { spawnPeerReview } = await import('../verify-loop.mjs');
  let spawnCalled = false;
  const _createReviewWorktree = () => ({ ok: false, error: 'simulated worktree setup failure', cleanup: () => {} });
  const _spawn = async () => { spawnCalled = true; return { outcome: 'ok', stdout: 'VERDICT: LGTM' }; };

  const result = await spawnPeerReview({
    task: { id: 'ZZ-hygiene-fail-itest' },
    prNumber: '1',
    reviewerAgent: 'claude',
    model: null,
    config,
    _spawn,
    _createReviewWorktree,
  });

  assert.equal(result.status, 'fail');
  assert.match(result.detail, /review worktree setup failed/);
  assert.equal(spawnCalled, false, 'the reviewer must never be spawned when worktree setup fails');
});

test('spawnPeerReview tears down the review worktree even when the reviewer fails', async () => {
  const { spawnPeerReview } = await import('../verify-loop.mjs');
  let cleanedUp = false;
  const _createReviewWorktree = () => ({ ok: true, path: '/fake/review/wt', cleanup: () => { cleanedUp = true; } });
  const _spawn = async () => { throw new Error('reviewer crashed'); };

  const result = await spawnPeerReview({
    task: { id: 'ZZ-hygiene-cleanup-itest' },
    prNumber: '1',
    reviewerAgent: 'claude',
    model: null,
    config,
    _spawn,
    _createReviewWorktree,
  }).catch((e) => ({ status: 'fail', detail: String(e?.message || e) }));

  assert.equal(result.status, 'fail');
  assert.equal(cleanedUp, true, 'the review worktree is always cleaned up, even on error');
});

// ---- domain prompt prose (2.1c) --------------------------------------------------------------
// buildReviewPrompt reads config.domain.prompts.reviewCriteria from the injected config, so its
// criteria block is byte-identical to whatever the injected DomainPlugin's reviewCriteria say —
// proven here with FIXTURE_DOMAIN's prose.

test('buildReviewPrompt\'s criteria block is byte-identical to the injected DomainPlugin\'s reviewCriteria', () => {
  const prompt = buildReviewPrompt({ id: 'ZZ-review-snapshot' }, '42', config);
  const start = prompt.indexOf('Read the changes carefully. Check for:');
  const end = prompt.indexOf('Respond with EXACTLY one line');
  const criteriaBlock = prompt.slice(start, end).trimEnd();
  assert.equal(criteriaBlock, [
    'Read the changes carefully. Check for:',
    ...FIXTURE_DOMAIN.prompts.reviewCriteria,
  ].join('\n'));
});

test('buildReviewPrompt reflects injected custom prompts and drops the previously-injected criteria', () => {
  const customConfig = resolvePaths({
    domain: { prompts: { implRules: [], reviewCriteria: ['- Custom tenant criterion'] } },
  });
  const prompt = buildReviewPrompt({ id: 'ZZ-review-custom' }, '43', customConfig);
  assert.ok(prompt.includes('- Custom tenant criterion'));
  assert.ok(!prompt.includes('Zone violations'));
  assert.ok(!prompt.includes('Tone guardrail violations'));
});
