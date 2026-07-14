import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { HARNESS_ADAPTERS, resolveHarness, buildSpawnPlan } from '../harness-adapters.mjs';
import { resolveProvider } from '../providers.mjs';
import { launchAgent } from '../launcher.mjs';
import { agentEnv } from '../worktree.mjs';
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

const tmpRoot = makeTempRepo('aios-itest-ha-');
const cfg = resolvePaths({ root: tmpRoot, domain: FIXTURE_DOMAIN }); // named `cfg`, not `config` — a couple of tests below use a local
// `config` for an unrelated JSON.parse() result and shadowing it would be confusing.

// Tear down: remove the worktreeRoot first (it lives outside tmpRoot as a sibling),
// then the temp repo itself.
after(() => {
  rmSync(cfg.worktreeRoot, { recursive: true, force: true });
  rmSync(tmpRoot, { recursive: true, force: true });
});

const anthropic = () => resolveProvider('anthropic', {});
const deepseek = () => resolveProvider('deepseek', {});
const openrouter = () => resolveProvider('openrouter', {});

function withEnv(key, value, fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, key);
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    return fn();
  } finally {
    if (had) process.env[key] = prev;
    else delete process.env[key];
  }
}

// ─── claude-code adapter ────────────────────────────────────────────────────

test('claude-code + native anthropic provider: no ANTHROPIC_* env, no --bare, args match the CLI flags', () => {
  const plan = buildSpawnPlan('claude-code', { prompt: 'do stuff', model: 'claude-opus-4-8', session: 'sess-123', provider: anthropic() });
  assert.equal(plan.cmd, 'claude');
  assert.ok(plan.args.includes('-p'));
  assert.ok(plan.args.includes('do stuff'));
  assert.ok(plan.args.includes('--permission-mode'));
  assert.ok(plan.args.includes('auto'));
  assert.ok(plan.args.includes('--model'));
  assert.ok(plan.args.includes('claude-opus-4-8'));
  assert.ok(plan.args.includes('--session-id'));
  assert.ok(plan.args.includes('sess-123'));
  assert.ok(!plan.args.includes('--bare'), 'native anthropic must stay byte-identical to pre-harness behavior');
  assert.deepEqual(plan.env, {});
  assert.deepEqual(plan.files, []);
});

test('claude-code + native anthropic provider ignores a passed tier (byte-parity holds even then)', () => {
  const plan = buildSpawnPlan('claude-code', { prompt: 'x', provider: anthropic(), tier: 'critical' });
  assert.deepEqual(plan.env, {});
  assert.ok(!plan.args.includes('--bare'));
});

test('claude-code + deepseek: resolves the /anthropic endpoint, reads the BYO key via ANTHROPIC_API_KEY, and passes --bare', () => {
  withEnv('DEEPSEEK_KEY', 'sk-test-123', () => {
    const plan = buildSpawnPlan('claude-code', { prompt: 'x', provider: deepseek() });
    assert.equal(plan.env.ANTHROPIC_BASE_URL, 'https://api.deepseek.com/anthropic');
    assert.equal(plan.env.ANTHROPIC_API_KEY, 'sk-test-123');
    assert.equal(plan.env.ANTHROPIC_AUTH_TOKEN, undefined, 'ANTHROPIC_AUTH_TOKEN is not read in --bare mode; only ANTHROPIC_API_KEY is');
    // --bare forces strict ANTHROPIC_API_KEY auth (OAuth/keychain never read) — without it, an
    // operator with an active `claude login` session silently authenticates with their OWN
    // Claude.ai OAuth token instead of the injected third-party key (verified live against
    // DeepSeek in 1.5 — the request reached the right endpoint but auth used the wrong identity).
    assert.ok(plan.args.includes('--bare'));
  });
});

