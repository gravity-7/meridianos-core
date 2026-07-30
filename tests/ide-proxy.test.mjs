/**
 * Tests for ide-proxy.mjs — IDE detection, proxy config generation, and connectivity testing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectInstalledIdes, generateProxyConfig, testIdeConnectivity, KNOWN_IDES } from '../ide-proxy.mjs';

describe('detectInstalledIdes', () => {
  it('returns an array with entries for all known IDE types', () => {
    const ides = detectInstalledIdes();
    assert.ok(Array.isArray(ides));
    assert.ok(ides.length >= KNOWN_IDES.length);

    for (const known of KNOWN_IDES) {
      const found = ides.find((i) => i.ideName === known.ideName);
      assert.ok(found, `Missing IDE: ${known.ideName}`);
      assert.strictEqual(typeof found.installed, 'boolean');
      assert.strictEqual(found.displayName, known.displayName);
      if (found.installed) {
        assert.ok(found.installPath, `installed IDE ${known.ideName} should have installPath`);
        assert.ok(found.detectionMethod, `installed IDE ${known.ideName} should have detectionMethod`);
        assert.ok(
          ['standard-path', 'custom-path', 'which-command', 'env-var'].includes(found.detectionMethod),
          `Unknown detection method: ${found.detectionMethod}`,
        );
      } else {
        assert.strictEqual(found.installPath, null);
        assert.strictEqual(found.detectionMethod, null);
      }
    }
  });

  it('respects customPaths option', () => {
    // Even with bogus custom paths, function should not throw
    const ides = detectInstalledIdes({ customPaths: ['/nonexistent/path'] });
    assert.ok(Array.isArray(ides));
  });
});

describe('generateProxyConfig', () => {
  const gatewayUrl = 'http://127.0.0.1:8787';

  it('generates settings-json snippet for VS Code family IDEs', () => {
    for (const ideName of ['vscode', 'cursor', 'windsurf']) {
      const config = generateProxyConfig(ideName, gatewayUrl);
      assert.strictEqual(config.snippetType, 'settings-json');
      assert.ok(config.content.includes('http.proxy'));
      assert.ok(config.content.includes(gatewayUrl));
      assert.ok(config.instructions.length > 0);
      assert.strictEqual(config.gatewayUrl, gatewayUrl);
    }
  });

  it('generates env-export snippet for Claude Code', () => {
    const config = generateProxyConfig('claude-code', gatewayUrl);
    assert.strictEqual(config.snippetType, 'env-export');
    assert.ok(config.content.includes('ANTHROPIC_BASE_URL'));
    assert.ok(config.content.includes(gatewayUrl));
    assert.ok(config.content.includes('HTTP_PROXY'));
  });

  it('generates settings-text snippet for JetBrains', () => {
    const config = generateProxyConfig('jetbrains', gatewayUrl);
    assert.strictEqual(config.snippetType, 'settings-text');
    assert.ok(config.content.includes('HTTP Proxy'));
    assert.ok(config.content.includes(gatewayUrl));
  });

  it('returns generic config for unknown IDE names', () => {
    const config = generateProxyConfig('unknown-ide', gatewayUrl);
    assert.strictEqual(config.snippetType, 'generic-proxy');
    assert.strictEqual(config.ideName, 'generic');
    assert.ok(config.content.includes('HTTP_PROXY'));
  });

  it('returns generic config for explicit generic request', () => {
    const config = generateProxyConfig('generic', gatewayUrl);
    assert.strictEqual(config.snippetType, 'generic-proxy');
  });

  it('handles non-default ports correctly', () => {
    const customUrl = 'http://127.0.0.1:9999';
    const config = generateProxyConfig('vscode', customUrl);
    assert.ok(config.content.includes(customUrl));
    assert.strictEqual(config.gatewayUrl, customUrl);
  });
});

describe('testIdeConnectivity', () => {
  it('returns connection failure when gateway is not running', async () => {
    // Use a port that almost certainly has nothing listening
    const result = await testIdeConnectivity('http://127.0.0.1:19999', 1000);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.errorCode, 'CONNECTION_FAILED');
    assert.ok(result.errorMessage);
    assert.ok(result.testedAt);
  });

  it('returns timeout for unreachable hosts', async () => {
    // Use a non-routable address with short timeout
    const result = await testIdeConnectivity('http://192.0.2.1:8787', 500);
    assert.strictEqual(result.ok, false);
    // Could be TIMEOUT or CONNECTION_FAILED depending on OS
    assert.ok(result.errorCode === 'TIMEOUT' || result.errorCode === 'CONNECTION_FAILED');
  });

  it('result includes testedAt timestamp in ISO format', async () => {
    const result = await testIdeConnectivity('http://127.0.0.1:19999', 500);
    assert.ok(result.testedAt);
    // Should parse as valid ISO date
    assert.ok(!isNaN(Date.parse(result.testedAt)));
  });
});

describe('KNOWN_IDES', () => {
  it('contains all 5 supported IDE families', () => {
    const names = KNOWN_IDES.map((i) => i.ideName);
    assert.ok(names.includes('vscode'));
    assert.ok(names.includes('cursor'));
    assert.ok(names.includes('windsurf'));
    assert.ok(names.includes('claude-code'));
    assert.ok(names.includes('jetbrains'));
  });

  it('each IDE has required fields', () => {
    for (const ide of KNOWN_IDES) {
      assert.ok(ide.ideName, `IDE missing ideName`);
      assert.ok(ide.displayName, `IDE ${ide.ideName} missing displayName`);
      assert.ok(ide.family, `IDE ${ide.ideName} missing family`);
      assert.ok(Array.isArray(ide.detectionMethods), `IDE ${ide.ideName} missing detectionMethods array`);
    }
  });
});
