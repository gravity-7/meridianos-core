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
