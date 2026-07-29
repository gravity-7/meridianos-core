/**
 * tests/provider-conformance.test.mjs — US2: Provider Conformance Testing
 *
 * Tests error classification, timeout handling, null baseUrl case,
 * and function signatures. Network-dependent tests (actual API calls)
 * are validated via manual quickstart scenarios rather than unit tests.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { testProviderConnection } from '../provider-conformance.mjs';

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
        { name: 'test', wire: 'openai', baseUrl: 'http://10.255.255.1:9999' },
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
        { name: 'test', wire: 'generic-http', baseUrl: 'http://10.255.255.1:9999' },
        null,
      );

      assert.equal(result.ok, false);
      assert.ok(typeof result.latencyMs === 'number');
    });

    it('includes error message on failure', async () => {
      const result = await testProviderConnection(
        { name: 'test', wire: 'openai', baseUrl: 'http://10.255.255.1:9999' },
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
        { name: 'test', wire: 'openai', baseUrl: 'http://10.255.255.1:9999' },
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
});

