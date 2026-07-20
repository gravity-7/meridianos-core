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
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PRICING_PATH = join(HERE, 'pricing.json');

/** Parsed catalog, or {} if the file is missing/malformed — callers then see null costs, never a crash.
 *  `config` is the injected AiosConfig; it only matters when `path` itself is omitted. */
export function loadPricing(path = undefined, config) {
  const p = path ?? config?.pricingPath ?? DEFAULT_PRICING_PATH;
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
