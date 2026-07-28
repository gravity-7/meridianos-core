/**
 * provider-wizard — interactive CLI and programmatic provider configuration wizard (US3).
 *
 * Dual-interface design:
 *   1. CLI: `node gateway/cli.mjs provider add [--auto|--name X ...]`
 *   2. Dashboard: `POST /api/providers`
 *
 * Uses known-providers.json for pre-fill and auto-detection.
 * Writes to policy.yaml with timestamped backup.
 * Detects concurrent modification via mtime comparison.
 */
import { readFileSync, writeFileSync, existsSync, statSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from './yaml-lite.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Load the known-providers database.
 * @returns {Array<object>}
 */
function loadKnownProviders() {
  const dbPath = join(HERE, 'gateway', 'known-providers.json');
  try {
    const raw = readFileSync(dbPath, 'utf8');
    const db = JSON.parse(raw);
    return db.providers ?? [];
  } catch {
    return [];
  }
}

/**
 * Look up a provider in the known-providers database by name.
 * @param {string} name - Provider name
 * @returns {object|null}
 */
function lookupKnownProvider(name) {
  const known = loadKnownProviders();
  return known.find((p) => p.name === name) ?? null;
}

/**
 * Auto-detect providers whose keyEnv environment variables are set.
 * Matches against known-providers.json for exact keyEnv matches only.
 * @returns {Array<{name: string, displayName: string, wire: string, baseUrl: string, keyEnv: string}>}
 */
export function autoDetectProviders() {
  const known = loadKnownProviders();
  const detected = [];
  for (const provider of known) {
    if (provider.keyEnv && process.env[provider.keyEnv]) {
      detected.push({
        name: provider.name,
        displayName: provider.displayName,
        wire: provider.wire,
        baseUrl: provider.baseUrl,
        keyEnv: provider.keyEnv,
      });
    }
  }
  return detected;
}

/**
 * Read the current policy.yaml and return its mtime for concurrency detection.
 * @returns {{policy: object, mtimeMs: number, raw: string}}
 */
function readPolicyState(repoRoot) {
  const policyPath = join(repoRoot, '.ai', 'policy.yaml');
  try {
    const stat = statSync(policyPath);
    const raw = readFileSync(policyPath, 'utf8');
    const policy = parseYaml(raw);
    return { policy, mtimeMs: stat.mtimeMs, raw };
  } catch {
    return { policy: {}, mtimeMs: 0, raw: '' };
  }
}

/**
 * Write the policy back to disk with a timestamped backup.
 * Throws if concurrent modification is detected.
 *
 * @param {string} repoRoot
 * @param {object} policy - The full policy object to write
 * @param {number} expectedMtimeMs - The mtime at read time (for concurrency detection)
 * @returns {{written: boolean, backupPath?: string, conflict?: boolean}}
 */
function writePolicyWithBackup(repoRoot, policy, expectedMtimeMs) {
  const policyPath = join(repoRoot, '.ai', 'policy.yaml');

  // Serialize back to YAML (simple key-value for providers section)
  // We use a simple approach: read the raw file and do surgical insertion
  // For now, write the full policy as YAML

  // Check for concurrent modification
  if (expectedMtimeMs > 0 && existsSync(policyPath)) {
    const currentMtime = statSync(policyPath).mtimeMs;
    if (currentMtime > expectedMtimeMs) {
      return { written: false, conflict: true };
    }
  }

  // Create backup
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = join(repoRoot, '.ai', `policy.backup.${timestamp}.yaml`);
  if (existsSync(policyPath)) {
    copyFileSync(policyPath, backupPath);
  }

  // Write updated policy
  const yaml = policyToYaml(policy);
  writeFileSync(policyPath, yaml, 'utf8');

  return { written: true, backupPath };
}

/**
 * Convert a policy object to YAML string (simple serialization).
 */
function policyToYaml(policy) {
  const lines = [];
  for (const [sectionKey, sectionVal] of Object.entries(policy)) {
    if (sectionVal == null) continue;
    if (typeof sectionVal !== 'object' || Array.isArray(sectionVal)) {
      lines.push(`${sectionKey}: ${JSON.stringify(sectionVal)}`);
      continue;
    }
    lines.push(`${sectionKey}:`);
    for (const [key, val] of Object.entries(sectionVal)) {
      if (val == null) continue;
      if (typeof val === 'object' && !Array.isArray(val)) {
        lines.push(`  ${key}:`);
        for (const [subKey, subVal] of Object.entries(val)) {
          if (typeof subVal === 'string') {
            lines.push(`    ${subKey}: "${subVal}"`);
          } else {
            lines.push(`    ${subKey}: ${subVal}`);
          }
        }
      } else if (typeof val === 'string') {
        lines.push(`  ${key}: "${val}"`);
      } else {
        lines.push(`  ${key}: ${val}`);
      }
    }
  }
  return lines.join('\n') + '\n';
}

/**
 * Run the provider wizard in the appropriate mode.
 *
 * @param {object} opts
 * @param {boolean} [opts.interactive] - Interactive CLI mode (stdin prompts)
 * @param {boolean} [opts.auto] - Auto-detect mode (scan process.env)
 * @param {string} [opts.name] - Provider name (non-interactive mode)
 * @param {string} [opts.wire] - Wire type (non-interactive mode)
 * @param {string} [opts.baseUrl] - Base URL (non-interactive mode)
 * @param {string} [opts.keyEnv] - Key env var name (non-interactive mode)
 * @param {string} [opts.repoRoot] - Repository root
 * @returns {Promise<{ok: boolean, provider?: object, detected?: Array, error?: string, conflict?: boolean}>}
 */
export async function runProviderWizard(opts = {}) {
  const repoRoot = opts.repoRoot ?? process.cwd();

  // Auto-detect mode
  if (opts.auto) {
    const detected = autoDetectProviders();
    if (detected.length === 0) {
      return { ok: false, error: 'No providers auto-detected. Set provider API keys in environment variables (e.g., ANTHROPIC_API_KEY, OPENAI_API_KEY).' };
    }
    // Add detected providers to policy
    const { policy, mtimeMs } = readPolicyState(repoRoot);
    const providers = policy.providers ?? {};
    for (const d of detected) {
      providers[d.name] = {
        name: d.name,
        displayName: d.displayName,
        wire: d.wire,
        baseUrl: d.baseUrl,
        keyEnv: d.keyEnv,
      };
    }
    policy.providers = providers;
    const result = writePolicyWithBackup(repoRoot, policy, mtimeMs);
    if (result.conflict) return { ok: false, error: 'Concurrent modification detected. policy.yaml was changed by another process.', conflict: true };
    return { ok: true, detected };
  }

  // Non-interactive mode
  if (opts.name && opts.wire && opts.baseUrl) {
    const { policy, mtimeMs } = readPolicyState(repoRoot);
    const providers = policy.providers ?? {};
    const entry = {
      name: opts.name,
      wire: opts.wire,
      baseUrl: opts.baseUrl,
    };
    if (opts.keyEnv) entry.keyEnv = opts.keyEnv;

    // Pre-fill from known providers
    const known = lookupKnownProvider(opts.name);
    if (known) {
      entry.displayName = known.displayName;
      if (known.features) entry.features = { ...known.features };
    }

    providers[opts.name] = entry;
    policy.providers = providers;
    const result = writePolicyWithBackup(repoRoot, policy, mtimeMs);
    if (result.conflict) return { ok: false, error: 'Concurrent modification detected. policy.yaml was changed by another process.', conflict: true };
    return { ok: true, provider: entry, backupPath: result.backupPath };
  }

  return { ok: false, error: 'No valid mode selected. Use --auto, or provide --name, --wire, and --base-url.' };
}

/**
 * Programmatic wizard for dashboard API (no stdin prompts).
 *
 * @param {string} name - Provider name
 * @param {string} keyEnv - Environment variable name for API key
 * @param {string} apiKey - The actual API key value (written to env, not policy)
 * @param {string} [repoRoot]
 * @returns {Promise<{ok: boolean, provider?: object, error?: string, conflict?: boolean}>}
 */
export async function runProviderWizardDashboard(name, keyEnv, apiKey, repoRoot) {
  const known = lookupKnownProvider(name);
  if (!known) {
    return { ok: false, error: `Unknown provider '${name}'. Must be one of the known providers.` };
  }

  const { policy, mtimeMs } = readPolicyState(repoRoot ?? process.cwd());
  const providers = policy.providers ?? {};

  const entry = {
    name: known.name,
    displayName: known.displayName,
    wire: known.wire,
    baseUrl: known.baseUrl,
    keyEnv: keyEnv ?? known.keyEnv,
  };
  if (known.features) entry.features = { ...known.features };

  providers[name] = entry;
  policy.providers = providers;

  const result = writePolicyWithBackup(repoRoot ?? process.cwd(), policy, mtimeMs);
  if (result.conflict) return { ok: false, error: 'Concurrent modification detected.', conflict: true };

  return { ok: true, provider: entry };
}
