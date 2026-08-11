/**
 * electron-app.test.mjs — User Story 2 (Electron Desktop Application) integration coverage:
 *   T025 — Electron app installation (packaging config + file layout)
 *   T026 — OS keychain storage (desktop/keychain.mjs)
 *   T027 — auto-update mechanism (desktop/main.js wiring)
 *
 * A real Electron process, a real OS keychain, and a real GitHub Releases auto-update can't run
 * in this test environment (no display session, no signed build, no network release feed). As
 * with binary-install.test.mjs, the testable REAL logic — keychain read/write/error-handling,
 * daemon spawn/health-check, and the packaging manifest — is exercised directly; main.js's
 * Electron-only wiring (which only Electron's runtime can execute) is checked structurally.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { setApiKey, getApiKey, deleteApiKey, loadDaemonEnv, ACCOUNTS, SERVICE_NAME } from '../../desktop/keychain.mjs';
import { spawnDaemon, stopDaemon, waitForHealthy } from '../../desktop/daemon-manager.mjs';

const DESKTOP_DIR = join(import.meta.dirname, '..', '..', 'desktop');

function fakeKeytar(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    setPassword: async (svc, acc, val) => { store.set(`${svc}:${acc}`, val); },
    getPassword: async (svc, acc) => store.get(`${svc}:${acc}`) ?? null,
    deletePassword: async (svc, acc) => store.delete(`${svc}:${acc}`),
    _store: store,
  };
}

// ─── T025: Electron app installation (packaging manifest + file layout) ────────────────────
describe('T025 — Electron app packaging (desktop/package.json, file layout)', () => {
  const pkg = JSON.parse(readFileSync(join(DESKTOP_DIR, 'package.json'), 'utf8'));

  test('desktop/package.json declares electron-builder targets for all 3 OSes', () => {
    assert.equal(pkg.build.win.target, 'nsis');
    assert.equal(pkg.build.mac.target, 'dmg');
    assert.equal(pkg.build.linux.target, 'AppImage');
  });

  test('runtime deps (keytar, electron-updater) are dependencies, not devDependencies', () => {
    assert.ok(pkg.dependencies.keytar);
    assert.ok(pkg.dependencies['electron-updater']);
    assert.ok(!('keytar' in (pkg.devDependencies ?? {})));
  });

  test('extraResources bundles the daemon source tree (a separate spawned Node process, not an Electron require())', () => {
    const bundled = pkg.build.extraResources.find((r) => r.to === 'app');
    assert.ok(bundled, 'expected an extraResources entry bundling the repo root as "app"');
    assert.equal(bundled.from, '..');
  });

  test('main.js, preload.js, and the renderer wizard files exist', () => {
    for (const f of ['main.js', 'preload.js', 'renderer/wizard.html', 'renderer/wizard.js']) {
      assert.ok(existsSync(join(DESKTOP_DIR, f)), `expected desktop/${f} to exist`);
    }
  });

  test('preload.js only exposes a narrow contextBridge API — no raw ipcRenderer leak', () => {
    const src = readFileSync(join(DESKTOP_DIR, 'preload.js'), 'utf8');
    assert.match(src, /contextBridge\.exposeInMainWorld\('meridianos'/);
    assert.match(src, /saveApiKey/);
    assert.match(src, /finishSetup/);
    assert.match(src, /onboarding:/);
    assert.match(src, /credentialStore: 'keychain'/);
    assert.match(src, /validateCredential/);
    assert.match(src, /storeCredential/);
    assert.match(src, /commitSetup/);
  });

  test('main.js creates the window with contextIsolation and without nodeIntegration', () => {
    const src = readFileSync(join(DESKTOP_DIR, 'main.js'), 'utf8');
    assert.match(src, /contextIsolation:\s*true/);
    assert.match(src, /nodeIntegration:\s*false/);
  });

  test('unified first-run loads the shared setup route and retains an explicit legacy fallback', () => {
    const src = readFileSync(join(DESKTOP_DIR, 'main.js'), 'utf8');
    assert.match(src, /loadURL\(`http:\/\/localhost:\$\{PORT\}\/app\/setup`\)/);
    assert.match(src, /MERIDIANOS_LEGACY_SETUP/);
    assert.match(src, /renderer', 'wizard.html/);
    assert.match(src, /credentialStore: 'keychain'/);
  });
});

// ─── T026: OS keychain storage ───────────────────────────────────────────────────────────────
describe('T026 — OS keychain storage (desktop/keychain.mjs)', () => {
  test('setApiKey/getApiKey round-trip through the (fake) OS keychain', async () => {
    const keytar = fakeKeytar();
    const set = await setApiKey({ keytar, account: ACCOUNTS.anthropic, value: 'sk-ant-abc' });
    assert.equal(set.ok, true);
    const get = await getApiKey({ keytar, account: ACCOUNTS.anthropic });
    assert.deepEqual(get, { ok: true, value: 'sk-ant-abc' });
    assert.ok(keytar._store.has(`${SERVICE_NAME}:${ACCOUNTS.anthropic}`), 'stored under the meridianos service name');
  });

  test('getApiKey returns null (not an error) for a never-set account', async () => {
    const keytar = fakeKeytar();
    const get = await getApiKey({ keytar, account: ACCOUNTS.deepseek });
    assert.deepEqual(get, { ok: true, value: null });
  });

  test('deleteApiKey removes a stored key', async () => {
    const keytar = fakeKeytar();
    await setApiKey({ keytar, account: ACCOUNTS.anthropic, value: 'x' });
    const del = await deleteApiKey({ keytar, account: ACCOUNTS.anthropic });
    assert.equal(del.deleted, true);
    assert.equal((await getApiKey({ keytar, account: ACCOUNTS.anthropic })).value, null);
  });

  test('T036 — a keychain access failure degrades gracefully instead of throwing', async () => {
    const brokenKeytar = {
      setPassword: async () => { throw new Error('keyring is locked'); },
      getPassword: async () => { throw new Error('libsecret not available'); },
      deletePassword: async () => { throw new Error('libsecret not available'); },
    };
    assert.deepEqual(await setApiKey({ keytar: brokenKeytar, account: ACCOUNTS.anthropic, value: 'x' }),
      { ok: false, error: 'keyring is locked' });
    assert.deepEqual(await getApiKey({ keytar: brokenKeytar, account: ACCOUNTS.anthropic }),
      { ok: false, value: null, error: 'libsecret not available' });
  });

  test('loadDaemonEnv maps stored keys to the daemon env-var names known-providers.json expects', async () => {
    const keytar = fakeKeytar();
    await setApiKey({ keytar, account: ACCOUNTS.anthropic, value: 'sk-ant-x' });
    await setApiKey({ keytar, account: ACCOUNTS.deepseek, value: 'sk-deep-x' });
    const { env, errors } = await loadDaemonEnv({ keytar });
    assert.deepEqual(env, { ANTHROPIC_API_KEY: 'sk-ant-x', DEEPSEEK_KEY: 'sk-deep-x' });
    assert.deepEqual(errors, []);
  });

  test('loadDaemonEnv omits unset keys and reports per-account errors without failing the whole load', async () => {
    const partiallyBrokenKeytar = {
      getPassword: async (_svc, acc) => { if (acc === ACCOUNTS.anthropic) throw new Error('denied'); return null; },
    };
    const { env, errors } = await loadDaemonEnv({ keytar: partiallyBrokenKeytar });
    assert.deepEqual(env, {});
    assert.deepEqual(errors, [{ account: ACCOUNTS.anthropic, error: 'denied' }]);
  });
});

// ─── daemon lifecycle (backs both the wizard's "Finish" and window-close/reopen) ────────────
describe('Electron daemon lifecycle (desktop/daemon-manager.mjs)', () => {
  test('spawnDaemon disables the packaged-binary tray (Electron provides its own)', () => {
    let captured;
    const fakeSpawn = (cmd, args, opts) => { captured = opts; return { killed: false, kill() { this.killed = true; } }; };
    spawnDaemon({ repoRoot: '/repo', spawnImpl: fakeSpawn, port: 4317 });
    assert.equal(captured.env.AIOS_DISABLE_TRAY, '1');
    assert.equal(captured.env.AIOS_DASHBOARD_PORT, '4317');
  });

  test('stopDaemon sends SIGTERM once and is a no-op on an already-stopped process', () => {
    const child = { killed: false, signals: [], kill(sig) { this.signals.push(sig); this.killed = true; } };
    stopDaemon(child);
    stopDaemon(child);
    assert.deepEqual(child.signals, ['SIGTERM']);
  });

  test('waitForHealthy resolves true once /healthz succeeds, false on timeout', async () => {
    const ok = await waitForHealthy({ fetchImpl: async () => ({ ok: true }), sleepImpl: async () => {} });
    assert.equal(ok, true);
    const down = await waitForHealthy({ fetchImpl: async () => { throw new Error('down'); }, timeoutMs: 10, sleepImpl: async () => {} });
    assert.equal(down, false);
  });
});

// ─── T027: auto-update mechanism ─────────────────────────────────────────────────────────────
describe('T027 — auto-update wiring (desktop/main.js)', () => {
  const src = readFileSync(join(DESKTOP_DIR, 'main.js'), 'utf8');

  test('main.js wires electron-updater and listens for update-available', () => {
    assert.match(src, /require\(['"]electron-updater['"]\)/);
    assert.match(src, /autoUpdater\.on\('update-available'/);
  });

  test('main.js prompts "Update available. Restart now?" before installing', () => {
    assert.match(src, /Update available\. Restart now\?/);
    assert.match(src, /quitAndInstall/);
  });

  test('an auto-update check failure is logged, not thrown (must never crash the running app)', () => {
    assert.match(src, /auto-update check failed/);
  });
});

// ─── Crash reporting (code-review follow-up) ────────────────────────────────────────────────
describe('crash reporting (desktop/main.js)', () => {
  const src = readFileSync(join(DESKTOP_DIR, 'main.js'), 'utf8');

  test('crashReporter.start() is called before app is ready, local-only unless a submit URL is configured', () => {
    assert.match(src, /crashReporter\.start\(/);
    assert.match(src, /uploadToServer:\s*Boolean\(process\.env\.AIOS_CRASH_REPORT_URL\)/);
  });

  test('a crashed renderer is logged and the window is auto-recreated, with a cutoff against a crash loop', () => {
    assert.match(src, /render-process-gone/);
    assert.match(src, /MAX_AUTO_RECREATE/);
    assert.match(src, /createMainWindow\(\); \/\/ self-heal/);
  });

  test('a successful page load resets the consecutive-crash counter', () => {
    assert.match(src, /did-finish-load/);
    assert.match(src, /consecutiveRendererCrashes = 0/);
  });

  test('main-process uncaught exceptions and unhandled rejections are logged, not left silent', () => {
    assert.match(src, /process\.on\('uncaughtException'/);
    assert.match(src, /process\.on\('unhandledRejection'/);
  });
});
