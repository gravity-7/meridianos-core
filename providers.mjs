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
 * Three-source merge (003 — Provider & Model Agnosticism):
 *   1. policy.yaml `providers:` key (HIGHEST priority — user overrides)
 *   2. .ai/providers.yaml (MIDDLE — wizard-generated local state)
 *   3. providers.defaults.yaml (LOWEST — built-in defaults shipped with the project)
 *
 * Merge rules:
 *   - Top-level fields are merged shallowly (higher source wins)
 *   - `headers` and `features` objects are merged deeply (individual keys overridden)
 *   - A provider's `null` value in a higher source hides it from the resolved list
 *   - `models` merges per-tier rather than wholesale
 *
 * Backward compatibility: `PROVIDERS` is a Proxy-based lazy getter that resolves via
 * `resolveAllProviders()`. All existing call sites continue to work without changes.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPolicy } from './budget.mjs';
import { TIERS } from './model-router.mjs';
import { parseYaml } from './yaml-lite.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const VALID_WIRES = ['anthropic', 'openai', 'google-ai', 'generic-http'];

// ─── Registry (code defaults — kept for backward compat, also used as fallback) ───

const BUILTIN_PROVIDERS = {
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
    if (entry.wire !== undefined && !VALID_WIRES.includes(entry.wire)) {
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

/**
 * Return the set of valid wire names from the registered WireAdapters.
 * Falls back to the static VALID_WIRES list if the WireAdapter registry is not available.
 */
export function getValidWires() {
  return [...VALID_WIRES];
}

// ─── Three-Source Merge Engine (003 — Provider & Model Agnosticism) ────────

/**
 * Deep-merge two objects. Fields in `higher` override fields in `lower`.
 * For `headers` and `features` sub-objects, merges deeply (individual keys overridden).
 * A `null` value in `higher` for a top-level field means "remove this field."
 */
function deepMergeProviders(lower, higher) {
  if (!lower && !higher) return null;
  if (!lower) return { ...higher };
  if (!higher) return { ...lower };

  const merged = { ...lower };
  for (const [key, val] of Object.entries(higher)) {
    // null override: remove the field
    if (val === null) {
      delete merged[key];
      continue;
    }
    // Deep merge for headers and features
    if ((key === 'headers' || key === 'features') && typeof val === 'object' && !Array.isArray(val)) {
      merged[key] = { ...(lower[key] ?? {}), ...val };
    } else if (key === 'models' && typeof val === 'object' && !Array.isArray(val)) {
      // models merge per-tier
      merged[key] = { ...(lower[key] ?? {}), ...val };
    } else {
      merged[key] = val;
    }
  }
  return merged;
}

/**
 * Read the YAML defaults file shipped with the project.
 * Returns parsed providers object or empty object if file missing/unparseable.
 */
function loadDefaultsYaml() {
  const defaultsPath = join(HERE, 'providers.defaults.yaml');
  try {
    if (!existsSync(defaultsPath)) return {};
    const raw = readFileSync(defaultsPath, 'utf8');
    const parsed = parseYaml(raw);
    return parsed?.providers ?? {};
  } catch {
    return {};
  }
}

/**
 * Resolve only version-controlled provider metadata shipped with MeridianOS. Unlike
 * `resolveAllProviders`, this deliberately ignores policy and `.ai/providers.yaml` overlays.
 * It is used for first-time credential collection, where an installation-local endpoint must
 * never be allowed to redirect a newly submitted credential.
 */
export function resolveTrustedSetupProviders() {
  const merged = { ...BUILTIN_PROVIDERS };
  const defaultProviders = loadDefaultsYaml();
  for (const [name, def] of Object.entries(defaultProviders)) {
    merged[name] = deepMergeProviders(merged[name], def);
  }
  return merged;
}

/**
 * Read the local .ai/providers.yaml (wizard-generated state).
 * Returns parsed providers object or empty object if file missing/unparseable.
 */
function loadLocalProvidersYaml(repoRoot) {
  const localPath = join(repoRoot ?? process.cwd(), '.ai', 'providers.yaml');
  try {
    if (!existsSync(localPath)) return {};
    const raw = readFileSync(localPath, 'utf8');
    const parsed = parseYaml(raw);
    return parsed?.providers ?? {};
  } catch {
    return {};
  }
}

/**
 * Resolve ALL providers from the three-source merge.
 *
 * Priority (highest to lowest):
 *   1. policy.yaml `providers:` key — user overrides
 *   2. .ai/providers.yaml — wizard-generated local state
 *   3. providers.defaults.yaml — built-in defaults
 *
 * Also includes the legacy BUILTIN_PROVIDERS as a fallback for code-default providers
 * that aren't in any YAML source (backward compatibility).
 *
 * @param {object} [policy] - Pre-loaded policy object (optional, loads if omitted)
 * @param {object} [config] - AiosConfig for repo root resolution (optional)
 * @returns {object} Flat map of provider name → resolved provider descriptor
 */
export function resolveAllProviders(policy, config) {
  let p = policy;
  if (!p) {
    try {
      p = loadPolicy(undefined, config);
    } catch {
      p = {};
    }
  }
  const repoRoot = config?.repoRoot ?? process.cwd();

  // Load three sources
  const policyProviders = p?.providers ?? {};
  const localProviders = loadLocalProvidersYaml(repoRoot);
  const merged = resolveTrustedSetupProviders();

  // Layer 2: local .ai/providers.yaml (middle priority)
  for (const [name, local] of Object.entries(localProviders)) {
    if (local === null) {
      delete merged[name];
      continue;
    }
    merged[name] = deepMergeProviders(merged[name], local);
  }

  // Layer 3: policy.yaml (highest priority)
  for (const [name, pol] of Object.entries(policyProviders)) {
    // null value at provider level means "hide this provider"
    if (pol === null) {
      delete merged[name];
      continue;
    }
    merged[name] = deepMergeProviders(merged[name], pol);
  }

  // Remove null-valued entries (hidden providers)
  for (const [name, entry] of Object.entries(merged)) {
    if (entry === null || entry === undefined) {
      delete merged[name];
    }
  }

  return merged;
}

// ─── Resolution ─────────────────────────────────────────────────────────────

// Cache for resolveAllProviders — invalidated when policy changes
let _providerCache = null;
let _providerCachePolicy = null;

/**
 * Merge a provider's sources with the three-source merge (003).
 * `models` merges per-tier rather than wholesale, so a policy can override one tier
 * without restating all five. A provider defined only in policy (not in the code registry)
 * resolves too — policy "extends".
 * Returns null if the provider isn't found in any source.
 */
export function resolveProvider(name, policy, config) {
  // `policy` is checked at the BODY level (not a default-parameter expression) so this works no
  // matter where `config` sits positionally — a default param can't reference a later param.
  const all = resolveAllProviders(policy, config);
  return all[name] ?? null;
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

// ─── Backward-Compatible Lazy Getter (003 — Provider & Model Agnosticism) ───

/**
 * `PROVIDERS` — backward-compatible lazy getter.
 *
 * This Proxy intercepts property access on `PROVIDERS` and delegates to
 * `resolveAllProviders()`, so existing code like `PROVIDERS.anthropic` or
 * `Object.keys(PROVIDERS)` continues to work without any changes.
 *
 * The Proxy traps:
 *   - `get(target, prop)` → resolves the named provider via resolveAllProviders()
 *   - `ownKeys(target)` → returns all provider names
 *   - `getOwnPropertyDescriptor(target, prop)` → makes providers enumerable
 */
export const PROVIDERS = new Proxy(
  {},
  {
    get(_target, prop) {
      if (typeof prop === 'symbol') return undefined;
      const all = resolveAllProviders();
      return all[prop];
    },
    ownKeys(_target) {
      const all = resolveAllProviders();
      return Object.keys(all);
    },
    getOwnPropertyDescriptor(_target, prop) {
      const all = resolveAllProviders();
      if (typeof prop === 'string' && prop in all) {
        return { enumerable: true, configurable: true, writable: false };
      }
      return undefined;
    },
  },
);
