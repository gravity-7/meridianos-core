/**
 * Generic HTTP WireAdapter — passthrough adapter for any HTTP-based LLM provider.
 * Does best-effort usage extraction (tries Anthropic format first, then OpenAI).
 * Never claims requests via detectRequest — activated by route config only.
 *
 * Required: detectRequest, extractUsage
 * Optional: injectAuth
 */

/**
 * Always returns null — generic-http is activated by route config, not request content.
 */
export function detectRequest(_req) {
  return null;
}

/**
 * Best-effort usage extraction. Tries Anthropic format first, then OpenAI.
 * Returns null for unrecognized formats — null means "genuinely unknown", never fabricated as 0.
 */
export function extractUsage(parsedBody) {
  if (!parsedBody || typeof parsedBody !== 'object') return null;

  const usage = parsedBody.usage;
  if (!usage || typeof usage !== 'object') return null;

  // Try Anthropic format first (input_tokens/output_tokens)
  if ('input_tokens' in usage || 'output_tokens' in usage) {
    return {
      inputTokens: usage.input_tokens ?? null,
      outputTokens: usage.output_tokens ?? null,
      cacheReadTokens: usage.cache_read_input_tokens ?? null,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? null,
    };
  }

  // Try OpenAI format (prompt_tokens/completion_tokens)
  if ('prompt_tokens' in usage || 'completion_tokens' in usage) {
    return {
      inputTokens: usage.prompt_tokens ?? null,
      outputTokens: usage.completion_tokens ?? null,
      cacheReadTokens: usage.prompt_tokens_details?.cached_tokens ?? null,
      cacheWriteTokens: null,
    };
  }

  return null;
}

/**
 * Inject Bearer token authentication header.
 */
export function injectAuth(headers, apiKey) {
  if (apiKey) headers['authorization'] = `Bearer ${apiKey}`;
}
