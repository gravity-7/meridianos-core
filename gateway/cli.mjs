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

// ─── Subcommand: provider ───────────────────────────────────────────────────

function parseSubcommandArgs(args, subcommand) {
  // Find subcommand position and extract args after it
  const idx = args.indexOf(subcommand);
  if (idx === -1) return [];
  return args.slice(idx + 1).filter(a => !a.startsWith('--'));
}

async function handleProviderCommand(args, flags) {
  const subArgs = parseSubcommandArgs(args, 'provider');
  const action = subArgs[0];

  if (action === 'test') {
    return handleProviderTest(subArgs, flags);
  }
  if (action === 'add') {
    return handleProviderAdd(flags);
  }
  if (action === 'list') {
    return handleProviderList(flags);
  }

  process.stderr.write('Usage: node gateway/cli.mjs provider <test|add|list> [options]\n');
  process.stderr.write('  provider test <name>    Test provider connection\n');
  process.stderr.write('  provider add [--auto]   Add a new provider\n');
  process.stderr.write('  provider list           List all providers\n');
  process.exit(1);
}

async function handleProviderTest(subArgs, flags) {
  const providerName = subArgs[1] ?? flags.name;
  if (!providerName) {
    process.stderr.write('Usage: node gateway/cli.mjs provider test <name>\n');
    process.exit(1);
  }

  try {
    const { resolveProvider } = await import('../providers.mjs');
    const { testProviderConnection } = await import('../provider-conformance.mjs');
    const policy = loadPolicy();

    const providerConfig = resolveProvider(providerName, policy);
    if (!providerConfig) {
      process.stderr.write(`Unknown provider: ${providerName}\n`);
      process.exit(1);
    }

    const resolvedKey = providerConfig.keyEnv ? process.env[providerConfig.keyEnv] ?? null : null;
    const result = await testProviderConnection(providerConfig, resolvedKey);

    const status = result.ok ? '✓' : '✗';
    process.stdout.write(`${status} ${providerName}: ${result.ok ? 'OK' : 'FAILED'}\n`);
    process.stdout.write(`  Latency: ${result.latencyMs}ms\n`);
    if (result.modelsFound !== null && result.modelsFound !== undefined) {
      process.stdout.write(`  Models found: ${result.modelsFound}\n`);
    }
    if (result.errorCode) {
      process.stdout.write(`  Error: [${result.errorCode}] ${result.errorMessage}\n`);
    }
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

async function handleProviderAdd(flags) {
  try {
    const { runProviderWizard } = await import('../provider-wizard.mjs');
    const policy = loadPolicy();

    if (flags.auto) {
      const result = await runProviderWizard({ interactive: false, auto: true, policy });
      const detected = result.detected ?? [];
      process.stdout.write(`Auto-detected ${detected.length} provider(s)\n`);
      for (const p of detected) {
        process.stdout.write(`  + ${p.name} (${p.keyEnv})\n`);
      }
    } else if (flags.name && flags.wire && flags.baseUrl) {
      const result = await runProviderWizard({
        interactive: false,
        auto: false,
        name: flags.name,
        wire: flags.wire,
        baseUrl: flags.baseUrl,
        keyEnv: flags.keyEnv ?? null,
        policy,
      });
      if (result.ok) {
        process.stdout.write(`Provider added: ${result.provider?.name ?? flags.name}\n`);
      } else {
        process.stderr.write(`Failed to add provider: ${result.error}\n`);
        process.exit(1);
      }
    } else {
      const result = await runProviderWizard({ interactive: true, policy });
      if (result.ok) {
        process.stdout.write(`Provider added: ${result.provider?.name}\n`);
      } else {
        process.stderr.write(`Failed to add provider: ${result.error}\n`);
        process.exit(1);
      }
    }
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

async function handleProviderList(flags) {
  try {
    const { resolveAllProviders } = await import('../providers.mjs');
    const { getProviderHealth } = await import('../provider-health.mjs');
    const policy = loadPolicy();
    const providers = resolveAllProviders(policy);
    const healthMap = getProviderHealth();

    process.stdout.write('Providers:\n');
    for (const [name, cfg] of Object.entries(providers)) {
      const health = healthMap[name];
      const hStatus = health?.status ?? 'unknown';
      const hLatency = health?.latencyMs != null ? `${health.latencyMs}ms` : '-';
      process.stdout.write(`  ${name.padEnd(16)} ${(cfg.displayName ?? cfg.name ?? '').padEnd(20)} ${cfg.wire.padEnd(14)} ${hStatus.padEnd(10)} ${hLatency}\n`);
    }
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

// ─── Subcommand: models ─────────────────────────────────────────────────────

async function handleModelsCommand(args, flags) {
  const subArgs = parseSubcommandArgs(args, 'models');
  const action = subArgs[0];

  if (action === 'refresh') {
    return handleModelsRefresh(flags);
  }
  if (action === 'list') {
    return handleModelsList(flags);
  }

  process.stderr.write('Usage: node gateway/cli.mjs models <refresh|list> [options]\n');
  process.stderr.write('  models refresh              Refresh model registry from all providers\n');
  process.stderr.write('  models list [--provider X] [--tier Y]  List discovered models\n');
  process.exit(1);
}

async function handleModelsRefresh(flags) {
  try {
    const { openDb } = await import('../db.mjs');
    const { discoverAllModels } = await import('../model-discovery.mjs');
    const policy = loadPolicy();
    const config = { repoRoot: process.cwd() };
    const db = openDb(undefined, config);

    process.stdout.write('Discovering models...\n');
    const result = await discoverAllModels(db, policy, config);
    process.stdout.write(`Done. ${result.modelsDiscovered} model(s) discovered from ${result.providersScanned} provider(s).\n`);
    if (result.errors.length > 0) {
      for (const err of result.errors) {
        process.stdout.write(`  ⚠ ${err.provider}: ${err.error}\n`);
      }
    }
    db.close();
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

async function handleModelsList(flags) {
  try {
    const { openDb } = await import('../db.mjs');
    const { getModels } = await import('../model-registry.mjs');
    const config = { repoRoot: process.cwd() };
    const db = openDb(undefined, config);

    const models = getModels(db, {
      provider: flags.provider ?? null,
      tier: flags.tier ?? null,
      deprecated: false,
    });

    process.stdout.write('Models:\n');
    for (const m of models) {
      const tier = m.tier_assigned ?? '-';
      const ctx = m.context_window != null ? `${(m.context_window / 1000).toFixed(0)}k` : '-';
      process.stdout.write(`  ${m.provider.padEnd(16)} ${m.model_id.padEnd(32)} tier:${tier.padEnd(8)} ctx:${ctx.padEnd(6)}\n`);
    }
    db.close();
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

// ─── Subcommand: pricing ────────────────────────────────────────────────────

async function handlePricingCommand(args, flags) {
  const subArgs = parseSubcommandArgs(args, 'pricing');
  const action = subArgs[0];

  if (action === 'refresh') {
    return handlePricingRefresh(flags);
  }
  if (action === 'show') {
    return handlePricingShow(flags);
  }

  process.stderr.write('Usage: node gateway/cli.mjs pricing <refresh|show> [options]\n');
  process.stderr.write('  pricing refresh                 Refresh pricing for all models\n');
  process.stderr.write('  pricing show [--provider X]     Show pricing data\n');
  process.exit(1);
}

async function handlePricingRefresh(flags) {
  try {
    const { openDb } = await import('../db.mjs');
    const { refreshAllModelPricing } = await import('../pricing-refresh.mjs');
    const policy = loadPolicy();
    const config = { repoRoot: process.cwd() };
    const db = openDb(undefined, config);

    process.stdout.write('Refreshing pricing...\n');
    const result = await refreshAllModelPricing(db, policy, config);
    process.stdout.write(`Done. ${result.refreshed ?? 0} model(s) priced, ${result.errors?.length ?? 0} error(s).\n`);
    if (result.errors?.length > 0) {
      for (const err of result.errors) {
        process.stdout.write(`  ⚠ ${err.model ?? err.provider}: ${err.error}\n`);
      }
    }
    db.close();
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

async function handlePricingShow(flags) {
  try {
    const { openDb } = await import('../db.mjs');
    const { getModels } = await import('../model-registry.mjs');
    const config = { repoRoot: process.cwd() };
    const db = openDb(undefined, config);

    const models = getModels(db, {
      provider: flags.provider ?? null,
      deprecated: false,
    });

    process.stdout.write('Pricing (USD per 1M tokens):\n');
    for (const m of models) {
      const inp = m.pricing_input_per_m != null ? `$${m.pricing_input_per_m.toFixed(2)}` : '-';
      const out = m.pricing_output_per_m != null ? `$${m.pricing_output_per_m.toFixed(2)}` : '-';
      const src = m.pricing_source ?? '-';
      process.stdout.write(`  ${m.provider.padEnd(16)} ${m.model_id.padEnd(32)} in:${inp.padEnd(8)} out:${out.padEnd(8)} [${src}]\n`);
    }
    db.close();
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

// ─── Subcommand: project ───────────────────────────────────────────────────

async function handleProjectCommand(args, flags) {
  const subArgs = parseSubcommandArgs(args, 'project');
  const action = subArgs[0];

  if (action === 'list') {
    return handleProjectList(flags);
  }
  if (action === 'create') {
    return handleProjectCreate(subArgs, flags);
  }
  if (action === 'start') {
    return handleProjectStart(subArgs, flags);
  }
  if (action === 'stop') {
    return handleProjectStop(subArgs, flags);
  }
  if (action === 'restart') {
    return handleProjectRestart(subArgs, flags);
  }
  if (action === 'delete') {
    return handleProjectDelete(subArgs, flags);
  }
  if (action === 'health') {
    return handleProjectHealth(subArgs, flags);
  }

  process.stderr.write('Usage: node gateway/cli.mjs project <list|create|start|stop|restart|delete|health> [options]\n');
  process.stderr.write('  project list                    List all projects\n');
  process.stderr.write('  project create <name>           Create a new project\n');
  process.stderr.write('  project start <id|name>         Start a project\n');
  process.stderr.write('  project stop <id|name>          Stop a project\n');
  process.stderr.write('  project restart <id|name>       Restart a project\n');
  process.stderr.write('  project delete <id|name>        Delete a project\n');
  process.stderr.write('  project health <id|name>        Check project health\n');
  process.exit(1);
}

async function handleProjectList(flags) {
  try {
    const { ProjectManager } = await import('../control-plane.mjs');
    const projectManager = new ProjectManager();
    const projects = projectManager.listProjects();

    if (projects.length === 0) {
      process.stdout.write('No projects found.\n');
      return;
    }

    process.stdout.write('Projects:\n');
    for (const project of projects) {
      const statusIcon = project.status === 'running' ? '▶' : 
                        project.status === 'stopped' ? '⏸' : 
                        project.status === 'error' ? '⚠' : '•';
      const healthIcon = project.health_status === 'healthy' ? '💚' : 
                        project.health_status === 'degraded' ? '💛' : 
                        project.health_status === 'down' ? '❤' : '⚪';
      
      process.stdout.write(`  ${statusIcon} ${project.name.padEnd(20)} ${project.id.slice(0, 8)}...  ${healthIcon} ${project.health_status.padEnd(10)} Port: ${project.port}\n`);
    }
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

async function handleProjectCreate(subArgs, flags) {
  const projectName = subArgs[1] ?? flags.name;
  const template = flags.template ?? '';

  if (!projectName) {
    process.stderr.write('Usage: node gateway/cli.mjs project create <name> [--template <template>]\n');
    process.exit(1);
  }

  try {
    const { ProjectManager } = await import('../control-plane.mjs');
    const projectManager = new ProjectManager();
    
    const project = projectManager.createProject({
      name: projectName,
      template: template || null,
      config_path: `${process.cwd()}/.ai/projects/${projectName}/policy.yaml`,
      state_path: `${process.cwd()}/.ai/projects/${projectName}/state`,
      created_by: 'cli'
    });

    process.stdout.write(`Project created: ${project.name} (ID: ${project.id})\n`);
    process.stdout.write(`  Port: ${project.port}\n`);
    process.stdout.write(`  Template: ${project.template || 'Blank'}\n`);
    process.stdout.write(`  Config: ${project.config_path}\n`);
    process.stdout.write(`  State: ${project.state_path}\n`);
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

async function handleProjectStart(subArgs, flags) {
  const projectIdentifier = subArgs[1] ?? flags.id ?? flags.name;

  if (!projectIdentifier) {
    process.stderr.write('Usage: node gateway/cli.mjs project start <id|name>\n');
    process.exit(1);
  }

  try {
    const { ProjectManager } = await import('../control-plane.mjs');
    const projectManager = new ProjectManager();
    
    const project = findProject(projectManager, projectIdentifier);
    if (!project) {
      process.stderr.write(`Project not found: ${projectIdentifier}\n`);
      process.exit(1);
    }

    const updated = await projectManager.startProject(project.id);
    process.stdout.write(`Project started: ${updated.name}\n`);
    process.stdout.write(`  Status: ${updated.status}\n`);
    process.stdout.write(`  Dashboard: http://localhost:${updated.port}\n`);
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

async function handleProjectStop(subArgs, flags) {
  const projectIdentifier = subArgs[1] ?? flags.id ?? flags.name;

  if (!projectIdentifier) {
    process.stderr.write('Usage: node gateway/cli.mjs project stop <id|name>\n');
    process.exit(1);
  }

  try {
    const { ProjectManager } = await import('../control-plane.mjs');
    const projectManager = new ProjectManager();
    
    const project = findProject(projectManager, projectIdentifier);
    if (!project) {
      process.stderr.write(`Project not found: ${projectIdentifier}\n`);
      process.exit(1);
    }

    const updated = await projectManager.stopProject(project.id);
    process.stdout.write(`Project stopped: ${updated.name}\n`);
    process.stdout.write(`  Status: ${updated.status}\n`);
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

async function handleProjectRestart(subArgs, flags) {
  const projectIdentifier = subArgs[1] ?? flags.id ?? flags.name;

  if (!projectIdentifier) {
    process.stderr.write('Usage: node gateway/cli.mjs project restart <id|name>\n');
    process.exit(1);
  }

  try {
    const { ProjectManager } = await import('../control-plane.mjs');
    const projectManager = new ProjectManager();
    
    const project = findProject(projectManager, projectIdentifier);
    if (!project) {
      process.stderr.write(`Project not found: ${projectIdentifier}\n`);
      process.exit(1);
    }

    const updated = await projectManager.restartProject(project.id);
    process.stdout.write(`Project restarted: ${updated.name}\n`);
    process.stdout.write(`  Status: ${updated.status}\n`);
    process.stdout.write(`  Dashboard: http://localhost:${updated.port}\n`);
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

async function handleProjectDelete(subArgs, flags) {
  const projectIdentifier = subArgs[1] ?? flags.id ?? flags.name;

  if (!projectIdentifier) {
    process.stderr.write('Usage: node gateway/cli.mjs project delete <id|name>\n');
    process.exit(1);
  }

  try {
    const { ProjectManager } = await import('../control-plane.mjs');
    const projectManager = new ProjectManager();
    
    const project = findProject(projectManager, projectIdentifier);
    if (!project) {
      process.stderr.write(`Project not found: ${projectIdentifier}\n`);
      process.exit(1);
    }

    if (project.status === 'running') {
      process.stderr.write(`Cannot delete running project. Stop it first.\n`);
      process.exit(1);
    }

    await projectManager.deleteProject(project.id);
    process.stdout.write(`Project deleted: ${project.name}\n`);
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

async function handleProjectHealth(subArgs, flags) {
  const projectIdentifier = subArgs[1] ?? flags.id ?? flags.name;

  if (!projectIdentifier) {
    process.stderr.write('Usage: node gateway/cli.mjs project health <id|name>\n');
    process.exit(1);
  }

  try {
    const { ProjectManager } = await import('../control-plane.mjs');
    const projectManager = new ProjectManager();
    
    const project = findProject(projectManager, projectIdentifier);
    if (!project) {
      process.stderr.write(`Project not found: ${projectIdentifier}\n`);
      process.exit(1);
    }

    const health = await projectManager.getProjectHealth(project.id);
    
    process.stdout.write(`Project Health: ${project.name}\n`);
    process.stdout.write(`  Status: ${health.status}\n`);
    process.stdout.write(`  HTTP Healthy: ${health.http_healthy ? 'Yes' : 'No'}\n`);
    process.stdout.write(`  Process Running: ${health.process_running ? 'Yes' : 'No'}\n`);
    process.stdout.write(`  CPU: ${health.metrics.cpu.toFixed(2)}s\n`);
    process.stdout.write(`  Memory: ${health.metrics.memory.toFixed(2)} MB\n`);
    process.stdout.write(`  Last Check: ${health.last_check}\n`);
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

function findProject(projectManager, identifier) {
  // Try by ID first
  let project = projectManager.getProject(identifier);
  if (project) return project;

  // Try by name
  const projects = projectManager.listProjects();
  return projects.find(p => p.name === identifier) || null;
}

async function main() {
  const args = process.argv.slice(2);
  const flags = parseArgs(args);

  // Handle subcommands
  if (args[0] === 'provider') {
    return handleProviderCommand(args, flags);
  }
  if (args[0] === 'models') {
    return handleModelsCommand(args, flags);
  }
  if (args[0] === 'pricing') {
    return handlePricingCommand(args, flags);
  }
  if (args[0] === 'project') {
    return handleProjectCommand(args, flags);
  }

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
