#!/usr/bin/env node
/**
 * cli — the standalone entry point for the gateway sidecar (card C1, "the wedge"): ONE command to
 * boot cost-governed metering across Claude/DeepSeek/etc, no tenant loop, no DomainPlugin, no
 * daemon required. Thin by design: all real behavior already lives in `assembleGateway`
 * (index.mjs) / `startGateway` (server.mjs) — this module only parses flags, wires them straight
 * through, prints where the sidecar came up, and shuts down cleanly on SIGINT. Nothing here is
 * reimplemented from those modules.
 *
 * Importing this module starts NOTHING (see the main-guard at the bottom, which mirrors
 * scheduler.mjs's own `fileURLToPath(import.meta.url) === process.argv[1]` idiom) — only running
 * it directly (`node gateway/cli.mjs ...` or the `meridian-gateway` bin) boots a server.
 *
 * Registering ONE default run: a bare `assembleGateway()` has no runs registered, so nothing could
 * ever route through it (every request 401s — see run-registry.mjs). Standalone has no launcher to
 * mint per-run tokens (that's `gateway/inject.mjs`, daemon-only), so when `--provider` is given this
 * CLI registers a single default run via the assembled gateway's own public `runs.registerRun` API
 * (no new registration mechanism, no touching run-registry.mjs itself) and prints the minted token
 * so an operator can point one BYO-key agent's base URL + auth header at this sidecar. Omit
 * `--provider` and the sidecar still boots — just with nothing registered to route through it yet.
 *
 * Never logs a provider key: only `keyEnv` NAMES ever flow through this module (via `--provider`
 * matching a route in the registry) — the real secret is resolved server-side, at forward-time,
 * inside server.mjs's `resolveKey`, and never touches this process's stdout.
 */
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { assembleGateway } from './index.mjs';
import { loadPolicy } from '../budget.mjs';

// ─── Zero-Config Auto-Detection ──────────────────────────────────────────────

/**
 * Strict whitelist of known AI provider API key environment variable names.
 * Each entry maps an env var name to { provider, wire } metadata.
 * No wildcard matching — avoids false positives on non-AI keys like AWS_ACCESS_KEY_ID.
 */
const KEY_PATTERNS = {
  ANTHROPIC_API_KEY: { provider: 'anthropic', wire: 'anthropic' },
  OPENAI_API_KEY: { provider: 'openai', wire: 'openai' },
  DEEPSEEK_KEY: { provider: 'deepseek', wire: 'anthropic' },
  GROQ_API_KEY: { provider: 'groq', wire: 'openai' },
  GOOGLE_API_KEY: { provider: 'google', wire: 'generic-http' },
  MISTRAL_API_KEY: { provider: 'mistral', wire: 'openai' },
  COHERE_API_KEY: { provider: 'cohere', wire: 'generic-http' },
  TOGETHER_API_KEY: { provider: 'together', wire: 'openai' },
};

/**
 * Scan process.env for recognized AI provider API keys.
 * Returns array of { provider, wire, keyEnv } for each detected key.
 * Strict whitelist only — no wildcard matching.
 */
export function autoDetectProviders() {
  const detected = [];
  for (const [envName, meta] of Object.entries(KEY_PATTERNS)) {
    if (process.env[envName]) {
      detected.push({ provider: meta.provider, wire: meta.wire, keyEnv: envName });
    }
  }
  return detected;
}

// ─── Package version (read from package.json at module load) ─────────────────

let _version = null;
function getVersion() {
  if (_version !== null) return _version;
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      _version = pkg.version || '0.0.0';
    }
  } catch {
    _version = '0.0.0';
  }
  return _version;
}

const DASHBOARD_PORT = 4317;

/**
 * Minimal inline flag parser (no dependency): `--flag value` pairs, plus bare `--flag` boolean
 * switches when the next token is missing or is itself another flag. That's the entire surface
 * this CLI needs — no `=`-form, no short flags, no positionals.
 */
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

/**
 * Assembles + starts one standalone gateway sidecar from parsed CLI flags. Exported separately
 * from `main` so tests can drive it in-process (no child-process spawn needed) — exactly like
 * `gateway/tests/index.test.mjs` already does for `assembleGateway` itself. Only `main()` (the
 * main-guarded path below) needs a real subprocess, to prove the stdout/SIGINT contract.
 *
 * Returns `{ ...assembled, token, registeredRun }` (see `assembleGateway`'s own return shape for
 * `gateway`/`ledger`/`runs`/`store`/`url`/`close`). `token` is the minted gateway token for the one
 * default run registered when `--provider` is given; `null` when it isn't (nothing registered).
 */
