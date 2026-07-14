/**
 * harness-adapters — makes the agent CLI (the "harness") swappable. Each adapter turns a
 * normalized run into a spawn plan: `{ cmd, args, env, files }`.
 *
 * Normalized run input: `{ prompt, model, session, provider, worktreePath, tier }`, where
 * `provider` is a resolved descriptor from providers.mjs (see providers.mjs's `resolveProvider`)
 * and `tier` is the task's complexity tier from model-router.mjs's `routeModel()` (`simple` |
 * `medium` | `medium_high` | `complex` | `critical`) — optional; adapters that don't use it
 * ignore it.
 *
 * `env` is the harness/provider-specific ADDITIONS only — the caller merges it over
 * `agentEnv()`, it does not replace it. `files` is `[{path, content}]` config to write into the
 * worktree before spawning (empty for the two adapters here).
 *
 * This module owns every hardcoded harness CLI invocation — nothing outside it should shell out
 * to `claude`, `agy`, or `opencode` directly.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

// claude-code's own complexity/effort scale (--effort / CLAUDE_CODE_EFFORT_LEVEL), in the same
// ascending order as model-router.mjs's TIERS — duplicated rather than imported: this stays a
// pure spawn-side module and must not import the decision-side model-router.mjs.
const TIER_TO_EFFORT = { simple: 'low', medium: 'medium', medium_high: 'high', complex: 'xhigh', critical: 'max' };

/**
 * claude-code — the Claude Code CLI. Args are unchanged from the original hardcoded branch for
 * the native-anthropic path (byte-parity).
 *
 * Provider wiring: Claude Code only understands an Anthropic-format API (`ANTHROPIC_BASE_URL` +
 * an API key). The native anthropic provider (`baseUrl: null, keyEnv: null`) means "use the
 * CLI's own login" — inject nothing, preserving today's exact behavior. Any other provider must
 * expose an Anthropic-format endpoint (`anthropicBaseUrl`, or `baseUrl` itself when
 * `wire === 'anthropic'`) and a BYO key read from `process.env[provider.keyEnv]`.
 *
 * `--bare` (third-party only): verified empirically (1.5, live DeepSeek run) that without it, a
 * CLI with an active `claude login` OAuth session silently authenticates with the STORED OAuth
 * token instead of the injected key — `ANTHROPIC_BASE_URL` is honored (the request really does go
 * to the third-party endpoint) but auth still uses the operator's own Claude.ai session, which
 * that endpoint then rejects. `--bare` is documented as the only mode where "Anthropic auth is
 * strictly ANTHROPIC_API_KEY ... OAuth and keychain are never read" — and only `ANTHROPIC_API_KEY`
 * (not `ANTHROPIC_AUTH_TOKEN`) is honored in that mode. This matters for EVERY real operator, not
 * just this proof: any founder/dev who has ever run `claude login` (the normal state) would hit
 * this same silent-fallback on the live daemon. `--bare` also disables hooks/LSP/plugin
 * sync/auto-memory/CLAUDE.md auto-discovery — acceptable here because `launchAgent`'s
 * `buildPrompt` already inlines "Follow .ai/constitution.md" as an explicit prompt rule rather
 * than relying on auto-discovery. Native anthropic is unaffected (byte-parity preserved).
 *
 * Third-party hardening (`ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL`): `--model`/`ANTHROPIC_API_KEY`
 * only override the SESSION's top-level model — Claude Code can still make internal calls against
 * its own named model tiers (subagent spawns, cheap internal operations) that, left unmapped,
 * resolve to Anthropic's OWN model names and silently hit paid Anthropic even on a DeepSeek-routed
 * session (the same silent-fallback class of bug `--bare` fixes above, one layer deeper). Setting
 * all three tiers to the provider's own per-tier models closes that off completely. Mirrors this
 * provider's own simple/medium/complex tiers (haiku≈simple, sonnet≈medium, opus≈complex) rather
 * than collapsing every tier onto the single top-level model, so internal cheap-tier calls still
 * route to the provider's own cheap-tier model.
 *
 * `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`: disables telemetry/Sentry/feedback/auto-update
 * checks — hygiene for unattended headless runs, third-party-scoped for now (see below).
 *
 * `CLAUDE_CODE_EFFORT_LEVEL`: only set when the caller passes a `tier` (optional — most call
 * sites, including every existing test, don't), mapped via `TIER_TO_EFFORT`.
 *
 * All of the above are scoped to third-party providers only, deliberately: this keeps every new
 * behavior confined to the BYO-key/cost-governance path this system exists for, and leaves the
 * live daemon's native-Anthropic behavior (and its byte-parity test) untouched — a separate,
 * deliberate decision if ever wanted there too.
 */
