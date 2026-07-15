/**
 * provider-registry — the serializable envelope a control plane pushes down to the gateway
 * sidecar, telling it which providers exist (DOWN direction) and where to really dial them.
 * Push/pull reconciliation between control plane and sidecar is 3.4's concern; this module only
 * defines the shape + validation + route lookup.
 *
 * The `providers` map reuses providers.mjs's descriptor shape verbatim (name, baseUrl, wire,
 * keyEnv, anthropicBaseUrl?, models{tier→id}) — validated by composing `validateProviders` from
 * providers.mjs rather than forking its per-entry logic.
 *
 * `routes` is the sidecar-only real-upstream map: `keyEnv` is always the NAME of an env var,
 * never a literal key — validated with the same shape providers.mjs enforces for BYO-key names.
 */
import { validateProviders } from '../providers.mjs';

const VALID_WIRES = ['anthropic', 'openai'];
const KEY_ENV_NAME_RE = /^[A-Z][A-Z0-9_]*$/;

function isKeyEnvName(v) {
  return v === null || (typeof v === 'string' && KEY_ENV_NAME_RE.test(v));
}

function isNumberOrNull(v) {
  return v === null || typeof v === 'number';
}

function validateCapPair(obj, path) {
  if (obj === undefined) return;
  if (!obj || typeof obj !== 'object') {
    throw new Error(`provider-registry.${path} must be an object`);
  }
  if ('per5hTokens' in obj && !isNumberOrNull(obj.per5hTokens)) {
    throw new Error(`provider-registry.${path}.per5hTokens must be a number or null`);
  }
  if ('perWeekTokens' in obj && !isNumberOrNull(obj.perWeekTokens)) {
    throw new Error(`provider-registry.${path}.perWeekTokens must be a number or null`);
  }
}

/** Throws on the first malformed field. Returns true when the registry is well-formed. */
export function validateProviderRegistry(reg) {
  if (!reg || typeof reg !== 'object') {
    throw new Error('provider-registry must be an object');
  }
  if (!Number.isInteger(reg.version)) {
    throw new Error('provider-registry.version must be an integer');
  }
  if (typeof reg.generatedAt !== 'string' || reg.generatedAt.length === 0) {
    throw new Error('provider-registry.generatedAt must be a non-empty ISO-8601 string');
  }
  if (typeof reg.tenant !== 'string' || reg.tenant.length === 0) {
    throw new Error('provider-registry.tenant must be a non-empty string');
  }
  if (!reg.providers || typeof reg.providers !== 'object') {
    throw new Error('provider-registry.providers must be an object');
  }
  validateProviders(reg.providers);

  if (!reg.routes || typeof reg.routes !== 'object') {
    throw new Error('provider-registry.routes must be an object');
  }
  for (const [name, route] of Object.entries(reg.routes)) {
    if (!route || typeof route !== 'object') {
      throw new Error(`provider-registry.routes.${name} must be an object`);
    }
    if (typeof route.upstreamUrl !== 'string' || route.upstreamUrl.length === 0) {
      throw new Error(`provider-registry.routes.${name}.upstreamUrl must be a non-empty string`);
    }
    if (!VALID_WIRES.includes(route.wire)) {
      throw new Error(`provider-registry.routes.${name}.wire must be one of ${VALID_WIRES.join(', ')} (got '${route.wire}')`);
    }
    if (!isKeyEnvName(route.keyEnv)) {
      throw new Error(`provider-registry.routes.${name}.keyEnv must be null or an env-var NAME (e.g. 'DEEPSEEK_KEY'), never a literal key`);
    }
    if (!(name in reg.providers)) {
      throw new Error(`provider-registry.routes.${name} references a provider not present in providers`);
    }
    // `thinking` is an OPTIONAL, off-by-default route field (gateway/server.mjs's
    // applyThinkingToBody reads it) — light validation only: when present it must be a boolean
    // (enable, no effort) or a plain object (e.g. `{ effort: 'high' }`). Not required.
    if ('thinking' in route && route.thinking !== undefined) {
      const t = route.thinking;
      const isPlainObject = t !== null && typeof t === 'object' && !Array.isArray(t);
      if (typeof t !== 'boolean' && !isPlainObject) {
        throw new Error(`provider-registry.routes.${name}.thinking must be a boolean or a plain object (got ${typeof t})`);
      }
    }
  }

  if (reg.enforcement !== undefined && reg.enforcement !== null) {
    if (typeof reg.enforcement !== 'object') {
      throw new Error('provider-registry.enforcement must be an object');
    }
    validateCapPair(reg.enforcement.default, 'enforcement.default');
    if (reg.enforcement.perProvider !== undefined && reg.enforcement.perProvider !== null) {
      if (typeof reg.enforcement.perProvider !== 'object') {
        throw new Error('provider-registry.enforcement.perProvider must be an object');
      }
      for (const [name, caps] of Object.entries(reg.enforcement.perProvider)) {
        validateCapPair(caps, `enforcement.perProvider.${name}`);
      }
    }
  }

  return true;
}

/** The route's `{ upstreamUrl, wire, keyEnv, thinking? }` for `providerName`, or null if absent.
 * `thinking` is only present on the returned object when the underlying route carries it — a
 * route without a thinking config yields the exact same 3-key shape as before (byte-identical),
 * and `route.thinking` reads as `undefined` (falsy — the off-by-default case) rather than `null`. */
export function resolveRoute(reg, providerName) {
  const route = reg?.routes?.[providerName];
  if (!route) return null;
  return {
    upstreamUrl: route.upstreamUrl,
    wire: route.wire,
    keyEnv: route.keyEnv,
    ...(route.thinking != null ? { thinking: route.thinking } : {}),
  };
}
