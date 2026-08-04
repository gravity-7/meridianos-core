/**
 * plugin-loader — discovery, contract validation, and basic security static analysis for the
 * Phase 7 plugin marketplace (contracts/intake-source-plugin.md). Distinct from
 * intake-registry.mjs's in-process IntakeSource contract (`name`/`list`/`read`) — this is the
 * marketplace/community plugin contract (`fetchTasks`/`createTask`/`updateTask`/`handleWebhook`),
 * loaded from `plugin.json` + `index.mjs` on disk rather than constructed in-process.
 *
 * Validation is intentionally two-layered (FR-019):
 *   1. Static analysis of the SOURCE TEXT, before any code runs — a plugin that fails this is
 *      never imported at all.
 *   2. Duck-typed contract validation of the IMPORTED MODULE — a plugin that passes static
 *      analysis but doesn't implement the required methods is rejected before use.
 * This is "standard" security per the spec's scope (contract + basic static analysis), not a
 * sandbox — plugins still run in-process with full Node.js capability once loaded.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { loadRegistry, recordInstall } from './plugin-registry.mjs';
import { recordPluginInstalled } from './telemetry.mjs';

export const REQUIRED_INTAKE_METHODS = ['fetchTasks', 'createTask', 'updateTask', 'handleWebhook'];

/** Patterns flagged by static analysis, with a human-readable reason for each. Regexes are
 *  intentionally simple (line-based grep, not an AST parse) — see research.md decision #9;
 *  the goal is to catch obviously dangerous plugins, not to be an unbeatable sandbox. */
