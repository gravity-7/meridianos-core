/**
 * model-registry — SQLite-backed model storage layer for auto-discovered models (US4).
 *
 * Stores discovered models in the gateway's ledger.db under the `model_registry` table.
 * Composite primary key `provider:model_id` ensures model identity is scoped to provider.
 *
 * Core operations:
 *   - upsertModel(provider, modelData) → INSERT OR REPLACE
 *   - getModels({ provider, tier, deprecated, search }) → filtered SELECT
 *   - markDeprecated(provider, activeModelIds) → batch UPDATE
 *   - autoAssignTiers() → heuristic tier assignment
 */
import { openLedger } from './gateway/ledger.mjs';

// ─── Schema ─────────────────────────────────────────────────────────────────

const ENSURE_SCHEMA = `
CREATE TABLE IF NOT EXISTS model_registry (
    id              TEXT PRIMARY KEY,
    provider        TEXT NOT NULL,
    model_id        TEXT NOT NULL,
    display_name    TEXT,
    context_window  INTEGER,
    max_output_tokens INTEGER,
    features        TEXT DEFAULT '{}',
    pricing_input_per_m         REAL,
    pricing_cached_input_per_m  REAL,
    pricing_output_per_m        REAL,
    pricing_source              TEXT,
    pricing_refreshed           TEXT,
    deprecated      INTEGER DEFAULT 0,
    deprecated_successor TEXT,
    tier_assigned   TEXT,
    last_seen       TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_model_registry_provider ON model_registry(provider);
CREATE INDEX IF NOT EXISTS idx_model_registry_tier ON model_registry(tier_assigned);
CREATE INDEX IF NOT EXISTS idx_model_registry_deprecated ON model_registry(deprecated);
`;

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Ensure the model_registry schema exists in the database.
 * @param {object} db - better-sqlite3 database instance
 */
export function ensureModelRegistry(db) {
  db.exec(ENSURE_SCHEMA);
}

/**
 * Insert or update a model in the registry.
 *
 * @param {object} db - better-sqlite3 database instance
 * @param {string} provider - Provider name
 * @param {object} modelData
 * @param {string} modelData.model_id - Provider-specific model ID
 * @param {string} [modelData.display_name] - Human-readable name
 * @param {number} [modelData.context_window] - Max context window in tokens
 * @param {number} [modelData.max_output_tokens] - Max output tokens
 * @param {object} [modelData.features] - Capability flags object
 * @param {number} [modelData.pricing_input_per_m]
 * @param {number} [modelData.pricing_cached_input_per_m]
 * @param {number} [modelData.pricing_output_per_m]
 * @param {string} [modelData.pricing_source]
 * @param {number} [modelData.deprecated] - 0 or 1
 * @param {string} [modelData.deprecated_successor]
 */