function claudeCodeAdapter({ prompt, model, session, provider, tier, mcpConfigPath }) {
  const isNativeAnthropic = provider?.baseUrl === null && provider?.keyEnv === null;
  const args = ['-p', prompt, '--permission-mode', 'auto'];
  if (model)         args.push('--model', model);
  if (session)       args.push('--session-id', session);
  if (!isNativeAnthropic) args.push('--bare');
  // G3: MCP config is written into the worktree by launchAgent for spec/designing stages.
  // Pass --mcp-config only when present so impl-stage runs are byte-identical to before.
  if (mcpConfigPath) args.push('--mcp-config', mcpConfigPath);
  return { cmd: 'claude', args, env: claudeCodeEnv(provider, isNativeAnthropic, tier), files: [] };
}

function claudeCodeEnv(provider, isNativeAnthropic, tier) {
  if (isNativeAnthropic) return {};

  const url = provider?.anthropicBaseUrl ?? (provider?.wire === 'anthropic' ? provider.baseUrl : null);
  if (!url) {
    throw new Error(`provider '${provider?.name}' has no Anthropic-format endpoint; not usable with the claude-code harness`);
  }
  const key = provider.keyEnv ? process.env[provider.keyEnv] : undefined;
  if (!key) {
    throw new Error(`provider '${provider.name}' key env '${provider.keyEnv}' is not set`);
  }
  const env = {
    ANTHROPIC_BASE_URL: url,
    ANTHROPIC_API_KEY: key,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: provider.models.simple,
    ANTHROPIC_DEFAULT_SONNET_MODEL: provider.models.medium,
    ANTHROPIC_DEFAULT_OPUS_MODEL: provider.models.complex,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  };
  const effort = tier ? TIER_TO_EFFORT[tier] : undefined;
  if (effort) env.CLAUDE_CODE_EFFORT_LEVEL = effort;
  return env;
}

/**
 * antigravity — the Antigravity CLI. Args are an exact migration of the original hardcoded
 * branch (parity, no behavior change). Antigravity doesn't take a `--session-id` flag; it takes
 * `--conversation` instead.
 */
function antigravityAdapter({ prompt, model, session, mcpConfigPath }) {
  const args = ['-p', prompt, '--dangerously-skip-permissions', '--print-timeout', '30m'];
  if (model)         args.push('--model', model);
  if (session)       args.push('--conversation', session);
  // G3: same MCP wiring as claude-code — agy also accepts --mcp-config for server connections.
  if (mcpConfigPath) args.push('--mcp-config', mcpConfigPath);
  return { cmd: 'agy', args, env: {}, files: [] };
}

/**
 * opencode installs as an npm-generated shim on Windows (`opencode.cmd`/`opencode.ps1`), not a
 * plain `.exe` like claude/agy. Node refuses to spawn `.cmd` directly without `shell: true`
 * (EINVAL — hardening from CVE-2024-27980), and `shell: true` routes through cmd.exe, which
 * interprets `&|<>^%` etc. in ANY argument — including the prompt, which is task-authored text we
 * don't fully control — as shell metacharacters; Node's shell-mode quoting does not escape them,
 * so that path is a command-injection hole. Instead we resolve past the shim to the real compiled
 * binary it wraps (`node_modules/opencode-ai/bin/opencode.exe`, colocated with the shim per npm's
 * standard global-install layout — see the .cmd shim's own `%dp0%\node_modules\...` line) and
 * spawn that directly: no shell, no metacharacter interpretation, same as claude.exe/agy.exe.
 * POSIX opencode installs are a real executable already, so this is a no-op there.
 *
 * Deliberately NOT called from `opencodeAdapter`/`buildSpawnPlan` — that must stay a pure,
 * deterministic function of its input (testable with no opencode install, on any OS). The launcher
 * calls this itself, right before a REAL spawn, so it never runs under a stubbed `_spawn` in tests.
 */
