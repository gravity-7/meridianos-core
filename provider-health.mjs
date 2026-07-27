/**
 * provider-health — Phase 0: background health check loop for configured LLM providers.
 *
 * Probes every configured provider endpoint at a configurable interval (default 60s) with a
 * lightweight GET request (5s timeout). Health states: unknown → ok (first success), degraded
 * (first failure), down (consecutive failures). Exposes an in-memory Map<providerName, HealthState>
 * for the dashboard and model router to consume.
 *
 * Zero-dependency — uses only node:http and node:https built-ins.
 */
import http from 'node:http';
import https from 'node:https';

/** @type {Map<string, HealthState>} */
const healthMap = new Map();

/**
 * @typedef {object} HealthState
 * @property {string} provider
 * @property {'unknown'|'ok'|'degraded'|'down'} status
 * @property {number|null} latencyMs
 * @property {string|null} lastCheck ISO-8601
 * @property {number} consecutiveFailures
 * @property {string|null} error
 */

/**
 * Probe a single provider endpoint. Returns a partial HealthState.
 * Uses a lightweight GET — no API key needed, no tokens consumed.
 */
function probeProvider(provider) {
  const baseUrl = provider.upstreamUrl || provider.baseUrl;
  if (!baseUrl) return { ok: false, error: 'no upstream URL configured' };

  const transport = baseUrl.startsWith('https') ? https : http;
  const start = Date.now();

  return new Promise((resolve) => {
    const req = transport.get(baseUrl, { timeout: 5000 }, (res) => {
      const latencyMs = Date.now() - start;
      // Any 2xx/3xx/4xx response means the endpoint is reachable (401 is fine — we just want to know it's alive)
      res.resume(); // consume response data to free memory
      res.on('end', () => resolve({ ok: true, latencyMs }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, latencyMs: Date.now() - start, error: 'timeout (5s)' }); });
    req.on('error', (err) => resolve({ ok: false, latencyMs: Date.now() - start, error: err.message }));
  });
}

/**
 * Start the background health check loop.
 * @param {object} opts
 * @param {() => {providers: object, routes: object}} opts.registry — zero-arg function returning registry envelope
 * @param {number} [opts.intervalMs=60000] — check interval in milliseconds
 * @param {(provider: string, state: HealthState) => void} [opts.onHealthChange] — optional callback on state change
 * @returns {{ stop: () => void, getHealth: () => Map<string, HealthState> }}
 */
export function startHealthLoop({ registry, intervalMs = 60_000, onHealthChange } = {}) {
  const timer = setInterval(async () => {
    if (typeof registry !== 'function') return;
    try {
      const reg = registry();
      const routes = reg?.routes ?? {};

      for (const [providerName, route] of Object.entries(routes)) {
        const baseUrl = route.upstreamUrl;
        if (!baseUrl) continue;

        const prev = healthMap.get(providerName);
        let result;
        try {
          result = await probeProvider({ upstreamUrl: baseUrl });
        } catch {
          result = { ok: false, latencyMs: null, error: 'probe failed' };
        }

        let status;
        if (result.ok) {
          status = 'ok';
        } else if (!prev || prev.status === 'unknown') {
          status = 'degraded';
        } else if (prev.status === 'degraded') {
          status = 'down';
        } else {
          status = prev.status === 'ok' ? 'degraded' : 'down';
        }

        const state = {
          provider: providerName,
          status,
          latencyMs: result.latencyMs ?? null,
          lastCheck: new Date().toISOString(),
          consecutiveFailures: result.ok ? 0 : (prev?.consecutiveFailures ?? 0) + 1,
          error: result.error ?? null,
        };

        if (prev?.status !== state.status && typeof onHealthChange === 'function') {
          try { onHealthChange(providerName, state); } catch { /* never let callback errors break the loop */ }
        }

        healthMap.set(providerName, state);
      }
    } catch { /* never let a single tick failure stop the loop */ }
  }, intervalMs);

  // Initialize health states for all known providers immediately
  setTimeout(() => {
    try {
      if (typeof registry === 'function') {
        const reg = registry();
        const routes = reg?.routes ?? {};
        for (const [providerName] of Object.entries(routes)) {
          if (!healthMap.has(providerName)) {
            healthMap.set(providerName, { provider: providerName, status: 'unknown', latencyMs: null, lastCheck: null, consecutiveFailures: 0, error: null });
          }
        }
      }
    } catch { /* registry might not be ready yet */ }
  }, 100);

  return {
    stop: () => clearInterval(timer),
    getHealth: () => healthMap,
  };
}

/** Read current health state for a specific provider, or all providers. */
export function getProviderHealth(providerName) {
  if (providerName) return healthMap.get(providerName) ?? null;
  return Object.fromEntries(healthMap);
}
