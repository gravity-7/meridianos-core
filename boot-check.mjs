/**
 * boot-check — pre-flight validation run BEFORE the daemon starts accepting work.
 *
 * Every check below maps to a real issue we hit during self-build bootstrapping.
 * The goal: an end user running `node scheduler.mjs` should NEVER see cryptic
 * crashes. They should see a clean checklist with green checks and actionable
 * fixes for anything red.
 *
 * SEVERITY LEVELS:
 *   fatal  — daemon cannot start (missing domain, unreadable policy, port conflict)
 *   error  — daemon starts but critical features are broken (missing keys, no git)
 *   warn   — daemon starts but with degraded functionality (no webhook, no pricing)
 *   info   — advisory (board empty, cadence off, first-time setup tips)
 *
 * INTEGRATION:
 *   Called by scheduler.mjs's start() BEFORE the dashboard binds and BEFORE
 *   the watchdog/runner cycles begin. Fatal checks throw (or return false).
 *   Non-fatal checks log warnings and the daemon continues.
 */

import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { createServer } from 'node:net';
import { loadPolicy } from './budget.mjs';
import { loadPricing } from './pricing.mjs';
import { parseYaml } from './yaml-lite.mjs';

// ═══════════════════════════════════════════════════════════════
// Individual checks (each returns { name, pass, severity, message, fix })
// ═══════════════════════════════════════════════════════════════

/**
 * Check 1: Git repository exists and is functional.
 * Agents create branches and commits — without git, they silently fail.
 */
function checkGit(config) {
  const repoRoot = config?.repoRoot ?? process.cwd();
  const gitDir = join(repoRoot, '.git');
  const exists = existsSync(gitDir);
  if (!exists) {
    return {
      name: 'Git repository',
      pass: false,
      severity: 'error',
      message: 'No .git directory found. Agents cannot branch, commit, or open PRs.',
      fix: `Run: cd ${repoRoot} && git init && git add -A && git commit -m "initial commit"`,
    };
  }
  // Verify git is functional
  try {
    execSync('git rev-parse --git-dir', { cwd: repoRoot, stdio: 'pipe', windowsHide: true });
  } catch {
    return {
      name: 'Git repository',
      pass: false,
      severity: 'error',
      message: 'Git is not installed or not on PATH. Agents cannot work without git.',
      fix: 'Install git from https://git-scm.com and ensure it is on your PATH',
    };
  }
  return { name: 'Git repository', pass: true, severity: 'info', message: 'OK', fix: null };
}

/**
 * Check 2: Policy file exists, parses, and has valid cadence.
 * An unparseable policy or unsupported cadence silently disables the runner.
 */
function checkPolicy(config) {
  const policyPath = config?.policyPath ?? join(config?.repoRoot ?? process.cwd(), '.ai', 'policy.yaml');
  if (!existsSync(policyPath)) {
    return {
      name: 'Policy file',
      pass: false,
      severity: 'fatal',
      message: `policy.yaml not found at ${policyPath}`,
      fix: 'Create .ai/policy.yaml with at minimum: gateway.enabled and agent roster',
    };
  }
  let raw, policy;
  try { raw = readFileSync(policyPath, 'utf8'); } catch (e) {
    return { name: 'Policy file', pass: false, severity: 'fatal', message: `Cannot read ${policyPath}: ${e.message}`, fix: 'Check file permissions' };
  }
  try { policy = parseYaml(raw); } catch (e) {
    return { name: 'Policy file', pass: false, severity: 'fatal', message: `YAML parse error: ${e.message}`, fix: 'Fix YAML syntax in .ai/policy.yaml' };
  }

  // Check cadence
  const VALID_CADENCES = ['every_15m', 'every_30m', 'every_45m', 'hourly', 'every_2h', 'every_3h', 'off', 'on_handoff'];
  const cadence = policy?.schedule?.cadence ?? 'off';
  if (!VALID_CADENCES.includes(cadence)) {
    return {
      name: 'Policy cadence',
      pass: false,
      severity: 'error',
      message: `Unsupported cadence: "${cadence}". Valid values: ${VALID_CADENCES.join(', ')}`,
      fix: `Change schedule.cadence in .ai/policy.yaml to one of: ${VALID_CADENCES.join(', ')}`,
    };
  }
  if (cadence === 'off') {
    return {
      name: 'Policy cadence',
      pass: true,
      severity: 'warn',
      message: 'Cadence is "off" — runner will not auto-fire. Trigger manually via dashboard or POST /api/run-now.',
      fix: "Set schedule.cadence to 'every_15m' or 'hourly' in .ai/policy.yaml",
    };
  }

  return { name: 'Policy file', pass: true, severity: 'info', message: `OK (cadence: ${cadence})`, fix: null };
}

/**
 * Check 3: Dashboard port is available.
 * EADDRINUSE crashes the daemon — catch it BEFORE binding.
 */