test('claude-code + deepseek: remaps all three model tiers so internal Claude Code calls never fall back to paid Anthropic', () => {
  withEnv('DEEPSEEK_KEY', 'sk-test-123', () => {
    const plan = buildSpawnPlan('claude-code', { prompt: 'x', provider: deepseek() });
    assert.equal(plan.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'deepseek-chat');
    assert.equal(plan.env.ANTHROPIC_DEFAULT_SONNET_MODEL, 'deepseek-chat');
    assert.equal(plan.env.ANTHROPIC_DEFAULT_OPUS_MODEL, 'deepseek-reasoner');
  });
});

test('claude-code + deepseek: disables nonessential traffic (telemetry/auto-update) on headless runs', () => {
  withEnv('DEEPSEEK_KEY', 'sk-test-123', () => {
    const plan = buildSpawnPlan('claude-code', { prompt: 'x', provider: deepseek() });
    assert.equal(plan.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, '1');
  });
});

test('claude-code + deepseek: no tier given means no CLAUDE_CODE_EFFORT_LEVEL is set', () => {
  withEnv('DEEPSEEK_KEY', 'sk-test-123', () => {
    const plan = buildSpawnPlan('claude-code', { prompt: 'x', provider: deepseek() });
    assert.equal(plan.env.CLAUDE_CODE_EFFORT_LEVEL, undefined);
  });
});

test('claude-code + deepseek: tier maps to CLAUDE_CODE_EFFORT_LEVEL (simple->low ... critical->max)', () => {
  withEnv('DEEPSEEK_KEY', 'sk-test-123', () => {
    const expected = { simple: 'low', medium: 'medium', medium_high: 'high', complex: 'xhigh', critical: 'max' };
    for (const [tier, effort] of Object.entries(expected)) {
      const plan = buildSpawnPlan('claude-code', { prompt: 'x', provider: deepseek(), tier });
      assert.equal(plan.env.CLAUDE_CODE_EFFORT_LEVEL, effort, `tier '${tier}' should map to effort '${effort}'`);
    }
  });
});

test('claude-code + a provider with no Anthropic-format endpoint throws', () => {
  assert.throws(
    () => buildSpawnPlan('claude-code', { prompt: 'x', provider: openrouter() }),
    /no Anthropic-format endpoint/,
  );
});

test('claude-code + deepseek with the key env unset throws', () => {
  withEnv('DEEPSEEK_KEY', undefined, () => {
    assert.throws(
      () => buildSpawnPlan('claude-code', { prompt: 'x', provider: deepseek() }),
      /key env/,
    );
  });
});

// ─── antigravity adapter (parity with the old hardcoded branch) ────────────

test('antigravity adapter returns correct CLI flags', () => {
  const plan = buildSpawnPlan('antigravity', { prompt: 'design it', model: 'gemini-3-pro' });
  assert.equal(plan.cmd, 'agy');
  assert.ok(plan.args.includes('-p'));
  assert.ok(plan.args.includes('design it'));
  assert.ok(plan.args.includes('--dangerously-skip-permissions'));
  assert.ok(plan.args.includes('--print-timeout'));
  assert.ok(plan.args.includes('30m'));
  assert.ok(plan.args.includes('--model'));
  assert.ok(plan.args.includes('gemini-3-pro'));
  assert.ok(!plan.args.includes('--session-id'), 'agy takes --conversation, not --session-id');
  assert.deepEqual(plan.env, {});
});

test('antigravity adapter uses --conversation for session and omits --model when null', () => {
  const plan = buildSpawnPlan('antigravity', { prompt: 'test', model: null, session: 'conv-1' });
  assert.ok(!plan.args.includes('--model'));
  assert.ok(plan.args.includes('--conversation'));
  assert.ok(plan.args.includes('conv-1'));
});

// ─── registry / resolution ──────────────────────────────────────────────────

test('HARNESS_ADAPTERS exposes exactly claude-code, antigravity, and opencode', () => {
  assert.deepEqual(Object.keys(HARNESS_ADAPTERS).sort(), ['antigravity', 'claude-code', 'opencode']);
});

test('resolveHarness throws for an unknown harness name', () => {
  assert.throws(() => resolveHarness('aider'), /unknown harness/);
});

// ─── opencode adapter ───────────────────────────────────────────────────────

