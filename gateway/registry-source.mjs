/**
 * registry-source — builds the provider-registry envelope (provider-registry.mjs's shape) FROM
 * providers.mjs + policy, in-process, for a single tenant. This is the "down" artifact half of
 * 3.4 (control plane → sidecar); push/pull reconciliation over the wire is 3.4b.
 *
 * Only BYO-key providers with a real upstream endpoint get a `routes` entry — the native
 * anthropic provider (baseUrl===null && keyEnv===null) uses the CLI's own login and never talks
 * to the gateway, so it's deliberately omitted from `routes` (still present in `providers`).
 *
 * keyEnv guarantee: providers.mjs/provider-registry.mjs already validate that `routes.*.keyEnv`
 * is a NAME, never a literal secret. This module additionally checks `providers.*.keyEnv` too —
 * closing the 3.1 review nit that only the routes half was checked — before the envelope ever
 * leaves this process.
 */
import { PROVIDERS, resolveProvider } from '../providers.mjs';
import { validateProviderRegistry } from './provider-registry.mjs';

const KEY_ENV_NAME_RE = /^[A-Z][A-Z0-9_]*$/;

function isKeyEnvName(v) {
  return v === null || (typeof v === 'string' && KEY_ENV_NAME_RE.test(v));
}

/** Throws if any keyEnv, in either half of the envelope, looks like a literal secret. */
function assertKeyEnvGuarantee(reg) {
  for (const [name, descriptor] of Object.entries(reg.providers)) {
    if (!isKeyEnvName(descriptor.keyEnv)) {
      throw new Error(`registry-source: providers.${name}.keyEnv looks like a literal secret, not an env-var NAME`);
    }
  }
  for (const [name, route] of Object.entries(reg.routes)) {
    if (!isKeyEnvName(route.keyEnv)) {
      throw new Error(`registry-source: routes.${name}.keyEnv looks like a literal secret, not an env-var NAME`);
    }
  }
}

/**
 * Builds a provider-registry envelope for `tenant` from providers.mjs's code defaults + the
 * policy overlay (via resolveProvider — this never reforks that resolution logic). `now` is
 * injectable so `generatedAt` is deterministic in tests.
 */
export function buildProviderRegistry({ policy, config, tenant = 'pv', version = 1, now = Date.now() }) {
  const providers = {};
  const routes = {};

  for (const name of Object.keys(PROVIDERS)) {
    const descriptor = resolveProvider(name, policy, config);
    if (!descriptor) continue;
    providers[name] = descriptor;

    const isNativeAnthropic = descriptor.baseUrl === null && descriptor.keyEnv === null;
    if (isNativeAnthropic) continue;

    if (descriptor.wire === 'anthropic') {
      routes[name] = {
        upstreamUrl: descriptor.anthropicBaseUrl ?? descriptor.baseUrl,
        wire: 'anthropic',
        keyEnv: descriptor.keyEnv,
      };
    } else if (descriptor.wire === 'openai') {
      routes[name] = { upstreamUrl: descriptor.baseUrl, wire: 'openai', keyEnv: descriptor.keyEnv };
    }
  }

  const reg = {
    version,
    generatedAt: new Date(now).toISOString(),
    tenant,
    providers,
    routes,
  };

  // NOTE: no `enforcement` section is derived here. The primary budget lever is PER-AGENT
  // (5h/weekly caps keyed by agent in policy.agent_budget.<agent>), which 3.3b computes from the
  // ledger directly. The registry envelope's `enforcement` block is a distinct PER-PROVIDER lever
  // (see provider-registry.mjs), so mapping per-agent caps onto it would be the wrong axis. How (or
  // whether) per-agent caps travel in the pushed registry for a remote Model-B sidecar is decided in
  // 3.4b, when the push/pull path is built — not guessed here.

  assertKeyEnvGuarantee(reg);
  validateProviderRegistry(reg);
  return reg;
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeysDeep(value[key]);
    }
    return out;
  }
  return value;
}

/** Canonical JSON with recursively-sorted object keys — deterministic for versioning/diffing. */
export function serializeRegistry(reg) {
  return JSON.stringify(sortKeysDeep(reg));
}