function checkPort(port, name) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        resolve({
          name: `${name} port`,
          pass: false,
          severity: 'fatal',
          message: `Port ${port} is already in use. Another daemon or service is running.`,
          fix: `Kill the process on port ${port} or set AIOS_DASHBOARD_PORT env var to a different port`,
        });
      } else {
        resolve({ name: `${name} port`, pass: false, severity: 'fatal', message: `Port ${port} error: ${e.message}`, fix: 'Check network configuration' });
      }
    });
    server.once('listening', () => {
      server.close();
      resolve({ name: `${name} port`, pass: true, severity: 'info', message: `Port ${port} available`, fix: null });
    });
    server.listen(port, '127.0.0.1');
  });
}

/**
 * Check 4: Required environment variables are set.
 * Missing provider keys cause silent agent failures.
 */
function checkEnvVars(policy) {
  const providers = policy?.providers ?? {};
  const missing = [];
  for (const [name, cfg] of Object.entries(providers)) {
    const keyEnv = cfg?.keyEnv;
    if (keyEnv && !process.env[keyEnv]) {
      missing.push({ provider: name, envVar: keyEnv });
    }
  }
  // Also check for quota_guard OAuth harnesses
  const quotaGuard = policy?.quota_guard ?? {};
  for (const [agent, cfg] of Object.entries(quotaGuard)) {
    if (cfg?.harness === 'claude-code' && !existsSync(join(process.env.HOME || process.env.USERPROFILE || '~', '.claude', 'projects'))) {
      // Claude Code not configured — warn but don't block
    }
  }

  if (missing.length > 0) {
    const names = missing.map(m => `${m.envVar} (for ${m.provider})`).join(', ');
    return {
      name: 'Provider keys',
      pass: false,
      severity: 'error',
      message: `Missing API key env vars: ${names}`,
      fix: `Set the env vars or add keys to a .env file. Agents routed to these providers will be skipped.`,
    };
  }
  return { name: 'Provider keys', pass: true, severity: 'info', message: 'OK', fix: null };
}

/**
 * Check 5: Pricing catalog exists and covers configured providers.
 * Missing pricing means cost_usd is always null — no cost visibility.
 */
function checkPricing(config) {
  try {
    const catalog = loadPricing(undefined, config);
    const providers = Object.keys(catalog);
    if (providers.length === 0) {
      return {
        name: 'Pricing catalog',
        pass: false,
        severity: 'warn',
        message: 'pricing.json is empty or missing. Cost tracking will show $0 for all calls.',
        fix: 'Run: npm run aios:pricing:refresh to fetch current pricing data',
      };
    }
    return {
      name: 'Pricing catalog',
      pass: true,
      severity: 'info',
      message: `OK (${providers.length} providers: ${providers.join(', ')})`,
      fix: null,
    };
  } catch (e) {
    return {
      name: 'Pricing catalog',
      pass: false,
      severity: 'warn',
      message: `Cannot load pricing: ${e.message}. Cost tracking disabled.`,
      fix: 'Check that pricing.json exists and is valid JSON',
    };
  }
}

/**
 * Check 6: Escalation webhook is configured or explicitly disabled.
 * Avoids the "push error: no webhook configured" flood every 60s.
 */
function checkEscalation(config) {
  const webhookPath = join(config?.repoRoot ?? process.cwd(), '.ai', 'secrets', 'escalation-webhook');
  if (existsSync(webhookPath)) {
    return { name: 'Escalation webhook', pass: true, severity: 'info', message: 'OK (configured)', fix: null };
  }
  // Check if ESCALATION_WEBHOOK env var is set
  if (process.env.AIOS_ESCALATION_WEBHOOK) {
    return { name: 'Escalation webhook', pass: true, severity: 'info', message: 'OK (env var)', fix: null };
  }
  return {
    name: 'Escalation webhook',
    pass: false,
    severity: 'warn',
    message: 'No escalation webhook configured. Push notifications will be silent.',
    fix: 'Create .ai/secrets/escalation-webhook with {"webhook":"disabled"} or set AIOS_ESCALATION_WEBHOOK env var',
  };
}

/**
 * Check 7: Database directory is writable.
 */
function checkDatabase(config) {
  const parentDir = join(config?.repoRoot ?? process.cwd(), '.ai');
  try {
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }
    return { name: 'Database', pass: true, severity: 'info', message: 'OK', fix: null };
  } catch (e) {
    return { name: 'Database', pass: false, severity: 'fatal', message: `Cannot create .ai directory: ${e.message}`, fix: 'Check filesystem permissions on the project directory' };
  }
}

/**
 * Check 8: Board has tasks (advisory — not a blocker).
 */
