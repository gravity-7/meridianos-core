/**
 * rate-limiter — in-memory sliding-window rate limiter for the public REST API (api/v1).
 *
 * Zero-dependency by design (constitution III): 100 concurrent users / 500 API keys is well
 * within what a `Map` can hold, so no Redis or other external store is needed. State is
 * per-process and NOT persisted — a daemon restart resets every key's window, which is
 * acceptable for a rate limiter (the worst case is a brief extra allowance, never a lockout).
 */

const DEFAULT_LIMIT = 100;
const DEFAULT_WINDOW_MS = 60_000;

/**
 * Create a rate limiter instance. Each instance owns its own Map, so tests can create
 * independent limiters without cross-contamination.
 * @param {{limit?: number, windowMs?: number}} [opts]
 */
export function createRateLimiter({ limit = DEFAULT_LIMIT, windowMs = DEFAULT_WINDOW_MS } = {}) {
  /** @type {Map<string, number[]>} apiKeyId -> sorted array of request timestamps (ms) */
  const requestLog = new Map();

  /**
   * Record a request for `apiKeyId` and check whether it's within the limit.
   * @param {string} apiKeyId
   * @param {number} [now]  override for testing
   * @returns {{allowed: boolean, limit: number, remaining: number, resetAt: number, retryAfter: number}}
   */
  function check(apiKeyId, now = Date.now()) {
    const windowStart = now - windowMs;
    const existing = requestLog.get(apiKeyId) || [];
    const withinWindow = existing.filter((ts) => ts > windowStart);

    if (withinWindow.length >= limit) {
      const oldest = withinWindow[0];
      const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      requestLog.set(apiKeyId, withinWindow);
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetAt: Math.floor((oldest + windowMs) / 1000),
        retryAfter,
      };
    }

    withinWindow.push(now);
    requestLog.set(apiKeyId, withinWindow);
    return {
      allowed: true,
      limit,
      remaining: limit - withinWindow.length,
      resetAt: Math.floor((now + windowMs) / 1000),
      retryAfter: 0,
    };
  }

  /** Drop all recorded requests for one key (e.g., on revocation) or every key (`clear()`). */
  function reset(apiKeyId) {
    if (apiKeyId === undefined) requestLog.clear();
    else requestLog.delete(apiKeyId);
  }

  /** Number of distinct keys currently tracked — for diagnostics/tests only. */
  function size() {
    return requestLog.size;
  }

  return { check, reset, size };
}

/**
 * Build the standard rate-limit response headers for a check() result.
 * @param {ReturnType<ReturnType<typeof createRateLimiter>['check']>} result
 */
export function rateLimitHeaders(result) {
  const headers = {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(result.resetAt),
  };
  if (!result.allowed) headers['Retry-After'] = String(result.retryAfter);
  return headers;
}
