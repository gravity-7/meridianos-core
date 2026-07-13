/**
 * Local-Ollama smoke — the formalized version of the ad-hoc Ollama smoke introduced in 1.3
 * (`opencode-e2e.test.mjs`, which defaulted to Ollama under a name that only mentioned the
 * harness). Renamed and re-gated as `OLLAMA_E2E` because that's what it actually proves: a real,
 * $0, no-cloud, end-to-end loop against local Ollama. (DeepSeek coverage lives in its own test,
 * `deepseek-e2e.test.mjs`, gated `DEEPSEEK_E2E` — no longer duplicated here.)
 *
 * It hits a live model, so it is skipped unless explicitly enabled and is NOT part of the
 * deterministic suite `npm run test:aios` gates in CI.
 *
 * Three checks, three layers of the stack:
 *   1. Wire-level conformance — runs conformance.mjs's full battery (completion, streaming,
 *      usage shape, error-shape handling) directly over HTTP against Ollama's OpenAI-compatible
 *      endpoint. This is the "onboard any new provider in a minute" battery exercised for real,
 *      no CLI harness involved.
 *   2. Harness-spawn-level — proves an opencode run completes end-to-end through the real runner
 *      primitives (createWorktree → buildSpawnPlan → spawn → cleanup) against a real,
 *      non-Anthropic model, with zero Claude Code / Anthropic involvement. Deliberately drives
 *      the harness/spawn primitives directly rather than launchAgent()'s buildPrompt() —
 *      buildPrompt's `ready-for-impl` instructions tell the agent to commit and open a real PR
 *      (`gh pr create`), which is not something a smoke test should let an unattended local model
 *      attempt with --auto tool-approval. This still exercises every real code path a board task
 *      would (worktree, config-writing, spawn, provider wiring) — it just prompts the model
 *      directly.
 *   3. Metering reality check (added alongside metering-e2e.test.mjs) — after that same live
 *      Ollama run, asserts `readUsage('opencode', ...)` returns non-null, positive tokens. This
 *      is the direct regression guard for the 1.2 null-metering bug: a real model, a real
 *      non-Anthropic provider, zero mocking anywhere in the chain.
 *
 * Run it yourself (requires `ollama serve` running locally with a model pulled):
 *   OLLAMA_E2E=1 node --test tools/aios/tests/ollama-e2e.test.mjs
 *
 * Override the model or endpoint if yours differs from the default:
 *   OLLAMA_E2E=1 OLLAMA_E2E_MODEL=llama3 OLLAMA_E2E_BASE_URL=http://localhost:11434/v1 \
 *     node --test tools/aios/tests/ollama-e2e.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createWorktree, agentEnv } from '../worktree.mjs';
import { buildSpawnPlan, resolveOpencodeCmd } from '../harness-adapters.mjs';
import { spawnAndWait } from '../launcher.mjs';
import { resolveTarget, runBattery, formatReport } from '../conformance.mjs';
import { readUsage } from '../usage-readers.mjs';

const enabled = process.env.OLLAMA_E2E === '1';
// opencode's @ai-sdk/openai-compatible config wants the FULL root including /v1 (it appends only
// `/chat/completions`, unlike providers.mjs's convention — see deepseek/openrouter in
// providers.mjs — where baseUrl excludes /v1 and the client library adds it). conformance.mjs
// follows the providers.mjs convention, so its target strips a trailing /v1 back off.
const baseUrl = process.env.OLLAMA_E2E_BASE_URL ?? 'http://localhost:11434/v1';
const conformanceBaseUrl = baseUrl.replace(/\/v1\/?$/, '');
const model = process.env.OLLAMA_E2E_MODEL ?? 'gemma4:e4b';

// Bare `spawnSync('opencode', ...)` ENOENTs on Windows (npm shim, not a plain .exe — see
// resolveOpencodeCmd's doc comment in harness-adapters.mjs), so use the same resolution the real
// spawn path uses to detect whether opencode is actually usable here.
function isOpencodeInstalled() {
  try {
    resolveOpencodeCmd();
    return true;
  } catch {
    return false;
  }
}
const opencodeInstalled = enabled && isOpencodeInstalled();

function ollamaProvider() {
  if (!process.env.OLLAMA_KEY) process.env.OLLAMA_KEY = 'local'; // Ollama ignores the value; opencode's {env:} interpolation just needs the var to exist.
  return {
    name: 'ollama',
    baseUrl,
    wire: 'openai',
    keyEnv: 'OLLAMA_KEY',
    models: { medium: model },
  };
}

test('conformance battery passes live against local Ollama (wire-level, no CLI harness)', { skip: !enabled }, async () => {
  const target = resolveTarget({ name: 'ollama', baseURL: conformanceBaseUrl, wire: 'openai', model, key: 'local' });
  const report = await runBattery(target);
  assert.equal(report.pass, true, formatReport(report));
});

test('opencode harness completes a real run against local Ollama (live smoke)', { skip: !opencodeInstalled }, async () => {
  const provider = ollamaProvider();
  const prompt = 'Reply with exactly this text and nothing else. Do not use any tools: OLLAMA_SMOKE_OK';
  const session = 'e2e' + Math.random().toString(36).slice(2, 8);

  const wt = createWorktree({ taskId: 'ZZ-ollama-e2e', session });
  assert.ok(wt.ok, `worktree setup failed: ${wt.error}`);
  try {
    const plan = buildSpawnPlan('opencode', { prompt, provider, worktreePath: wt.path });
    for (const file of plan.files) {
      const abs = join(wt.path, file.path);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, file.content);
    }
    const env = { ...agentEnv(), ...plan.env };
    const result = await spawnAndWait(plan.cmd, plan.args, { cwd: wt.path, env, timeoutMs: 5 * 60 * 1000 });

    assert.equal(result.outcome, 'ok', result.note);
    assert.ok(result.stdout && result.stdout.trim().length > 0, 'expected non-empty stdout from the model');

    // Regression guard for the 1.2 null-metering bug: a real, non-Anthropic model run must
    // yield real, positive token counts — not null (the reader silently found nothing) and not
    // zero (the reader found a row but misread it).
    const usage = readUsage('opencode', { session, provider, worktreePath: wt.path }, result);
    assert.ok(usage, 'expected readUsage to return non-null usage for a completed live Ollama run');
    assert.ok(usage.inputTokens > 0, `expected positive inputTokens, got ${usage.inputTokens}`);
    assert.ok(usage.outputTokens > 0, `expected positive outputTokens, got ${usage.outputTokens}`);
    assert.ok(usage.totalTokens > 0, `expected positive totalTokens, got ${usage.totalTokens}`);
  } finally {
    try { wt.cleanup(); } catch { /* best-effort */ }
  }
});
