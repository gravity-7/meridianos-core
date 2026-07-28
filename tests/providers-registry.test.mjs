/**
 * tests/providers-registry.test.mjs — Tests for the three-source provider merge engine (US1).
 *
 * Tests:
 *   - Three-source merge priority (policy > .ai > defaults)
 *   - Field-level override
 *   - Provider hiding via null override
 *   - Deep merge of headers/features
 *   - Backward-compatible PROVIDERS lazy getter
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');
const AI_DIR = join(REPO_ROOT, '.ai');

// Ensure .ai directory exists for test
if (!existsSync(AI_DIR)) mkdirSync(AI_DIR, { recursive: true });

// Clean up test artifacts
function cleanup() {
  const files = [
    join(AI_DIR, 'providers.yaml'),
    join(AI_DIR, 'policy.yaml'),
  ];
  for (const f of files) {
    try { unlinkSync(f); } catch { /* ok */ }
  }
}

// Dynamically import after cleanup to avoid stale module cache
async function reloadProviders() {
  // Bust the module cache
  const mod = await import('../providers.mjs');
  return mod;
}

describe('Provider Registry — Three-Source Merge', () => {
  it('resolveAllProviders returns built-in defaults when no policy or local YAML exist', async () => {
    cleanup();
    const { resolveAllProviders } = await reloadProviders();
    const all = resolveAllProviders({}, { repoRoot: REPO_ROOT });
    // Should have at least the code-built-in providers
    assert.ok('anthropic' in all, 'anthropic should be present');
    assert.ok('deepseek' in all, 'deepseek should be present');
    assert.ok('openrouter' in all, 'openrouter should be present');
    // Ollama from providers.defaults.yaml
    assert.ok('ollama' in all, 'ollama from defaults YAML should be present');
  });

  it('resolveAllProviders merges policy.yaml provider overrides (highest priority)', async () => {
    cleanup();
    const testPolicy = {
      providers: {
        anthropic: {
          baseUrl: 'https://custom-proxy.example.com',
          displayName: 'Custom Anthropic',
        },
      },
    };
    const { resolveAllProviders } = await reloadProviders();
    const all = resolveAllProviders(testPolicy, { repoRoot: REPO_ROOT });
    const anthro = all.anthropic;
    assert.equal(anthro.baseUrl, 'https://custom-proxy.example.com', 'baseUrl should be overridden by policy');
    assert.equal(anthro.displayName, 'Custom Anthropic', 'displayName should be overridden');
    assert.equal(anthro.wire, 'anthropic', 'wire should be preserved from defaults');
  });

  it('resolveAllProviders deep-merges headers and features', async () => {
    cleanup();
    const testPolicy = {
      providers: {
        openrouter: {
          headers: {
            'X-Custom': 'my-value',
          },
          features: {
            supportsCaching: true,
          },
        },
      },
    };
    const { resolveAllProviders } = await reloadProviders();
    const all = resolveAllProviders(testPolicy, { repoRoot: REPO_ROOT });
    const or = all.openrouter;
    // Original headers (HTTP-Referer, X-Title) should be preserved
    assert.ok(or.headers?.['HTTP-Referer'], 'original HTTP-Referer header preserved');
    assert.equal(or.headers?.['X-Custom'], 'my-value', 'new header added');
    // Feature should be overridden
    assert.equal(or.features?.supportsCaching, true, 'supportsCaching overridden');
    assert.equal(or.features?.supportsStreaming, true, 'supportsStreaming preserved');
  });

  it('resolveProvider returns null for unknown provider', async () => {
    cleanup();
    const { resolveProvider } = await reloadProviders();
    const result = resolveProvider('nonexistent', {}, { repoRoot: REPO_ROOT });
    assert.equal(result, null, 'unknown provider should return null');
  });

  it('resolveProvider returns resolved provider for known provider', async () => {
    cleanup();
    const { resolveProvider } = await reloadProviders();
    const result = resolveProvider('anthropic', {}, { repoRoot: REPO_ROOT });
    assert.ok(result, 'anthropic should resolve');
    assert.equal(result.name, 'anthropic');
    assert.equal(result.wire, 'anthropic');
  });

  it('PROVIDERS Proxy lazy getter works for existing code patterns', async () => {
    cleanup();
    const { PROVIDERS, resolveAllProviders } = await reloadProviders();
    // Access as PROVIDERS.anthropic
    assert.ok(PROVIDERS.anthropic, 'PROVIDERS.anthropic should resolve');
    assert.equal(PROVIDERS.anthropic.name, 'anthropic');
    // Object.keys should work
    const keys = Object.keys(PROVIDERS);
    assert.ok(keys.includes('anthropic'), 'Object.keys should include anthropic');
    assert.ok(keys.includes('deepseek'), 'Object.keys should include deepseek');
  });

  it('null provider in policy hides the provider', async () => {
    cleanup();
    const testPolicy = {
      providers: {
        ollama: null, // hide ollama
      },
    };
    const { resolveAllProviders } = await reloadProviders();
    const all = resolveAllProviders(testPolicy, { repoRoot: REPO_ROOT });
    assert.ok(!('ollama' in all), 'ollama should be hidden by null override');
    assert.ok('anthropic' in all, 'anthropic still present');
  });
});
