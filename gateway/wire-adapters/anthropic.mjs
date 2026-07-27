/**
 * Anthropic WireAdapter — handles the Anthropic Messages API protocol.
 * Extracted from gateway/server.mjs as part of Universal Gateway (002).
 *
 * Required: detectRequest, extractUsage
 * Optional: injectAuth, extractUsageFromSSE, formatDenial, normalizeModel
 */

/**
 * Detect whether this request is an Anthropic-format request.
 * Checks for x-api-key header or Anthropic-specific body structure.
 */
export function detectRequest(req) {
  // Anthropic uses x-api-key header
  if (typeof req.headers['x-api-key'] === 'string' && req.headers['x-api-key'].length > 0) {
    return { wire: 'anthropic', model: null, provider: null };
  }
  // Also detect from body when available (the gateway reads body later; here we check
  // what's available at request time — the header check above is the primary signal)
  return null;
}

/**
 * Extract token usage from a parsed Anthropic response body.
 * Returns null for unknown fields — never fabricates as 0.
 */
export function extractUsage(parsedBody) {
  const usage = parsedBody?.usage;
  if (!usage || typeof usage !== 'object') {
    return null;
  }
  return {
    inputTokens: usage.input_tokens ?? null,
    outputTokens: usage.output_tokens ?? null,
    cacheReadTokens: usage.cache_read_input_tokens ?? null,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? null,
  };
}

/**
 * Inject Anthropic authentication header (x-api-key).
 * @param {object} headers - Mutable headers object
 * @param {string} apiKey - Resolved API key value
 */
export function injectAuth(headers, apiKey) {
  if (apiKey) headers['x-api-key'] = apiKey;
}

/**
 * Parse usage from an Anthropic SSE (Server-Sent Events) event.
 * Tracks cumulative usage from message_start and message_delta events.
 */
export function extractUsageFromSSE(event) {
  if (!event || typeof event !== 'object') return null;

  const result = {};

  // message_start carries input + cache usage
  if (event.type === 'message_start' && event.message?.usage && typeof event.message.usage === 'object') {
    const u = event.message.usage;
    if (u.input_tokens !== undefined) result.inputTokens = u.input_tokens;
    if (u.cache_creation_input_tokens !== undefined) result.cacheWriteTokens = u.cache_creation_input_tokens;
    if (u.cache_read_input_tokens !== undefined) result.cacheReadTokens = u.cache_read_input_tokens;
  }

  // message_delta carries cumulative output_tokens
  if (event.type === 'message_delta' && event.usage && typeof event.usage.output_tokens === 'number') {
    result.outputTokens = event.usage.output_tokens;
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Format a budget-denial response in Anthropic wire format.
 * Anthropic uses: { type: 'error', error: { type: 'permission_error', message } }
 */
export function formatDenial(capWindow) {
  const message = `gateway: over budget (${capWindow})`;
  return {
    status: 403,
    body: { type: 'error', error: { type: 'permission_error', message } },
  };
}
