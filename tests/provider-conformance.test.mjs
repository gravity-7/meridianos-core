/**
 * tests/provider-conformance.test.mjs — US2: Provider Conformance Testing
 *
 * Tests error classification, timeout handling, null baseUrl case,
 * and function signatures. Network-dependent tests (actual API calls)
 * are validated via manual quickstart scenarios rather than unit tests.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { testProviderConnection, toSafeProviderValidationResult, validateSetupProviderConnection } from '../provider-conformance.mjs';

// A real local TCP server that accepts the connection but never responds — exercises
// testProviderConnection's 5s AbortController timeout path deterministically. An earlier version of
// this file pointed at a real-looking-but-unreachable external IP (10.255.255.1) to provoke the same
// TIMEOUT/CONNECTION_FAILED classification: fetch()'s AbortSignal DID fire correctly at 5s, but the
// underlying OS-level connect() to that black-holed address wasn't cleanly cancellable, leaving a
// lingering socket handle that kept the whole `node --test` process alive for minutes past the
// assertions actually passing — it hung the entire suite, not just this file. A loopback server that
// actually accepts the connection has a real, cancellable socket, so the abort tears it down cleanly.
let blackHole;
let blackHoleUrl;

before(async () => {
  blackHole = net.createServer((socket) => { /* accept, never respond — provokes the abort-timeout path */ });
  await new Promise((resolve) => blackHole.listen(0, '127.0.0.1', resolve));
  blackHoleUrl = `http://127.0.0.1:${blackHole.address().port}`;
});

after(async () => {
  await new Promise((resolve) => blackHole.close(resolve));
});

