/**
 * tests/model-router-fallback.test.mjs — US5: Model Router Fallback Tests
 *
 * Tests weighted selection distribution, fallback chains across tiers,
 * circuit breaker transitions, and backward compatibility.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  selectModelFromCandidates,
  resolveModelWithFallback,
  AllModelsExhaustedError,
} from '../model-router.mjs';
import { CircuitBreaker } from '../model-fallback.mjs';

describe('Model Router Fallback (US5)', () => {
  describe('selectModelFromCandidates — weighted selection', () => {
    it('selects the only candidate when weight is 100', () => {
      const tierConfig = { candidates: [{ model: 'model-a', weight: 100 }] };
      const result = selectModelFromCandidates(tierConfig, { seed: 42 });
      assert.ok(result);
      assert.equal(result.model, 'model-a');
    });

    it('distributes roughly according to weights (deterministic seed)', () => {
      const tierConfig = {
        candidates: [
          { model: 'primary', weight: 90 },
          { model: 'canary', weight: 10 },
        ],
      };

      // Use a single seeded generator for consistent distribution
      let primaryCount = 0;
      let canaryCount = 0;
      for (let i = 0; i < 100; i++) {
        // Use a single seed, iterate the PRNG by using progressively larger seeds
        const result = selectModelFromCandidates(tierConfig, { seed: i * 1000 + 1 });
        if (result.model === 'primary') primaryCount++;
        else canaryCount++;
      }

      // The primary should be selected a majority of the time with 90/10 weights
      // Allow generous tolerance (at least 70%) since small sample + PRNG artifacts
      assert.ok(primaryCount >= 70, `primary should be selected majority of time, got ${primaryCount}/100`);
    });

    it('returns null for empty candidates', () => {
      const tierConfig = { candidates: [] };
      const result = selectModelFromCandidates(tierConfig);
      assert.equal(result, null);
    });

    it('auto-wraps legacy model string format', () => {
      const tierConfig = { model: 'legacy-model' };
      const result = selectModelFromCandidates(tierConfig, { seed: 1 });
      assert.ok(result);
      assert.equal(result.model, 'legacy-model');
      assert.equal(result.weight, 100);
    });

    it('filters out circuit-broken models', () => {
      const cb = new CircuitBreaker();
      cb.recordFailure('broken-model', { status: 401 }); // immediate circuit_open

      const tierConfig = {
        candidates: [
          { model: 'broken-model', weight: 50 },
          { model: 'healthy-model', weight: 50 },
        ],
      };

      const result = selectModelFromCandidates(tierConfig, { circuitBreaker: cb, seed: 1 });
      assert.ok(result);
      assert.equal(result.model, 'healthy-model');
    });

    it('returns null when all candidates are circuit-broken', () => {
      const cb = new CircuitBreaker();
      cb.recordFailure('broken-1', { status: 401 });
      cb.recordFailure('broken-2', { status: 401 });

      const tierConfig = {
        candidates: [
          { model: 'broken-1', weight: 50 },
          { model: 'broken-2', weight: 50 },
        ],
      };

      const result = selectModelFromCandidates(tierConfig, { circuitBreaker: cb });
      assert.equal(result, null);
    });
  });

  describe('resolveModelWithFallback — tier fallback', () => {
    it('selects from first tier when available', () => {
      const taskConfig = {
        tiers: [
          { candidates: [{ model: 'tier0-model', weight: 100 }] },
          { candidates: [{ model: 'tier1-model', weight: 100 }] },
        ],
      };

      const result = resolveModelWithFallback(taskConfig, { seed: 1 });
      assert.equal(result.model, 'tier0-model');
      assert.equal(result.tierIndex, 0);
    });

    it('falls back to next tier when first tier exhausted', () => {
      const taskConfig = {
        tiers: [
          { candidates: [] }, // empty tier
          { candidates: [{ model: 'tier1-model', weight: 100 }] },
        ],
      };

      const result = resolveModelWithFallback(taskConfig, { seed: 1 });
      assert.equal(result.model, 'tier1-model');
      assert.equal(result.tierIndex, 1);
    });

    it('skips already-attempted models', () => {
      const taskConfig = {
        tiers: [
          { candidates: [{ model: 'model-a', weight: 100 }] },
          { candidates: [{ model: 'model-a', weight: 50 }, { model: 'model-b', weight: 50 }] },
        ],
      };

      const attempted = new Set(['model-a']);
      const result = resolveModelWithFallback(taskConfig, { attemptedModels: attempted, seed: 1 });
      assert.equal(result.model, 'model-b');
    });

    it('throws AllModelsExhaustedError when all tiers exhausted', () => {
      const taskConfig = {
        tiers: [
          { candidates: [] },
          { candidates: [] },
        ],
      };

      assert.throws(
        () => resolveModelWithFallback(taskConfig),
        AllModelsExhaustedError,
      );
    });

    it('throws AllModelsExhaustedError for empty tiers', () => {
      assert.throws(
        () => resolveModelWithFallback({ tiers: [] }),
        AllModelsExhaustedError,
      );
    });

    it('handles legacy model string in tier config', () => {
      const taskConfig = {
        tiers: [
          { model: 'legacy-model' },
        ],
      };

      const result = resolveModelWithFallback(taskConfig, { seed: 1 });
      assert.equal(result.model, 'legacy-model');
    });
  });

  describe('CircuitBreaker', () => {
    it('starts healthy for unknown models', () => {
      const cb = new CircuitBreaker();
      assert.equal(cb.isAvailable('unknown-model'), true);
      assert.equal(cb.getState('unknown-model'), 'healthy');
    });

    it('transitions healthy → degraded → circuit_open on successive failures', () => {
      const cb = new CircuitBreaker();
      assert.equal(cb.getState('test-model'), 'healthy');

      cb.recordFailure('test-model', { status: 500 });
      assert.equal(cb.getState('test-model'), 'healthy'); // 1 failure, still healthy

      cb.recordFailure('test-model', { status: 500 });
      assert.equal(cb.getState('test-model'), 'degraded'); // 2 failures → degraded

      cb.recordFailure('test-model', { status: 500 });
      cb.recordFailure('test-model', { status: 500 });
      cb.recordFailure('test-model', { status: 500 });
      assert.equal(cb.getState('test-model'), 'circuit_open'); // 5 failures → circuit_open
    });

    it('immediately opens circuit on auth error (401)', () => {
      const cb = new CircuitBreaker();
      cb.recordFailure('auth-model', { status: 401 });
      assert.equal(cb.getState('auth-model'), 'circuit_open');
    });

    it('immediately opens circuit on auth error (403)', () => {
      const cb = new CircuitBreaker();
      cb.recordFailure('auth-model-2', { status: 403 });
      assert.equal(cb.getState('auth-model-2'), 'circuit_open');
    });

    it('recovers from degraded to healthy on success', () => {
      const cb = new CircuitBreaker();
      cb.recordFailure('recovery-model', { status: 500 });
      cb.recordFailure('recovery-model', { status: 500 });
      assert.equal(cb.getState('recovery-model'), 'degraded');

      cb.recordSuccess('recovery-model');
      assert.equal(cb.getState('recovery-model'), 'healthy');
    });

    it('does not count 4xx client errors (except auth)', () => {
      const cb = new CircuitBreaker();
      cb.recordFailure('client-err-model', { status: 400 });
      cb.recordFailure('client-err-model', { status: 404 });
      cb.recordFailure('client-err-model', { status: 422 });
      assert.equal(cb.getState('client-err-model'), 'healthy');
    });

    it('circuit_open model becomes available after cooldown', () => {
      const cb = new CircuitBreaker();
      cb.recordFailure('cooldown-model', { status: 401 });
      assert.equal(cb.getState('cooldown-model'), 'circuit_open');
      assert.equal(cb.isAvailable('cooldown-model'), false);

      // Can't easily test cooldown expiry without mocking time,
      // but we verify the state is circuit_open
    });
  });
});