export async function startCli(flags = {}) {
  const port = flags.port !== undefined ? Number(flags.port) : 0;
  const tenant = flags.tenant ?? 'pv';
  const policy = flags.policy && typeof flags.policy === 'string' ? loadPolicy(flags.policy) : {};
  const ledgerPath = typeof flags.ledger === 'string' ? flags.ledger : undefined;

  // Auto-detect providers from environment
  const detectedProviders = autoDetectProviders();

  // Handle --init flag: generate config and return early
  if (flags.init) {
    const configPath = generateInitConfig(detectedProviders, typeof flags.init === 'string' ? flags.init : undefined);
    if (configPath) {
      process.stdout.write(`Config written to: ${configPath}\n`);
      process.stdout.write(`${detectedProviders.length} provider(s) detected.\n`);
    }
    return { detectedProviders, initConfigPath: configPath, token: null, registeredRun: null };
  }

  const assembled = await assembleGateway({ policy, port, tenant, ledgerPath });

  let token = null;
  let registeredRun = null;
  if (flags.provider && typeof flags.provider === 'string') {
    token = typeof flags.token === 'string' ? flags.token : randomUUID();
    registeredRun = {
      tenant,
      agent: typeof flags.agent === 'string' ? flags.agent : 'cli',
      session: typeof flags.session === 'string' ? flags.session : randomUUID(),
      task: null,
      runId: null,
      provider: flags.provider,
      model: typeof flags.model === 'string' ? flags.model : null,
      tier: 'medium',
    };
    assembled.runs.registerRun(token, registeredRun);
  }

  return { ...assembled, tenant, ledgerPath, token, registeredRun, detectedProviders };
}

/**
 * Print the rich startup message including version, port, detected providers, and dashboard URL.
 */
export function printStartupMessage({ version, port, detectedProviders, dashboardPort = DASHBOARD_PORT, loggingEnabled = false }) {
  const ver = version ?? getVersion();
  const count = detectedProviders?.length ?? 0;

  if (count > 0) {
    const providerList = detectedProviders.map((p) => p.provider).join(', ');
    process.stdout.write(
      `MeridianOS Gateway v${ver} | Listening on http://127.0.0.1:${port} | ` +
      `${count} provider(s) auto-detected: ${providerList} | ` +
      `Dashboard: http://127.0.0.1:${dashboardPort}\n`,
    );
  } else {
    process.stdout.write(
      `MeridianOS Gateway v${ver} | Listening on http://127.0.0.1:${port} | ` +
      `No API keys detected. Set provider API keys in your environment or run with --init to generate a starter config. | ` +
      `Dashboard: http://127.0.0.1:${dashboardPort}\n`,
    );
  }

  // Privacy warning when logging is enabled
  if (loggingEnabled) {
    process.stdout.write(
      '\u26A0 Logging is ENABLED. Request/response data will be stored for debugging. ' +
      'Authorization headers are automatically redacted, but request bodies may contain sensitive information.\n',
    );
  }
}

/**
 * Generate a default config file with auto-detected providers.
 */
export function generateInitConfig(detectedProviders, outputPath) {
  const configPath = outputPath || '.ai/providers.yaml';
  const lines = [
    '# MeridianOS Gateway — auto-generated provider config',
    `# Generated: ${new Date().toISOString()}`,
    '',
    'providers:',
  ];
  for (const p of detectedProviders) {
    lines.push(`  ${p.provider}:`);
    lines.push(`    wire: ${p.wire}`);
    lines.push(`    keyEnv: ${p.keyEnv}`);
  }
  lines.push('');

  try {
    writeFileSync(configPath, lines.join('\n'), 'utf8');
  } catch (err) {
    process.stderr.write(`meridian-gateway: failed to write config to ${configPath}: ${err?.message ?? err}\n`);
    return null;
  }
  return configPath;
}

function printBanner({ url, tenant, ledgerPath, token, registeredRun, detectedProviders }) {
  const port = url ? Number(url.split(':').pop()) : 0;
  printStartupMessage({
    version: getVersion(),
    port,
    detectedProviders: detectedProviders ?? [],
  });

  process.stdout.write(`tenant: ${tenant}\n`);
  process.stdout.write(`ledger: ${ledgerPath ?? '(default .ai/gateway/ledger.db)'}\n`);
  if (token) {
    const modelPart = registeredRun?.model ? ` model=${registeredRun.model}` : '';
    process.stdout.write(`default run registered: agent=${registeredRun?.agent ?? 'cli'} provider=${registeredRun?.provider ?? '?'}${modelPart}\n`);
    process.stdout.write(`gateway token (send as x-gateway-token, x-api-key, or Authorization: Bearer): ${token}\n`);
  } else {
    process.stdout.write('no --provider given: sidecar is up but no run is registered yet (every request will 401)\n');
  }
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));

  // Handle --init before assembly
  if (flags.init) {
    const detected = autoDetectProviders();
    const configPath = generateInitConfig(detected, typeof flags.init === 'string' ? flags.init : undefined);
    if (configPath) {
      process.stdout.write(`Config written to: ${configPath}\n`);
      process.stdout.write(`${detected.length} provider(s) auto-detected.\n`);
    }
    if (detected.length === 0) {
      process.stdout.write('No API keys detected. Set provider API keys in your environment and re-run.\n');
    }
    return;
  }

  const cli = await startCli(flags);
  printBanner(cli);

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    cli.close?.().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Only run the CLI when this file is the direct process entry point (mirrors scheduler.mjs's own
// main-guard) — importing this module (e.g. from a test) starts no server.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    process.stderr.write(`meridian-gateway: fatal: ${err?.message ?? err}\n`);
    process.exit(1);
  });
}
