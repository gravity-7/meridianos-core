/**
 * VS Code extension tests for MeridianOS.
 *
 * Verifies package manifest, ESM conversion, and file structure.
 * Full integration tests require VS Code's extension test runner
 * because source modules depend on the `vscode` API (only available
 * inside the VS Code extension host).
 *
 * Run: node --test vscode-extension/test/extension.test.mjs
 */
import assert from 'node:assert';
import { describe, it } from 'node:test';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readPackageJson() {
  const pkgPath = path.join(__dirname, '..', 'package.json');
  return JSON.parse(readFileSync(pkgPath, 'utf8'));
}

describe('Extension Manifest', () => {
  it('has correct metadata', () => {
    const m = readPackageJson();
    assert.strictEqual(m.name, 'meridianos');
    assert.strictEqual(m.publisher, 'gravity-7');
    assert.strictEqual(m.type, 'module', 'should declare type: module for ESM');
    assert.ok(m.main.endsWith('.mjs'), 'main should point to .mjs entry');
    assert.ok(m.engines.vscode, 'should specify vscode engine');
    assert.ok(m.activationEvents.includes('onStartupFinished'));
  });

  it('declares all 6 MeridianOS commands', () => {
    const ids = readPackageJson().contributes.commands.map((c) => c.command);
    for (const cmd of ['meridian.setup', 'meridian.openDashboard', 'meridian.createTask', 'meridian.routeCopilot', 'meridian.toggleGateway', 'meridian.pauseAllSpend']) {
      assert.ok(ids.includes(cmd), `should include ${cmd}`);
    }
  });

  it('defines sidebar and task board view', () => {
    const m = readPackageJson();
    const container = m.contributes.viewsContainers?.activitybar?.find((c) => c.id === 'meridianos');
    assert.ok(container, 'should have meridianos activitybar container');
    const views = m.contributes.views?.meridianos;
    assert.ok(views?.some((v) => v.id === 'meridianos.board'), 'should have task board view');
  });

  it('has package script', () => {
    assert.ok(readPackageJson().scripts?.package);
  });
});

describe('ESM Conversion', () => {
  it('all source files use .mjs extension', () => {
    for (const f of ['sidebar.mjs', 'status-bar.mjs', 'daemon-manager.mjs', 'extension.mjs']) {
      assert.ok(existsSync(path.join(__dirname, '..', f)), `${f} should exist`);
    }
  });

  it('no .js source files remain', () => {
    for (const f of ['sidebar.js', 'status-bar.js', 'daemon-manager.js', 'extension.js']) {
      assert.ok(!existsSync(path.join(__dirname, '..', f)), `${f} should NOT exist`);
    }
  });

  it('package.json type is module', () => {
    assert.strictEqual(readPackageJson().type, 'module');
  });
});

describe('File Structure', () => {
  it('.vscodeignore covers essential patterns', () => {
    const p = path.join(__dirname, '..', '.vscodeignore');
    assert.ok(existsSync(p));
    const c = readFileSync(p, 'utf8');
    for (const pattern of ['node_modules', 'test/', '.git']) {
      assert.ok(c.includes(pattern), `should ignore ${pattern}`);
    }
  });

  it('devDependencies include @vscode/test-electron', () => {
    const m = readPackageJson();
    assert.ok(m.devDependencies?.['@vscode/test-electron'], 'should have test-electron dev dep');
  });
});
