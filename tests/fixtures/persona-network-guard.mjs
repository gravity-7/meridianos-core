const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
export const PROVIDER_KEY_ENV_NAMES = Object.freeze([
  'ANTHROPIC_API_KEY', 'DEEPSEEK_KEY', 'OPENAI_API_KEY', 'OPENROUTER_KEY', 'GROQ_API_KEY',
  'TOGETHER_API_KEY', 'MISTRAL_API_KEY', 'COHERE_API_KEY', 'GEMINI_API_KEY',
]);

/**
 * Reject anything that is not an exact, credential-free local HTTP endpoint.
 * Future persona fixtures must use this before invoking a mock dependency.
 */
export function assertLoopbackEndpoint(value, { allowedOrigins = null } = {}) {
  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    throw new TypeError('Fixture endpoint must be an absolute HTTP URL');
  }
  if (!['http:', 'https:'].includes(endpoint.protocol)) {
    throw new TypeError('Fixture endpoint must use HTTP or HTTPS');
  }
  if (endpoint.username || endpoint.password || !LOOPBACK_HOSTS.has(endpoint.hostname)) {
    throw new TypeError('Fixture endpoint must use an exact loopback hostname without credentials');
  }
  if (allowedOrigins) {
    const allowed = new Set([...allowedOrigins].map((origin) => new URL(origin).origin));
    if (!allowed.has(endpoint.origin)) throw new TypeError('Fixture endpoint is outside the allowlisted loopback origin');
  }
  return endpoint;
}

/** Check that a browser URL is on the exact dashboard origin selected for this fixture. */
export function assertBrowserOrigin(value, allowedOrigin) {
  const endpoint = assertLoopbackEndpoint(value, { allowedOrigins: [allowedOrigin] });
  if (endpoint.origin !== new URL(allowedOrigin).origin) throw new TypeError('Browser origin is not allowlisted');
  return endpoint;
}

/** Reject a supplied child environment that accidentally inherited a real provider-key name. */
export function assertNoInheritedProviderKeys(environment) {
  if (!environment || typeof environment !== 'object') throw new TypeError('A child environment object is required');
  const inherited = Object.keys(environment).filter((key) => PROVIDER_KEY_ENV_NAMES.includes(key));
  if (inherited.length > 0) throw new Error('Fixture child environment contains an inherited provider key name');
  return environment;
}

/** Wrap a supplied fetch implementation so future fixtures fail before egress. */
export function createLoopbackFetch(fetchImpl) {
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required');
  const attempts = [];
  const guardedFetch = async (input, init) => {
    const value = typeof input === 'string' || input instanceof URL ? input.toString() : input?.url;
    const attempt = { method: init?.method ?? input?.method ?? 'GET', endpoint: String(value), allowed: false, status: null };
    try {
      const endpoint = assertLoopbackEndpoint(value);
      attempt.endpoint = endpoint.toString();
      attempt.allowed = true;
    } catch (error) {
      attempts.push(attempt);
      throw error;
    }
    // A local mock must not bounce a fixture into an external destination.
    try {
      const response = await fetchImpl(input, { ...(init ?? {}), redirect: 'error' });
      attempt.status = response?.status ?? null;
      if (response?.redirected) throw new Error('Fixture dependency followed a redirect');
      attempts.push(attempt);
      return response;
    } catch (error) {
      attempt.error = 'blocked-or-failed';
      attempts.push(attempt);
      throw error;
    }
  };
  Object.defineProperty(guardedFetch, 'attempts', { value: attempts, enumerable: true });
  Object.defineProperty(guardedFetch, 'externalAttemptCount', {
    get: () => attempts.filter((attempt) => !attempt.allowed).length,
    enumerable: true,
  });
  return guardedFetch;
}
