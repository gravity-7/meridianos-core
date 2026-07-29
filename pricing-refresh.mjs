/**
 * pricing-refresh — OPT-IN, manual-only refresh of tools/aios/pricing.json from public,
 * no-auth pricing sources. Never runs in CI or any hot path; only `npm run aios:pricing:refresh`
 * invokes the network-touching `main()` below (guarded by the import.meta.url check at the
 * bottom of this file). Importing this module for its pure functions (as the tests do) never
 * makes a network call.
 *
 * Sources:
 *   - models.dev's aggregated catalog (https://models.dev/api.json) for anthropic + deepseek —
 *     every model's `cost` is already USD-per-1M-tokens, the same unit pricing.json uses, so
 *     those two providers need only a reshape (normalizeModelsDev), no unit conversion.
 *     (models.dev also publishes an `/api/pricing.json` alias for the same data; it currently
 *     302-redirects to the site's homepage rather than serving JSON, so this module talks to the
 *     stable `/api.json` endpoint directly.)
 *   - OpenRouter's own `/api/v1/models` for the openrouter provider — deliberately NOT sourced
 *     from models.dev's openrouter mirror, per the spec: OpenRouter prices come from OpenRouter
 *     itself. Its `pricing.prompt`/`pricing.completion` are USD-per-TOKEN decimal strings, so
 *     normalizeOpenRouter multiplies by 1e6 to land in the same per-1M unit as everything else.
 *
 * Both providers/models this repo doesn't track are ignored — the registry (providers.mjs) is
 * the source of truth for which providers matter; this script only ever fills in prices for
 * providers already known there.
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadPricing } from './pricing.mjs';
import { PROVIDERS } from './providers.mjs';
import { createAios } from './config.mjs';

export const MODELS_DEV_URL = 'https://models.dev/api.json';
export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

/**
 * Reshape models.dev's { models: { modelId: { cost: {input, output, cache_read} } } } per
 * provider into pricing.json's { modelId: { inputPerM, outputPerM, cachedInputPerM? } }.
 * `providerNames` scopes this to providers we actually track (anthropic, deepseek) — a
 * models.dev provider with no `cost.input`/`cost.output` numbers is skipped, never guessed.
 */
export function normalizeModelsDev(raw, providerNames) {
  const out = {};
  for (const name of providerNames) {
    const models = raw?.[name]?.models;
    if (!models || typeof models !== 'object') continue;
    const entries = {};
    for (const [modelId, m] of Object.entries(models)) {
      const cost = m?.cost;
      if (!cost || typeof cost.input !== 'number' || typeof cost.output !== 'number') continue;
      const entry = { inputPerM: cost.input, outputPerM: cost.output };
      if (typeof cost.cache_read === 'number') entry.cachedInputPerM = cost.cache_read;
      entries[modelId] = entry;
    }
    if (Object.keys(entries).length) out[name] = entries;
  }
  return out;
}

/**
 * Reshape OpenRouter's { data: [{ id, pricing: { prompt, completion, input_cache_read } }] }
 * (USD-per-token decimal strings) into { modelId: { inputPerM, outputPerM, cachedInputPerM? } }.
 * A model with a non-numeric or missing prompt/completion price is skipped rather than guessed.
 */
// Per-token decimal strings * 1e6 routinely lands on a binary-float neighbor of a clean decimal
// (e.g. 0.0000001 * 1e6 -> 0.09999999999999999) — round to 6dp so pricing.json stays readable
// and diffCatalogs doesn't flag a "change" that's really just float noise on every refresh.
const round6 = (n) => Math.round(n * 1e6) / 1e6;

export function normalizeOpenRouter(raw) {
  const out = {};
  for (const m of raw?.data ?? []) {
    const id = m?.id;
    const pricing = m?.pricing;
    if (!id || !pricing) continue;
    const input = Number(pricing.prompt);
    const output = Number(pricing.completion);
    if (!Number.isFinite(input) || !Number.isFinite(output)) continue;
    const entry = { inputPerM: round6(input * 1_000_000), outputPerM: round6(output * 1_000_000) };
    const cacheRead = Number(pricing.input_cache_read);
    if (Number.isFinite(cacheRead) && cacheRead > 0) entry.cachedInputPerM = round6(cacheRead * 1_000_000);
    out[id] = entry;
  }
  return out;
}

/**
 * Merge fresh provider sections into the previous catalog. Each provider section named in
 * `fresh` fully REPLACES the previous one (a model that disappeared from the upstream source
 * disappears from pricing.json too, rather than lingering with a stale price); a provider not
 * present in `fresh` (e.g. openrouter fetch was skipped) is left exactly as it was.
 */
export function mergeCatalog(previous, fresh) {
  return { ...previous, ...fresh };
}