export function upsertModel(db, provider, modelData) {
  ensureModelRegistry(db);
  const id = `${provider}:${modelData.model_id}`;
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO model_registry (
      id, provider, model_id, display_name, context_window, max_output_tokens,
      features, pricing_input_per_m, pricing_cached_input_per_m, pricing_output_per_m,
      pricing_source, pricing_refreshed, deprecated, deprecated_successor,
      last_seen, updated_at
    ) VALUES (
      @id, @provider, @model_id, @display_name, @context_window, @max_output_tokens,
      @features, @pricing_input_per_m, @pricing_cached_input_per_m, @pricing_output_per_m,
      @pricing_source, @pricing_refreshed, @deprecated, @deprecated_successor,
      @last_seen, @updated_at
    ) ON CONFLICT(id) DO UPDATE SET
      display_name = COALESCE(@display_name, display_name),
      context_window = COALESCE(@context_window, context_window),
      max_output_tokens = COALESCE(@max_output_tokens, max_output_tokens),
      features = COALESCE(@features, features),
      pricing_input_per_m = COALESCE(@pricing_input_per_m, pricing_input_per_m),
      pricing_cached_input_per_m = COALESCE(@pricing_cached_input_per_m, pricing_cached_input_per_m),
      pricing_output_per_m = COALESCE(@pricing_output_per_m, pricing_output_per_m),
      pricing_source = COALESCE(@pricing_source, pricing_source),
      pricing_refreshed = COALESCE(@pricing_refreshed, pricing_refreshed),
      deprecated = COALESCE(@deprecated, deprecated),
      deprecated_successor = COALESCE(@deprecated_successor, deprecated_successor),
      last_seen = @last_seen,
      updated_at = @updated_at
  `);

  stmt.run({
    id,
    provider,
    model_id: modelData.model_id,
    display_name: modelData.display_name ?? null,
    context_window: modelData.context_window ?? null,
    max_output_tokens: modelData.max_output_tokens ?? null,
    features: modelData.features ? JSON.stringify(modelData.features) : '{}',
    pricing_input_per_m: modelData.pricing_input_per_m ?? null,
    pricing_cached_input_per_m: modelData.pricing_cached_input_per_m ?? null,
    pricing_output_per_m: modelData.pricing_output_per_m ?? null,
    pricing_source: modelData.pricing_source ?? null,
    pricing_refreshed: modelData.pricing_refreshed ?? null,
    deprecated: modelData.deprecated ?? 0,
    deprecated_successor: modelData.deprecated_successor ?? null,
    last_seen: now,
    updated_at: now,
  });
}

/**
 * Query models from the registry with optional filters.
 *
 * @param {object} db
 * @param {object} [filters]
 * @param {string} [filters.provider] - Filter by provider name
 * @param {string} [filters.tier] - Filter by tier_assigned
 * @param {boolean} [filters.deprecated] - Filter deprecated status (null = all)
 * @param {string} [filters.search] - Search in display_name or model_id
 * @returns {Array<object>}
 */
export function getModels(db, filters = {}) {
  ensureModelRegistry(db);
  const conditions = [];
  const params = {};

  if (filters.provider) {
    conditions.push('provider = @provider');
    params.provider = filters.provider;
  }
  if (filters.tier) {
    conditions.push('tier_assigned = @tier');
    params.tier = filters.tier;
  }
  if (filters.deprecated !== undefined && filters.deprecated !== null) {
    conditions.push('deprecated = @deprecated');
    params.deprecated = filters.deprecated ? 1 : 0;
  }
  if (filters.search) {
    conditions.push('(display_name LIKE @search OR model_id LIKE @search)');
    params.search = `%${filters.search}%`;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM model_registry ${where} ORDER BY provider, model_id`).all(params);

  // Parse JSON features
  return rows.map((row) => ({
    ...row,
    features: safeJsonParse(row.features),
  }));
}

/**
 * Mark models as deprecated that are no longer in the active set.
 *
 * @param {object} db
 * @param {string} provider - Provider name
 * @param {string[]} activeModelIds - List of currently active model IDs
 */
export function markDeprecated(db, provider, activeModelIds) {
  ensureModelRegistry(db);
  if (activeModelIds.length === 0) return;

  const placeholders = activeModelIds.map(() => '?').join(',');
  db.prepare(`
    UPDATE model_registry
    SET deprecated = 1, updated_at = datetime('now')
    WHERE provider = ? AND model_id NOT IN (${placeholders}) AND deprecated = 0
  `).run(provider, ...activeModelIds);
}

/**
 * Mark all unseen models for a provider as deprecated (batch).
 *
 * @param {object} db
 * @param {string} provider
 * @param {string[]} seenIds - Model IDs that were seen in this discovery run
 */
export function markUnseenAsDeprecated(db, provider, seenIds) {
  ensureModelRegistry(db);
  if (seenIds.length === 0) {
    // All models deprecated if none seen
    db.prepare(`
      UPDATE model_registry SET deprecated = 1, updated_at = datetime('now')
      WHERE provider = ? AND deprecated = 0
    `).run(provider);
    return;
  }
  markDeprecated(db, provider, seenIds);
}

/**
 * Auto-assign routing tiers based on context window and pricing heuristics.
 *
 * Tiers:
 *   - quick:  context_window < 32000 OR output_price_per_m < $1.00
 *   - medium: 32000 ≤ context_window < 128000
 *   - best:   context_window ≥ 128000
 *
 * @param {object} db
 */
export function autoAssignTiers(db) {
  ensureModelRegistry(db);

  // Assign 'best' for models with >= 128k context
  db.prepare(`
    UPDATE model_registry SET tier_assigned = 'best', updated_at = datetime('now')
    WHERE context_window >= 128000 AND deprecated = 0
  `).run();

  // Assign 'quick' for models with < 32k context or cheap output
  db.prepare(`
    UPDATE model_registry SET tier_assigned = 'quick', updated_at = datetime('now')
    WHERE deprecated = 0
      AND tier_assigned IS NULL
      AND (context_window < 32000 OR pricing_output_per_m < 1.0)
  `).run();

  // Assign 'medium' for remaining models
  db.prepare(`
    UPDATE model_registry SET tier_assigned = 'medium', updated_at = datetime('now')
    WHERE deprecated = 0 AND tier_assigned IS NULL
  `).run();
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function safeJsonParse(str) {
  try {
    return typeof str === 'string' ? JSON.parse(str) : (str ?? {});
  } catch {
    return {};
  }
}