test('opencode + deepseek: writes opencode.json with baseURL/apiKey interpolation/model, and correct args', () => {
  const plan = buildSpawnPlan('opencode', { prompt: 'do stuff', model: 'deepseek-chat', provider: deepseek() });
  assert.equal(plan.cmd, 'opencode');
  assert.ok(plan.args.includes('run'));
  assert.ok(plan.args.includes('do stuff'));
  assert.ok(plan.args.includes('--model'));
  assert.ok(plan.args.includes('deepseek/deepseek-chat'));
  assert.ok(plan.args.includes('--auto'));
  assert.deepEqual(plan.env, {});

  assert.equal(plan.files.length, 1);
  const [file] = plan.files;
  assert.equal(file.path, 'opencode.json');
  const config = JSON.parse(file.content);
  assert.equal(config.$schema, 'https://opencode.ai/config.json');
  assert.equal(config.provider.deepseek.npm, '@ai-sdk/openai-compatible');
  assert.equal(config.provider.deepseek.options.baseURL, 'https://api.deepseek.com');
  assert.equal(config.provider.deepseek.options.apiKey, '{env:DEEPSEEK_KEY}');
  assert.ok(Object.prototype.hasOwnProperty.call(config.provider.deepseek.models, 'deepseek-chat'));
});

test('opencode + openrouter: writes opencode.json for the openrouter endpoint', () => {
  const plan = buildSpawnPlan('opencode', { prompt: 'x', model: 'openrouter/auto', provider: openrouter() });
  assert.ok(plan.args.includes('openrouter/openrouter/auto'));
  const config = JSON.parse(plan.files[0].content);
  assert.equal(config.provider.openrouter.options.baseURL, 'https://openrouter.ai/api/v1');
  assert.equal(config.provider.openrouter.options.apiKey, '{env:OPENROUTER_KEY}');
  assert.ok(Object.prototype.hasOwnProperty.call(config.provider.openrouter.models, 'openrouter/auto'));
});

test('opencode falls back to the provider\'s medium-tier model when none is given', () => {
  const plan = buildSpawnPlan('opencode', { prompt: 'x', provider: deepseek() });
  assert.ok(plan.args.includes('deepseek/deepseek-chat'));
});

test('opencode pins env.PWD to worktreePath when given (opencode trusts inherited PWD over its real cwd)', () => {
  const plan = buildSpawnPlan('opencode', { prompt: 'x', provider: deepseek(), worktreePath: '/some/worktree/path' });
  assert.deepEqual(plan.env, { PWD: '/some/worktree/path' });
});

test('opencode omits env.PWD when no worktreePath is given', () => {
  const plan = buildSpawnPlan('opencode', { prompt: 'x', provider: deepseek() });
  assert.deepEqual(plan.env, {});
});

test('opencode + native anthropic provider throws', () => {
  assert.throws(
    () => buildSpawnPlan('opencode', { prompt: 'x', provider: anthropic() }),
    /native Anthropic login is claude-code only/,
  );
});

test('opencode + a provider with no OpenAI-format endpoint throws', () => {
  const anthropicWire = { ...anthropic(), baseUrl: 'https://example.com', wire: 'anthropic', keyEnv: 'X' };
  assert.throws(
    () => buildSpawnPlan('opencode', { prompt: 'x', provider: anthropicWire }),
    /no OpenAI-format endpoint/,
  );
});

// ─── launchAgent parity: default path is byte-identical to before harnesses were pluggable ──
// No `inGitRepo` guard needed — the hermetic temp repo always exists.

