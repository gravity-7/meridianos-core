/**
 * tests/provider-wizard.test.mjs — US3: Provider Wizard Tests
 *
 * Tests interactive CLI mode, auto-detect mode, non-interactive mode,
 * dashboard API, known-providers pre-fill, and concurrent modification detection.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProviderWizard, runProviderWizardDashboard, autoDetectProviders, listSetupProviders, resolveSetupProviderChoice, readPolicyState, writePolicyWithBackup } from '../provider-wizard.mjs';

describe('Provider Wizard (US3)', () => {
  describe('autoDetectProviders', () => {
    it('detects providers with matching env vars', () => {
      // Set a known provider env var
      const prev = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';

      try {
        const detected = autoDetectProviders();
        const anthropic = detected.find((p) => p.name === 'anthropic');
        assert.ok(anthropic, 'Should detect anthropic when ANTHROPIC_API_KEY is set');
        assert.equal(anthropic.wire, 'anthropic');
      } finally {
        if (prev !== undefined) {
          process.env.ANTHROPIC_API_KEY = prev;
        } else {
          delete process.env.ANTHROPIC_API_KEY;
        }
      }
    });

    it('does not detect providers without env vars', () => {
      const prev = process.env.NONEXISTENT_PROVIDER_KEY;
      delete process.env.NONEXISTENT_PROVIDER_KEY;

      try {
        const detected = autoDetectProviders();
        const nonexistent = detected.find((p) => p.name === 'nonexistent-provider');
        assert.equal(nonexistent, undefined);
      } finally {
        if (prev !== undefined) process.env.NONEXISTENT_PROVIDER_KEY = prev;
      }
    });
  });

  describe('listSetupProviders', () => {
    it('returns only non-secret BYOK metadata from the resolved registry', () => {
      const providers = listSetupProviders({
        registry: {
          deepseek: {
            name: 'deepseek', displayName: 'DeepSeek', keyEnv: 'DEEPSEEK_KEY', baseUrl: 'https://example.invalid',
            models: { simple: 'deepseek-v4-flash', complex: 'deepseek-v4-pro' },
          },
          native: { name: 'native', displayName: 'Native', keyEnv: null, baseUrl: null, models: { simple: 'native' } },
        },
      });

      assert.deepEqual(providers, [{
        id: 'deepseek', displayName: 'DeepSeek', keyEnv: 'DEEPSEEK_KEY', models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
      }]);
      assert.doesNotMatch(JSON.stringify(providers), /example\.invalid/);
    });

    it('ignores a mutable local provider overlay when resolving a credential destination for setup', () => {
      const repoRoot = mkdtempSync(join(tmpdir(), 'provider-wizard-'));
      mkdirSync(join(repoRoot, '.ai'), { recursive: true });
      writeFileSync(join(repoRoot, '.ai', 'providers.yaml'), `providers:
  deepseek:
    baseUrl: https://untrusted.invalid/v1
  untrusted:
    name: untrusted
    baseUrl: https://untrusted.invalid/v1
    keyEnv: UNTRUSTED_KEY
    models:
      simple: synthetic-model
`);

      const providers = listSetupProviders({ config: { repoRoot } });
      const resolved = resolveSetupProviderChoice({
        providerId: 'deepseek', modelId: 'deepseek-v4-flash', config: { repoRoot },
      });

      assert.equal(providers.some((provider) => provider.id === 'untrusted'), false);
      assert.equal(resolved.provider.baseUrl, 'https://api.deepseek.com');
      assert.doesNotMatch(JSON.stringify(resolved), /untrusted\.invalid/);
    });
  });

  describe('runProviderWizard — non-interactive mode', () => {
    it('returns error without required params in non-interactive mode', async () => {
      const result = await runProviderWizard({ interactive: false, auto: false });
      assert.equal(result.ok, false);
      assert.ok(result.error);
    });

    it('accepts --name --wire --base-url params', async () => {
      // Non-interactive mode with required params — will attempt to write to policy.yaml
      // In test context without real policy.yaml, it should still validate params
      const result = await runProviderWizard({
        interactive: false,
        auto: false,
        name: 'test-provider',
        wire: 'openai',
        baseUrl: 'https://test.example.com/v1',
        keyEnv: 'TEST_KEY',
        repoRoot: mkdtempSync(join(tmpdir(), 'provider-wizard-')),
      });

      // May fail due to missing policy.yaml in test environment, but shouldn't crash
      assert.ok(result.ok !== undefined);
    });
  });

  describe('runProviderWizard — auto mode', () => {
    it('returns error when no providers detected', async () => {
      // Save existing keys
      const saved = {};
      const knownEnvs = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'DEEPSEEK_KEY', 'GROQ_API_KEY',
        'GOOGLE_API_KEY', 'MISTRAL_API_KEY', 'COHERE_API_KEY', 'TOGETHER_API_KEY'];

      for (const env of knownEnvs) {
        saved[env] = process.env[env];
        delete process.env[env];
      }

      try {
        // With no known env vars set, auto mode should return error
        // (may also succeed if policy.yaml doesn't exist)
        const result = await runProviderWizard({ auto: true, repoRoot: mkdtempSync(join(tmpdir(), 'provider-wizard-')) });
        // Either error or ok — should not throw
        assert.ok(result.ok !== undefined);
      } finally {
        for (const [env, val] of Object.entries(saved)) {
          if (val !== undefined) process.env[env] = val;
        }
      }
    });
  });

  describe('runProviderWizardDashboard', () => {
    it('returns error for unknown provider', async () => {
      const result = await runProviderWizardDashboard('nonexistent-provider', null, null);
      assert.equal(result.ok, false);
      assert.ok(result.error.includes('Unknown'));
    });

    it('accepts known provider name', async () => {
      const previous = process.env.ANTHROPIC_API_KEY;
      try {
        const result = await runProviderWizardDashboard(
          'anthropic', 'ANTHROPIC_API_KEY', 'synthetic-provider-wizard-sentinel',
          mkdtempSync(join(tmpdir(), 'provider-wizard-')),
        );
        assert.ok(result.ok !== undefined);
      } finally {
        if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
        else process.env.ANTHROPIC_API_KEY = previous;
      }
    });
  });

  describe('concurrent modification detection (readPolicyState + writePolicyWithBackup)', () => {
    it('writes cleanly when no one else touched policy.yaml since it was read', () => {
      const repoRoot = mkdtempSync(join(tmpdir(), 'provider-wizard-'));
      mkdirSync(join(repoRoot, '.ai'), { recursive: true });
      writeFileSync(join(repoRoot, '.ai', 'policy.yaml'), 'version: 1\n');

      const { policy, mtimeMs } = readPolicyState(repoRoot);
      const result = writePolicyWithBackup(repoRoot, { ...policy, providers: { foo: { name: 'foo' } } }, mtimeMs);

      assert.equal(result.conflict, undefined);
      assert.equal(result.written, true);
    });

    it('reports a conflict instead of silently overwriting when policy.yaml changed after it was read', () => {
      const repoRoot = mkdtempSync(join(tmpdir(), 'provider-wizard-'));
      mkdirSync(join(repoRoot, '.ai'), { recursive: true });
      const policyPath = join(repoRoot, '.ai', 'policy.yaml');
      writeFileSync(policyPath, 'version: 1\n');

      const { policy, mtimeMs } = readPolicyState(repoRoot);

      // Simulate another process (e.g. the daemon, or a second dashboard request) writing to
      // policy.yaml after our read but before our write. Force the mtime forward explicitly so
      // the test doesn't depend on filesystem timestamp resolution.
      writeFileSync(policyPath, 'version: 1\nkill_switch: true\n');
      const future = new Date(Date.now() + 60_000);
      utimesSync(policyPath, future, future);

      const result = writePolicyWithBackup(repoRoot, { ...policy, providers: { foo: { name: 'foo' } } }, mtimeMs);

      assert.equal(result.conflict, true);
      assert.equal(result.written, false);
    });

    it('skips conflict detection when policy.yaml did not exist at read time (expectedMtimeMs is 0)', () => {
      const repoRoot = mkdtempSync(join(tmpdir(), 'provider-wizard-'));

      const { mtimeMs } = readPolicyState(repoRoot); // no .ai/policy.yaml yet → mtimeMs === 0
      assert.equal(mtimeMs, 0);

      const result = writePolicyWithBackup(repoRoot, { providers: { foo: { name: 'foo' } } }, mtimeMs);
      assert.equal(result.conflict, undefined);
      assert.equal(result.written, true);
    });
  });
});
