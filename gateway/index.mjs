/**
 * index — the Phase 3 gateway ASSEMBLY: composes the existing building blocks (ledger, run
 * registry, provider-registry-source/store, ledger-backed enforcement verdict, and the HTTP
 * server itself) into one runnable sidecar. Nothing here is reimplemented — every piece is
 * imported from its own module and wired together exactly as each module's own doc comment says
 * it's meant to be driven.
 *
 * NOT auto-started by the daemon (scheduler.mjs untouched by this bite): a founder-gated live
 * BYO-key dogfood run against a real upstream is a separate, later, explicitly-authorized step.
 * This module only proves (in gateway/tests/index.test.mjs) that the meter → verdict → enforce
 * loop works end-to-end against an OFFLINE stub upstream.
 */
import { loadPolicy } from '../budget.mjs';
import { loadPricing, costFor } from '../pricing.mjs';
import { openLedger, appendEvent } from './ledger.mjs';
import { createRunRegistry } from './run-registry.mjs';
import { buildProviderRegistry } from './registry-source.mjs';
import { createRegistryStore } from './registry-pull.mjs';
import { makeCheckVerdict } from './windows.mjs';
import { startGateway } from './server.mjs';
import { startHealthLoop } from '../provider-health.mjs';
import { discoverAdapters } from './wire-adapter-registry.mjs';
import { openDb } from '../db.mjs';
import { triggerEvent } from '../api/webhooks.mjs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

/**
 * Assembles and starts one gateway sidecar instance.
 *
 * - `config` — the injected AiosConfig; only consulted where `policy`/`ledgerPath` are omitted
 *   (loadPolicy's default path, ledger.mjs's default `.ai/gateway/ledger.db` path).
 * - `policy` — pre-loaded policy object; defaults to `loadPolicy(undefined, config)`.
 * - `port` — 0 (default) picks an ephemeral free port, matching startGateway's own default.
 * - `tenant` — the single tenant this sidecar serves today (defaults to 'default').
 * - `ledgerPath` — pass ':memory:' in tests; omitted falls back to ledger.mjs's on-disk default.
 * - `now` — a numeric epoch-ms clock seam for the registry envelope's `generatedAt` only (matches
 *   buildProviderRegistry's own `now: Date.now()` convention). makeCheckVerdict's PER-REQUEST clock
 *   is a separate seam (its own `now: () => Date.now()` function default) — deliberately NOT wired
 *   to this `now`, so every enforcement check re-reads the real clock at request time regardless of
 *   what `now` the envelope was generated with.
 *
 * Returns `{ gateway, ledger, runs, store, url, close() }`: `store` is the live registry-store
 * (see `refreshRegistry` below for pushing a newer envelope into it), `url`/`close` mirror
 * `startGateway`'s own return shape for convenience.
 *
 * Cost (bite: ledger cost): the pricing catalog (`pricing.mjs`'s committed `pricing.json`, at
 * `config.pricingPath`) is loaded ONCE here and closed over by a `costFn` passed into
 * `startGateway` — `server.mjs` itself stays free of any pricing import (the gateway only ever
 * takes injected sinks/seams). `costFor` returns `null` (never a fabricated number) when the
 * catalog has no entry for a provider/model, so a tenant without a `pricing.json` simply gets
 * `costUsd: null` on every event — no error.
 */
export async function assembleGateway({ config, policy, port = 0, tenant = 'default', ledgerPath, now } = {}) {
  const pol = policy ?? loadPolicy(undefined, config);
  const ledger = openLedger(ledgerPath, { config });
  const runs = createRunRegistry();
  const store = createRegistryStore(buildProviderRegistry({ policy: pol, config, tenant, version: 1, now }));
  const checkVerdict = makeCheckVerdict({ ledger, policy: pol, config });
  // `config` is nullable here — assembleGateway may be called without one (see e.g. this module's
  // own hermetic tests). loadPricing REQUIRES a config when its explicit `path` is omitted (it
  // reads `config.pricingPath`), so a config-less caller gets an empty catalog directly rather
  // than risking a crash on `undefined.pricingPath` — behaviorally identical to loadPricing's own
  // missing-file fallback (`{}`), so costFor still returns null (never fabricated) per call.
  const catalog = config ? loadPricing(config.pricingPath, config) : {};
  const costFn = (provider, model, usage) => costFor(provider, model, usage, { catalog })?.totalCost ?? null;

  // Discover WireAdapters from the gateway/wire-adapters/ directory
  const adaptersDir = join(dirname(fileURLToPath(import.meta.url)), 'wire-adapters');
  const adapters = await discoverAdapters(adaptersDir);

  const gateway = await startGateway({
    port,
    registry: () => store.get(),
    runs,
    onTokenEvent: (evt) => appendEvent(ledger, evt),
    checkVerdict,
    costFn,
    adapters,
  });

  // Phase 0: Start provider health monitoring loop (60s interval)
  const health = startHealthLoop({
    registry: () => store.get(),
    intervalMs: 60_000,
    onHealthChange: (provider, state) => {
      // Log health transitions for observability
      if (state.status === 'down') {
        console.warn(`[MERIDIANOS] provider-health: ${provider} is DOWN — ${state.error ?? 'unreachable'}`);
        // Phase 7 (US3, T052): FR-011 provider.error webhook. `config` may be absent (this
        // module's own hermetic tests assemble without one) — skip rather than fabricate a DB.
        if (config) {
          try {
            const db = openDb(undefined, config);
            triggerEvent(db, 'provider.error', { provider, error: state.error ?? 'unreachable', affected_requests: state.consecutiveFailures ?? 0 })
              .finally(() => { try { db.close?.(); } catch { /* ignore */ } });
          } catch { /* webhook delivery must never break the health loop */ }
        }
      }
    },
  });

  return {
    gateway,
    ledger,
    runs,
    store,
    health,
    url: gateway.url,
    close: () => {
      health.stop();
      return gateway.close();
    },
  };
}

/**
 * Builds a fresh provider-registry envelope and applies it to `store` via `applyIfNewer` — a
 * one-liner for pushing a registry update into an already-running gateway (e.g. after a policy or
 * providers.mjs change), without restarting the sidecar. Returns `applyIfNewer`'s own
 * `{ applied, version }` result.
 */
export function refreshRegistry(store, { policy, config, tenant = 'default', version, now } = {}) {
  const reg = buildProviderRegistry({ policy, config, tenant, version, now });
  return store.applyIfNewer(reg);
}
