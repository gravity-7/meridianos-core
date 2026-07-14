/**
 * registry-pull — sidecar active-registry store + transport-agnostic pull loop (3.4b).
 *
 * Maintains the sidecar's ACTIVE provider-registry: pull a versioned envelope from any source
 * and apply it only if it's strictly newer, atomically (reference swap, never in-place mutation).
 * Transport-agnostic: the caller supplies a `source` function — in-process (wrapping
 * buildProviderRegistry) for tenant #0, or an HTTP-fetch wrapper later for a remote control plane.
 * This module never imports http/fetch/net; sources are injected.
 *
 * NOTE: Whether per-agent budget caps travel INSIDE the pushed registry (vs. being read sidecar-side
 * from policy) is an open design decision deferred here — this module transports whatever validated
 * envelope it's given and does not interpret enforcement/caps.
 */
import { validateProviderRegistry } from './provider-registry.mjs';

// ─── createRegistryStore ────────────────────────────────────────────────────

/**
 * Creates an active-registry store.
 *
 * @param {object|null} initial - An already-validated registry to start with, or null.
 * @returns {{ get(): object|null, applyIfNewer(reg): { applied: boolean, version: number|null } }}
 */
export function createRegistryStore(initial = null) {
  // Stable reference — never mutated in place; only swapped.
  let _active = initial ?? null;

  /**
   * Returns the current active registry (stable reference for the duration of a request),
   * or null if no registry has been applied yet.
   */
  function get() {
    return _active;
  }

  /**
   * Validates reg via validateProviderRegistry first (throws on malformed; leaves active
   * unchanged). Then applies reg as the new active registry only if:
   *   - there is no current active registry (first-ever apply), OR
   *   - reg.version is strictly greater than the current active version.
   *
   * Equal or older versions are silently ignored. Returns { applied, version } where version
   * is the active registry's version after the call.
   *
   * @param {object} reg - A registry envelope to validate and potentially apply.
   * @returns {{ applied: boolean, version: number|null }}
   */
  function applyIfNewer(reg) {
    // Validate FIRST — a malformed envelope must never replace the active registry.
    validateProviderRegistry(reg);

    if (_active === null || reg.version > _active.version) {
      // Swap the reference; do NOT mutate the incoming object or the previously-active one.
      _active = reg;
      return { applied: true, version: _active.version };
    }

    // Equal or older — ignored.
    return { applied: false, version: _active.version };
  }

  return { get, applyIfNewer };
}

// ─── pullOnce ───────────────────────────────────────────────────────────────

/**
 * Fetches one envelope from `source` (any async or sync function returning a registry envelope)
 * and applies it to `store`. Returns the { applied, version } result from applyIfNewer.
 *
 * `source` is injected — in-process for tenant #0, HTTP-backed for remote; this function stays
 * transport-agnostic.
 *
 * @param {ReturnType<typeof createRegistryStore>} store
 * @param {() => object | Promise<object>} source
 * @returns {Promise<{ applied: boolean, version: number|null }>}
 */
export async function pullOnce(store, source) {
  const reg = await source();
  return store.applyIfNewer(reg);
}

// ─── startRegistryPoll ──────────────────────────────────────────────────────

/**
 * Starts a setInterval-based polling loop that calls pullOnce on every tick.
 *
 * - onApply(result) is called when applied === true.
 * - onError(err) is called when source or validation throws — the loop survives (best-effort).
 * - stop() clears the interval and halts future pulls.
 *
 * @param {{ store: ReturnType<typeof createRegistryStore>, source: Function,
 *           intervalMs: number, onApply?: Function, onError?: Function }} opts
 * @returns {{ stop(): void }}
 */
export function startRegistryPoll({ store, source, intervalMs, onApply, onError }) {
  const id = setInterval(async () => {
    try {
      const result = await pullOnce(store, source);
      if (result.applied && typeof onApply === 'function') {
        onApply(result);
      }
    } catch (err) {
      if (typeof onError === 'function') {
        try { onError(err); } catch { /* swallow handler errors too */ }
      }
    }
  }, intervalMs);

  function stop() {
    clearInterval(id);
  }

  return { stop };
}
