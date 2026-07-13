/**
 * Opt-in live smoke test — proves the complete select→spawn path against DeepSeek (the first
 * *paid* cheap provider), through BOTH wire formats, plus the cost-safety guard, for real. Hits
 * live paid APIs, so it is skipped unless explicitly enabled and is NOT part of the deterministic
 * suite `npm run test:aios` gates in CI.
 *
 * Three things proven here:
 *   1. claude-code + DeepSeek, /anthropic wire — routeModel() selects deepseek for a scratch
 *      policy overlay, then the claude-code harness completes a real run against DeepSeek's
 *      Anthropic-format endpoint.
 *   2. opencode + DeepSeek, OpenAI wire — same selection, then the opencode harness completes a
 *      real run against DeepSeek's native OpenAI-format endpoint.
 *   3. The cost guard, live — with DEEPSEEK_KEY temporarily unset, router.decide() must skip the
 *      claim (never fall back to paid Anthropic), and runner.executeRun() must log + warn the
 *      skip without ever invoking `launch`.
 *
 * Deliberately drives the harness/spawn primitives directly (createWorktree → buildSpawnPlan →
 * spawn → cleanup) rather than launchAgent()'s buildPrompt() — exactly the same reasoning as
 * opencode-e2e.test.mjs: buildPrompt's `ready-for-impl` instructions tell the agent to commit and
 * open a real PR (`gh pr create`), which is not something a smoke test should let an unattended
 * model attempt with --permission-mode/--auto tool-approval. This still exercises every real code
 * path a board task would (routeModel selection, worktree, config-writing, spawn, provider
 * wiring) — it just prompts the model directly with a trivial, PR-free task.
 *
 * Run it yourself (requires DEEPSEEK_KEY — see .ai/constitution.md §6, spending money is a
 * founder-only decision; the founder setting this key IS the authorization):
 *   DEEPSEEK_E2E=1 DEEPSEEK_KEY=sk-... node --test tools/aios/tests/deepseek-e2e.test.mjs
 *
 * Never mutates live .ai/policy.yaml, the live runlog, or the running daemon — every policy
 * overlay, task, DB, and run-log path here is scratch/in-memory.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createWorktree, agentEnv } from '../worktree.mjs';
import { buildSpawnPlan, resolveOpencodeCmd } from '../harness-adapters.mjs';
import { resolveProvider, providerKeyPresent } from '../providers.mjs';
import { spawnAndWait } from '../launcher.mjs';
import { routeModel } from '../model-router.mjs';
import { decide } from '../router.mjs';
import { executeRun } from '../runner.mjs';
import { appendRun, readRuns } from '../runlog.mjs';
import { openDb } from '../db.mjs';
import { upsertTask } from '../state.mjs';
import { resolvePaths } from '../config.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';

const config = resolvePaths({ domain: FIXTURE_DOMAIN });

const enabled = process.env.DEEPSEEK_E2E === '1';
const hasKey = enabled && Boolean(process.env.DEEPSEEK_KEY);

function isClaudeInstalled() {
  try {
    const r = spawnSync('claude', ['--version'], { encoding: 'utf8' });
    return !r.error && r.status === 0;
  } catch {
    return false;
  }
}
function isOpencodeInstalled() {
  try {
    resolveOpencodeCmd();
    return true;
  } catch {
    return false;
  }
}

// Scratch routing overlay — the exact shape a founder would add to .ai/policy.yaml's
// model_routing section, but never written to disk or to the live policy.
function scratchPolicy(harness) {
  return { model_routing: { claude: { simple: { provider: 'deepseek', harness } } } };
}

// A synthetic, throwaway task — never touches the real board/state DB.
const simpleTask = (id) => ({ id, title: 'deepseek e2e proof', complexity: 1, risk_tags: '[]' });

function scratchRunsPath() {
  return join(tmpdir(), `aios-deepseek-e2e-runs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jsonl`);
}

async function runProof({ harness, taskId }) {
  const policy = scratchPolicy(harness);
  const task = simpleTask(taskId);

  // 1. SELECT — routeModel() picks deepseek + the model from providers.mjs's registry.
  const routed = routeModel('claude', task, policy, 'ok', FIXTURE_DOMAIN);
  assert.equal(routed.provider, 'deepseek');
  assert.equal(routed.harness, harness);
  assert.ok(routed.model, 'expected a deepseek model id resolved from the provider registry');

  const provider = resolveProvider('deepseek', policy);
  assert.ok(providerKeyPresent(provider), 'DEEPSEEK_KEY must be set for this proof');

  // 2. SPAWN — buildSpawnPlan + a real worktree + a real process, exactly what launchAgent wraps.
  const prompt = 'Create a file named PROOF.md containing exactly one line of text: DEEPSEEK_E2E_OK. '
    + 'Then stop. Do not run git, do not commit, do not open a pull request.';
  const session = randomUUID();
  const wt = createWorktree({ taskId: task.id, session });
  assert.ok(wt.ok, `worktree setup failed: ${wt.error}`);
  const runsPath = scratchRunsPath();
  try {
    const plan = buildSpawnPlan(harness, { prompt, model: routed.model, session, provider, worktreePath: wt.path });
    for (const file of plan.files ?? []) {
      const abs = join(wt.path, file.path);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, file.content);
    }
    const env = { ...agentEnv(), ...plan.env };
    const result = await spawnAndWait(plan.cmd, plan.args, { cwd: wt.path, env, timeoutMs: 5 * 60 * 1000 });

    assert.equal(result.outcome, 'ok', result.note);

    const proofPath = join(wt.path, 'PROOF.md');
    assert.ok(existsSync(proofPath), 'expected PROOF.md to be created in the worktree');
    const content = readFileSync(proofPath, 'utf8');
    assert.match(content, /DEEPSEEK_E2E_OK/, 'PROOF.md did not contain the expected marker');

    // 3. OBSERVE — record + read back the run-log, exactly like the real runner would.
    appendRun(
      { agent: 'claude', model: routed.model, provider: 'deepseek', harness, session, task: task.id, outcome: 'ok', note: 'DEEPSEEK_E2E proof' },
      { path: runsPath },
    );
    const logged = readRuns({ path: runsPath, limit: 1 })[0];
    assert.equal(logged.provider, 'deepseek');
    assert.equal(logged.harness, harness);
    assert.equal(logged.outcome, 'ok');

    return { result, content, logged };
  } finally {
    try { wt.cleanup(); } catch { /* best-effort */ }
    try { rmSync(runsPath, { force: true }); } catch { /* best-effort */ }
  }
}

