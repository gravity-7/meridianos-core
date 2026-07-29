/**
 * pricing — turns metered tokens (usage-readers.mjs) into USD cost via a committed price catalog
 * (tools/aios/pricing.json, keyed provider -> model -> { inputPerM, outputPerM, cachedInputPerM? },
 * USD per 1M tokens — the models.dev unit). Founder-tunable DATA, not code: this module only
 * reads and computes, it never guesses a price. Refreshed by `npm run aios:pricing:refresh`
 * (pricing-refresh.mjs) — manual, opt-in, never run here or in CI.
 *
 * cachedInputPerM is captured in the catalog for a future refinement (splitting cached vs
 * uncached input cost) but unused by costFor today — all input tokens cost at the uncached rate,
 * since usage-readers.mjs doesn't currently split cached vs fresh input tokens per run.
 */
import { readFileSync } from 'node:fs';

/** Parsed catalog, or {} if the file is missing/malformed — callers then see null costs, never a crash.
 *  `config` is the injected AiosConfig (REQUIRED); it only matters when `path` itself is omitted. */
export function loadPricing(path = undefined, config) {
  const p = path ?? config.pricingPath;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return {}; }
}

/**
 * USD cost for one run's usage against the catalog. `usage` is the usage-readers.mjs shape
 * ({ inputTokens, outputTokens, ... }) or any object with numeric inputTokens/outputTokens.
 * Returns null — NEVER a fabricated number — when the provider/model has no price entry.
 * `config` is only consulted when `catalog` itself is omitted (its default loads the real
 * committed catalog via `loadPricing(undefined, config)`).
 */
export function costFor(provider, model, usage, { config, catalog = loadPricing(undefined, config) } = {}) {
  const entry = catalog?.[provider]?.[model];
  if (!entry || typeof entry.inputPerM !== 'number' || typeof entry.outputPerM !== 'number') return null;
  const inputTokens = typeof usage?.inputTokens === 'number' ? usage.inputTokens : 0;
  const outputTokens = typeof usage?.outputTokens === 'number' ? usage.outputTokens : 0;
  const inputCost = (inputTokens / 1_000_000) * entry.inputPerM;
  const outputCost = (outputTokens / 1_000_000) * entry.outputPerM;
  return { inputCost, outputCost, totalCost: inputCost + outputCost };
}

/**
 * Cache-differentiated cost calculation (003 — US6).
 *
 * Formula: (uncachedInput × inputPerM + cachedInput × cachedInputPerM + output × outputPerM) / 1,000,000
 *
 * When a model doesn't support cache-aware pricing (cachedInputPerM is null/undefined),
 * cached tokens are costed at the standard input rate.
 *
 * @param {string} compositeModelId - "provider:model_id" format
 * @param {number} inputTokens - Total input tokens (cached + uncached)
 * @param {number} outputTokens - Total output tokens
 * @param {number} [cachedInputTokens=0] - Number of cache-hit input tokens
 * @param {object} [catalog] - Pricing catalog (loaded if omitted)
 * @param {object} [config] - AiosConfig
 * @returns {number|null} Total cost in USD, or null if pricing unavailable
 */
export function getEffectiveCost(compositeModelId, inputTokens, outputTokens, cachedInputTokens = 0, catalog, config) {
  const [provider, model] = compositeModelId.split(':');
  if (!provider || !model) return null;

  const cat = catalog ?? loadPricing(undefined, config);
  const entry = cat?.[provider]?.[model];
  if (!entry) return null;

  const inputPerM = entry.inputPerM;
  const outputPerM = entry.outputPerM;
  if (typeof inputPerM !== 'number' || typeof outputPerM !== 'number') return null;

  const cachedPerM = typeof entry.cachedInputPerM === 'number' ? entry.cachedInputPerM : inputPerM;
  const uncachedInput = Math.max(0, inputTokens - cachedInputTokens);
  const cachedInput = Math.min(inputTokens, cachedInputTokens);

  const inputCost = (uncachedInput / 1_000_000) * inputPerM;
  const cachedCost = (cachedInput / 1_000_000) * cachedPerM;
  const outputCost = (outputTokens / 1_000_000) * outputPerM;

  return inputCost + cachedCost + outputCost;
}
