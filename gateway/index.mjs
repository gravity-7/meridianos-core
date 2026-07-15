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
import { openLedger, appendEvent } from './ledger.mjs';
import { createRunRegistry } from './run-registry.mjs';
import { buildProviderRegistry } from './registry-source.mjs';
import { createRegistryStore } from './registry-pull.mjs';
import { makeCheckVerdict } from './windows.mjs';
import { startGateway } from './server.mjs';

/**
 * Assembles and starts one gateway sidecar instance.
 *
 * - `config` — the injected AiosConfig; only consulted where `policy`/`ledgerPath` are omitted
 *   (loadPolicy's default path, ledger.mjs's default `.ai/gateway/ledger.db` path).
 * - `policy` — pre-loaded policy object; defaults to `loadPolicy(undefined, config)`.
 * - `port` — 0 (default) picks an ephemeral free port, matching startGateway's own default.
 * - `tenant` — the single tenant this sidecar serves today (defaults to 'pv').
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
 */
export async function assembleGateway({ config, policy, port = 0, tenant = 'pv', ledgerPath, now } = {}) {
  const pol = policy ?? loadPolicy(undefined, config);
  const ledger = openLedger(ledgerPath, { config });
  const runs = createRunRegistry();
  const store = createRegistryStore(buildProviderRegistry({ policy: pol, config, tenant, version: 1, now }));
  const checkVerdict = makeCheckVerdict({ ledger, policy: pol, config });

  const gateway = await startGateway({
    port,
    registry: () => store.get(),
    runs,
    onTokenEvent: (evt) => appendEvent(ledger, evt),
    checkVerdict,
  });

  return {
    gateway,
    ledger,
    runs,
    store,
    url: gateway.url,
    close: () => gateway.close(),
  };
}

/**
 * Builds a fresh provider-registry envelope and applies it to `store` via `applyIfNewer` — a
 * one-liner for pushing a registry update into an already-running gateway (e.g. after a policy or
 * providers.mjs change), without restarting the sidecar. Returns `applyIfNewer`'s own
 * `{ applied, version }` result.
 */
export function refreshRegistry(store, { policy, config, tenant = 'pv', version, now } = {}) {
  const reg = buildProviderRegistry({ policy, config, tenant, version, now });
  return store.applyIfNewer(reg);
}
