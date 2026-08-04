/**
 * binary-install.test.mjs — User Story 1 (Packaged Binary Installation) integration coverage:
 *   T013 — binary build pipeline (scripts/build.mjs)
 *   T014 — OS service registration (scripts/install-service.mjs), across all 3 platforms
 *   T015 — system tray icon + menu (tray-icons.mjs, tray-status.mjs)
 *
 * None of these tests invoke a real `bun compile`, a real OS service manager, or a real tray
 * icon — that would require a signed binary, admin/root privileges, and a live desktop session,
 * none of which are available (or desirable) in CI. Every OS boundary (`execImpl`, `fetchImpl`,
 * `home`) is dependency-injected instead, so what's under test is the REAL decision logic: which
 * commands get built, what gets written to disk, and how health/environment maps to tray state —
 * exactly the logic a broken packaging change would actually break.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildBinary, parseArgs } from '../../scripts/build.mjs';
import { installService, verifyAutoStart, installWindowsService, installMacService, installLinuxService } from '../../scripts/install-service.mjs';
import { runSetupWizard } from '../../scripts/setup-wizard-minimal.mjs';
import { getTrayIcon } from '../../tray-icons.mjs';
import { shouldStartTray, classifyHealth, openUrlCommand, TRAY_MENU_ITEMS } from '../../tray-status.mjs';

function fakeExecCapture() {
  const calls = [];
  const exec = (cmd, args) => { calls.push([cmd, ...(args ?? [])]); return ''; };
  return { exec, calls };
}

// ─── T013: binary build pipeline ────────────────────────────────────────────────────────────
describe('T013 — packaged binary build (scripts/build.mjs)', () => {
  test('parseArgs reads --target and --outfile', () => {
    const args = parseArgs(['--target=bun-linux-x64', '--outfile=dist/x', 'ignored']);
    assert.deepEqual(args, { target: 'bun-linux-x64', outfile: 'dist/x' });
  });

  test('buildBinary invokes bun compile with the right target per platform', () => {
    for (const [platform, expectedTarget] of [['win32', 'bun-windows-x64'], ['darwin', 'bun-darwin-arm64'], ['linux', 'bun-linux-x64']]) {
      const calls = [];
      const execImpl = (cmd, args) => { calls.push([cmd, ...args]); };
      const result = buildBinary({ platform, execImpl });
      assert.equal(result.target, expectedTarget);
      assert.equal(calls.length, 1);
      assert.equal(calls[0][0], 'bun');
      assert.deepEqual(calls[0].slice(1, 3), ['compile', '--target']);
      assert.equal(calls[0][3], expectedTarget);
    }
  });

  test('buildBinary honors explicit --target/--outfile overrides', () => {
    const calls = [];
    const execImpl = (cmd, args) => calls.push([cmd, ...args]);
    const result = buildBinary({ target: 'bun-linux-arm64', outfile: 'dist/custom-name', platform: 'linux', execImpl });
    assert.equal(result.target, 'bun-linux-arm64');
    assert.ok(result.outfile.endsWith(join('dist', 'custom-name')));
  });

  test('buildBinary throws for an unsupported platform with no explicit target/outfile', () => {
    assert.throws(() => buildBinary({ platform: 'freebsd', execImpl: () => {} }), /no default bun target/);
  });
});

// ─── T014: OS service registration ───────────────────────────────────────────────────────────
describe('T014 — OS background service registration (scripts/install-service.mjs)', () => {
  test('Windows: installService calls sc.exe create with start= auto, then sc.exe start', () => {
    const { exec, calls } = fakeExecCapture();
    const result = installWindowsService({ nodeExe: 'node.exe', daemonPath: 'C:\\app\\daemon-entry.mjs', execImpl: exec });
    assert.equal(result.mechanism, 'sc.exe');
    assert.equal(calls[0][0], 'sc.exe');
    assert.equal(calls[0][1], 'create');
    assert.equal(calls[0][2], 'MeridianOS');
    assert.ok(calls[0].includes('start='));
    assert.ok(calls[0].includes('auto'));
    assert.deepEqual(calls[1], ['sc.exe', 'start', 'MeridianOS']);
  });

  test('macOS: installService writes a launchd plist with RunAtLoad and loads it', () => {
    const home = mkdtempSync(join(tmpdir(), 'home-mac-'));
    const { exec, calls } = fakeExecCapture();
    const result = installMacService({ nodeExe: '/usr/bin/node', daemonPath: '/opt/daemon-entry.mjs', execImpl: exec, home });
    assert.equal(result.mechanism, 'launchd');
    assert.ok(existsSync(result.plistPath));
    const plist = readFileSync(result.plistPath, 'utf8');
    assert.match(plist, /<string>com\.meridianos\.daemon<\/string>/);
    assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\s*\/>/);
    assert.equal(calls[0][0], 'launchctl');
    assert.equal(calls[0][1], 'load');
  });

  test('Linux: installService writes a systemd --user unit named meridianos.service and enables + starts it', () => {
    const home = mkdtempSync(join(tmpdir(), 'home-linux-'));
    const { exec, calls } = fakeExecCapture();
    const result = installLinuxService({ nodeExe: '/usr/bin/node', daemonPath: '/opt/daemon-entry.mjs', execImpl: exec, home });
    assert.equal(result.mechanism, 'systemd');
    assert.ok(result.unitPath.endsWith(join('.config', 'systemd', 'user', 'meridianos.service')));
    const unit = readFileSync(result.unitPath, 'utf8');
    assert.match(unit, /ExecStart=\/usr\/bin\/node \/opt\/daemon-entry\.mjs/);
    assert.deepEqual(calls.map((c) => c.join(' ')), [
      'systemctl --user daemon-reload',
      'systemctl --user enable meridianos',
      'systemctl --user start meridianos',
    ]);
  });

  test('installService dispatches by platform and rejects unsupported ones', () => {
    const { exec } = fakeExecCapture();
    assert.equal(installService({ platform: 'win32', daemonPath: 'd.mjs', execImpl: exec }).platform, 'win32');
    assert.throws(() => installService({ platform: 'plan9', daemonPath: 'd.mjs', execImpl: exec }), /unsupported platform/);
    assert.throws(() => installService({ platform: 'win32', execImpl: exec }), /daemonPath is required/);
  });

  test('verifyAutoStart confirms Windows AUTO_START, macOS loaded agent, and Linux enabled unit', () => {
    const winOut = () => 'SERVICE_NAME: MeridianOS\n        START_TYPE   : 2   AUTO_START\n';
    assert.equal(verifyAutoStart({ platform: 'win32', execImpl: winOut }).autoStart, true);

    const home = mkdtempSync(join(tmpdir(), 'home-verify-'));
    installMacService({ nodeExe: '/usr/bin/node', daemonPath: '/opt/d.mjs', execImpl: () => '', home });
    assert.equal(verifyAutoStart({ platform: 'darwin', execImpl: () => 'com.meridianos.daemon\n', home }).autoStart, true);

    assert.equal(verifyAutoStart({ platform: 'linux', execImpl: () => 'enabled\n' }).autoStart, true);
    assert.equal(verifyAutoStart({ platform: 'linux', execImpl: () => 'disabled\n' }).autoStart, false);
  });

  test('verifyAutoStart never throws — a failing OS query reports autoStart:false with a detail', () => {
    const boom = () => { throw new Error('command not found'); };
    const result = verifyAutoStart({ platform: 'win32', execImpl: boom });
    assert.equal(result.autoStart, false);
    assert.match(result.detail, /command not found/);
  });

  test('installService and verifyAutoStart log lifecycle events to daemon.log (T024)', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'svc-log-'));
    const daemonPath = join(workDir, 'daemon-entry.mjs');
    installService({ platform: 'win32', nodeExe: 'node.exe', daemonPath, execImpl: () => 'START_TYPE   : 2   AUTO_START' });
    verifyAutoStart({ platform: 'win32', execImpl: () => 'START_TYPE   : 2   AUTO_START', daemonPath });
    const log = readFileSync(join(workDir, '.ai', 'logs', 'daemon.log'), 'utf8');
    assert.match(log, /Registered background service via sc\.exe/);
    assert.match(log, /Auto-start verification \(win32\): CONFIRMED/);
  });
});

// ─── Setup wizard (part of the T013 installation flow) ──────────────────────────────────────
describe('setup wizard (scripts/setup-wizard-minimal.mjs)', () => {
  test('runSetupWizard writes .env, patches policy.yaml budget, and installs the service on Y', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'wizard-'));
    let installArgs = null;
    const fakeInstall = (opts) => { installArgs = opts; return { platform: 'win32', mechanism: 'sc.exe' }; };

    const result = await runSetupWizard({
      repoRoot,
      answers: { anthropicApiKey: 'sk-ant-x', deepseekApiKey: 'sk-deep-x', monthlyBudget: '100', installService: 'Y' },
      installServiceImpl: fakeInstall,
    });

    assert.equal(result.serviceInstalled, true);
    assert.ok(installArgs.daemonPath.endsWith('daemon-entry.mjs'));
    assert.match(readFileSync(result.envPath, 'utf8'), /ANTHROPIC_API_KEY=sk-ant-x/);
    assert.match(readFileSync(result.envPath, 'utf8'), /DEEPSEEK_KEY=sk-deep-x/);
    assert.match(readFileSync(result.policyPath, 'utf8'), /monthlyLimit: 100/);
  });

  test('runSetupWizard skips service installation when the answer is "n"', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'wizard-'));
    let installCalled = false;
    const fakeInstall = () => { installCalled = true; return {}; };

    const result = await runSetupWizard({
      repoRoot,
      answers: { anthropicApiKey: '', deepseekApiKey: '', monthlyBudget: '50', installService: 'n' },
      installServiceImpl: fakeInstall,
    });

    assert.equal(result.serviceInstalled, false);
    assert.equal(installCalled, false);
  });

  test('running the wizard twice updates monthlyLimit in place rather than duplicating the block', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'wizard-'));
    const noopInstall = () => ({});
    await runSetupWizard({ repoRoot, answers: { monthlyBudget: '100', installService: 'n' }, installServiceImpl: noopInstall });
    const second = await runSetupWizard({ repoRoot, answers: { monthlyBudget: '250', installService: 'n' }, installServiceImpl: noopInstall });
    const policy = readFileSync(second.policyPath, 'utf8');
    assert.equal((policy.match(/monthlyLimit:/g) || []).length, 1);
    assert.match(policy, /monthlyLimit: 250/);
  });
});

// ─── T015: system tray icon + menu ───────────────────────────────────────────────────────────
describe('T015 — system tray icon and menu (tray-icons.mjs, tray-status.mjs)', () => {
  test('getTrayIcon returns a valid 32x32 RGB PNG for each status, and falls back for unknown', () => {
    const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    for (const status of ['green', 'yellow', 'red', 'anything-else']) {
      const buf = Buffer.from(getTrayIcon(status), 'base64');
      assert.ok(buf.subarray(0, 8).equals(PNG_SIGNATURE), `${status} icon must start with the PNG signature`);
      assert.equal(buf.readUInt32BE(16), 32, `${status} icon width`);
      assert.equal(buf.readUInt32BE(20), 32, `${status} icon height`);
    }
  });

  test('the tray menu has exactly the 4 items required by FR-004, in order', () => {
    assert.deepEqual(TRAY_MENU_ITEMS, ['Open Dashboard', 'Pause All Spend', 'Status', 'Quit']);
  });

  test('shouldStartTray skips in headless/CI/disabled environments, but runs by default on a desktop OS', () => {
    assert.equal(shouldStartTray({ env: { AIOS_DISABLE_TRAY: '1' }, platform: 'win32' }), false);
    assert.equal(shouldStartTray({ env: { CI: 'true' }, platform: 'win32' }), false);
    assert.equal(shouldStartTray({ env: {}, platform: 'linux' }), false); // no DISPLAY/WAYLAND_DISPLAY
    assert.equal(shouldStartTray({ env: { DISPLAY: ':0' }, platform: 'linux' }), true);
    assert.equal(shouldStartTray({ env: {}, platform: 'win32' }), true);
    assert.equal(shouldStartTray({ env: {}, platform: 'darwin' }), true);
  });

  test('openUrlCommand builds the right shell command per OS', () => {
    assert.equal(openUrlCommand('http://localhost:4317', 'win32'), 'start "" "http://localhost:4317"');
    assert.equal(openUrlCommand('http://localhost:4317', 'darwin'), 'open "http://localhost:4317"');
    assert.equal(openUrlCommand('http://localhost:4317', 'linux'), 'xdg-open "http://localhost:4317"');
  });

  test('classifyHealth: red when /healthz is unreachable', async () => {
    const fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
    assert.equal(await classifyHealth({ port: 4317, fetchImpl }), 'red');
  });

  test('classifyHealth: red when the budget kill-switch is active', async () => {
    const fetchImpl = async (url) => url.includes('healthz')
      ? { ok: true }
      : { ok: true, json: async () => ({ kill_switch: true, escalations: [] }) };
    assert.equal(await classifyHealth({ port: 4317, fetchImpl }), 'red');
  });

  test('classifyHealth: yellow on a warn escalation, red on a critical one, green otherwise', async () => {
    const withEscalations = (escalations) => async (url) => url.includes('healthz')
      ? { ok: true }
      : { ok: true, json: async () => ({ kill_switch: false, escalations }) };

    assert.equal(await classifyHealth({ port: 4317, fetchImpl: withEscalations([{ severity: 'warn' }]) }), 'yellow');
    assert.equal(await classifyHealth({ port: 4317, fetchImpl: withEscalations([{ severity: 'critical' }]) }), 'red');
    assert.equal(await classifyHealth({ port: 4317, fetchImpl: withEscalations([]) }), 'green');
  });

  test('classifyHealth: yellow (degraded, not down) when /api/status fails after /healthz succeeds', async () => {
    const fetchImpl = async (url) => {
      if (url.includes('healthz')) return { ok: true };
      throw new Error('status endpoint timed out');
    };
    assert.equal(await classifyHealth({ port: 4317, fetchImpl }), 'yellow');
  });
});