test('launchAgent default path (no provider/harness given) spawns claude with no ANTHROPIC_* env', async () => {
  let captured = null;
  const fakeSpawn = async (cmd, args, opts) => {
    captured = { cmd, args, opts };
    return { outcome: 'ok', note: 'stubbed' };
  };
  const session = 'itest' + Math.random().toString(36).slice(2, 6);
  const task = { id: 'ZZ-harness-itest', title: 'parity check', status: 'ready-for-impl' };
  const result = await launchAgent({ agent: 'claude', model: 'claude-opus-4-8', task, session, _spawn: fakeSpawn, config: cfg });

  assert.equal(result.outcome, 'ok');
  assert.equal(captured.cmd, 'claude');
  assert.ok(captured.args.includes('-p'));
  assert.ok(captured.args.includes('--permission-mode'));
  assert.ok(captured.args.includes('--model'));
  assert.ok(captured.args.includes('claude-opus-4-8'));
  assert.ok(captured.args.includes('--session-id'));
  assert.ok(captured.args.includes(session));
  // The native anthropic provider injects nothing (env: {}) — the spawn env must be byte-identical
  // to plain agentEnv(process.env, {}, cfg), exactly as it was before harnesses/providers existed. (Not asserting the
  // ANTHROPIC_* keys are absent: a real dev shell may already export them for its own CLI login —
  // that's inherited via agentEnv(process.env, {}, cfg)'s process.env spread today AND before this change, so it's not
  // a regression to check for here.)
  assert.deepEqual(captured.opts.env, agentEnv(process.env, {}, cfg));
});

test('launchAgent maps agent "antigravity" to the antigravity harness by default', async () => {
  let captured = null;
  const fakeSpawn = async (cmd, args, opts) => {
    captured = { cmd, args, opts };
    return { outcome: 'ok', note: 'stubbed' };
  };
  const session = 'itest' + Math.random().toString(36).slice(2, 6);
  const task = { id: 'ZZ-harness-itest-agy', title: 'parity check', status: 'ready-for-impl' };
  await launchAgent({ agent: 'antigravity', model: 'gemini-3-pro', task, session, _spawn: fakeSpawn, config: cfg });

  assert.equal(captured.cmd, 'agy');
  assert.ok(captured.args.includes('--dangerously-skip-permissions'));
  assert.ok(captured.args.includes('--conversation'));
});

test('launchAgent wires a third-party provider through an explicit harness', async () => {
  let captured = null;
  const fakeSpawn = async (cmd, args, opts) => {
    captured = { cmd, args, opts };
    return { outcome: 'ok', note: 'stubbed' };
  };
  const session = 'itest' + Math.random().toString(36).slice(2, 6);
  const task = { id: 'ZZ-harness-itest-ds', title: 'parity check', status: 'ready-for-impl' };
  const hadKey = Object.prototype.hasOwnProperty.call(process.env, 'DEEPSEEK_KEY');
  const prevKey = process.env.DEEPSEEK_KEY;
  process.env.DEEPSEEK_KEY = 'sk-test-456';
  try {
    await launchAgent({ agent: 'claude', task, session, provider: deepseek(), harness: 'claude-code', tier: 'complex', _spawn: fakeSpawn, config: cfg });
  } finally {
    if (hadKey) process.env.DEEPSEEK_KEY = prevKey;
    else delete process.env.DEEPSEEK_KEY;
  }

  assert.equal(captured.opts.env.ANTHROPIC_BASE_URL, 'https://api.deepseek.com/anthropic');
  assert.equal(captured.opts.env.ANTHROPIC_API_KEY, 'sk-test-456');
  assert.ok(captured.args.includes('--bare'));
  assert.equal(captured.opts.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'deepseek-chat');
  assert.equal(captured.opts.env.ANTHROPIC_DEFAULT_SONNET_MODEL, 'deepseek-chat');
  assert.equal(captured.opts.env.ANTHROPIC_DEFAULT_OPUS_MODEL, 'deepseek-reasoner');
  assert.equal(captured.opts.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, '1');
  assert.equal(captured.opts.env.CLAUDE_CODE_EFFORT_LEVEL, 'xhigh', "tier 'complex' -> effort 'xhigh'");
});

