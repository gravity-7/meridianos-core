/**
 * model-discovery — orchestrates automated model discovery across all configured providers (US4).
 *
 * Workflow:
 *   1. For each configured provider, resolve the appropriate discovery adapter by wire type
 *   2. Call each adapter's discoverModels() in parallel
 *   3. Catches per-provider errors (doesn't block other providers)
 *   4. Upserts discovered models into the model_registry via model-registry.mjs
 *   5. Marks models no longer seen as deprecated
 *   6. Auto-assigns routing tiers
 */
import { resolveAllProviders } from './providers.mjs';
import { upsertModel, markUnseenAsDeprecated, autoAssignTiers, ensureModelRegistry } from './model-registry.mjs';

/**
 * Discover models from all configured providers and persist to the registry.
 *
 * @param {object} db - better-sqlite3 database instance
 * @param {object} [policy] - Pre-loaded policy (optional)
 * @param {object} [config] - AiosConfig
 * @returns {Promise<{modelsDiscovered: number, providersScanned: number, errors: Array}>}
 */
export async function discoverAllModels(db, policy, config) {
  ensureModelRegistry(db);
  const providers = resolveAllProviders(policy, config);
  const providerNames = Object.keys(providers);
  const errors = [];
  let modelsDiscovered = 0;

  // Discover models from each provider in parallel
  const results = await Promise.allSettled(
    providerNames.map(async (name) => {
      const providerConfig = providers[name];
      const models = await discoverModelsForProvider(providerConfig);
      const seenIds = [];

      for (const model of models) {
        upsertModel(db, name, model);
        seenIds.push(model.model_id);
        modelsDiscovered++;
      }

      // Mark unseen models as deprecated
      markUnseenAsDeprecated(db, name, seenIds);
      return { provider: name, count: models.length };
    }),
  );

  // Collect errors
  for (const result of results) {
    if (result.status === 'rejected') {
      errors.push({ provider: 'unknown', error: result.reason?.message ?? String(result.reason) });
    }
  }

  // Auto-assign tiers after all models are discovered
  autoAssignTiers(db);

  return {
    modelsDiscovered,
    providersScanned: providerNames.length,
    errors,
  };
}

/**
 * Discover models for a single provider by dispatching to the appropriate adapter.
 *
 * @param {object} providerConfig - Resolved provider descriptor
 * @returns {Promise<Array<object>>}
 */
async function discoverModelsForProvider(providerConfig) {
  const { wire } = providerConfig;

  try {
    // Try to load a wire-specific adapter
    let adapter;
    try {
      adapter = await import(`./gateway/model-discovery-adapters/${wire}.mjs`);
    } catch {
      // Fall back to generic-http adapter
      try {
        adapter = await import('./gateway/model-discovery-adapters/generic-http.mjs');
      } catch {
        // No adapter available — return empty
        return [];
      }
    }

    if (typeof adapter.discoverModels === 'function') {
      return await adapter.discoverModels(providerConfig);
    }
  } catch (err) {
    console.error(`[DISCOVERY] Failed to discover models for ${providerConfig.name}: ${err.message}`);
  }

  return [];
}

/**
 * Full model registry refresh cycle — discover all models and assign tiers.
 * Called by the scheduler daily and on-demand via CLI/dashboard.
 *
 * @param {object} db - better-sqlite3 database instance
 * @param {object} [policy]
 * @param {object} [config]
 * @returns {Promise<{modelsDiscovered: number, providersScanned: number, errors: Array}>}
 */
export async function refreshModelRegistry(db, policy, config) {
  console.log('[DISCOVERY] Starting model registry refresh...');
  const result = await discoverAllModels(db, policy, config);
  console.log(`[DISCOVERY] Complete: ${result.modelsDiscovered} models across ${result.providersScanned} providers. ${result.errors.length} errors.`);
  return result;
}
