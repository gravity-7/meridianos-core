/**
 * metering-e2e — closes the gap between 1.6 (usage-readers.mjs, reads local persisted
 * artifacts) and 1.7 (mock-provider.mjs, intercepts HTTP): nothing previously connected the
 * two, so nothing proved that after a REAL CLI spawn, the numbers `readUsage` extracts equal
 * what the provider actually returned. That exact blind spot let the 1.2 null-metering
 * regression survive 4 PRs — a mocked/unit-tested reader can be internally consistent and still
 * read the wrong file, the wrong key, or nothing at all, and nothing would catch it.
 *
 * The mock provider is the ground truth here: it returns a known, fixed usage payload
 * (input=137, output=42) no matter which harness or model asks. Each exact-match test spawns
 * the REAL harness CLI (real `claude -p` / real `opencode run`) pointed at the mock, lets it run
 * the full real chain (CLI → provider HTTP call → the CLI's OWN on-disk artifact — a claude-code
 * transcript or an opencode.db row), then asserts `readUsage` recovers those exact numbers with
 * NO location overrides (no fake `home`/`dbPath`) — the real reader, reading the real artifact,
 * written by a real process that really talked to the mock.
 *
 * Gated behind METERING_E2E=1 (spawns real CLIs, writes real local artifacts under the
 * developer's actual ~/.claude / opencode.db — not something CI should do or something a
 * default `npm run test:aios` run should pay for) and skipped whenever the relevant CLI isn't
 * installed, same pattern as ollama-e2e.test.mjs.
 *
 * Run it yourself (requires both `claude` and `opencode` on PATH — no API keys, no network
 * beyond localhost):
 *   METERING_E2E=1 node --test tools/aios/tests/metering-e2e.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { startMockProvider } from '../test/mock-provider.mjs';
import { createWorktree, agentEnv } from '../worktree.mjs';
import { buildSpawnPlan, resolveOpencodeCmd } from '../harness-adapters.mjs';
import { spawnAndWait } from '../launcher.mjs';
import { readUsage } from '../usage-readers.mjs';

const enabled = process.env.METERING_E2E === '1';

// Same "no tool calls, one short final assistant turn" prompt both harnesses accept and
// terminate cleanly on — no side calls, so the transcript/db row carries exactly the ONE usage
// record the mock returned, matching it exactly rather than some multiple of it.
const PROMPT = 'Reply with exactly this text and nothing else. Do not use any tools: MOCK_SMOKE_OK';
const KNOWN_USAGE = { promptTokens: 137, completionTokens: 42 };

function isOpencodeInstalled() {
  try { resolveOpencodeCmd(); return true; } catch { return false; }
}
function isClaudeInstalled() {
  try {
    const r = spawnSync('claude', ['--version'], { encoding: 'utf8', windowsHide: true });
    return !r.error && r.status === 0;
  } catch { return false; }
}
const opencodeInstalled = enabled && isOpencodeInstalled();
const claudeInstalled = enabled && isClaudeInstalled();

function writePlanFiles(worktreePath, files) {
  for (const file of files ?? []) {
    const abs = join(worktreePath, file.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, file.content);
  }
}

test('opencode: real spawn against the mock provider → opencode.db → readUsage matches the mock exactly', { skip: !opencodeInstalled }, async () => {
  const mock = await startMockProvider({ usage: KNOWN_USAGE });
  try {
    process.env.METERING_E2E_OPENCODE_KEY = 'test-key';
    const provider = {
      name: 'meteringmock',
      // opencode's @ai-sdk/openai-compatible config wants the full root INCLUDING /v1 (see
      // ollama-e2e.test.mjs's own baseUrl convention) — the mock listens on /v1/chat/completions.
      baseUrl: mock.url + '/v1',
      wire: 'openai',
      keyEnv: 'METERING_E2E_OPENCODE_KEY',
      models: { medium: 'mock-model' },
    };
    const session = 'me2e' + Math.random().toString(36).slice(2, 8);
    const wt = createWorktree({ taskId: 'ZZ-metering-e2e-opencode', session });
    assert.ok(wt.ok, `worktree setup failed: ${wt.error}`);
    try {
      const plan = buildSpawnPlan('opencode', { prompt: PROMPT, provider, worktreePath: wt.path });
      writePlanFiles(wt.path, plan.files);
      const env = { ...agentEnv(), ...plan.env };
      const result = await spawnAndWait(plan.cmd, plan.args, { cwd: wt.path, env, timeoutMs: 5 * 60 * 1000 });
      assert.equal(result.outcome, 'ok', result.note);

      // No dbPath override — the real reader against the real ~/.local/share/opencode/opencode.db,
      // matched by this run's unique worktree directory (see opencode-usage.mjs).
      const usage = readUsage('opencode', { session, provider, worktreePath: wt.path }, result);
      assert.ok(usage, 'expected readUsage to find this run\'s row in the real opencode.db');
      assert.equal(usage.inputTokens, KNOWN_USAGE.promptTokens);
      assert.equal(usage.outputTokens, KNOWN_USAGE.completionTokens);
      assert.equal(usage.totalTokens, KNOWN_USAGE.promptTokens + KNOWN_USAGE.completionTokens);
    } finally {
      try { wt.cleanup(); } catch { /* best-effort */ }
    }
  } finally {
    await mock.close();
  }
});

test('claude-code: real spawn against the mock provider → transcript → readUsage matches the mock exactly', { skip: !claudeInstalled }, async () => {
  const mock = await startMockProvider({ usage: KNOWN_USAGE });
  try {
    process.env.METERING_E2E_CLAUDE_KEY = 'sk-mock-test-key';
    const provider = {
      name: 'meteringmock',
      baseUrl: mock.url,
      wire: 'anthropic',
      keyEnv: 'METERING_E2E_CLAUDE_KEY',
      // All five tiers point at the mock model too, so claude-code's internal tier calls (if
      // any fire for this trivial prompt) also resolve to the mock rather than silently falling
      // through to real Anthropic — the same silent-fallback class 1.5 closed for third-party
      // providers generally.
      models: { simple: 'mock-model', medium: 'mock-model', medium_high: 'mock-model', complex: 'mock-model', critical: 'mock-model' },
    };
    const session = randomUUID(); // claude-code requires --session-id to be a UUID
    const wt = createWorktree({ taskId: 'ZZ-metering-e2e-claude', session });
    assert.ok(wt.ok, `worktree setup failed: ${wt.error}`);
    try {
      const plan = buildSpawnPlan('claude-code', { prompt: PROMPT, model: 'mock-model', session, provider, worktreePath: wt.path });
      writePlanFiles(wt.path, plan.files);
      const env = { ...agentEnv(), ...plan.env };
      const result = await spawnAndWait(plan.cmd, plan.args, { cwd: wt.path, env, timeoutMs: 5 * 60 * 1000 });
      assert.equal(result.outcome, 'ok', result.note);

      // No home override — the real reader against the real ~/.claude/projects transcript.
      const usage = readUsage('claude-code', { session, provider }, result);
      assert.ok(usage, 'expected readUsage to find this run\'s transcript under the real ~/.claude');
      assert.equal(usage.inputTokens, KNOWN_USAGE.promptTokens);
      assert.equal(usage.outputTokens, KNOWN_USAGE.completionTokens);
      assert.equal(usage.totalTokens, KNOWN_USAGE.promptTokens + KNOWN_USAGE.completionTokens);
    } finally {
      try { wt.cleanup(); } catch { /* best-effort */ }
    }
  } finally {
    await mock.close();
  }
});
