/**
 * exit-confirm-e2e — the OFFLINE proof-of-behavior for PR #29 (`fix(gateway): return a
 * non-retryable 403 on a budget deny, not a retryable 429`). #29 was verified against the gateway
 * HTTP contract (gateway/tests/server.test.mjs, gateway/tests/index.test.mjs) but never against a
 * real spawned harness PROCESS — the actual claim (#29's own PR description) is that a capped
 * agent EXITS instead of retry-looping into the launcher's 30-minute kill. Response-shape
 * assertions cannot prove that; only observing a real process's actual exit can.
 *
 * This test spawns the REAL `claude` CLI (not a mock function, not a stub `_spawn`) — the exact
 * binary `launcher.mjs` spawns in production — pointed at a REAL gateway/index.mjs instance (real
 * ledger, real windows.mjs/budget.mjs enforcement math, real HTTP server) via the SAME
 * `applyGatewayInjection` rewrite `launchAgent` uses in production. The ledger is pre-seeded past
 * a tiny cap so the harness's own first real call is denied — the process's exit is then observed
 * directly (exit code, elapsed wall-clock, captured stdout), not asserted against a mocked return.
 *
 * Money/network safety:
 *   - The route's upstreamUrl is a dead address (http://127.0.0.1:1, nothing listens there) — the
 *     SAME "prove upstream is never contacted" trick gateway/tests/server.test.mjs already uses.
 *     A deny never forwards (gateway/server.mjs's enforcement short-circuit), so this is
 *     belt-and-suspenders: even if enforcement regressed, the run would 502, never reach a real
 *     provider.
 *   - `--bare` (harness-adapters.mjs's claudeCodeAdapter, applied automatically for any
 *     non-native-anthropic provider) means the locally-installed `claude` CLI's own OAuth/keychain
 *     login is NEVER read — auth is strictly the injected ANTHROPIC_API_KEY (the gateway's
 *     short-lived per-run token), which the gateway itself accepts on `x-api-key` and never
 *     forwards anywhere upstream on a deny.
 *   - `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` (also automatic for third-party providers)
 *     disables telemetry/update-check network calls, same protection the existing
 *     tests/metering-e2e.test.mjs relies on for its own "no network beyond localhost" claim.
 *   - No `ollama`/`opencode`/`DEEPSEEK_KEY`/`ANTHROPIC_API_KEY` real credential is read or used.
 *
 * Gated behind EXIT_CONFIRM_E2E=1 (spawns a real CLI process — heavier and slower than the
 * deterministic unit suite `npm test` gates in CI) and skipped when `claude` isn't on PATH, same
 * convention as ollama-e2e.test.mjs / metering-e2e.test.mjs / deepseek-e2e.test.mjs.
 *
 * Run it yourself (requires `claude` on PATH — no API keys, no network beyond 127.0.0.1):
 *   EXIT_CONFIRM_E2E=1 node --test tools/aios/tests/exit-confirm-e2e.test.mjs
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assembleGateway } from '../gateway/index.mjs';
import { appendEvent, listEvents } from '../gateway/ledger.mjs';
import { makeTokenEvent } from '../gateway/token-event.mjs';
import { resolveRoute } from '../gateway/provider-registry.mjs';
import { applyGatewayInjection } from '../gateway/inject.mjs';
import { resolveProvider } from '../providers.mjs';
import { buildSpawnPlan } from '../harness-adapters.mjs';
import { spawnAndWait } from '../launcher.mjs';
import { classifyExit } from '../exit-classify.mjs';

const enabled = process.env.EXIT_CONFIRM_E2E === '1';
const AGENT = 'exitconfirmagent';
const KEY_ENV = 'EXITCONFIRM_E2E_KEY';

function isClaudeInstalled() {
  try {
    const r = spawnSync('claude', ['--version'], { encoding: 'utf8', windowsHide: true });
    return !r.error && r.status === 0;
  } catch { return false; }
}
const claudeInstalled = enabled && isClaudeInstalled();

let assembled;
let worktreePath;

before(async () => {
  if (!claudeInstalled) return;
  process.env[KEY_ENV] = 'sk-placeholder-never-sent-to-any-real-provider';

  const policy = {
    // A dead upstream (nothing listens on 127.0.0.1:1) — belt-and-suspenders: a deny never
    // forwards, so this is only ever reached if enforcement itself regressed.
    providers: { anthropic: { baseUrl: 'http://127.0.0.1:1', keyEnv: KEY_ENV } },
    // 1 token, NOT 0 — a literal 0 cap is treated as "no cap" (see gateway/tests/windows.test.mjs's
    // footgun test), so it would never deny. 1 is the smallest cap that actually halts.
    agent_budget: { [AGENT]: { per_5h_tokens: 1, per_week_tokens: 1_000_000 } },
  };

  assembled = await assembleGateway({ policy, tenant: 'pv', ledgerPath: ':memory:', now: Date.now() });

  // Pre-seed the ledger PAST the cap so the harness's very first real call is denied on attempt
  // #1 — checkVerdict compares against PRIOR cumulative usage (windows.mjs), which is 0 for a
  // brand-new agent, so with no seed a fresh agent's first call is always allowed regardless of
  // cap size. This mirrors the real live-dogfood shape too (see scratch/dogfood-29-confirm.md):
  // a truly fresh agent's first call always goes through; the deny fires on the NEXT call.
  appendEvent(assembled.ledger, makeTokenEvent({
    agent: AGENT, tenant: 'pv', session: 'seed-session', requestId: randomUUID(),
    provider: 'anthropic', model: 'claude-sonnet-5', wire: 'anthropic',
    inputTokens: 999_999, outputTokens: 0, totalTokens: 999_999,
    enforcementDecision: 'allow', capWindow: null,
  }));

  worktreePath = mkdtempSync(join(tmpdir(), 'exit-confirm-e2e-'));
});

after(async () => {
  if (assembled) await assembled.close();
  if (worktreePath) rmSync(worktreePath, { recursive: true, force: true });
  delete process.env[KEY_ENV];
});

test('a real claude-code spawn against a denying gateway EXITS non-zero within seconds, not a retry-loop', { skip: !claudeInstalled }, async () => {
  const session = randomUUID(); // claude-code requires --session-id to be a UUID
  const resolvedProvider = resolveProvider('anthropic', { providers: { anthropic: { baseUrl: 'http://127.0.0.1:1', keyEnv: KEY_ENV } } });
  const route = resolveRoute(assembled.store.get(), 'anthropic');
  assert.ok(route, 'expected a resolvable anthropic route in the assembled registry');

  const plan = buildSpawnPlan('claude-code', {
    prompt: 'Reply with exactly: OK',
    model: 'claude-sonnet-5',
    session,
    provider: resolvedProvider,
    worktreePath,
  });

  // The SAME production rewrite launcher.mjs's launchAgent uses (gateway/inject.mjs) — swaps
  // ANTHROPIC_BASE_URL/ANTHROPIC_API_KEY onto the gateway + a fresh per-run token, registered in
  // the gateway's run registry. Not reimplemented here — this is the real function.
  const ctx = {
    tenant: 'pv', agent: AGENT, session, task: 'ZZ-exit-confirm-e2e', runId: session,
    provider: 'anthropic', model: 'claude-sonnet-5', tier: 'medium',
  };
  const injected = applyGatewayInjection({ plan, route, ctx, gatewayUrl: assembled.url, runs: assembled.runs });
  const finalPlan = injected.plan;
  assert.equal(finalPlan.env.ANTHROPIC_BASE_URL, assembled.url, 'the harness must be pointed at the gateway, not the dead upstream');

  const env = { ...process.env, ...finalPlan.env };
  const timeoutMs = 90_000; // WAY under the 30-min real kill — a retry-loop would still be spinning at 90s
  const t0 = Date.now();
  const result = await spawnAndWait(finalPlan.cmd, finalPlan.args, { cwd: worktreePath, env, timeoutMs });
  const elapsedMs = Date.now() - t0;

  // ─── The actual claim: the PROCESS exited, it didn't hang/retry to the timeout ───────────────
  assert.notEqual(result.outcome, 'ok', `expected a failed (denied) run, got ok — note: ${result.note}`);
  assert.notEqual(result.reason, 'timeout', `process did not exit within ${timeoutMs}ms — this IS the retry-loop #29 was meant to prevent. note: ${result.note}`);
  // A generous bound: a genuine single-call deny should resolve in low single-digit seconds
  // (process start + one localhost round-trip + shutdown). A blown budget of 30s catches any
  // reintroduced backoff/retry without being flaky on a slow CI box.
  assert.ok(elapsedMs < 30_000, `expected a fast clean exit, took ${elapsedMs}ms — note: ${result.note}`);

  // ─── The response actually reached the harness (not some unrelated failure) ──────────────────
  const blob = `${result.stdout}\n${result.stderr}`;
  assert.match(blob, /403/, `expected the 403 to surface in the harness's own output — note: ${result.note}`);
  assert.match(blob, /over budget/i, `expected the gateway's deny message to surface verbatim — note: ${result.note}`);

  // ─── exit-classify.mjs must label this DISTINCTLY (item 3: not a crash, not a timeout) ──────
  const classified = classifyExit({ code: null, stdout: result.stdout, stderr: result.stderr, timedOut: false });
  assert.equal(classified.reason, 'budget', `expected classifyExit to recognize the real captured output as a budget deny, got '${classified.reason}'`);
  assert.notEqual(classified.reason, 'nonzero');
  assert.notEqual(classified.reason, 'timeout');

  // ─── Metering reality: exactly one deny event landed in the ledger for this run ──────────────
  const events = listEvents(assembled.ledger, { tenant: 'pv', agent: AGENT }).filter((e) => e.session === session);
  assert.equal(events.length, 1, 'expected exactly one token-event for this run\'s session');
  assert.equal(events[0].enforcementDecision, 'deny');
  assert.equal(events[0].capWindow, '5h');
  assert.equal(events[0].upstreamStatus, null, 'a deny must never reach the (dead) upstream, so upstreamStatus stays unknown');
});
