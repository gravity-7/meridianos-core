import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../db.mjs';
import { upsertTask, getTask } from '../state.mjs';
import {
  requiredChecks, verdictFrom, runChecks, verify, verifierStatus, applyVerdict, createCheckRunners,
} from '../verifier.mjs';
import { resolvePaths } from '../config.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';

const config = resolvePaths({ domain: FIXTURE_DOMAIN });
const T0 = '2026-07-03T00:00:00.000Z';
function freshDb(seed = []) {
  const db = openDb(':memory:', config);
  for (const t of seed) upsertTask(db, t, { now: T0 });
  return db;
}
const pass = (name) => ({ name, status: 'pass', detail: '' });

test('requiredChecks adds peer-review only in peer mode', () => {
  assert.deepEqual(requiredChecks('verifier_gated'), ['tests', 'guardrails']);
  assert.deepEqual(requiredChecks('founder_only'), ['tests', 'guardrails']);
  assert.deepEqual(requiredChecks('peer_agent_review'), ['tests', 'guardrails', 'peer-review']);
});

test('verdictFrom: failing → needs_changes; pending → pending', () => {
  assert.equal(verdictFrom([pass('tests'), { name: 'guardrails', status: 'fail' }], 'verifier_gated'), 'needs_changes');
  assert.equal(verdictFrom([pass('tests'), { name: 'guardrails', status: 'pending' }], 'verifier_gated'), 'pending');
  assert.equal(verdictFrom([], 'verifier_gated'), 'pending');
});

test('verdictFrom: all-pass gates by mode', () => {
  const all = [pass('tests'), pass('guardrails')];
  assert.equal(verdictFrom(all, 'verifier_gated'), 'pass');
  assert.equal(verdictFrom([...all, pass('peer-review')], 'peer_agent_review'), 'pass');
  assert.equal(verdictFrom(all, 'founder_only'), 'pending'); // founder still merges by hand
});

test('verdictFrom: a skipped guardrail is neutral — it does not block the gate, but a fail/pending elsewhere still wins', () => {
  const skip = { name: 'guardrails', status: 'skip', detail: 'no guardrail check configured' };
  assert.equal(verdictFrom([pass('tests'), skip], 'verifier_gated'), 'pass');
  assert.equal(verdictFrom([pass('tests'), skip, pass('peer-review')], 'peer_agent_review'), 'pass');
  assert.equal(verdictFrom([pass('tests'), skip], 'founder_only'), 'pending'); // gate still manual
  assert.equal(verdictFrom([{ name: 'tests', status: 'fail' }, skip], 'verifier_gated'), 'needs_changes');
  assert.equal(verdictFrom([{ name: 'tests', status: 'pending' }, skip], 'verifier_gated'), 'pending');
});

test('runChecks normalizes results; a throwing runner is a failed check', () => {
  const checks = runChecks({}, { runners: [
    { name: 'tests', fn: () => ({ status: 'pass', detail: '61/61' }) },
    { name: 'guardrails', fn: () => { throw new Error('boom'); } },
  ] });
  assert.deepEqual(checks[0], { name: 'tests', status: 'pass', detail: '61/61' });
  assert.equal(checks[1].status, 'fail');
  assert.match(checks[1].detail, /boom/);
});

test('verify reports the verdict and mergeability', () => {
  const v = verify({ task: 'F-1', mode: 'verifier_gated', checks: [pass('tests'), pass('guardrails')], pr: 33 });
  assert.equal(v.verdict, 'pass');
  assert.equal(v.mergeable, true);
  const v2 = verify({ task: 'F-1', mode: 'founder_only', checks: [pass('tests'), pass('guardrails')] });
  assert.equal(v2.verdict, 'pending');
  assert.equal(v2.mergeable, false);
});

test('verifierStatus lists in-review tasks with per-mode verdicts', () => {
  const db = freshDb([
    { id: 'F-a', title: 'a', status: 'in-review', owner: 'claude', pr: '33', priority: 10 },
    { id: 'F-b', title: 'b', status: 'ready-for-impl', owner: 'claude', priority: 20 },
  ]);
  const s = verifierStatus(db, { policy: { auto_merge: 'verifier_gated' }, checksByTask: { 'F-a': [pass('tests'), pass('guardrails')] }, config });
  assert.equal(s.mode, 'verifier_gated');
  assert.equal(s.pending.length, 1);
  assert.equal(s.pending[0].task, 'F-a');
  assert.equal(s.pending[0].verdict, 'pass');
});

