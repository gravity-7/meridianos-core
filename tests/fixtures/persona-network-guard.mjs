const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Reject anything that is not an exact, credential-free local HTTP endpoint.
 * Future persona fixtures must use this before invoking a mock dependency.
 */
export function assertLoopbackEndpoint(value) {
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
  return endpoint;
}

/** Wrap a supplied fetch implementation so future fixtures fail before egress. */
export function createLoopbackFetch(fetchImpl) {
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required');
  const attempts = [];
  const guardedFetch = (input, init) => {
    const value = typeof input === 'string' || input instanceof URL ? input.toString() : input?.url;
    try {
      const endpoint = assertLoopbackEndpoint(value);
      attempts.push({ endpoint: endpoint.toString(), allowed: true });
    } catch (error) {
      attempts.push({ endpoint: String(value), allowed: false });
      throw error;
    }
    // A local mock must not bounce a fixture into an external destination.
    return fetchImpl(input, { ...(init ?? {}), redirect: 'error' });
  };
  Object.defineProperty(guardedFetch, 'attempts', { value: attempts, enumerable: true });
  Object.defineProperty(guardedFetch, 'externalAttemptCount', {
    get: () => attempts.filter((attempt) => !attempt.allowed).length,
    enumerable: true,
  });
  return guardedFetch;
}
