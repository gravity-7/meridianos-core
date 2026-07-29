/**
 * provider-conformance — automated provider connectivity, auth, and wire format testing (US2).
 *
 * Runs lightweight API calls per wire type to verify a provider is reachable and correctly
 * configured. Designed to complete in <10 seconds per provider at near-zero token cost.
 *
 * Wire-type dispatch:
 *   - openai      → GET /v1/models (validates auth, lists models)
 *   - anthropic   → POST /v1/messages (1-token minimal message)
 *   - google-ai   → GET /v1beta/models?key={apiKey}
 *   - generic-http → GET / (basic reachability check)
 *
 * Error classification: AUTH_FAILED, CONNECTION_FAILED, TIMEOUT, UNEXPECTED_RESPONSE
 */

/**
 * Test a provider's connection health.
 *
 * @param {object} providerConfig - Resolved provider descriptor (name, wire, baseUrl, keyEnv, ...)
 * @param {string} resolvedKey - The resolved API key (from process.env or other source)
 * @returns {Promise<{ok: boolean, latencyMs: number, modelsFound?: number, features?: object, errorCode?: string, errorMessage?: string}>}
 */
export async function testProviderConnection(providerConfig, resolvedKey) {
  const { name, wire, baseUrl } = providerConfig;
  const start = Date.now();

  // Guard: null baseUrl means no remote endpoint to test (e.g., native CLI auth)
  if (baseUrl === null) {
    return {
      ok: true,
      latencyMs: 0,
      modelsFound: null,
      features: null,
      errorCode: undefined,
      errorMessage: undefined,
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    let response;
    let body;

    switch (wire) {
      case 'openai': {
        // GET /v1/models — standard OpenAI-compatible health check
        const url = `${baseUrl.replace(/\/+$/, '')}/models`;
        response = await fetch(url, {
          method: 'GET',
          headers: resolvedKey
            ? { Authorization: `Bearer ${resolvedKey}`, 'Content-Type': 'application/json' }
            : { 'Content-Type': 'application/json' },
          signal: controller.signal,
        });
        body = await response.json().catch(() => null);
        break;
      }

      case 'anthropic': {
        // POST /v1/messages with 1 token — minimal valid Anthropic request
        const url = `${baseUrl.replace(/\/+$/, '')}/v1/messages`;
        response = await fetch(url, {
          method: 'POST',
          headers: resolvedKey
            ? { 'x-api-key': resolvedKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }
            : { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'Hi' }],
          }),
          signal: controller.signal,
        });
        body = await response.json().catch(() => null);
        break;
      }

      case 'google-ai': {
        // GET /v1beta/models — Google AI model listing
        const keyParam = resolvedKey ? `?key=${encodeURIComponent(resolvedKey)}` : '';
        const url = `${baseUrl.replace(/\/+$/, '')}/v1beta/models${keyParam}`;
        response = await fetch(url, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
        });
        body = await response.json().catch(() => null);
        break;
      }

      case 'generic-http':
      default: {
        // GET / — basic reachability check
        const url = baseUrl.replace(/\/+$/, '');
        response = await fetch(url, {
          method: 'GET',
          headers: resolvedKey
            ? { Authorization: `Bearer ${resolvedKey}`, 'Content-Type': 'application/json' }
            : { 'Content-Type': 'application/json' },
          signal: controller.signal,
        });
        body = null; // Don't try to parse generic responses
        break;
      }
    }

    clearTimeout(timeout);
    const latencyMs = Date.now() - start;

    // Classify response
    if (response.ok) {
      const modelsFound = body?.data?.length ?? body?.models?.length ?? null;
      const features = inferFeatures(wire, body);
      return { ok: true, latencyMs, modelsFound, features };
    }

    // Error classification
    const errorCode = classifyError(response.status, body);
    const errorMessage = formatErrorMessage(errorCode, name, providerConfig.keyEnv);

    return { ok: false, latencyMs, errorCode, errorMessage };

  } catch (err) {
    const latencyMs = Date.now() - start;

    if (err.name === 'AbortError' || err.code === 'ETIMEDOUT') {
      return {
        ok: false,
        latencyMs,
        errorCode: 'TIMEOUT',
        errorMessage: `Connection to ${name} timed out after 5 seconds. Check the base URL (${providerConfig.baseUrl}) and network connectivity.`,
      };
    }

    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.cause?.code === 'ENOTFOUND') {
      return {
        ok: false,
        latencyMs,
        errorCode: 'CONNECTION_FAILED',
        errorMessage: `Could not connect to ${name} at ${providerConfig.baseUrl}. Check the URL and network. Error: ${err.message}`,
      };
    }

    return {
      ok: false,
      latencyMs,
      errorCode: 'UNEXPECTED_RESPONSE',
      errorMessage: `Unexpected error testing ${name}: ${err.message}`,
    };
  }
}

/**
 * Classify HTTP error responses into error codes.
 */
function classifyError(status, body) {
  if (status === 401 || status === 403) {
    return 'AUTH_FAILED';
  }
  if (status === 404 || status === 400) {
    return 'UNEXPECTED_RESPONSE';
  }
  if (status >= 500) {
    return 'CONNECTION_FAILED';
  }
  // Check body for auth-related error messages
  const errMsg = typeof body?.error?.message === 'string' ? body.error.message.toLowerCase() : '';
  if (errMsg.includes('auth') || errMsg.includes('api key') || errMsg.includes('unauthorized') || errMsg.includes('forbidden')) {
    return 'AUTH_FAILED';
  }
  return 'UNEXPECTED_RESPONSE';
}

/**
 * Format a human-readable error message for the given error code.
 */
function formatErrorMessage(errorCode, providerName, keyEnv) {
  switch (errorCode) {
    case 'AUTH_FAILED':
      return `Authentication failed: API key is invalid or expired. Check ${keyEnv ?? 'your API key'}.`;
    case 'CONNECTION_FAILED':
      return `Connection failed: could not reach ${providerName}. Check the base URL and network connectivity.`;
    case 'TIMEOUT':
      return `Connection timed out: ${providerName} did not respond within 5 seconds.`;
    case 'UNEXPECTED_RESPONSE':
      return `Unexpected response from ${providerName}. Check the wire type and base URL are correct.`;
    default:
      return `Unknown error testing ${providerName}.`;
  }
}

/**
 * Infer provider features from a successful conformance test response.
 */
function inferFeatures(wire, body) {
  const features = {};
  if (wire === 'openai' && body?.data) {
    // Check for known model patterns
    const modelIds = body.data.map((m) => m.id).filter(Boolean);
    features.supportsStreaming = true; // OpenAI-compatible endpoints typically support streaming
    features.modelsFound = modelIds.length;
  }
  if (wire === 'anthropic' && body?.type === 'message') {
    features.supportsStreaming = true;
    features.supportsToolUse = true;
  }
  if (wire === 'google-ai' && body?.models) {
    features.supportsStreaming = true;
  }
  return features;
}
