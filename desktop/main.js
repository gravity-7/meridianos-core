/**
 * desktop/main.js — Electron main process for the MeridianOS desktop app (User Story 2).
 *
 * Responsibilities (T028): spawn the daemon, own the native system tray, and drive
 * electron-updater. Pure decision logic (keychain access, daemon spawn/health-check) lives in
 * ../keychain.mjs and ./daemon-manager.mjs — both plain ESM with no `electron` import, so they're
 * unit-testable; this file is deliberately thin glue that only Electron itself can execute.
 *
 * This is a CommonJS entrypoint (desktop/package.json has no "type": "module") — the ESM helper
 * modules are loaded via dynamic `import()`, which CJS supports natively.
 */
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, dialog, crashReporter } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// In a packaged app, the daemon's full source tree is bundled as an extraResource (see
// desktop/package.json's build.extraResources) at `<resources>/app`, since electron-builder's
// `files` only packs desktop/'s own sources — the daemon is a SEPARATE Node process spawned
// from that resource directory, not something Electron's bundler follows requires/imports into.
const REPO_ROOT = app.isPackaged ? path.join(process.resourcesPath, 'app') : path.join(__dirname, '..');
const PORT = 4317;

// Crash reporting (code-review follow-up: "Consider adding crash reporting for Electron app").
// Local-only by default (matches telemetry.mjs's privacy stance elsewhere in this repo) — native
// crash dumps (segfaults, renderer OOM/hangs) land in Electron's own crashDumps directory
// (app.getPath('crashDumps')) and are NEVER uploaded unless $AIOS_CRASH_REPORT_URL is explicitly
// set to a real ingestion endpoint this deployment controls. Must run before app 'ready'.
crashReporter.start({
  companyName: 'MeridianOS',
  productName: 'MeridianOS',
  uploadToServer: Boolean(process.env.AIOS_CRASH_REPORT_URL),
  submitURL: process.env.AIOS_CRASH_REPORT_URL || '',
  ignoreSystemCrashHandler: false,
});

let mainWindow = null;
let tray = null;
let daemonChild = null;
let logger = null;
let consecutiveRendererCrashes = 0;
const MAX_AUTO_RECREATE = 3; // stop self-healing after this many crashes in a row — a persistent
                              // crash-on-load bug must surface as a visible failure, not a silent loop

/** Lazily construct a daemon-logger instance (T037) rooted at the repo's `.ai/logs`. Falls back
 *  to console if the logger itself can't be constructed — logging must never crash the app. */
async function getLogger() {
  if (logger) return logger;
  try {
    const { createRotatingLogger } = await import(path.join(REPO_ROOT, 'daemon-logger.mjs'));
    logger = createRotatingLogger({ logDir: path.join(REPO_ROOT, '.ai', 'logs') });
  } catch {
    logger = { log: (_t, m) => console.log(`[meridianos-desktop] ${m}`), error: (_t, m, e) => console.error(`[meridianos-desktop] ${m}`, e ?? '') };
  }
  return logger;
}

function isFirstRun() {
  return !fs.existsSync(path.join(REPO_ROOT, '.env')) && !fs.existsSync(path.join(REPO_ROOT, '.ai', 'policy.yaml'));
}

async function loadKeychainEnv() {
  const keytar = require('keytar');
  const { loadDaemonEnv } = await import(path.join(__dirname, 'keychain.mjs'));
  return loadDaemonEnv({ keytar });
}

async function startDaemon() {
  const log = await getLogger();
  const { startDaemonAndWait } = await import(path.join(__dirname, 'daemon-manager.mjs'));
  const { spawn } = require('node:child_process');

  const { env, errors } = await loadKeychainEnv(); // T036: keychain failures are reported, not fatal
  for (const e of errors) log.error('keychain', `failed to read ${e.account} from OS keychain`, e.error);

  const { child, healthy } = await startDaemonAndWait({
    repoRoot: REPO_ROOT, env, port: PORT, timeoutMs: 30_000,
    spawnImpl: spawn,
  });
  daemonChild = child;
  daemonChild.stdout?.on('data', (d) => log.log('daemon', d.toString().trim()));
  daemonChild.stderr?.on('data', (d) => log.error('daemon', d.toString().trim()));
  log.log('daemon', healthy ? 'daemon is healthy' : 'daemon did not become healthy within 30s');
  return healthy;
}