/** Flat list of { provider, model, from, to } for every added/removed/changed price. */
export function diffCatalogs(previous, next) {
  const changes = [];
  const providers = new Set([...Object.keys(previous ?? {}), ...Object.keys(next ?? {})]);
  for (const provider of providers) {
    const before = previous?.[provider] ?? {};
    const after = next?.[provider] ?? {};
    const models = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const model of models) {
      const from = before[model] ?? null;
      const to = after[model] ?? null;
      if (JSON.stringify(from) !== JSON.stringify(to)) changes.push({ provider, model, from, to });
    }
  }
  return changes;
}

function printDiff(changes) {
  if (!changes.length) { console.log('pricing.json: no changes.'); return; }
  console.log(`pricing.json: ${changes.length} change(s):`);
  for (const { provider, model, from, to } of changes) {
    const tag = !from ? 'added' : !to ? 'removed' : 'changed';
    console.log(`  [${tag}] ${provider}/${model}: ${JSON.stringify(from)} -> ${JSON.stringify(to)}`);
  }
}

/** The full refresh: fetch, normalize, merge, diff, write. Network-only entry point. `path`
 *  is REQUIRED — the CLI entry below constructs a config via createAios() and passes
 *  config.pricingPath explicitly. */
export async function refresh({ includeOpenRouter = true, path, fetchImpl = fetch } = {}) {
  const previous = loadPricing(path);
  const modelsDevProviders = Object.keys(PROVIDERS).filter((name) => name !== 'openrouter');

  const modelsDevRes = await fetchImpl(MODELS_DEV_URL);
  if (!modelsDevRes.ok) throw new Error(`models.dev fetch failed: HTTP ${modelsDevRes.status}`);
  const modelsDevRaw = await modelsDevRes.json();
  const fresh = normalizeModelsDev(modelsDevRaw, modelsDevProviders);

  if (includeOpenRouter) {
    try {
      const orRes = await fetchImpl(OPENROUTER_MODELS_URL);
      if (orRes.ok) fresh.openrouter = normalizeOpenRouter(await orRes.json());
      else console.warn(`OpenRouter fetch skipped: HTTP ${orRes.status}`);
    } catch (e) {
      console.warn(`OpenRouter fetch skipped: ${e?.message || e}`);
    }
  }

  const next = mergeCatalog(previous, fresh);
  const changes = diffCatalogs(previous, next);
  printDiff(changes);
  if (changes.length) writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
  return { previous, next, changes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const skipOpenRouter = process.argv.includes('--skip-openrouter');
  // Diagnostic-only default plugin — see budget.mjs's identical comment. pricingPath is a pure
  // path field, unaffected by domain, so any plugin works here.
  const DIAG_DOMAIN = { agents: ['a', 'b'], prompts: { implRules: [], reviewCriteria: [] }, guardrailCheck: null, boardTitle: 'AIOS', riskToAction: {}, knownRiskTags: [] };
  const { config } = createAios({ domain: DIAG_DOMAIN });
  refresh({ includeOpenRouter: !skipOpenRouter, path: config.pricingPath }).catch((e) => {
    console.error(`aios:pricing:refresh failed: ${e?.message || e}`);
    process.exitCode = 1;
  });
}

// ─── Model Registry Pricing Refresh (003 — US6) ─────────────────────────

/**
 * Refresh per-model pricing stored in the model_registry SQLite table using
 * the 4-tier fallback chain: provider-native → OpenRouter → models.dev → cache.
 *
 * @param {object} db - better-sqlite3 database instance
 * @param {object} [policy]
 * @param {object} [config]
 * @returns {Promise<{refreshed: number, failed: number, details: Array}>}
 */
export async function refreshAllModelPricing(db, policy, config) {
  // Lazy-load to avoid circular dependency
  const { getModels, upsertModel, ensureModelRegistry } = await import('./model-registry.mjs');
  const { resolveAllProviders } = await import('./providers.mjs');

  ensureModelRegistry(db);
  const providers = resolveAllProviders(policy, config);
  const models = getModels(db, { deprecated: false });
  const now = new Date().toISOString();
  let refreshed = 0;
  let failed = 0;
  const details = [];

  for (const model of models) {
    const providerConfig = providers[model.provider];
    if (!providerConfig) {
      failed++;
      details.push({ model: model.id, error: 'unknown provider', ok: false });
      continue;
    }

    try {
      const pricing = await refreshModelPricing(model, providerConfig, db);
      upsertModel(db, model.provider, {
        model_id: model.model_id,
        pricing_input_per_m: pricing.inputPerM,
        pricing_cached_input_per_m: pricing.cachedInputPerM,
        pricing_output_per_m: pricing.outputPerM,
        pricing_source: pricing.source,
        pricing_refreshed: now,
      });

      // Price change detection
      if (model.pricing_input_per_m != null && pricing.inputPerM != null) {
        const change = Math.abs((pricing.inputPerM - model.pricing_input_per_m) / model.pricing_input_per_m);
        if (change > 0.5) {
          console.log(`[PRICING] ALERT: ${model.id} input price changed ${(change * 100).toFixed(0)}%`);
        } else if (change > 0.1) {
          console.log(`[PRICING] NOTIFY: ${model.id} input price changed ${(change * 100).toFixed(0)}%`);
        }
      }

      details.push({ model: model.id, source: pricing.source, ok: true });
      refreshed++;
    } catch (err) {
      details.push({ model: model.id, error: err.message, ok: false });
      failed++;
    }
  }

  console.log(`[PRICING] Refreshed ${refreshed} model prices, ${failed} failures`);
  return { refreshed, failed, details };
}

/**
 * Refresh pricing for a single model using the 4-tier fallback chain.
 *
 * @param {object} model - Model row from model_registry
 * @param {object} providerConfig - Resolved provider descriptor
 * @param {object} db - better-sqlite3 database instance
 * @returns {Promise<{inputPerM: number|null, cachedInputPerM: number|null, outputPerM: number|null, source: string}>}
 */
async function refreshModelPricing(model, providerConfig, db) {
  const { model_id } = model;

  // Tier 1: Provider-native pricing
  const native = await tryProviderPricing(providerConfig, model_id);
  if (native) return { ...native, source: 'provider-native' };

  // Tier 2: OpenRouter pricing
  const or = await tryOpenRouterModelPricing(model_id);
  if (or) return { ...or, source: 'openrouter' };

  // Tier 3: models.dev pricing
  const md = await tryModelsDevModelPricing(model.provider, model_id);
  if (md) return { ...md, source: 'models-dev' };

  // Tier 4: Last-known-good cache
  if (model.pricing_input_per_m != null || model.pricing_output_per_m != null) {
    return {
      inputPerM: model.pricing_input_per_m ?? null,
      cachedInputPerM: model.pricing_cached_input_per_m ?? null,
      outputPerM: model.pricing_output_per_m ?? null,
      source: 'cache',
    };
  }

  return { inputPerM: null, cachedInputPerM: null, outputPerM: null, source: 'none' };
}

async function tryProviderPricing(providerConfig, modelId) {
  if (providerConfig.wire === 'anthropic') {
    // Read from data file per Constitution V (Configuration over Code).
    // New Anthropic models only require updating pricing-anthropic.json — no code change.
    const { readFileSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const HERE = dirname(fileURLToPath(import.meta.url));
    try {
      const raw = readFileSync(join(HERE, 'pricing-anthropic.json'), 'utf8');
      const data = JSON.parse(raw);
      const models = data?.models ?? {};
      // Exact match first, then prefix match
      if (models[modelId]) {
        const r = models[modelId];
        return { inputPerM: r.inputPerM, cachedInputPerM: r.cachedInputPerM, outputPerM: r.outputPerM };
      }
      if (data._prefixMatch) {
        for (const [prefix, rates] of Object.entries(models)) {
          if (modelId.startsWith(prefix)) {
            return { inputPerM: rates.inputPerM, cachedInputPerM: rates.cachedInputPerM, outputPerM: rates.outputPerM };
          }
        }
      }
    } catch { /* file missing — fall through to next tier */ }
  }
  return null;
}

async function tryOpenRouterModelPricing(modelId) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(OPENROUTER_MODELS_URL, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) return null;

    const body = await response.json();
    const models = body?.data ?? [];
    const found = models.find((m) => m.id === modelId || m.id?.endsWith(`:${modelId}`));
    if (!found?.pricing) return null;

    const input = Number(found.pricing.prompt);
    const output = Number(found.pricing.completion);
    if (!Number.isFinite(input) || !Number.isFinite(output)) return null;

    return {
      inputPerM: round6(input * 1_000_000),
      cachedInputPerM: null,
      outputPerM: round6(output * 1_000_000),
    };
  } catch {
    return null;
  }
}

async function tryModelsDevModelPricing(provider, modelId) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const url = `https://models.dev/api/v1/models/${encodeURIComponent(provider)}/${encodeURIComponent(modelId)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) return null;

    const body = await response.json();
    if (!body?.pricing) return null;
    return {
      inputPerM: body.pricing.input_per_million ?? null,
      cachedInputPerM: body.pricing.cached_input_per_million ?? null,
      outputPerM: body.pricing.output_per_million ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Check if pricing data is stale (>7 days since last refresh).
 * @param {string} pricingRefreshed - ISO-8601 timestamp
 * @returns {boolean}
 */
export function isPricingStale(pricingRefreshed) {
  if (!pricingRefreshed) return true;
  const refreshed = new Date(pricingRefreshed).getTime();
  return (Date.now() - refreshed) > 7 * 24 * 60 * 60 * 1000;
}
