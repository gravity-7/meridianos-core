/**
 * boot-guard.test.mjs — the daemon boot guard that restores the PRIMARY working tree to `main`.
 *
 * Two layers:
 *   • Unit tests with an INJECTED fake git runner — assert the decision logic and that no
 *     destructive git command is issued in the no-op / dirty paths.
 *   • Integration tests against a REAL temporary git repo — actually exercise `git switch` /
 *     `git checkout` so the acceptance scenarios are proven end-to-end, cross-platform.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  restorePrimaryTreeToMain,
  trackedModifiedPaths,
  primaryTreeBranch,
  GENERATED_BOARD_FILES,
} from '../boot-guard.mjs';
import { resolvePaths } from '../config.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';

// ---------------------------------------------------------------------------
// Unit layer: injected fake git runner
// ---------------------------------------------------------------------------

/**
 * Build a fake git runner. `head` is the branch reported by `rev-parse --abbrev-ref HEAD`;
 * `status` is the porcelain body. Records every invocation for assertions.
 */
function fakeGit({ head = 'main', status = '', switchStatus = 0, checkoutStatus = 0 } = {}) {
  const calls = [];
  const run = (args) => {
    calls.push(args.join(' '));
    if (args[0] === 'rev-parse' && args.includes('--abbrev-ref')) return { status: 0, stdout: head + '\n', stderr: '' };
    if (args[0] === 'status') return { status: 0, stdout: status, stderr: '' };
    if (args[0] === 'switch') return { status: switchStatus, stdout: '', stderr: switchStatus ? 'switch failed' : '' };
    // `checkout HEAD -- <files>` (discard drift) always succeeds; a bare `checkout <branch>`
    // (the switch fallback) honors checkoutStatus so switch-failure can be simulated.
    if (args[0] === 'checkout') {
      const isFallbackSwitch = args[1] !== 'HEAD';
      return { status: isFallbackSwitch ? checkoutStatus : 0, stdout: '', stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  };
  run.calls = calls;
  return run;
}

test('trackedModifiedPaths ignores untracked (??) and normalizes rename destinations', () => {
  const porcelain = [
    ' M .ai/board.md',
    'M  .ai/state/board.json',
    '?? pr_diff.txt',
    'R  old/name.js -> src/new.js',
    'A  packages\\tax-engine\\index.ts',
    '',
  ].join('\n');
  const paths = trackedModifiedPaths(porcelain);
  assert.deepEqual(
    paths.sort(),
    ['.ai/board.md', '.ai/state/board.json', 'packages/tax-engine/index.ts', 'src/new.js'].sort(),
  );
  assert.ok(!paths.includes('pr_diff.txt'), 'untracked files are excluded');
});

test('already on main → no-op (no switch/checkout issued)', () => {
  const git = fakeGit({ head: 'main' });
  const r = restorePrimaryTreeToMain({ repoRoot: '/x', git });
  assert.deepEqual(r, { switched: false, from: 'main', reason: 'already-main' });
  assert.ok(!git.calls.some(c => c.startsWith('switch') || c.startsWith('checkout')), 'must not touch the tree when already on main');
});

test('feature branch with only board drift → discards drift then switches', () => {
  const status = ' M .ai/board.md\n M .ai/state/board.json\n?? pr_diff.txt\n';
  const git = fakeGit({ head: 'aios/F2-image-stage-abc', status });
  const r = restorePrimaryTreeToMain({ repoRoot: '/x', git });
  assert.equal(r.switched, true);
  assert.equal(r.from, 'aios/F2-image-stage-abc');
  assert.equal(r.reason, 'restored');
  // The generated board files are restored (checkout HEAD --) BEFORE the switch.
  const checkoutIdx = git.calls.findIndex(c => c.startsWith('checkout HEAD --'));
  const switchIdx = git.calls.findIndex(c => c === 'switch main');
  assert.ok(checkoutIdx !== -1, 'board drift is discarded via checkout HEAD --');
  assert.ok(switchIdx !== -1 && switchIdx > checkoutIdx, 'switch happens after discarding drift');
});

test('feature branch with a NON-board uncommitted change → skipped (dirty), never switched', () => {
  const status = ' M .ai/board.md\n M packages/tax-engine/index.ts\n';
  const git = fakeGit({ head: 'aios/F2-image-stage-abc', status });
  const r = restorePrimaryTreeToMain({ repoRoot: '/x', git });
  assert.equal(r.switched, false);
  assert.equal(r.reason, 'dirty');
  assert.deepEqual(r.dirty, ['packages/tax-engine/index.ts']);
  assert.ok(!git.calls.some(c => c.startsWith('switch') || c.startsWith('checkout')), 'must NOT discard/switch when real work is present');
});

test('switch failure is reported, not swallowed', () => {
  const git = fakeGit({ head: 'feature', status: '', switchStatus: 1, checkoutStatus: 1 });
  const r = restorePrimaryTreeToMain({ repoRoot: '/x', git });
  assert.equal(r.switched, false);
  assert.equal(r.reason, 'switch-failed');
});

test('GENERATED_BOARD_FILES is exactly the two rendered board files', () => {
  assert.deepEqual([...GENERATED_BOARD_FILES].sort(), ['.ai/board.md', '.ai/state/board.json'].sort());
});

// ---------------------------------------------------------------------------
// Integration layer: a real temp git repo
// ---------------------------------------------------------------------------

const gitAvailable = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;

/** Init a throwaway repo on `main` with committed board files + one source file. Returns its path. */
function initRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'aios-bootguard-'));
  const g = (...args) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
    return r;
  };
  g('init', '-b', 'main');
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'Test');
  g('config', 'commit.gpgsign', 'false');
  g('config', 'core.autocrlf', 'false'); // keep board content byte-exact on Windows
  mkdirSync(join(dir, '.ai', 'state'), { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, '.ai', 'board.md'), '# board (main)\n');
  writeFileSync(join(dir, '.ai', 'state', 'board.json'), '{"v":"main"}\n');
  writeFileSync(join(dir, 'src', 'app.js'), 'export const v = 1;\n');
  g('add', '-A');
  g('commit', '-m', 'initial on main');
  return { dir, g };
}