async function stopDaemon() {
  const { stopDaemon: stop } = await import(path.join(__dirname, 'daemon-manager.mjs'));
  stop(daemonChild);
  daemonChild = null;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isFirstRun()) {
    mainWindow.loadFile(path.join(__dirname, 'renderer', 'wizard.html'));
  } else {
    mainWindow.loadURL(`http://localhost:${PORT}`); // T035: existing dashboard, loaded as-is
  }

  // A page that loads successfully clears the crash streak — only CONSECUTIVE, immediate crashes
  // should trip the auto-recreate cutoff above.
  mainWindow.webContents.on('did-finish-load', () => { consecutiveRendererCrashes = 0; });

  // Crash reporting, renderer half: a renderer that crashes/hangs/OOMs doesn't throw a normal JS
  // exception anywhere — this event is the only signal. Logged locally (daemon-logger) alongside
  // whatever crashReporter wrote to disk, and the window is recreated so the app self-heals
  // instead of leaving the user staring at a blank window.
  mainWindow.webContents.on('render-process-gone', async (_event, details) => {
    const log = await getLogger();
    log.error('renderer', `render process gone: reason=${details.reason} exitCode=${details.exitCode}`);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();

    consecutiveRendererCrashes++;
    if (consecutiveRendererCrashes > MAX_AUTO_RECREATE) {
      log.error('renderer', `giving up after ${consecutiveRendererCrashes} consecutive crashes — not auto-reopening`);
      return;
    }
    createMainWindow(); // self-heal: reopen a fresh window rather than leaving the user stuck
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function createTray() {
  // 16x16 template icon — built at runtime from tray-icons.mjs (same trick as the packaged
  // binary's tray) rather than bundling a binary asset.
  import(path.join(REPO_ROOT, 'tray-icons.mjs')).then(({ getTrayIcon }) => {
    const icon = nativeImage.createFromBuffer(Buffer.from(getTrayIcon('green'), 'base64'));
    tray = new Tray(icon);
    tray.setToolTip('MeridianOS');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Dashboard', click: () => mainWindow?.loadURL(`http://localhost:${PORT}`) || createMainWindow() },
      { label: 'Quit', click: () => app.quit() },
    ]));
  });
}

function setupIpc() {
  ipcMain.handle('wizard:save-api-key', async (_event, { provider, value }) => {
    const keytar = require('keytar');
    const { setApiKey, ACCOUNTS } = await import(path.join(__dirname, 'keychain.mjs'));
    return setApiKey({ keytar, account: ACCOUNTS[provider], value });
  });

  ipcMain.handle('wizard:finish', async (_event, { monthlyBudget }) => {
    const { runSetupWizard } = await import(path.join(REPO_ROOT, 'scripts', 'setup-wizard-minimal.mjs'));
    const result = await runSetupWizard({
      repoRoot: REPO_ROOT,
      answers: { anthropicApiKey: '', deepseekApiKey: '', monthlyBudget: String(monthlyBudget ?? 0), installService: 'n' },
      installServiceImpl: () => null, // Electron IS the background-service mechanism here
    });
    const healthy = await startDaemon();
    if (healthy) mainWindow.loadURL(`http://localhost:${PORT}`);
    return { ...result, healthy };
  });

  ipcMain.handle('dashboard:open-external', (_event, url) => shell.openExternal(url));
}

async function checkForUpdates() {
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.on('update-available', () => {
      dialog.showMessageBox({
        type: 'info',
        buttons: ['Restart now', 'Later'],
        message: 'Update available. Restart now?',
      }).then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall();
      });
    });
    autoUpdater.checkForUpdates();
  } catch (err) {
    (await getLogger()).error('updater', 'auto-update check failed', err);
  }
}

app.whenReady().then(async () => {
  createTray();
  createMainWindow();
  setupIpc();
  if (!isFirstRun()) await startDaemon();
  checkForUpdates();
});

app.on('window-all-closed', async () => {
  await stopDaemon(); // T032: daemon stops when the window closes
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    if (!daemonChild) await startDaemon(); // T032: restart on reopen, keys re-read from keychain
    createMainWindow();
  }
});

app.on('before-quit', () => { stopDaemon(); });

// Crash reporting, main-process half: crashReporter.start() above covers NATIVE crashes
// (segfaults, OOM); a JS-level uncaught exception/rejection in the main process is a DIFFERENT
// failure mode it doesn't see at all. Logged locally so it shows up in `.ai/logs/daemon.log`
// even though the app itself is about to become unusable — matches this repo's "logging must
// never crash the process, but a genuine crash must still be visible somewhere" convention
// (daemon-logger.mjs).
process.on('uncaughtException', async (err) => {
  try { (await getLogger()).error('main-process', 'uncaught exception', err); } catch { /* logging must never mask the real crash */ }
});
process.on('unhandledRejection', async (reason) => {
  try { (await getLogger()).error('main-process', 'unhandled rejection', reason); } catch { /* logging must never mask the real crash */ }
});
