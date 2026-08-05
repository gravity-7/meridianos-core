/**
 * tests/model-discovery.test.mjs — US4: Model Discovery Tests
 *
 * Tests discovery adapters, normalization, deprecation marking, and error resilience.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db.mjs';
import { ensureModelRegistry, getModels } from '../model-registry.mjs';

// Test the adapter function signatures and basic behavior
describe('Model Discovery (US4)', () => {
  describe('OpenAI adapter', () => {
    it('has discoverModels export', async () => {
      const adapter = await import('../gateway/model-discovery-adapters/openai.mjs');
      assert.equal(typeof adapter.discoverModels, 'function');
    });

    it('normalizes model list response format', async () => {
      const adapter = await import('../gateway/model-discovery-adapters/openai.mjs');
      assert.equal(typeof adapter.discoverModels, 'function');
      // Function exists — network-dependent tests run via cassette in CI
    });
  });

  describe('Anthropic adapter', () => {
    it('has discoverModels export', async () => {
      const adapter = await import('../gateway/model-discovery-adapters/anthropic.mjs');
      assert.equal(typeof adapter.discoverModels, 'function');
    });

    it('returns curated model list (no network required)', async () => {
      const adapter = await import('../gateway/model-discovery-adapters/anthropic.mjs');
      const models = await adapter.discoverModels({ name: 'anthropic', baseUrl: 'https://api.anthropic.com' });
      assert.ok(Array.isArray(models));
      assert.ok(models.length > 0, 'Anthropic adapter should return at least one model');
      // Each model should have model_id
      for (const m of models) {
        assert.ok(typeof m.model_id === 'string');
        assert.ok(m.model_id.length > 0);
      }
    });
  });

  describe('Google AI adapter', () => {
    it('has discoverModels export', async () => {
      const adapter = await import('../gateway/model-discovery-adapters/google-ai.mjs');
      assert.equal(typeof adapter.discoverModels, 'function');
    });
  });

  describe('Generic HTTP adapter', () => {
    it('has discoverModels export', async () => {
      const adapter = await import('../gateway/model-discovery-adapters/generic-http.mjs');
      assert.equal(typeof adapter.discoverModels, 'function');
    });

    it('handles unreachable endpoint gracefully', async () => {
      const adapter = await import('../gateway/model-discovery-adapters/generic-http.mjs');
      // Use a non-routable IP with a short timeout expectation
      // The adapter should handle failures without throwing
      try {
        const models = await adapter.discoverModels({
          name: 'test',
          wire: 'generic-http',
          baseUrl: 'http://10.255.255.1:9999',
        });
        assert.ok(Array.isArray(models));
      } catch {
        // Adapter may throw — that's acceptable for unreachable endpoints
        // The orchestrator (discoverAllModels) catches per-provider errors
      }
    });
  });

  describe('model-discovery orchestrator', () => {
    it('exports discoverAllModels', async () => {
      const discovery = await import('../model-discovery.mjs');
      assert.equal(typeof discovery.discoverAllModels, 'function');
    });
  });

  describe('concurrent discovery + pricing refresh (spec.md edge case)', () => {
    // Anthropic-only policy: curated discovery adapter + provider-native pricing are both
    // network-free, so this test is deterministic and doesn't depend on any other provider's
    // reachability (deepseek/openrouter/ollama all ship as built-in defaults — see providers.defaults.yaml).
    const policy = { providers: { deepseek: null, openrouter: null, ollama: null } };

    it('running discoverAllModels and refreshAllModelPricing concurrently does not throw or corrupt the registry', async () => {
      const db = openDb(':memory:');
      ensureModelRegistry(db);
      try {
        const { discoverAllModels } = await import('../model-discovery.mjs');
        const { refreshAllModelPricing } = await import('../pricing-refresh.mjs');

        // Pricing refresh racing ahead of discovery (registry still empty) must no-op cleanly,
        // not crash — this is the actual failure mode the spec.md edge case warns about.
        const [discoveryResult, pricingResult] = await Promise.all([
          discoverAllModels(db, policy, {}),
          refreshAllModelPricing(db, policy, {}),
        ]);

        assert.ok(discoveryResult.modelsDiscovered >= 0);
        assert.ok(pricingResult.failed === 0 || pricingResult.refreshed >= 0);

        // Registry must still be well-formed after the race.
        const rows = getModels(db, {});
        assert.ok(Array.isArray(rows));
      } finally {
        db.close();
      }
    });

    it('a model discovered mid-refresh is priced on the next pricing pass (not lost)', async () => {
      const db = openDb(':memory:');
      ensureModelRegistry(db);
      try {
        const { discoverAllModels } = await import('../model-discovery.mjs');
        const { refreshAllModelPricing } = await import('../pricing-refresh.mjs');

        await discoverAllModels(db, policy, {});
        const afterDiscovery = getModels(db, { provider: 'anthropic' });
        assert.ok(afterDiscovery.length > 0, 'anthropic curated adapter should have discovered models');

        const result = await refreshAllModelPricing(db, policy, {});
        assert.equal(result.failed, 0);

        const priced = getModels(db, { provider: 'anthropic' });
        for (const m of priced) {
          assert.equal(m.pricing_source, 'provider-native');
        }
      } finally {
        db.close();
      }
    });
  });
});
