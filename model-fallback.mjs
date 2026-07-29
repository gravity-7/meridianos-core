/**
 * model-fallback — Circuit breaker for per-model health tracking (US5).
 *
 * Three-state circuit breaker per model:
 *   - healthy       → Normal rotation, no failures
 *   - degraded      → 2+ consecutive failures, still in rotation but monitored
 *   - circuit_open  → 5+ consecutive failures OR immediate auth error, excluded from rotation
 *
 * State transitions:
 *   healthy --(2+ failures)--> degraded --(5 total failures)--> circuit_open
 *   degraded --(success)--> healthy
 *   circuit_open --(5-min cooldown + probe success)--> healthy
 *   circuit_open --(5-min cooldown + probe failure)--> circuit_open (reset cooldown)
 *
 * Auth errors (401, 403) → immediate circuit_open (not retryable).
 * Timeout/5xx errors → counted toward thresholds.
 * 4xx client errors (except auth) → NOT counted.
 *
 * State is ephemeral in-memory — reset on daemon restart.
 */
export class CircuitBreaker {
  /** @type {Map<string, {state: string, failureCount: number, lastFailure: number, lastError: string, cooldownUntil: number|null}>} */
  #models = new Map();

  /**
   * Record a successful request for a model.
   * Moves from degraded → healthy.
   */
  recordSuccess(modelId) {
    const entry = this.#models.get(modelId);
    if (!entry) return;
    entry.failureCount = 0;
    entry.cooldownUntil = null;
    if (entry.state === 'degraded') {
      console.log(`[CIRCUIT] model ${modelId}: degraded → healthy (recovery)`);
      entry.state = 'healthy';
    }
  }

  /**
   * Record a failed request for a model.
   *
   * @param {string} modelId
   * @param {Error|object} error - Error object with status code or message
   */
  recordFailure(modelId, error) {
    let entry = this.#models.get(modelId);
    if (!entry) {
      entry = { state: 'healthy', failureCount: 0, lastFailure: 0, lastError: '', cooldownUntil: null };
      this.#models.set(modelId, entry);
    }

    const status = error?.status ?? error?.statusCode ?? 0;
    const isAuthError = status === 401 || status === 403;

    entry.lastFailure = Date.now();
    entry.lastError = error?.message ?? String(error);

    if (isAuthError) {
      // Immediate circuit open for auth errors
      const prevState = entry.state;
      entry.state = 'circuit_open';
      entry.cooldownUntil = Date.now() + 5 * 60 * 1000;
      console.log(`[CIRCUIT] model ${modelId}: ${prevState} → circuit_open (auth error)`);
      return;
    }

    // Don't count 4xx client errors (except auth, handled above)
    if (status >= 400 && status < 500) return;

    entry.failureCount++;
    const prevState = entry.state;

    if (entry.failureCount >= 5) {
      entry.state = 'circuit_open';
      entry.cooldownUntil = Date.now() + 5 * 60 * 1000;
      console.log(`[CIRCUIT] model ${modelId}: ${prevState} → circuit_open (${entry.failureCount} failures)`);
    } else if (entry.failureCount >= 2 && entry.state === 'healthy') {
      entry.state = 'degraded';
      console.log(`[CIRCUIT] model ${modelId}: healthy → degraded (${entry.failureCount} failures)`);
    }
  }

  /**
   * Check if a model is currently available for routing.
   * Models in circuit_open are unavailable unless the cooldown has expired
   * (in which case they become available for a probe request).
   */
  isAvailable(modelId) {
    const entry = this.#models.get(modelId);
    if (!entry) return true; // Never tracked = healthy
    if (entry.state === 'healthy' || entry.state === 'degraded') return true;
    if (entry.state === 'circuit_open') {
      if (entry.cooldownUntil && Date.now() >= entry.cooldownUntil) {
        // Cooldown expired — allow a probe
        return true;
      }
      return false;
    }
    return true;
  }

  /**
   * Get the current circuit breaker state for a model.
   * @returns {string} 'healthy', 'degraded', or 'circuit_open'
   */
  getState(modelId) {
    return this.#models.get(modelId)?.state ?? 'healthy';
  }

  /**
   * Get all tracked models with their state.
   * @returns {Map<string, {state: string, failureCount: number, lastFailure: number}>}
   */
  getAllStates() {
    return new Map(this.#models);
  }

  /**
   * Reset a model's circuit breaker to healthy.
   */
  reset(modelId) {
    this.#models.delete(modelId);
  }

  /**
   * Reset all circuit breakers.
   */
  resetAll() {
    this.#models.clear();
  }
}
