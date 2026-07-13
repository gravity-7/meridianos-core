import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPricing, costFor } from '../pricing.mjs';
import { resolvePaths } from '../config.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';

const config = resolvePaths({ domain: FIXTURE_DOMAIN });

const TIERS_BY_PROVIDER = {
  anthropic: ['claude-haiku-4-5-20251001', 'claude-sonnet-5', 'claude-opus-4-8', 'claude-fable-5'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
};

test('pricing.json is valid JSON with a shape of provider -> model -> per-1M USD prices', () => {
  const raw = JSON.parse(readFileSync(config.pricingPath, 'utf8'));
  assert.equal(typeof raw, 'object');
  for (const [provider, models] of Object.entries(raw)) {
    assert.equal(typeof provider, 'string');
    assert.equal(typeof models, 'object');
    for (const [model, entry] of Object.entries(models)) {
      assert.equal(typeof model, 'string');
      assert.equal(typeof entry.inputPerM, 'number', `${provider}/${model}.inputPerM must be a number`);
      assert.equal(typeof entry.outputPerM, 'number', `${provider}/${model}.outputPerM must be a number`);
      assert.ok(entry.inputPerM >= 0, `${provider}/${model}.inputPerM must be non-negative`);
      assert.ok(entry.outputPerM >= 0, `${provider}/${model}.outputPerM must be non-negative`);
      if (entry.cachedInputPerM !== undefined) {
        assert.equal(typeof entry.cachedInputPerM, 'number', `${provider}/${model}.cachedInputPerM must be a number when present`);
        assert.ok(entry.cachedInputPerM >= 0);
      }
    }
  }
});

test('pricing.json seeds every anthropic + deepseek tier model the provider registry references', () => {
  const raw = JSON.parse(readFileSync(config.pricingPath, 'utf8'));
  for (const [provider, models] of Object.entries(TIERS_BY_PROVIDER)) {
    for (const model of models) {
      assert.ok(raw[provider]?.[model], `pricing.json is missing ${provider}/${model}`);
    }
  }
});

test('pricing.json seeds openrouter as an object (populated only by the refresh script, not hand-entry)', () => {
  const raw = JSON.parse(readFileSync(config.pricingPath, 'utf8'));
  assert.equal(typeof raw.openrouter, 'object');
});

test('loadPricing returns {} for a missing file rather than throwing', () => {
  assert.deepEqual(loadPricing('/definitely/not/a/real/path/pricing.json'), {});
});

test('costFor computes input/output/total cost from a catalog entry', () => {
  const catalog = { anthropic: { 'claude-sonnet-5': { inputPerM: 2, outputPerM: 10 } } };
  const cost = costFor('anthropic', 'claude-sonnet-5', { inputTokens: 500_000, outputTokens: 100_000 }, { catalog });
  assert.equal(cost.inputCost, 1); // 0.5M * $2/M
  assert.equal(cost.outputCost, 1); // 0.1M * $10/M
  assert.equal(cost.totalCost, 2);
});

test('costFor returns null when the provider is entirely absent from the catalog', () => {
  const catalog = { anthropic: { 'claude-sonnet-5': { inputPerM: 2, outputPerM: 10 } } };
  assert.equal(costFor('deepseek', 'deepseek-chat', { inputTokens: 1000, outputTokens: 500 }, { catalog }), null);
});

test('costFor returns null when the model is absent from a known provider (never fabricated)', () => {
  const catalog = { anthropic: { 'claude-sonnet-5': { inputPerM: 2, outputPerM: 10 } } };
  assert.equal(costFor('anthropic', 'claude-opus-4-8', { inputTokens: 1000, outputTokens: 500 }, { catalog }), null);
});

test('costFor treats missing token counts as zero rather than throwing', () => {
  const catalog = { anthropic: { 'claude-sonnet-5': { inputPerM: 2, outputPerM: 10 } } };
  const cost = costFor('anthropic', 'claude-sonnet-5', {}, { catalog });
  assert.deepEqual(cost, { inputCost: 0, outputCost: 0, totalCost: 0 });
});

test('costFor uses the real committed catalog by default (loadPricing(undefined, config))', () => {
  const cost = costFor('anthropic', 'claude-haiku-4-5-20251001', { inputTokens: 1_000_000, outputTokens: 1_000_000 }, { config });
  assert.ok(cost, 'claude-haiku-4-5-20251001 must be priced in the committed catalog');
  assert.ok(cost.totalCost > 0);
});