describe('Provider Conformance (US2)', () => {
  describe('Null baseUrl (no network)', () => {
    it('returns ok:true with zero latency for null baseUrl', async () => {
      const result = await testProviderConnection(
        { name: 'native', wire: 'anthropic', baseUrl: null },
        null,
      );

      assert.equal(result.ok, true);
      assert.equal(result.latencyMs, 0);
      assert.equal(result.modelsFound, null);
      assert.equal(result.errorCode, undefined);
    });

    it('handles null baseUrl for openai wire', async () => {
      const result = await testProviderConnection(
        { name: 'local-llm', wire: 'openai', baseUrl: null },
        null,
      );

      assert.equal(result.ok, true);
      assert.equal(result.latencyMs, 0);
    });
  });

  describe('Error classification (non-routable address)', () => {
    it('classifies unreachable host as CONNECTION_FAILED', async () => {
      const result = await testProviderConnection(
        { name: 'test', wire: 'openai', baseUrl: blackHoleUrl },
        'sk-test-key',
      );

      assert.equal(result.ok, false);
      assert.ok(
        result.errorCode === 'CONNECTION_FAILED' || result.errorCode === 'TIMEOUT',
        `Expected CONNECTION_FAILED or TIMEOUT, got ${result.errorCode}`,
      );
    });

    it('reports latency even on failure', async () => {
      const result = await testProviderConnection(
        { name: 'test', wire: 'generic-http', baseUrl: blackHoleUrl },
        null,
      );

      assert.equal(result.ok, false);
      assert.ok(typeof result.latencyMs === 'number');
    });

    it('includes error message on failure', async () => {
      const result = await testProviderConnection(
        { name: 'test', wire: 'openai', baseUrl: blackHoleUrl },
        'sk-test-key',
      );

      assert.equal(result.ok, false);
      assert.ok(typeof result.errorMessage === 'string');
      assert.ok(result.errorMessage.length > 0);
    });
  });

  describe('Function contract', () => {
    it('returns expected shape on success (null baseUrl)', async () => {
      const result = await testProviderConnection(
        { name: 'test', wire: 'anthropic', baseUrl: null },
        null,
      );

      assert.ok('ok' in result);
      assert.ok('latencyMs' in result);
      assert.ok(result.modelsFound === null || typeof result.modelsFound === 'number');
      // errorCode and errorMessage should be undefined on success
      assert.equal(result.errorCode, undefined);
    });

    it('returns expected shape on failure', async () => {
      const result = await testProviderConnection(
        { name: 'test', wire: 'openai', baseUrl: blackHoleUrl },
        'sk-test-key',
      );

      assert.equal(result.ok, false);
      assert.ok(typeof result.latencyMs === 'number');
      assert.ok(typeof result.errorCode === 'string');
      assert.ok(typeof result.errorMessage === 'string');
    });

    it('handles all supported wire types without throwing', async () => {
      const wires = ['openai', 'anthropic', 'google-ai', 'generic-http'];
      for (const wire of wires) {
        // Use null baseUrl to avoid network calls
        const result = await testProviderConnection(
          { name: 'test', wire, baseUrl: null },
          null,
        );
        assert.equal(result.ok, true);
        assert.equal(result.latencyMs, 0);
      }
    });
  });

  describe('setup validation safety seam', () => {
    it('uses an injected loopback-only fetch implementation without exposing a submitted value', async () => {
      let redirectMode;
      const result = await testProviderConnection(
        { name: 'fixture-provider', wire: 'openai', baseUrl: 'http://127.0.0.1:4318/v1', keyEnv: 'FIXTURE_KEY' },
        'synthetic-onboarding-sentinel',
        {
          allowUrl: (url) => url.startsWith('http://127.0.0.1:4318/'),
          fetchImpl: async (_url, init) => {
            redirectMode = init.redirect;
            return new Response(JSON.stringify({ data: [{ id: 'fixture-model' }] }), { status: 200 });
          },
        },
      );
      assert.equal(result.ok, true);
      assert.equal(redirectMode, 'error');
    });

    it('rejects a provider redirect before a second destination could be contacted', async () => {
      let requested = false;
      const result = await testProviderConnection(
        { name: 'fixture-provider', wire: 'openai', baseUrl: 'http://127.0.0.1:4318/v1', keyEnv: 'FIXTURE_KEY' },
        'synthetic-onboarding-sentinel',
        {
          allowUrl: (url) => url.startsWith('http://127.0.0.1:4318/'),
          fetchImpl: async (_url, init) => {
            requested = true;
            assert.equal(init.redirect, 'error');
            const error = new TypeError('redirect mode is error');
            error.code = 'REDIRECT_BLOCKED';
            throw error;
          },
        },
      );
      assert.equal(requested, true);
      assert.equal(result.ok, false);
      assert.equal(result.errorCode, 'UNEXPECTED_RESPONSE');
    });

    it('blocks a non-permitted validation endpoint before fetch can send a credential', async () => {
      let fetchCalled = false;
      const result = await testProviderConnection(
        { name: 'fixture-provider', wire: 'openai', baseUrl: 'http://not-permitted.invalid/v1', keyEnv: 'FIXTURE_KEY' },
        'synthetic-onboarding-sentinel',
        {
          allowUrl: () => false,
          fetchImpl: async () => {
            fetchCalled = true;
            throw new Error('fetch should not run');
          },
        },
      );
      assert.equal(fetchCalled, false);
      assert.equal(result.ok, false);
      assert.doesNotMatch(JSON.stringify(result), /synthetic-onboarding-sentinel|not-permitted\.invalid/);
    });

    it('maps injected failures to a stable redacted setup recovery result', async () => {
      const result = await validateSetupProviderConnection(
        { name: 'fixture-provider', wire: 'openai', baseUrl: 'http://127.0.0.1:4318/v1' },
        'synthetic-onboarding-sentinel',
        { testConnection: async () => { throw new Error('synthetic-onboarding-sentinel'); } },
      );
      assert.deepEqual(result, {
        status: 'unavailable', code: 'UNAVAILABLE', summary: 'The provider is unavailable. Try again shortly.',
      });
      assert.doesNotMatch(JSON.stringify(result), /synthetic-onboarding-sentinel/);
    });
  });

  it('normalizes upstream errors into a safe onboarding result', () => {
    const safe = toSafeProviderValidationResult({
      ok: false, errorCode: 'CONNECTION_FAILED', errorMessage: 'https://provider.test/?api_key=secret', latencyMs: 3,
    }, 'deepseek');
    assert.deepEqual(safe, {
      providerId: 'deepseek', status: 'unreachable', retryable: true,
      messageCode: 'provider_unreachable', latencyMs: 3, modelsFound: null,
    });
    assert.doesNotMatch(JSON.stringify(safe), /provider\.test|api_key|secret/);
  });
});

