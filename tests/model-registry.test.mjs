/**
 * tests/model-registry.test.mjs — US4: Model Registry Tests
 *
 * Tests SQLite model_registry table operations: upsert, query, filter,
 * deprecation marking, tier assignment, and composite PK scoping.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db.mjs';
import {
  ensureModelRegistry,
  upsertModel,
  getModels,
  markDeprecated,
  markUnseenAsDeprecated,
  autoAssignTiers,
  findModel,
} from '../model-registry.mjs';

describe('Model Registry (US4)', () => {
  /** @type {import('better-sqlite3').Database} */
  let db;

  before(() => {
    db = openDb(':memory:');
    ensureModelRegistry(db);
  });

  after(() => {
    db?.close();
  });

  describe('ensureModelRegistry', () => {
    it('creates model_registry table', () => {
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='model_registry'").get();
      assert.ok(row);
      assert.equal(row.name, 'model_registry');
    });

    it('is idempotent', () => {
      // Calling again should not throw
      assert.doesNotThrow(() => ensureModelRegistry(db));
    });
  });

  describe('upsertModel', () => {
    it('inserts a new model', () => {
      upsertModel(db, 'anthropic', {
        model_id: 'claude-sonnet-5',
        display_name: 'Claude Sonnet 5',
        context_window: 200000,
        max_output_tokens: 8192,
        features: { vision: true, toolUse: true },
      });

      const model = findModel(db, 'anthropic', 'claude-sonnet-5');
      assert.ok(model);
      assert.equal(model.model_id, 'claude-sonnet-5');
      assert.equal(model.provider, 'anthropic');
      assert.equal(model.display_name, 'Claude Sonnet 5');
      assert.equal(model.context_window, 200000);
    });

    it('updates an existing model (upsert)', () => {
      upsertModel(db, 'anthropic', {
        model_id: 'claude-sonnet-5',
        display_name: 'Claude Sonnet 5 Updated',
        context_window: 250000,
      });

      const model = findModel(db, 'anthropic', 'claude-sonnet-5');
      assert.equal(model.display_name, 'Claude Sonnet 5 Updated');
      assert.equal(model.context_window, 250000);
    });

    it('scopes models by provider (composite PK)', () => {
      upsertModel(db, 'anthropic', {
        model_id: 'claude-sonnet-5',
        display_name: 'Anthropic Claude Sonnet 5',
      });
      upsertModel(db, 'openrouter', {
        model_id: 'claude-sonnet-5',
        display_name: 'OpenRouter Claude Sonnet 5',
      });

      const anthro = findModel(db, 'anthropic', 'claude-sonnet-5');
      const openrouter = findModel(db, 'openrouter', 'claude-sonnet-5');

      assert.ok(anthro);
      assert.ok(openrouter);
      assert.equal(anthro.display_name, 'Anthropic Claude Sonnet 5');
      assert.equal(openrouter.display_name, 'OpenRouter Claude Sonnet 5');
      assert.notEqual(anthro.id, openrouter.id);
    });
  });

  describe('getModels', () => {
    before(() => {
      // Seed test data
      upsertModel(db, 'anthropic', { model_id: 'claude-opus-4', context_window: 200000, features: { vision: true } });
      upsertModel(db, 'openai', { model_id: 'gpt-4o', context_window: 128000 });
      upsertModel(db, 'openai', { model_id: 'gpt-4o-mini', context_window: 128000 });
      upsertModel(db, 'deepseek', { model_id: 'deepseek-v4-pro', context_window: 65536, deprecated: 0 });
      upsertModel(db, 'deepseek', { model_id: 'deprecated-model', context_window: 8192, deprecated: 1 });
    });

    it('returns all models with no filters', () => {
      const models = getModels(db, {});
      assert.ok(models.length >= 4);
    });

    it('filters by provider', () => {
      const models = getModels(db, { provider: 'openai' });
      assert.ok(models.length >= 2);
      for (const m of models) {
        assert.equal(m.provider, 'openai');
      }
    });

    it('filters by deprecated flag', () => {
      const active = getModels(db, { deprecated: false });
      for (const m of active) {
        assert.ok(!m.deprecated || m.deprecated === 0);
      }

      const deprecated = getModels(db, { deprecated: true });
      for (const m of deprecated) {
        assert.equal(m.deprecated, 1);
      }
    });

    it('filters by search text', () => {
      const models = getModels(db, { search: 'claude' });
      assert.ok(models.length >= 2);
      for (const m of models) {
        assert.ok(m.model_id.includes('claude') || m.display_name?.includes('Claude'));
      }
    });
  });

  describe('markDeprecated', () => {
    it('marks unseen models as deprecated', () => {
      // First, ensure model exists and is not deprecated
      upsertModel(db, 'test-provider', { model_id: 'will-be-deprecated', deprecated: 0 });
      upsertModel(db, 'test-provider', { model_id: 'stays-active', deprecated: 0 });

      // Mark only 'stays-active' as seen
      markUnseenAsDeprecated(db, 'test-provider', ['stays-active']);

      const deprecated = findModel(db, 'test-provider', 'will-be-deprecated');
      const active = findModel(db, 'test-provider', 'stays-active');

      assert.equal(deprecated?.deprecated, 1);
      assert.equal(active?.deprecated, 0);
    });
  });

  describe('autoAssignTiers', () => {
    before(() => {
      // Models with different context windows
      upsertModel(db, 'tier-test', { model_id: 'small-model', context_window: 8192, deprecated: 0 });
      upsertModel(db, 'tier-test', { model_id: 'medium-model', context_window: 65536, deprecated: 0 });
      upsertModel(db, 'tier-test', { model_id: 'large-model', context_window: 200000, deprecated: 0 });
      upsertModel(db, 'tier-test', { model_id: 'no-ctx-model', context_window: null, deprecated: 0 });
    });

    it('assigns tiers based on context window heuristic', () => {
      autoAssignTiers(db);

      const small = findModel(db, 'tier-test', 'small-model');
      const medium = findModel(db, 'tier-test', 'medium-model');
      const large = findModel(db, 'tier-test', 'large-model');

      // Heuristic: < 32k → quick, 32k-128k → medium, ≥128k → best
      assert.equal(small?.tier_assigned, 'quick');
      assert.equal(medium?.tier_assigned, 'medium');
      assert.equal(large?.tier_assigned, 'best');
    });

    it('assigns medium tier as safe default for null context window models', () => {
      const noCtx = findModel(db, 'tier-test', 'no-ctx-model');
      // Models without context window info get 'medium' as a safe default tier
      assert.ok(noCtx?.tier_assigned);
      assert.equal(noCtx.tier_assigned, 'medium');
    });
  });

  describe('findModel', () => {
    it('returns null for unknown model', () => {
      const result = findModel(db, 'nonexistent', 'fake-model');
      assert.equal(result, null);
    });

    it('returns model by provider and model_id', () => {
      const result = findModel(db, 'openai', 'gpt-4o');
      assert.ok(result);
      assert.equal(result.model_id, 'gpt-4o');
    });
  });
});
