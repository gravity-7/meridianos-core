/**
 * model-discovery-adapters/generic-http.mjs — Generic HTTP provider model discovery (US4).
 *
 * Multi-strategy with fallbacks:
 *   1. Try GET {baseUrl}/v1/models (OpenAI-compatible pattern)
 *   2. Fall back to empty list (no discovery endpoint available)
 *
 * Used as the default adapter for unrecognized wire types.
 */

/**
 * Discover models from a generic HTTP provider.
 *
 * @param {object} providerConfig - Resolved provider descriptor
 * @returns {Promise<Array<object>>}
 */
export async function discoverModels(providerConfig) {
  const { baseUrl, keyEnv } = providerConfig;
  const resolvedKey = keyEnv ? process.env[keyEnv] : undefined;

  // Strategy 1: Try OpenAI-compatible /v1/models endpoint
  try {
    const url = `${baseUrl.replace(/\/+$/, '')}/models`;
    const headers = { 'Content-Type': 'application/json' };
    if (resolvedKey) {
      headers.Authorization = `Bearer ${resolvedKey}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    clearTimeout(timeout);

    if (response.ok) {
      const body = await response.json();
      if (body?.data && Array.isArray(body.data)) {
        return body.data.map((m) => ({
          model_id: m.id ?? m.model_id ?? m.name,
          display_name: m.id ?? m.model_id ?? m.name,
          context_window: null,
          features: { streaming: true },
          deprecated: false,
        }));
      }
    }
  } catch {
    // Strategy 1 failed — try next strategy
  }

  // Strategy 2: No discovery endpoint available — return empty
  console.log(`[DISCOVERY] Generic adapter: no models discovered for ${providerConfig.name}`);
  return [];
}