const DANGEROUS_PATTERNS = [
  { pattern: /\beval\s*\(/, reason: 'uses eval()' },
  { pattern: /new\s+Function\s*\(/, reason: 'uses the Function constructor (equivalent to eval)' },
  { pattern: /\brequire\s*\(\s*['"]child_process['"]\s*\)/, reason: "imports 'child_process'" },
  { pattern: /from\s+['"]node:child_process['"]/, reason: "imports 'node:child_process'" },
  { pattern: /\brequire\s*\(\s*['"](?:fs|node:fs)['"]\s*\)/, reason: "imports the filesystem module ('fs')" },
  { pattern: /from\s+['"]node:fs(?:\/promises)?['"]/, reason: "imports the filesystem module ('node:fs')" },
  { pattern: /\bprocess\s*\.\s*env\b/, reason: 'reads process.env directly (config must come from the injected config object)' },
];

/**
 * Scan plugin source text for common dangerous patterns (FR-019 / research.md #9).
 * @param {string} sourceCode
 * @returns {{safe: boolean, violations: string[]}}
 */
export function analyzePluginSource(sourceCode) {
  const violations = DANGEROUS_PATTERNS
    .filter(({ pattern }) => pattern.test(sourceCode))
    .map(({ reason }) => reason);
  return { safe: violations.length === 0, violations };
}

/**
 * Validate that a loaded plugin module implements the IntakeSource contract (duck typing).
 * @param {Record<string, unknown>} pluginModule
 * @returns {true}
 * @throws {Error} listing every missing method
 */
export function validateIntakeSourceContract(pluginModule) {
  const missing = REQUIRED_INTAKE_METHODS.filter((m) => typeof pluginModule?.[m] !== 'function');
  if (missing.length > 0) {
    throw new Error(`Plugin missing required IntakeSource method(s): ${missing.join(', ')}`);
  }
  return true;
}

/** Read and parse a plugin's `plugin.json`. Throws if missing or malformed. */
function readPluginMetadata(pluginDir) {
  const metaPath = join(pluginDir, 'plugin.json');
  const raw = readFileSync(metaPath, 'utf8');
  const meta = JSON.parse(raw);
  if (!meta.name || !meta.type || !meta.main) {
    throw new Error(`plugin.json at ${metaPath} must include name, type, and main`);
  }
  return meta;
}

/**
 * Load one plugin from a directory: static-analyze its entry file, dynamically import it, then
 * validate the IntakeSource contract. Throws on any failure — callers (discoverPlugins) catch
 * per-plugin so one broken plugin doesn't take down discovery of the rest.
 * @param {string} pluginDir  absolute path to the plugin's root directory
 */
export async function loadPlugin(pluginDir) {
  const metadata = readPluginMetadata(pluginDir);
  const entryPath = join(pluginDir, metadata.main);
  const sourceCode = readFileSync(entryPath, 'utf8');

  const analysis = analyzePluginSource(sourceCode);
  if (!analysis.safe) {
    throw new Error(`Plugin '${metadata.name}' failed static analysis: ${analysis.violations.join('; ')}`);
  }

  const module = await import(pathToFileURL(entryPath).href);
  if (metadata.type === 'intake-source') {
    validateIntakeSourceContract(module);
  }

  return { metadata, module, dir: pluginDir };
}

/** Subdirectories of `dir` that contain a `plugin.json` (non-throwing — missing `dir` yields []). */
function pluginDirsIn(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(dir, entry.name))
    .filter((candidate) => existsSync(join(candidate, 'plugin.json')));
}

/**
 * Auto-discover plugins (FR-015) from `node_modules/@meridian-plugins/intake-{name}` and
 * `.ai/plugins/`. Each candidate is loaded independently — a plugin that fails static analysis,
 * contract validation, or fails to import is reported in `errors` rather than aborting discovery.
 * @param {{repoRoot: string}} config  the injected AiosConfig (only `repoRoot` is used)
 * @param {{logger?: {error(tag: string, msg: string, err?: unknown): void}}} [opts]  optional
 *        daemon-logger instance (see daemon-logger.mjs) — a broken plugin is logged, not thrown,
 *        so one bad plugin never blocks discovery of the rest.
 * @returns {Promise<{loaded: Array<{metadata: object, module: object, dir: string}>, errors: Array<{dir: string, error: string}>}>}
 */
export async function discoverPlugins(config, { logger } = {}) {
  const scopedDir = join(config.repoRoot, 'node_modules', '@meridian-plugins');
  const scopedCandidates = existsSync(scopedDir)
    ? readdirSync(scopedDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.startsWith('intake-'))
        .map((entry) => join(scopedDir, entry.name))
        .filter((candidate) => existsSync(join(candidate, 'plugin.json')))
    : [];

  const localDir = join(config.repoRoot, '.ai', 'plugins');
  const localCandidates = pluginDirsIn(localDir);

  const loaded = [];
  const errors = [];
  for (const dir of [...scopedCandidates, ...localCandidates]) {
    try {
      loaded.push(await loadPlugin(dir));
    } catch (err) {
      const message = String(err?.message || err);
      errors.push({ dir, error: message });
      logger?.error('plugin-loader', `failed to load plugin at ${dir}`, err);
    }
  }
  return { loaded, errors };
}

// ─── Install/enable/config (T068-T071) — the `plugins` + `plugin_configurations` SQLite tables
// track PER-MACHINE state; plugin-registry.mjs's JSON catalog (or BUILTIN_PLUGINS) is where an
// entry's name/description/author/version comes FROM when installing for the first time. ───────

/** Look up a catalog entry by id from the registry file, falling back to BUILTIN_PLUGINS (so a
 *  fresh machine that hasn't run seedBuiltinPlugins() yet can still install one of the 6). */
function catalogEntry(registryPath, pluginId) {
  const entries = loadRegistry(registryPath);
  return entries.find((e) => e.id === pluginId) ?? null;
}

/**
 * Install a plugin: record it in the local `plugins` table (is_installed=1) and bump the
 * catalog's install_count. Throws if `pluginId` isn't in the catalog at all.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} registryPath
 * @param {string} pluginId
 * @param {{logger?: object, policy?: object}} [opts]  `policy` is only used for T104's opt-in
 *        telemetry counter (policy.telemetry.enabled) — omit it and nothing is recorded.
 */
export function installPlugin(db, registryPath, pluginId, { logger, policy } = {}) {
  const entry = catalogEntry(registryPath, pluginId);
  if (!entry) throw new Error(`Plugin '${pluginId}' not found in the marketplace catalog`);

  const now = Math.floor(Date.now() / 1000);
  const existing = db.prepare('SELECT id FROM plugins WHERE id = ?').get(pluginId);
  if (existing) {
    db.prepare('UPDATE plugins SET is_installed = 1, installed_at = ? WHERE id = ?').run(now, pluginId);
  } else {
    db.prepare(
      `INSERT INTO plugins (id, name, type, description, author, version, rating, install_count, repository, is_installed, is_enabled, installed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?)`,
    ).run(entry.id, entry.name, entry.type, entry.description ?? null, entry.author ?? null, entry.version, entry.rating ?? 0, entry.install_count ?? 0, entry.repository ?? null, now);
  }
  try { recordInstall(registryPath, pluginId); } catch { /* registry bookkeeping is best-effort */ }
  logger?.log('plugin-loader', `installed plugin '${pluginId}'`);
  recordPluginInstalled(db, { pluginId }, { policy });
  return db.prepare('SELECT * FROM plugins WHERE id = ?').get(pluginId);
}

/** Uninstall a plugin (is_installed=0, is_enabled=0) — the row is kept, not deleted, so its
 *  config/history isn't lost if the user reinstalls later. */
export function uninstallPlugin(db, pluginId, { logger } = {}) {
  const result = db.prepare('UPDATE plugins SET is_installed = 0, is_enabled = 0 WHERE id = ?').run(pluginId);
  if (result.changes > 0) logger?.log('plugin-loader', `uninstalled plugin '${pluginId}'`);
  return result.changes > 0;
}

function setEnabled(db, pluginId, enabled, logger) {
  const row = db.prepare('SELECT is_installed FROM plugins WHERE id = ?').get(pluginId);
  if (!row) throw new Error(`Plugin '${pluginId}' is not installed`);
  if (!row.is_installed) throw new Error(`Plugin '${pluginId}' must be installed before it can be ${enabled ? 'enabled' : 'disabled'}`);
  db.prepare('UPDATE plugins SET is_enabled = ? WHERE id = ?').run(enabled ? 1 : 0, pluginId);
  logger?.log('plugin-loader', `${enabled ? 'enabled' : 'disabled'} plugin '${pluginId}'`);
  return true;
}

export const enablePlugin = (db, pluginId, { logger } = {}) => setEnabled(db, pluginId, true, logger);
export const disablePlugin = (db, pluginId, { logger } = {}) => setEnabled(db, pluginId, false, logger);

/**
 * Store a plugin's configuration: one row per key in `plugin_configurations` (so `is_sensitive`
 * fields — per plugin.json's config_schema — can be filtered out of any listing UI), plus a
 * denormalized JSON blob on `plugins.config` for a fast single-row read.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} pluginId
 * @param {Record<string, unknown>} configValues
 * @param {{sensitiveKeys?: string[], logger?: object}} [opts]
 */
export function setPluginConfig(db, pluginId, configValues, { sensitiveKeys = [], logger } = {}) {
  const sensitive = new Set(sensitiveKeys);
  db.prepare('DELETE FROM plugin_configurations WHERE plugin_id = ?').run(pluginId);
  for (const [key, value] of Object.entries(configValues)) {
    db.prepare(
      'INSERT INTO plugin_configurations (id, plugin_id, key, value, is_sensitive) VALUES (?, ?, ?, ?, ?)',
    ).run(`plugincfg-${randomUUID()}`, pluginId, key, String(value), sensitive.has(key) ? 1 : 0);
  }
  db.prepare('UPDATE plugins SET config = ? WHERE id = ?').run(JSON.stringify(configValues), pluginId);
  logger?.log('plugin-loader', `updated configuration for plugin '${pluginId}' (${Object.keys(configValues).length} key(s))`);
}

/**
 * Reconstruct a plugin's configuration object from `plugin_configurations`. Sensitive values are
 * omitted by default — pass `includeSensitive: true` only when actually connecting to the
 * external service (never for a UI listing).
 */
export function getPluginConfig(db, pluginId, { includeSensitive = false } = {}) {
  const rows = db.prepare('SELECT key, value, is_sensitive FROM plugin_configurations WHERE plugin_id = ?').all(pluginId);
  const config = {};
  for (const row of rows) {
    if (row.is_sensitive && !includeSensitive) continue;
    config[row.key] = row.value;
  }
  return config;
}

/** Call a loaded plugin module's optional `testConnection`, normalizing the "no such method"
 *  case to a clear result rather than throwing. */
export async function testPluginConnection(pluginModule, config) {
  if (typeof pluginModule.testConnection !== 'function') {
    return { success: true, message: 'This plugin does not implement testConnection — nothing to verify' };
  }
  return pluginModule.testConnection(config);
}

/**
 * T070 — dashboard-ready plugin status: local install/enable state (from `plugins`) joined with
 * catalog metadata (rating/install_count from plugin-registry.mjs), for every plugin either
 * source knows about.
 */
export function pluginStatus(db, registryPath) {
  const installed = db.prepare('SELECT * FROM plugins').all();
  const catalog = loadRegistry(registryPath);

  const merged = new Map();
  for (const entry of catalog) {
    merged.set(entry.id, { ...entry, is_installed: false, is_enabled: false, installed_at: null, config: null });
  }
  for (const row of installed) {
    // rating/install_count are catalog-owned (marketplace-wide, changes independently of any one
    // machine's install) — the local `plugins` row only snapshotted them at install time, so it
    // must NOT override the fresher catalog values here. Everything else (installed/enabled/
    // config) IS this machine's own state and DOES come from the local row.
    const { rating: _staleRating, install_count: _staleCount, ...localOnly } = row;
    merged.set(row.id, { ...merged.get(row.id), ...localOnly, is_installed: !!row.is_installed, is_enabled: !!row.is_enabled });
  }
  return [...merged.values()];
}