test('applyVerdict auto-merges on pass under a gate, but not in founder_only', () => {
  const db = freshDb([{ id: 'F-a', title: 'a', status: 'in-review', owner: 'claude', priority: 10 }]);
  const blocked = applyVerdict(db, { task: 'F-a', verdict: 'pass', mode: 'founder_only' });
  assert.equal(blocked.ok, false);
  assert.equal(getTask(db, 'F-a').status, 'in-review');
  const merged = applyVerdict(db, { task: 'F-a', verdict: 'pass', mode: 'verifier_gated' });
  assert.equal(merged.ok, true);
  assert.equal(getTask(db, 'F-a').status, 'done');
});

test('applyVerdict refuses a non-pass verdict', () => {
  const db = freshDb([{ id: 'F-a', title: 'a', status: 'in-review', owner: 'claude', priority: 10 }]);
  const r = applyVerdict(db, { task: 'F-a', verdict: 'needs_changes', mode: 'verifier_gated' });
  assert.equal(r.ok, false);
  assert.equal(getTask(db, 'F-a').status, 'in-review');
});

// ---- guardrail check-runner externalized behind AiosConfig (2.1d) ---------------------------

function guardrailsCheck(repoRoot, opts = {}) {
  return createCheckRunners(repoRoot, { config, ...opts }).find((r) => r.name === 'guardrails');
}

test('createCheckRunners guardrail runner: FIXTURE_DOMAIN\'s default (guardrailCheck:null) → skip (tenant declared no check)', () => {
  // No override — this exercises the injected config's domain.guardrailCheck DEFAULT.
  // FIXTURE_DOMAIN declares no guardrail check at all (a real tenant, e.g. this repo's own
  // tools/aios/pv-domain.mjs, injects a real {cmd,script} instead — proven end-to-end for a real
  // script by the "used verbatim" test below).
  const runner = guardrailsCheck(config.repoRoot);
  const res = runner.fn();
  assert.deepEqual(res, { status: 'skip', detail: 'no guardrail check configured' });
});

test('createCheckRunners guardrail runner: an explicit {cmd,script} override runs it, pass/fail by exit code', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aios-guardrail-default-parity-'));
  try {
    writeFileSync(join(dir, 'ok.mjs'), 'process.exit(0);\n');
    const runner = guardrailsCheck(dir, { guardrailCheck: { cmd: process.execPath, script: 'ok.mjs' } });
    const res = runner.fn();
    assert.ok(res.status === 'pass' || res.status === 'fail', `expected pass/fail, got ${res.status}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createCheckRunners guardrail runner: guardrailCheck:null → skip (tenant declared no check)', () => {
  const runner = guardrailsCheck(config.repoRoot, { guardrailCheck: null });
  const res = runner.fn();
  assert.deepEqual(res, { status: 'skip', detail: 'no guardrail check configured' });
});

test('createCheckRunners guardrail runner: a script that does not exist on disk → skip (NOT pass)', () => {
  const runner = guardrailsCheck(config.repoRoot, { guardrailCheck: { cmd: 'python', script: 'tools/guardrails/does-not-exist.py' } });
  const res = runner.fn();
  assert.equal(res.status, 'skip');
  assert.match(res.detail, /not found/);
});

test('createCheckRunners guardrail runner: a custom {cmd, script} from config is used verbatim', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aios-guardrail-'));
  try {
    writeFileSync(join(dir, 'pass.mjs'), 'process.exit(0);\n');
    writeFileSync(join(dir, 'fail.mjs'), 'process.stdout.write("nope"); process.exit(1);\n');

    const passRunner = guardrailsCheck(dir, { guardrailCheck: { cmd: process.execPath, script: 'pass.mjs' } });
    assert.deepEqual(passRunner.fn(), { status: 'pass', detail: 'clean' });

    const failRunner = guardrailsCheck(dir, { guardrailCheck: { cmd: process.execPath, script: 'fail.mjs' } });
    const failRes = failRunner.fn();
    assert.equal(failRes.status, 'fail');
    assert.match(failRes.detail, /nope/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createCheckRunners guardrail runner: an unavailable interpreter → skip, not the old silent fail-open pass', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aios-guardrail-spawnerr-'));
  try {
    writeFileSync(join(dir, 'script.py'), '# present on disk, but the interpreter below does not exist\n');
    const runner = guardrailsCheck(dir, { guardrailCheck: { cmd: 'this-interpreter-does-not-exist-xyz', script: 'script.py' } });
    const res = runner.fn();
    assert.equal(res.status, 'skip');
    assert.match(res.detail, /guardrail runner unavailable/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createCheckRunners still returns the tests + guardrails runners (shape unchanged)', () => {
  const runners = createCheckRunners(config.repoRoot, { config });
  assert.deepEqual(runners.map((r) => r.name), ['tests', 'guardrails']);
});
