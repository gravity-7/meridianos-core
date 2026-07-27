/**
 * OpenAI WireAdapter — handles the OpenAI Chat Completions API protocol.
 * Extracted from gateway/server.mjs as part of Universal Gateway (002).
 *
 * Required: detectRequest, extractUsage
 * Optional: injectAuth, extractUsageFromSSE, formatDenial, normalizeModel
 */

/**
 * Detect whether this request is an OpenAI-format request.
 * Checks for authorization: Bearer header or OpenAI-specific body structure.
 */
export function detectRequest(req) {
  // OpenAI uses authorization: Bearer header
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && /^Bearer\s+/i.test(auth)) {
    return { wire: 'openai', model: null, provider: null };
  }
  return null;
}

/**
 * Extract token usage from a parsed OpenAI response body.
 * Returns null for unknown fields — never fabricates as 0.
 */
export function extractUsage(parsedBody) {
  const usage = parsedBody?.usage;
  if (!usage || typeof usage !== 'object') {
    return null;
  }
  return {
    inputTokens: usage.prompt_tokens ?? null,
    outputTokens: usage.completion_tokens ?? null,
    cacheReadTokens: usage.prompt_tokens_details?.cached_tokens ?? null,
    cacheWriteTokens: null, // OpenAI has no cache-write concept
  };
}

/**
 * Inject OpenAI authentication header (authorization: Bearer).
 * @param {object} headers - Mutable headers object
 * @param {string} apiKey - Resolved API key value
 */
export function injectAuth(headers, apiKey) {
  if (apiKey) headers['authorization'] = `Bearer ${apiKey}`;
}

/**
 * Parse usage from an OpenAI SSE (Server-Sent Events) event.
 * Usage data arrives in the final SSE event with a `usage` field.
 */
export function extractUsageFromSSE(event) {
  if (!event || typeof event !== 'object') return null;

  const u = event?.usage;
  if (!u || typeof u !== 'object') return null;

  const result = {};
  if (u.prompt_tokens !== undefined) result.inputTokens = u.prompt_tokens;
  if (u.completion_tokens !== undefined) result.outputTokens = u.completion_tokens;
  if (u.prompt_tokens_details?.cached_tokens !== undefined) result.cacheReadTokens = u.prompt_tokens_details.cached_tokens;

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Format a budget-denial response in OpenAI wire format.
 * OpenAI-compatible: { error: { message, type: 'permission_error', code: 'over_budget' } }
 */
export function formatDenial(capWindow) {
  const message = `gateway: over budget (${capWindow})`;
  return {
    status: 403,
    body: { error: { message, type: 'permission_error', code: 'over_budget' } },
  };
}
