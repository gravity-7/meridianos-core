/**
 * providers — the single source of truth describing each LLM provider the AIOS can spawn an
 * agent against. Foundational data layer only: this module defines, validates, and resolves
 * provider descriptors. It does NOT wire into spawning — that's harness adapters (1.2) and
 * model-router provider selection (1.4).
 *
 * BYO-key: a provider references the NAME of an env var holding its key (`keyEnv`), never a
 * literal key. Keys are read from `process.env` at use-time (`providerKeyPresent`), not at
 * load-time — no secrets in the registry, no secrets in the repo.
 *
 * Policy overlay: `.ai/policy.yaml`'s optional `providers:` section overrides/extends these
 * code defaults, the same way `model_routing` overlays a domain's `defaultModels` in
 * model-router.mjs. Absent policy → code defaults. This module never writes policy.yaml.
 */
import { loadPolicy } from './budget.mjs';
import { TIERS } from './model-router.mjs';

const VALID_WIRES = ['anthropic', 'openai'];

// ─── Registry (code defaults) ───────────────────────────────────────────────

export const PROVIDERS = {
  anthropic: {
    name: 'anthropic',
    baseUrl: null, // null = inject nothing; use the CLI's own login (today's behavior)
    wire: 'anthropic',
    keyEnv: null, // no BYO key for the native harness
    // Declarative harness compatibility — which harnesses can talk to this provider.
    // 'antigravity' is absent because antigravity runs native Gemini, not via provider routing.
    harnesses: ['claude-code'],
    models: {
      simple:      'claude-haiku-4-5-20251001',
      medium:      'claude-sonnet-5',
      medium_high: 'claude-sonnet-5',
      complex:     'claude-opus-4-8',
      critical:    'claude-fable-5',
    },
  },
  deepseek: {
    name: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    // DeepSeek exposes both an OpenAI-format endpoint (default, above) and an Anthropic-format
    // one — anthropicBaseUrl — for harnesses (like claude-code) that only speak Anthropic wire.
    wire: 'openai',
    keyEnv: 'DEEPSEEK_KEY',
    anthropicBaseUrl: 'https://api.deepseek.com/anthropic',
    harnesses: ['claude-code', 'opencode'],
    models: {
      simple:      'deepseek-v4-flash',
      medium:      'deepseek-v4-flash',
      medium_high: 'deepseek-v4-flash',
      complex:     'deepseek-v4-pro',
      critical:    'deepseek-v4-pro',
    },
  },
  openrouter: {
    name: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    wire: 'openai',
    keyEnv: 'OPENROUTER_KEY',
    harnesses: ['claude-code', 'opencode'],
    // The universal test key for cheap multi-model eval (1.7) — tier-specific model choice on
    // OpenRouter is that task's concern, not this one, so every tier points at the same route.
    models: {
      simple:      'openrouter/auto',
      medium:      'openrouter/auto',
      medium_high: 'openrouter/auto',
      complex:     'openrouter/auto',
      critical:    'openrouter/auto',
    },
  },
};

// ─── Validation ─────────────────────────────────────────────────────────────

/** Throws on the first malformed entry found. Returns true if the whole registry is well-formed. */
export function validateProviders(registry) {
  for (const [key, entry] of Object.entries(registry)) {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`providers.${key} must be an object`);
    }
    if (entry.name !== key) {
      throw new Error(`providers.${key}.name ('${entry.name}') must match its registry key`);
    }
    if (entry.baseUrl !== null && typeof entry.baseUrl !== 'string') {
      throw new Error(`providers.${key}.baseUrl must be null or a string`);
    }
    if (entry.anthropicBaseUrl !== undefined && entry.anthropicBaseUrl !== null && typeof entry.anthropicBaseUrl !== 'string') {
      throw new Error(`providers.${key}.anthropicBaseUrl must be null, undefined, or a string`);
    }
    if (!VALID_WIRES.includes(entry.wire)) {
      throw new Error(`providers.${key}.wire must be one of ${VALID_WIRES.join(', ')} (got '${entry.wire}')`);
    }
    if (entry.keyEnv !== null && typeof entry.keyEnv !== 'string') {
      throw new Error(`providers.${key}.keyEnv must be null or a string`);
    }
    if (!entry.models || typeof entry.models !== 'object') {
      throw new Error(`providers.${key}.models must be an object`);
    }
    // Tiers are OPTIONAL — a provider may cover only a subset. Missing tiers simply
    // won't be routable for that provider; model-router falls back to the next provider.
    for (const tier of Object.keys(entry.models)) {
      if (!TIERS.includes(tier)) {
        throw new Error(`providers.${key}.models.${tier}: unknown tier (valid: ${TIERS.join(', ')})`);
      }
      if (typeof entry.models[tier] !== 'string' || entry.models[tier].length === 0) {
        throw new Error(`providers.${key}.models.${tier} must be a non-empty model id`);
      }
    }
  }
  return true;
}

// ─── Resolution ─────────────────────────────────────────────────────────────

/**
 * Merge a provider's code default with its policy overlay (policy wins). `models` merges
 * per-tier rather than wholesale, so a policy can override one tier without restating all five.
 * A provider defined only in policy (not in the code registry) resolves too — policy "extends".
 * Returns null if the provider isn't in the code registry or the policy overlay.
 */
export function resolveProvider(name, policy, config) {
  // `policy` is checked at the BODY level (not a default-parameter expression) so this works no
  // matter where `config` sits positionally — a default param can't reference a later param.
  const p = policy ?? loadPolicy(undefined, config);
  const base = PROVIDERS[name];
  const overlay = p?.providers?.[name];
  if (!base && !overlay) return null;
  return {
    ...base,
    ...overlay,
    models: { ...(base?.models ?? {}), ...(overlay?.models ?? {}) },
  };
}

/** The model id a provider uses for a given complexity tier, after the policy overlay. */
export function modelForTier(providerName, tier, policy, config) {
  const descriptor = resolveProvider(providerName, policy, config);
  return descriptor?.models?.[tier] ?? null;
}

/**
 * Is this provider's credential requirement satisfied right now? `keyEnv: null` means no key
 * is needed (e.g. anthropic's native CLI login), so it's trivially satisfied. Otherwise checks
 * whether `process.env[keyEnv]` is set — read at use-time, never cached at load-time.
 */
export function providerKeyPresent(descriptor) {
  if (!descriptor) return false;
  if (descriptor.keyEnv === null || descriptor.keyEnv === undefined) return true;
  return Boolean(process.env[descriptor.keyEnv]);
}

/**
 * Validate that a harness is compatible with a provider. Checks the provider's declarative
 * `harnesses` field. Returns { ok, error? } — never throws, so callers can surface the
 * incompatibility as a diagnosable reason rather than a crash.
 */
export function validateHarnessCompatibility(harness, providerDescriptor) {
  if (!providerDescriptor) return { ok: false, error: 'unknown provider' };
  if (!harness) return { ok: true }; // no harness constraint
  // 'antigravity' runs native Gemini — it's not routed through providers
  if (harness === 'antigravity') return { ok: true };
  const compatible = providerDescriptor.harnesses;
  if (!compatible || compatible.length === 0) return { ok: true }; // no compatibility declared → assume compatible
  if (compatible.includes(harness)) return { ok: true };
  return {
    ok: false,
    error: `harness '${harness}' is not compatible with provider '${providerDescriptor.name}'. Compatible harnesses: ${compatible.join(', ')}`,
  };
}