test('integration: stranded on a feature branch → restored to main, board drift discarded', { skip: !gitAvailable }, () => {
  const { dir, g } = initRepo();
  try {
    // A feature branch that changed board.md and committed it (so main and feature genuinely differ).
    g('switch', '-c', 'aios/F2-image-stage-xyz');
    writeFileSync(join(dir, '.ai', 'board.md'), '# board (feature committed)\n');
    g('add', '-A');
    g('commit', '-m', 'feature board render');
    // Now simulate the stranded primary tree: on the feature branch with UNCOMMITTED board drift.
    writeFileSync(join(dir, '.ai', 'board.md'), '# board (uncommitted drift)\n');
    writeFileSync(join(dir, '.ai', 'state', 'board.json'), '{"v":"drift"}\n');
    writeFileSync(join(dir, 'pr_diff.txt'), 'untracked scratch\n'); // untracked must not block

    assert.equal(primaryTreeBranch({ repoRoot: dir }), 'aios/F2-image-stage-xyz');

    const r = restorePrimaryTreeToMain({ repoRoot: dir });
    assert.equal(r.switched, true, `should switch; got ${JSON.stringify(r)}`);
    assert.equal(r.reason, 'restored');

    // HEAD is back on main and board.md holds main's committed content (drift discarded).
    assert.equal(primaryTreeBranch({ repoRoot: dir }), 'main');
    assert.equal(readFileSync(join(dir, '.ai', 'board.md'), 'utf8'), '# board (main)\n');
    // The untracked scratch file survives (never touched).
    assert.equal(readFileSync(join(dir, 'pr_diff.txt'), 'utf8'), 'untracked scratch\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('integration: primaryTreeBranch/restorePrimaryTreeToMain honor a non-default injected config (repoRoot resolved from config, no explicit repoRoot)', { skip: !gitAvailable }, () => {
  const { dir, g } = initRepo();
  try {
    g('switch', '-c', 'aios/F2-image-stage-xyz');
    writeFileSync(join(dir, '.ai', 'board.md'), '# board (uncommitted drift)\n');
    g('config', 'commit.gpgsign', 'false'); // keep the sub-branch config, belt-and-suspenders

    const config = resolvePaths({ root: dir, domain: FIXTURE_DOMAIN }); // fake AiosConfig pointed at the temp repo, NOT the singleton
    assert.equal(primaryTreeBranch({ config }), 'aios/F2-image-stage-xyz', 'repoRoot came from the injected config, not the default singleton');

    const r = restorePrimaryTreeToMain({ config });
    assert.equal(r.switched, true, `should switch; got ${JSON.stringify(r)}`);
    assert.equal(primaryTreeBranch({ config }), 'main');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('integration: already on main and clean → untouched', { skip: !gitAvailable }, () => {
  const { dir } = initRepo();
  try {
    const before = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout.trim();
    const r = restorePrimaryTreeToMain({ repoRoot: dir });
    assert.deepEqual(r, { switched: false, from: 'main', reason: 'already-main' });
    const after = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout.trim();
    assert.equal(after, before, 'HEAD unchanged');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('integration: stranded but with a NON-board uncommitted change → skipped, left on feature', { skip: !gitAvailable }, () => {
  const { dir, g } = initRepo();
  try {
    g('switch', '-c', 'aios/F2-image-stage-xyz');
    // Real, unsaved work on a non-generated file — must NOT be discarded.
    writeFileSync(join(dir, 'src', 'app.js'), 'export const v = 999; // WIP\n');
    writeFileSync(join(dir, '.ai', 'board.md'), '# drift too\n');

    const r = restorePrimaryTreeToMain({ repoRoot: dir });
    assert.equal(r.switched, false, `should skip; got ${JSON.stringify(r)}`);
    assert.equal(r.reason, 'dirty');
    assert.deepEqual(r.dirty, ['src/app.js']);

    // Still on the feature branch and the WIP file is intact.
    assert.equal(primaryTreeBranch({ repoRoot: dir }), 'aios/F2-image-stage-xyz');
    assert.equal(readFileSync(join(dir, 'src', 'app.js'), 'utf8'), 'export const v = 999; // WIP\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
