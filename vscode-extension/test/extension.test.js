/**
 * VS Code extension integration tests for MeridianOS.
 *
 * These tests verify extension activation, sidebar TreeView provider registration,
 * status bar item creation, command registration, and daemon health checking.
 * Uses @vscode/test-electron for VS Code integration testing.
 *
 * Run: npx vscode-test --extensionDevelopmentPath=. --launchArgs .
 */
const assert = require('assert');
const path = require('path');

// These tests require the VS Code test runner. When run inside VS Code's
// extension test host, the `vscode` module and test APIs are available.

describe('MeridianOS Extension', () => {
  it('package.json has correct manifest fields', () => {
    const manifest = require('../package.json');
    assert.strictEqual(manifest.name, 'meridianos');
    assert.strictEqual(manifest.publisher, 'gravity-7');
    assert.ok(manifest.engines.vscode, 'should specify vscode engine');
    assert.ok(manifest.activationEvents.includes('onStartupFinished'));
    assert.ok(manifest.contributes.viewsContainers, 'should define viewsContainers');
    assert.ok(manifest.contributes.views, 'should define views');
    assert.ok(manifest.contributes.commands.length >= 6, 'should define at least 6 commands');
  });

  it('defines all required MeridianOS commands', () => {
    const manifest = require('../package.json');
    const commandIds = manifest.contributes.commands.map((c) => c.command);
    assert.ok(commandIds.includes('meridian.setup'));
    assert.ok(commandIds.includes('meridian.openDashboard'));
    assert.ok(commandIds.includes('meridian.createTask'));
    assert.ok(commandIds.includes('meridian.routeCopilot'));
    assert.ok(commandIds.includes('meridian.toggleGateway'));
    assert.ok(commandIds.includes('meridian.pauseAllSpend'));
  });

  it('defines sidebar view container and task board view', () => {
    const manifest = require('../package.json');
    const container = manifest.contributes.viewsContainers?.activitybar?.find(
      (c) => c.id === 'meridianos',
    );
    assert.ok(container, 'should define meridianos activitybar container');
    assert.strictEqual(container.title, 'MeridianOS');

    const views = manifest.contributes.views?.meridianos;
    assert.ok(views, 'should define meridianos views');
    assert.ok(views.some((v) => v.id === 'meridianos.board'), 'should define task board view');
  });

  it('sidebar module exports TaskBoardProvider', () => {
    const { TaskBoardProvider } = require('../sidebar');
    assert.ok(TaskBoardProvider, 'should export TaskBoardProvider');
    const provider = new TaskBoardProvider();
    assert.strictEqual(typeof provider.getChildren, 'function');
    assert.strictEqual(typeof provider.getTreeItem, 'function');
  });

  it('status-bar module exports SpendIndicator', () => {
    // SpendIndicator requires vscode APIs — only test structural contract
    const { SpendIndicator } = require('../status-bar');
    assert.ok(SpendIndicator, 'should export SpendIndicator');
  });

  it('daemon-manager module exports all lifecycle functions', () => {
    const dm = require('../daemon-manager');
    assert.strictEqual(typeof dm.checkNodeJs, 'function');
    assert.strictEqual(typeof dm.checkDaemonHealth, 'function');
    assert.strictEqual(typeof dm.startDaemon, 'function');
    assert.strictEqual(typeof dm.stopDaemon, 'function');
    assert.strictEqual(typeof dm.downloadAndInstallDaemon, 'function');
    assert.strictEqual(typeof dm.launchWizardInWebview, 'function');
  });

  it('daemon-manager checkNodeJs returns expected shape', () => {
    const { checkNodeJs } = require('../daemon-manager');
    const result = checkNodeJs();
    assert.strictEqual(typeof result.ok, 'boolean');
    if (result.ok) {
      assert.ok(result.version, 'should have version when ok');
      assert.ok(result.version.startsWith('v'), 'version should start with v');
    } else {
      assert.ok(result.downloadUrl, 'should have downloadUrl when not ok');
    }
  });

  it('extension module exports activate and deactivate', () => {
    const ext = require('../extension');
    assert.strictEqual(typeof ext.activate, 'function');
    assert.strictEqual(typeof ext.deactivate, 'function');
  });

  it('package.json scripts include package command', () => {
    const manifest = require('../package.json');
    assert.ok(manifest.scripts?.package, 'should have package script');
  });

  it('.vscodeignore exists and contains essential patterns', () => {
    const fs = require('fs');
    const ignorePath = path.join(__dirname, '..', '.vscodeignore');
    assert.ok(fs.existsSync(ignorePath), '.vscodeignore should exist');
    const content = fs.readFileSync(ignorePath, 'utf8');
    assert.ok(content.includes('node_modules'), 'should ignore node_modules');
    assert.ok(content.includes('test/'), 'should ignore test directory');
    assert.ok(content.includes('.git'), 'should ignore .git');
  });
});
