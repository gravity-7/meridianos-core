import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPricing, costFor } from '../pricing.mjs';

// NOTE: tests that validate a *tenant's committed* pricing.json (shape / registry coverage /
// the default committed-catalog path) live with the tenant (PropertyVerdict's tools/aios/tests),
// not here — the generic core ships no pricing.json. These cover the pure loadPricing/costFor logic.

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
