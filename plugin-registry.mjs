/**
 * plugin-registry — JSON-based catalog of publishable/installable plugins (FR-017), distinct
 * from the `plugins` SQLite table (schema.sql): this module is the MARKETPLACE CATALOG (what's
 * available, with ratings/install counts/author), while the SQLite table tracks PER-MACHINE
 * install state (is_installed, is_enabled, local config). A dashboard install action reads an
 * entry from here and writes the corresponding row there.
 *
 * Per the spec's assumptions, the registry starts as a simple JSON file (no database) — it can
 * be a local file, or one pulled from a static host / GitHub repo; `loadRegistry`/`saveRegistry`
 * don't care which, they just read/write a path.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const VALID_TYPES = new Set(['intake-source', 'wire-adapter']);
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

/** Default on-disk location for the local registry file. `config` is the injected AiosConfig. */
export function registryPath(config) {
  return join(config.repoRoot, '.ai', 'plugin-registry.json');
}

/** Validate one registry entry against data-model.md's Plugin validation rules. Throws on the
 *  first violation found. */
export function validatePluginEntry(entry) {
  if (!entry?.id || typeof entry.id !== 'string') throw new Error('Plugin entry requires a string id');
  if (!entry.name || typeof entry.name !== 'string') throw new Error('Plugin entry requires a string name');
  if (!VALID_TYPES.has(entry.type)) throw new Error(`Plugin entry type must be one of: ${[...VALID_TYPES].join(', ')}`);
  if (!SEMVER_RE.test(entry.version || '')) throw new Error('Plugin entry version must be semantic (e.g. 1.0.0)');
  const rating = entry.rating ?? 0;
  if (typeof rating !== 'number' || rating < 0 || rating > 5) throw new Error('Plugin entry rating must be between 0 and 5');
  const installCount = entry.install_count ?? 0;
  if (typeof installCount !== 'number' || installCount < 0) throw new Error('Plugin entry install_count must be non-negative');
  return true;
}

/** Load the registry from `path`. Returns `[]` if the file doesn't exist yet (fresh install). */
export function loadRegistry(path) {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

/** Persist `entries` to `path` (creating parent directories as needed), pretty-printed. */
export function saveRegistry(path, entries) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(entries, null, 2) + '\n', 'utf8');
}

/** Add (or replace, by id) a plugin entry in the registry file at `path`. Validates first. */
export function upsertPluginEntry(path, entry) {
  validatePluginEntry(entry);
  const entries = loadRegistry(path);
  const idx = entries.findIndex((e) => e.id === entry.id);
  if (idx >= 0) entries[idx] = { ...entries[idx], ...entry };
  else entries.push(entry);
  saveRegistry(path, entries);
  return entries;
}

/** Remove a plugin entry by id. Returns true if an entry was removed. */
export function removePluginEntry(path, id) {
  const entries = loadRegistry(path);
  const next = entries.filter((e) => e.id !== id);
  saveRegistry(path, next);
  return next.length !== entries.length;
}

/** Increment install_count for a plugin entry (called when a user installs it). */
export function recordInstall(path, id) {
  const entries = loadRegistry(path);
  const entry = entries.find((e) => e.id === id);
  if (!entry) throw new Error(`Plugin '${id}' not found in registry`);
  entry.install_count = (entry.install_count ?? 0) + 1;
  saveRegistry(path, entries);
  return entry;
}

/**
 * Rate a plugin (1-5 stars). Stores a running average in `rating` plus the sample count in
 * `rating_count` (not part of the SQLite schema — registry-only bookkeeping so the average is
 * reproducible without replaying every rating).
 */
export function ratePlugin(path, id, stars) {
  if (typeof stars !== 'number' || stars < 1 || stars > 5) throw new Error('Rating must be between 1 and 5');
  const entries = loadRegistry(path);
  const entry = entries.find((e) => e.id === id);
  if (!entry) throw new Error(`Plugin '${id}' not found in registry`);
  const priorCount = entry.rating_count ?? 0;
  const priorTotal = (entry.rating ?? 0) * priorCount;
  entry.rating_count = priorCount + 1;
  entry.rating = Math.round(((priorTotal + stars) / entry.rating_count) * 100) / 100;
  saveRegistry(path, entries);
  return entry;
}

/** List entries, optionally filtered by type. */
export function listPlugins(path, { type } = {}) {
  const entries = loadRegistry(path);
  return type ? entries.filter((e) => e.type === type) : entries;
}

// ─── Pre-built connectors (FR-013, US4) ─────────────────────────────────────────────────────
//
// These 6 ship WITH core (intake-adapters/*.mjs) rather than being discovered from
// node_modules/@meridian-plugins — they're seeded into the catalog directly so the marketplace
// has something to list on a fresh install (SC-007: "at least 6 pre-built plugins").
export const BUILTIN_PLUGINS = [
  { id: 'jira-source', name: 'Jira', type: 'intake-source', description: 'Import tasks from Jira Cloud/Server', author: 'MeridianOS Team', version: '1.0.0', main: 'intake-adapters/jira-source.mjs', built_in: true },
  { id: 'linear-source', name: 'Linear', type: 'intake-source', description: 'Import tasks from Linear', author: 'MeridianOS Team', version: '1.0.0', main: 'intake-adapters/linear-source.mjs', built_in: true },
  { id: 'notion-source', name: 'Notion', type: 'intake-source', description: 'Import tasks from a Notion database', author: 'MeridianOS Team', version: '1.0.0', main: 'intake-adapters/notion-source.mjs', built_in: true },
  { id: 'github-issues-source', name: 'GitHub Issues', type: 'intake-source', description: 'Import tasks from GitHub Issues', author: 'MeridianOS Team', version: '1.0.0', main: 'intake-adapters/github-issues-source.mjs', built_in: true },
  { id: 'teams-source', name: 'Microsoft Teams', type: 'intake-source', description: 'Import tasks from Microsoft Planner (Teams)', author: 'MeridianOS Team', version: '1.0.0', main: 'intake-adapters/teams-source.mjs', built_in: true },
  { id: 'webhook-source', name: 'Generic Webhook', type: 'intake-source', description: 'Turn any JSON payload into tasks via configurable field mappings', author: 'MeridianOS Team', version: '1.0.0', main: 'intake-adapters/webhook-source.mjs', built_in: true },
];

/** Seed (or re-seed, non-destructively) the registry file with the 6 built-in connectors —
 *  existing entries (including any rating/install_count already accrued) are left untouched;
 *  only missing built-ins are added. Idempotent — safe to call on every daemon boot. */
export function seedBuiltinPlugins(path) {
  const entries = loadRegistry(path);
  const existingIds = new Set(entries.map((e) => e.id));
  let changed = false;
  for (const builtin of BUILTIN_PLUGINS) {
    if (!existingIds.has(builtin.id)) {
      entries.push({ ...builtin, rating: 0, install_count: 0 });
      changed = true;
    }
  }
  if (changed) saveRegistry(path, entries);
  return entries;
}
