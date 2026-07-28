/**
 * model-discovery-adapters/openai.mjs — OpenAI-compatible model discovery (US4).
 *
 * Discovery method: GET {baseUrl}/v1/models → parse { data: [{ id, ... }] }
 * Context windows looked up from a static mapping since OpenAI's API doesn't expose them.
 * Features inferred from model ID patterns.
 */

/**
 * Discover models from an OpenAI-compatible provider.
 *
 * @param {object} providerConfig - Resolved provider descriptor
 * @returns {Promise<Array<{model_id: string, display_name?: string, context_window?: number, features?: object}>>}
 */
export async function discoverModels(providerConfig) {
  const { baseUrl } = providerConfig;
  const keyEnv = providerConfig.keyEnv;
  const resolvedKey = keyEnv ? process.env[keyEnv] : undefined;

  const url = `${baseUrl.replace(/\/+$/, '')}/models`;
  const headers = { 'Content-Type': 'application/json' };
  if (resolvedKey) {
    headers.Authorization = `Bearer ${resolvedKey}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      console.error(`[DISCOVERY] OpenAI adapter: ${providerConfig.name} returned ${response.status}`);
      return [];
    }

    const body = await response.json();
    const models = body?.data ?? [];

    return models.map((m) => {
      const modelId = m.id;
      return {
        model_id: modelId,
        display_name: modelId,
        context_window: lookupContextWindow(modelId),
        features: inferFeatures(modelId),
        deprecated: false,
      };
    });
  } catch (err) {
    console.error(`[DISCOVERY] OpenAI adapter error for ${providerConfig.name}: ${err.message}`);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Look up known context windows for common model families.
 */
function lookupContextWindow(modelId) {
  const KNOWN = {
    // OpenAI
    'gpt-4o': 128000,
    'gpt-4o-mini': 128000,
    'gpt-4-turbo': 128000,
    'gpt-4': 8192,
    'gpt-3.5-turbo': 16385,
    'o1': 200000,
    'o1-mini': 128000,
    'o3': 200000,
    'o3-mini': 200000,
    'o4-mini': 200000,
    // DeepSeek
    'deepseek-chat': 128000,
    'deepseek-v4-flash': 128000,
    'deepseek-v4-pro': 128000,
    // Groq
    'llama-3.3-70b': 128000,
    'mixtral-8x7b': 32768,
    'gemma2-9b-it': 8192,
    // Together
    'llama-3.1': 128000,
    // Mistral
    'mistral-large': 128000,
    'mistral-small': 32000,
    'codestral': 32000,
    // Cohere
    'command-r': 128000,
    'command-r-plus': 128000,
    // Perplexity
    'sonar': 128000,
  };

  // Try exact match first, then prefix match
  if (KNOWN[modelId]) return KNOWN[modelId];

  for (const [prefix, ctx] of Object.entries(KNOWN)) {
    if (modelId.startsWith(prefix)) return ctx;
  }

  return null;
}

/**
 * Infer model features from model ID patterns.
 */
function inferFeatures(modelId) {
  const features = {};

  // Vision-capable models
  if (/gpt-4o|vision|claude|gemini/i.test(modelId)) {
    features.vision = true;
  }

  // Tool use capable models
  if (/gpt-4|gpt-3.5|claude|command/i.test(modelId)) {
    features.toolUse = true;
  }

  // Streaming (almost all models support this)
  features.streaming = true;

  // Reasoning models (no tool use in some cases)
  if (/^o[134]|deepseek-r1/i.test(modelId)) {
    features.thinking = true;
    // o-series models have limited tool use support
    if (/^o[13]/.test(modelId)) {
      features.toolUse = false;
    }
  }

  return features;
}