test('claude-code + DeepSeek completes a real run via the /anthropic wire (live)', { skip: !(hasKey && isClaudeInstalled()) }, async () => {
  const { result, content, logged } = await runProof({ harness: 'claude-code', taskId: 'ZZ-deepseek-e2e-cc' });
  console.log('[deepseek-e2e][claude-code] outcome:', result.outcome);
  console.log('[deepseek-e2e][claude-code] PROOF.md:', content.trim());
  console.log('[deepseek-e2e][claude-code] run-log:', JSON.stringify(logged));
});

test('opencode + DeepSeek completes a real run via the OpenAI wire (live)', { skip: !(hasKey && isOpencodeInstalled()) }, async () => {
  const { result, content, logged } = await runProof({ harness: 'opencode', taskId: 'ZZ-deepseek-e2e-oc' });
  console.log('[deepseek-e2e][opencode] outcome:', result.outcome);
  console.log('[deepseek-e2e][opencode] PROOF.md:', content.trim());
  console.log('[deepseek-e2e][opencode] run-log:', JSON.stringify(logged));
});

test('cost guard: missing DEEPSEEK_KEY skips the claim and never falls back to paid Anthropic (live)', { skip: !enabled }, async () => {
  const savedKey = process.env.DEEPSEEK_KEY;
  delete process.env.DEEPSEEK_KEY;
  try {
    const policy = scratchPolicy('claude-code');
    const task = simpleTask('ZZ-deepseek-e2e-guard');
    const db = openDb(':memory:');
    upsertTask(db, { ...task, owner: 'claude', status: 'ready-for-impl', priority: 10 }, { now: '2026-07-09T00:00:00.000Z' });

    // router.decide() must deny the claim with the missing-key reason, never silently substitute anthropic.
    const budget = { kill_switch: false, claude: { state: 'ok' }, mayClaim: { claude: true } };
    const d = decide(db, { agent: 'claude', policy, budget, now: Date.parse('2026-07-09T00:00:00.000Z'), config });
    assert.equal(d.mayClaim, false);
    assert.equal(d.reason, 'missing_key:deepseek');
    console.log('[deepseek-e2e][guard] router.decide():', JSON.stringify(d));

    // runner.executeRun() must log + warn the skip and MUST NOT invoke launch (the canary throws if it does).
    const runsPath = scratchRunsPath();
    let launchCalled = false;
    try {
      const outcome = await executeRun({
        db,
        policy,
        budget,
        now: Date.parse('2026-07-09T00:00:05.000Z'),
        agents: ['claude'],
        runs: [],
        runsPath,
        config,
        launch: async () => { launchCalled = true; throw new Error('launch must never be called on a missing-key guard'); },
      });
      assert.equal(launchCalled, false, 'launch was invoked despite the missing DEEPSEEK_KEY — cost guard failed');
      assert.equal(outcome.fired, false);
      const logged = readRuns({ path: runsPath })[0];
      assert.ok(logged, 'expected the missing-key skip to be logged');
      assert.equal(logged.outcome, 'skipped');
      assert.equal(logged.provider, 'deepseek');
      console.log('[deepseek-e2e][guard] runner.executeRun() logged:', JSON.stringify(logged));
    } finally {
      try { rmSync(runsPath, { force: true }); } catch { /* best-effort */ }
    }
  } finally {
    if (savedKey === undefined) delete process.env.DEEPSEEK_KEY; else process.env.DEEPSEEK_KEY = savedKey;
  }
});