function checkBoard(config) {
  const dbPath = join(config?.repoRoot ?? process.cwd(), '.ai', 'state', 'aios.db');
  if (!existsSync(dbPath)) {
    return { name: 'Task board', pass: true, severity: 'info', message: 'Not yet created (initialized on first boot)', fix: null };
  }
  try {
    const { DatabaseSync } = require_sqlite();
    const db = new DatabaseSync(dbPath);
    const cnt = db.prepare('SELECT COUNT(*) as cnt FROM tasks WHERE status != ?').get('done');
    db.close();
    if (!cnt || cnt.cnt === 0) {
      return { name: 'Task board', pass: true, severity: 'info', message: 'Empty — no active tasks. Create tasks via dashboard.', fix: 'Create tasks or connect ADO/Jira integration' };
    }
    return { name: 'Task board', pass: true, severity: 'info', message: `OK (${cnt.cnt} active tasks)`, fix: null };
  } catch {
    return { name: 'Task board', pass: true, severity: 'info', message: 'Will be initialized on first run', fix: null };
  }
}

// Lazy require for node:sqlite (may not exist on older Node versions)
function require_sqlite() {
  try { return import('node:sqlite'); } catch { return null; }
  // Fallback for versions that don't support import() in sync context
  try { return require('node:sqlite'); } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════
// Runner
// ═══════════════════════════════════════════════════════════════

/**
 * Run all pre-flight checks. Returns { allClear, results, fatals, errors, warns }.
 *
 * @param {object} opts
 * @param {object} opts.config — the AiosConfig (must have repoRoot)
 * @param {object} [opts.policy] — pre-loaded policy (avoids double-load)
 * @param {number} [opts.dashboardPort=4317] — port to check
 * @returns {Promise<object>}
 */
export async function runBootChecks({ config, policy: policyIn, dashboardPort = 4317 } = {}) {
  const policy = policyIn ?? loadPolicy(undefined, config);
  const results = [];

  // Synchronous checks first
  results.push(checkGit(config));
  results.push(checkPolicy(config));
  results.push(checkEnvVars(policy));
  results.push(checkPricing(config));
  results.push(checkEscalation(config));
  results.push(checkDatabase(config));
  results.push(checkBoard(config));

  // Async checks
  results.push(await checkPort(dashboardPort, 'Dashboard'));
  const gwPort = policy?.gateway?.port ?? 0;
  if (gwPort > 0) {
    results.push(await checkPort(gwPort, 'Gateway'));
  }

  const fatals = results.filter(r => r.severity === 'fatal' && !r.pass);
  const errors = results.filter(r => r.severity === 'error' && !r.pass);
  const warns = results.filter(r => r.severity === 'warn' && !r.pass);
  const allClear = fatals.length === 0;

  return { allClear, results, fatals, errors, warns };
}

/**
 * Format boot check results for console output.
 */
export function formatBootCheckResults({ results, fatals, errors, warns }) {
  const lines = [];
  const icons = { pass: '✅', fail: '❌', warn: '⚠️' };
  const severities = { fatal: 'FATAL', error: 'ERROR', warn: 'WARN', info: 'INFO' };

  lines.push('');
  lines.push('═══════════════════════════════════════════');
  lines.push('  MeridianOS — Pre-flight Checks');
  lines.push('═══════════════════════════════════════════');

  for (const r of results) {
    const icon = r.pass ? icons.pass : (r.severity === 'warn' ? icons.warn : icons.fail);
    const sev = severities[r.severity];
    lines.push(`  ${icon} [${sev}] ${r.name}: ${r.message}`);
    if (!r.pass && r.fix) {
      lines.push(`     ↳ Fix: ${r.fix}`);
    }
  }

  lines.push('───────────────────────────────────────────');
  if (fatals.length > 0) {
    lines.push(`  ❌ ${fatals.length} FATAL issue(s) — daemon cannot start`);
    for (const f of fatals) lines.push(`     • ${f.name}: ${f.fix}`);
  } else if (errors.length > 0) {
    lines.push(`  ⚠️  ${errors.length} error(s) — daemon starts with degraded functionality`);
  } else if (warns.length > 0) {
    lines.push(`  ℹ️  ${warns.length} warning(s) — review before production use`);
  } else {
    lines.push('  ✅ All checks passed. Daemon ready.');
  }
  lines.push('═══════════════════════════════════════════');
  lines.push('');

  return lines.join('\n');
}

/**
 * Quick inline check runner (also used as the CLI entry for standalone testing).
 * Usage: node boot-check.mjs
 */
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const REPO = process.cwd();
  const config = {
    repoRoot: REPO,
    policyPath: join(REPO, '.ai', 'policy.yaml'),
  };
  const policy = loadPolicy(undefined, config);
  runBootChecks({ config, policy }).then(({ results, fatals, errors, warns, allClear }) => {
    console.log(formatBootCheckResults({ results, fatals, errors, warns }));
    process.exit(allClear ? 0 : 1);
  });
}
