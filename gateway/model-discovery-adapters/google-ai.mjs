/**
 * model-discovery-adapters/google-ai.mjs — Google AI (Gemini) model discovery (US4).
 *
 * Discovery method: GET {baseUrl}/v1beta/models?key={apiKey}
 * Parses { models: [{ name, displayName, inputTokenLimit, outputTokenLimit, supportedGenerationMethods }] }
 * Filters to models supporting 'generateContent'.
 * Strips 'models/' prefix from name.
 */

/**
 * Discover models from Google AI (Gemini).
 *
 * @param {object} providerConfig - Resolved provider descriptor
 * @returns {Promise<Array<object>>}
 */
export async function discoverModels(providerConfig) {
  const { baseUrl, keyEnv } = providerConfig;
  const resolvedKey = keyEnv ? process.env[keyEnv] : undefined;

  const url = `${baseUrl.replace(/\/+$/, '')}/v1beta/models?key=${encodeURIComponent(resolvedKey ?? '')}`;
  const headers = { 'Content-Type': 'application/json' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      console.error(`[DISCOVERY] Google AI adapter: ${providerConfig.name} returned ${response.status}`);
      return [];
    }

    const body = await response.json();
    const models = body?.models ?? [];

    return models
      .filter((m) => {
        const methods = m.supportedGenerationMethods ?? [];
        return methods.includes('generateContent');
      })
      .map((m) => {
        // Strip 'models/' prefix from name
        const modelId = (m.name ?? '').replace(/^models\//, '');

        return {
          model_id: modelId,
          display_name: m.displayName ?? modelId,
          context_window: m.inputTokenLimit ?? null,
          max_output_tokens: m.outputTokenLimit ?? null,
          features: {
            vision: /vision|gemini-pro-vision/i.test(modelId),
            toolUse: true,
            streaming: true,
            thinking: /gemini-2|gemini-3/i.test(modelId),
            caching: true,
          },
          deprecated: false,
        };
      });
  } catch (err) {
    console.error(`[DISCOVERY] Google AI adapter error for ${providerConfig.name}: ${err.message}`);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
