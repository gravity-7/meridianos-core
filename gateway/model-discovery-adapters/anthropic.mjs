/**
 * model-discovery-adapters/anthropic.mjs — Anthropic model discovery (US4).
 *
 * Anthropic has no public model listing endpoint. Uses:
 *   1. Curated static list of known Claude models
 *   2. (Future) models.dev API for newly released models
 */

/** Curated list of known Anthropic models with context windows and features. */
const KNOWN_CLAUDE_MODELS = [
  {
    model_id: 'claude-sonnet-4-20250514',
    display_name: 'Claude Sonnet 4',
    context_window: 200000,
    features: { vision: true, toolUse: true, streaming: true, caching: true, thinking: true },
  },
  {
    model_id: 'claude-opus-4-20250514',
    display_name: 'Claude Opus 4',
    context_window: 200000,
    features: { vision: true, toolUse: true, streaming: true, caching: true, thinking: true },
  },
  {
    model_id: 'claude-haiku-4-5-20251001',
    display_name: 'Claude Haiku 4.5',
    context_window: 200000,
    features: { vision: true, toolUse: true, streaming: true, caching: true, thinking: false },
  },
  {
    model_id: 'claude-sonnet-5',
    display_name: 'Claude Sonnet 5',
    context_window: 200000,
    features: { vision: true, toolUse: true, streaming: true, caching: true, thinking: true },
  },
  {
    model_id: 'claude-opus-4-8',
    display_name: 'Claude Opus 4.8',
    context_window: 200000,
    features: { vision: true, toolUse: true, streaming: true, caching: true, thinking: true },
  },
  {
    model_id: 'claude-fable-5',
    display_name: 'Claude Fable 5',
    context_window: 200000,
    features: { vision: true, toolUse: true, streaming: true, caching: true, thinking: true },
  },
  {
    model_id: 'claude-sonnet-4',
    display_name: 'Claude Sonnet 4',
    context_window: 200000,
    features: { vision: true, toolUse: true, streaming: true, caching: true, thinking: true },
  },
  {
    model_id: 'claude-opus-4',
    display_name: 'Claude Opus 4',
    context_window: 200000,
    features: { vision: true, toolUse: true, streaming: true, caching: true, thinking: true },
  },
];

/**
 * Discover models from Anthropic.
 *
 * @param {object} providerConfig - Resolved provider descriptor
 * @returns {Promise<Array<object>>}
 */
export async function discoverModels(providerConfig) {
  // Return the curated static list — no network call needed
  return KNOWN_CLAUDE_MODELS.map((m) => ({
    ...m,
    deprecated: false,
  }));
}