test('launchAgent selects the opencode harness and writes opencode.json into the worktree', async () => {
  let captured = null;
  const fakeSpawn = async (cmd, args, opts) => {
    // The worktree is torn down in launchAgent's `finally`, so read the config file here,
    // before _spawn returns, to prove writePlanFile ran against the real worktree path.
    captured = { cmd, args, opts, configContent: readFileSync(join(opts.cwd, 'opencode.json'), 'utf8') };
    return { outcome: 'ok', note: 'stubbed' };
  };
  const session = 'itest' + Math.random().toString(36).slice(2, 6);
  const task = { id: 'ZZ-harness-itest-oc', title: 'parity check', status: 'ready-for-impl' };
  const hadKey = Object.prototype.hasOwnProperty.call(process.env, 'DEEPSEEK_KEY');
  const prevKey = process.env.DEEPSEEK_KEY;
  process.env.DEEPSEEK_KEY = 'sk-test-789';
  let expectedEnv;
  try {
    await launchAgent({ agent: 'claude', task, session, provider: deepseek(), harness: 'opencode', _spawn: fakeSpawn, config: cfg });
    // Snapshot agentEnv(process.env, {}, cfg) here, before restoring DEEPSEEK_KEY below, so it matches what
    // launchAgent actually saw at spawn time.
    expectedEnv = agentEnv(process.env, {}, cfg);
  } finally {
    if (hadKey) process.env.DEEPSEEK_KEY = prevKey;
    else delete process.env.DEEPSEEK_KEY;
  }

  assert.equal(captured.cmd, 'opencode');
  assert.ok(captured.args.includes('run'));
  assert.ok(captured.args.includes('--auto'));
  // env.PWD is deliberately overridden to the worktree path (see opencodeAdapter's doc comment) —
  // compare everything except PWD against agentEnv(process.env, {}, cfg) baseline; PWD is
  // asserted separately against cwd. We exclude PWD from the deepEqual because on Windows
  // process.env.PWD is absent, so spreading `PWD: undefined` creates an explicit key that
  // deepStrictEqual treats differently from the key being absent in the baseline.
  const { PWD: _actualPwd, ...envWithoutPwd } = captured.opts.env;
  const { PWD: _basePwd, ...baseWithoutPwd } = expectedEnv;
  assert.deepEqual(envWithoutPwd, baseWithoutPwd);
  assert.equal(captured.opts.env.PWD, captured.opts.cwd);
  const config = JSON.parse(captured.configContent);
  assert.equal(config.provider.deepseek.options.apiKey, '{env:DEEPSEEK_KEY}');
});

// ─── launchAgent gateway wiring (3.2d, opt-in, locked decision D4) ─────────
// A stub run-registry that records call order (register/unregister) alongside a stub _spawn so
// tests can assert "registered BEFORE spawn, unregistered AFTER" without a real gateway process.

function makeStubRuns() {
  const calls = [];
  const store = new Map();
  return {
    calls,
    registerRun(token, ctx) { calls.push({ op: 'register', token }); store.set(token, ctx); },
    resolveRun(token) { return store.get(token) ?? null; },
    unregisterRun(token) { calls.push({ op: 'unregister', token }); store.delete(token); },
  };
}