export function resolveOpencodeCmd() {
  if (process.platform !== 'win32') {
    const check = spawnSync('opencode', ['--version'], { encoding: 'utf8' });
    if (check.error || check.status !== 0) {
      throw new Error('opencode is not installed (opencode --version failed)');
    }
    return 'opencode';
  }
  const where = spawnSync('where', ['opencode.cmd'], { encoding: 'utf8' });
  const shimPath = where.status === 0 ? where.stdout.split(/\r?\n/)[0].trim() : null;
  if (shimPath) {
    const exePath = join(dirname(shimPath), 'node_modules', 'opencode-ai', 'bin', 'opencode.exe');
    if (existsSync(exePath)) return exePath;
  }
  throw new Error('opencode is not installed (could not resolve opencode.cmd -> opencode.exe on Windows)');
}

/**
 * opencode — the OpenCode CLI. Only usable with providers that expose a concrete OpenAI-format
 * endpoint (`wire: 'openai'`, a real `baseUrl` + `keyEnv`) — e.g. deepseek, openrouter. The native
 * anthropic provider (`baseUrl: null` — "use the CLI's own login") has no endpoint for opencode to
 * talk to, so it's rejected outright; native Anthropic access is claude-code only.
 *
 * Config wiring: unlike claude-code (which speaks Anthropic wire natively), opencode has no
 * built-in notion of these providers, so every run writes a generated `opencode.json` into the
 * worktree registering the provider as a custom OpenAI-compatible endpoint via the
 * `@ai-sdk/openai-compatible` adapter. The key is referenced through opencode's own `{env:VAR}`
 * interpolation syntax — never inlined as a literal — so the run stays BYO-key even though the
 * config file itself lives on disk for the run's duration.
 *
 * No session flag: opencode's `--session`/`-s` resumes a previously-created session, which doesn't
 * fit a freshly generated run id — a fresh run per task is fine (constitution §9).
 *
 * `--auto` grants auto-approval for every non-denied permission so the run never blocks on an
 * interactive tool-permission prompt (opencode's `run` subcommand is already non-interactive in
 * the sense of not opening the TUI, but tool calls still gate on permissions without this flag).
 *
 * `env.PWD` is pinned to `worktreePath`: opencode's project/config discovery trusts an inherited
 * `PWD` env var over the OS-assigned working directory it's actually spawned with, so a stale
 * `PWD` (e.g. left over from whatever shell launched the long-running AIOS scheduler process)
 * makes it bootstrap against the WRONG project — one without our generated `opencode.json` — and
 * fail with "Model not found" for a provider that's really defined right there in the worktree.
 * Setting `PWD` explicitly is what a real shell would do after `cd`-ing into the worktree, and
 * fixes it (verified empirically against a real opencode + Ollama run).
 */
function opencodeAdapter({ prompt, model, provider, worktreePath }) {
  if (!provider || provider.baseUrl === null) {
    throw new Error('opencode requires an explicit provider endpoint; native Anthropic login is claude-code only');
  }
  if (provider.wire !== 'openai') {
    throw new Error(`provider '${provider.name}' has no OpenAI-format endpoint; not usable with the opencode harness`);
  }
  if (!provider.keyEnv) {
    throw new Error(`provider '${provider.name}' has no BYO key env configured; opencode cannot authenticate`);
  }
  const modelId = model ?? provider.models?.medium;
  if (!modelId) {
    throw new Error(`provider '${provider.name}' has no model to run; pass one explicitly`);
  }

  const config = {
    $schema: 'https://opencode.ai/config.json',
    provider: {
      [provider.name]: {
        npm: '@ai-sdk/openai-compatible',
        options: {
          baseURL: provider.baseUrl,
          apiKey: `{env:${provider.keyEnv}}`,
        },
        models: {
          [modelId]: {},
        },
      },
    },
  };

  return {
    cmd: 'opencode',
    args: ['run', '--model', `${provider.name}/${modelId}`, '--auto', prompt],
    env: worktreePath ? { PWD: worktreePath } : {},
    files: [{ path: 'opencode.json', content: JSON.stringify(config, null, 2) }],
  };
}

export const HARNESS_ADAPTERS = {
  'claude-code': claudeCodeAdapter,
  antigravity: antigravityAdapter,
  opencode: opencodeAdapter,
};

/** Look up an adapter by name. Throws for anything not in HARNESS_ADAPTERS. */
export function resolveHarness(name) {
  const adapter = HARNESS_ADAPTERS[name];
  if (!adapter) throw new Error(`unknown harness: ${name}`);
  return adapter;
}

/** Resolve the harness and build its spawn plan for this run in one call. */
export function buildSpawnPlan(harnessName, run) {
  return resolveHarness(harnessName)(run);
}
