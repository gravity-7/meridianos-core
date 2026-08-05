import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPricing, costFor, getEffectiveCost } from '../pricing.mjs';

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

// getEffectiveCost — cache-differentiated cost calculation (003 US6)

test('getEffectiveCost splits cached vs uncached input at their respective rates', () => {
  const catalog = { anthropic: { 'claude-sonnet-5': { inputPerM: 3, outputPerM: 15, cachedInputPerM: 0.3 } } };
  // 500 cached + 500 uncached input, 200 output
  const cost = getEffectiveCost('anthropic:claude-sonnet-5', 1000, 200, 500, catalog);
  // (500 * 3.00 + 500 * 0.30 + 200 * 15.00) / 1_000_000
  assert.equal(cost, (500 * 3 + 500 * 0.3 + 200 * 15) / 1_000_000);
});

test('getEffectiveCost costs all input at the standard rate when cachedInputTokens is 0', () => {
  const catalog = { anthropic: { 'claude-sonnet-5': { inputPerM: 3, outputPerM: 15, cachedInputPerM: 0.3 } } };
  const cost = getEffectiveCost('anthropic:claude-sonnet-5', 1000, 200, 0, catalog);
  assert.equal(cost, (1000 * 3 + 200 * 15) / 1_000_000);
});

test('getEffectiveCost falls back to the standard input rate when cachedInputPerM is absent', () => {
  const catalog = { anthropic: { 'claude-sonnet-5': { inputPerM: 3, outputPerM: 15 } } };
  const cost = getEffectiveCost('anthropic:claude-sonnet-5', 1000, 200, 500, catalog);
  // no cachedInputPerM → cached tokens cost at the standard input rate, same as if none were cached
  assert.equal(cost, (1000 * 3 + 200 * 15) / 1_000_000);
});

test('getEffectiveCost clamps cachedInputTokens to inputTokens (never double-counts or goes negative)', () => {
  const catalog = { anthropic: { 'claude-sonnet-5': { inputPerM: 3, outputPerM: 15, cachedInputPerM: 0.3 } } };
  // cachedInputTokens exceeds inputTokens — should behave as if all input was cached
  const cost = getEffectiveCost('anthropic:claude-sonnet-5', 1000, 200, 5000, catalog);
  assert.equal(cost, (1000 * 0.3 + 200 * 15) / 1_000_000);
});

test('getEffectiveCost returns null when the model is absent from the catalog', () => {
  const catalog = { anthropic: { 'claude-sonnet-5': { inputPerM: 3, outputPerM: 15 } } };
  assert.equal(getEffectiveCost('anthropic:claude-opus-4-8', 1000, 200, 0, catalog), null);
});

test('getEffectiveCost returns null for a malformed composite model id (missing ":")', () => {
  const catalog = { anthropic: { 'claude-sonnet-5': { inputPerM: 3, outputPerM: 15 } } };
  assert.equal(getEffectiveCost('claude-sonnet-5', 1000, 200, 0, catalog), null);
});