test('launchAgent injects the gateway when config.gateway.enabled=true and the provider has an anthropic-wire route', async () => {
  let captured = null;
  const runs = makeStubRuns();
  const fakeSpawn = async (cmd, args, opts) => {
    runs.calls.push({ op: 'spawn' });
    captured = { cmd, args, opts };
    return { outcome: 'ok', note: 'stubbed' };
  };
  // A stub registry naming a route for 'deepseek' as an anthropic-wire route (the shape a real
  // registry would carry for a BYO-key provider reached through the claude-code/anthropic-wire
  // harness) — only `route.wire` is read by the launcher's gating logic; the real upstream
  // resolution happens server-side in the gateway itself, not here.
  const registry = { tenant: 'pv', routes: { deepseek: { upstreamUrl: 'https://api.deepseek.com/anthropic', wire: 'anthropic', keyEnv: 'DEEPSEEK_KEY' } } };
  const gwConfig = { enabled: true, url: 'http://127.0.0.1:1234', runs, registry };
  const cfgWithGateway = { ...cfg, gateway: gwConfig };

  const session = 'itest' + Math.random().toString(36).slice(2, 6);
  const task = { id: 'ZZ-harness-itest-gw', title: 'gateway wiring', status: 'ready-for-impl' };
  const hadKey = Object.prototype.hasOwnProperty.call(process.env, 'DEEPSEEK_KEY');
  const prevKey = process.env.DEEPSEEK_KEY;
  process.env.DEEPSEEK_KEY = 'sk-real-should-never-reach-spawn-env';
  try {
    await launchAgent({ agent: 'claude', task, session, provider: deepseek(), harness: 'claude-code', _spawn: fakeSpawn, config: cfgWithGateway });
  } finally {
    if (hadKey) process.env.DEEPSEEK_KEY = prevKey;
    else delete process.env.DEEPSEEK_KEY;
  }

  // The spawn env talks to the gateway, not the real upstream, and carries a MINTED token, never
  // the real key.
  assert.equal(captured.opts.env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:1234');
  assert.notEqual(captured.opts.env.ANTHROPIC_API_KEY, 'sk-real-should-never-reach-spawn-env');
  assert.equal(typeof captured.opts.env.ANTHROPIC_API_KEY, 'string');
  assert.ok(captured.opts.env.ANTHROPIC_API_KEY.length > 0);
  // Everything else the claude-code adapter set (model-tier remaps, --bare, etc.) is preserved.
  assert.ok(captured.args.includes('--bare'));
  assert.equal(captured.opts.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'deepseek-chat');
  assert.equal(captured.opts.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, '1');

  // The run was registered BEFORE the spawn and unregistered AFTER it, with the same token both
  // times — never leaked past this run.
  assert.equal(runs.calls.length, 3);
  assert.equal(runs.calls[0].op, 'register');
  assert.equal(runs.calls[1].op, 'spawn');
  assert.equal(runs.calls[2].op, 'unregister');
  assert.equal(runs.calls[0].token, runs.calls[2].token);
  assert.equal(runs.calls[0].token, captured.opts.env.ANTHROPIC_API_KEY);
  // resolveRun no longer finds it post-run.
  assert.equal(runs.resolveRun(runs.calls[0].token), null);
});

test('launchAgent leaves a provider with no route (native anthropic) alone even when the gateway is enabled', async () => {
  let captured = null;
  const runs = makeStubRuns();
  const fakeSpawn = async (cmd, args, opts) => { captured = { cmd, args, opts }; return { outcome: 'ok', note: 'stubbed' }; };
  // No 'anthropic' entry in routes — mirrors the real setup where the native CLI-login provider
  // has no BYO key and so no gateway route is generated for it.
  const registry = { tenant: 'pv', routes: {} };
  const gwConfig = { enabled: true, url: 'http://127.0.0.1:1234', runs, registry };
  const session = 'itest' + Math.random().toString(36).slice(2, 6);
  const task = { id: 'ZZ-harness-itest-gw-native', title: 'gateway wiring native bypass', status: 'ready-for-impl' };

  await launchAgent({ agent: 'claude', model: 'claude-opus-4-8', task, session, _spawn: fakeSpawn, config: { ...cfg, gateway: gwConfig } });

  assert.deepEqual(captured.opts.env, agentEnv(process.env, {}, cfg));
  assert.equal(runs.calls.length, 0, 'no route ⇒ no injection ⇒ nothing registered/unregistered');
});

test('launchAgent leaves an openai-wire route alone even when the gateway is enabled (openai/opencode follow-up, 3.2d-ii)', async () => {
  let captured = null;
  const runs = makeStubRuns();
  const fakeSpawn = async (cmd, args, opts) => {
    captured = { cmd, args, opts, configContent: readFileSync(join(opts.cwd, 'opencode.json'), 'utf8') };
    return { outcome: 'ok', note: 'stubbed' };
  };
  const registry = { tenant: 'pv', routes: { deepseek: { upstreamUrl: 'https://api.deepseek.com', wire: 'openai', keyEnv: 'DEEPSEEK_KEY' } } };
  const gwConfig = { enabled: true, url: 'http://127.0.0.1:1234', runs, registry };
  const session = 'itest' + Math.random().toString(36).slice(2, 6);
  const task = { id: 'ZZ-harness-itest-gw-openai', title: 'gateway wiring openai bypass', status: 'ready-for-impl' };
  const hadKey = Object.prototype.hasOwnProperty.call(process.env, 'DEEPSEEK_KEY');
  const prevKey = process.env.DEEPSEEK_KEY;
  process.env.DEEPSEEK_KEY = 'sk-test-opencode-gw';
  try {
    await launchAgent({ agent: 'claude', task, session, provider: deepseek(), harness: 'opencode', _spawn: fakeSpawn, config: { ...cfg, gateway: gwConfig } });
  } finally {
    if (hadKey) process.env.DEEPSEEK_KEY = prevKey;
    else delete process.env.DEEPSEEK_KEY;
  }

  assert.equal(runs.calls.length, 0, 'openai wire is out of scope for 3.2d — left untouched');
  const config = JSON.parse(captured.configContent);
  assert.equal(config.provider.deepseek.options.apiKey, '{env:DEEPSEEK_KEY}', 'opencode.json still references the real BYO key literally, unrewritten');
});

test('launchAgent is byte-identical to the no-gateway path when config.gateway is entirely absent', async () => {
  let capturedWithout = null;
  let capturedAbsent = null;
  const spawnCapture = (slot) => async (cmd, args, opts) => { slot.value = { cmd, args, opts }; return { outcome: 'ok', note: 'stubbed' }; };

  const withoutSlot = {}; const absentSlot = {};
  const sessionA = 'itest' + Math.random().toString(36).slice(2, 6);
  const sessionB = 'itest' + Math.random().toString(36).slice(2, 6);
  const taskA = { id: 'ZZ-harness-itest-gw-absent-a', title: 'no gateway key at all', status: 'ready-for-impl' };
  const taskB = { id: 'ZZ-harness-itest-gw-absent-b', title: 'gateway key present but disabled', status: 'ready-for-impl' };

  // (a) config has no `gateway` key whatsoever.
  await launchAgent({ agent: 'claude', model: 'claude-opus-4-8', task: taskA, session: sessionA, _spawn: spawnCapture(withoutSlot), config: cfg });
  capturedWithout = withoutSlot.value;

  // (b) config.gateway is present but enabled: false (with an otherwise-live-looking registry).
  const runs = makeStubRuns();
  const disabledGwConfig = { enabled: false, url: 'http://127.0.0.1:1234', runs, registry: { tenant: 'pv', routes: { anthropic: { upstreamUrl: 'https://x', wire: 'anthropic', keyEnv: null } } } };
  await launchAgent({ agent: 'claude', model: 'claude-opus-4-8', task: taskB, session: sessionB, _spawn: spawnCapture(absentSlot), config: { ...cfg, gateway: disabledGwConfig } });
  capturedAbsent = absentSlot.value;

  const baselineEnv = agentEnv(process.env, {}, cfg);
  assert.deepEqual(capturedWithout.opts.env, baselineEnv);
  assert.deepEqual(capturedAbsent.opts.env, baselineEnv);
  assert.deepEqual(capturedWithout.opts.env, capturedAbsent.opts.env);
  assert.equal(runs.calls.length, 0, 'gateway disabled ⇒ no registration ever happens, even with a live-looking registry');
});

// ─── launchAgent post-hoc usage capture (1.6) ───────────────────────────────

test('launchAgent attaches tokens=null/usage=null when the harness genuinely has no usage recorded yet (never fabricated)', async () => {
  const fakeSpawn = async () => ({ outcome: 'ok', note: 'stubbed' });
  const session = 'itest-usage-' + Math.random().toString(36).slice(2, 8); // guaranteed not to exist in ~/.claude
  const task = { id: 'ZZ-harness-itest-usage', title: 'usage capture parity', status: 'ready-for-impl' };
  const result = await launchAgent({ agent: 'claude', model: 'claude-opus-4-8', task, session, _spawn: fakeSpawn, config: cfg });

  assert.equal(result.outcome, 'ok');
  assert.equal(result.tokens, null);
  assert.equal(result.usage, null);
});
