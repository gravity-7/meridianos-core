#!/usr/bin/env node
/**
 * daemon-entry — zero-code Docker entrypoint for the MeridianOS daemon.
 *
 * This is the "just mount your config and go" entrypoint. It calls `start()` from scheduler.mjs
 * WITHOUT an explicit DomainPlugin — the config resolution chain in config.mjs will auto-discover
 * the tenant from:
 *   1. `$AIOS_TENANT_CONFIG` env var → YAML file path
 *   2. `.ai/tenant.yaml` in `$AIOS_ROOT` (or the mounted repo root)
 *
 * Usage (Docker):
 *   docker run -v ./my-tenant:/tenant -e AIOS_ROOT=/tenant meridianos-core daemon-entry.mjs
 *
 * Usage (bare Node):
 *   AIOS_ROOT=/path/to/tenant node daemon-entry.mjs
 *
 * Environment variables honored:
 *   AIOS_ROOT             — repo root (default: two dirs up from this file)
 *   AIOS_DB               — state DB path override
 *   AIOS_WORKTREE_ROOT    — worktree root override (rarely needed)
 *   AIOS_TENANT_CONFIG    — explicit tenant YAML path
 *   AIOS_DASHBOARD_PORT   — dashboard port (default 4317)
 *   AIOS_DRY_RUN          — set to "1" for dry-run mode
 *   AIOS_DISABLE_TRAY     — set to "1" to skip the system tray icon (User Story 1, FR-004)
 */

import { randomBytes } from 'node:crypto';
import { exec } from 'node:child_process';
import { start } from './scheduler.mjs';
import { createAios } from './config.mjs';
import { createRotatingLogger } from './daemon-logger.mjs';
import { getTrayIcon } from './tray-icons.mjs';
import { shouldStartTray, classifyHealth, openUrlCommand, TRAY_MENU_ITEMS } from './tray-status.mjs';

const port = Number(process.env.AIOS_DASHBOARD_PORT) || 4317;

// Fix the dashboard's per-boot auth token BEFORE start() so this same process's tray can call
// authenticated dashboard endpoints (e.g. Pause All Spend) — dashboard/server.mjs reads
// $AIOS_DASH_TOKEN if set and only generates its own random one when it's absent.
process.env.AIOS_DASH_TOKEN = process.env.AIOS_DASH_TOKEN || randomBytes(16).toString('hex');
const dashToken = process.env.AIOS_DASH_TOKEN;

console.log(`[meridianos] Starting daemon (dashboard on :${port})...`);
console.log(`[meridianos] Tenant config: ${process.env.AIOS_TENANT_CONFIG || '.ai/tenant.yaml (default)'}`);

try {
  await start(); // domain auto-resolved from .ai/tenant.yaml or $AIOS_TENANT_CONFIG
} catch (err) {
  console.error('[meridianos] Failed to start:', err.message);
  if (err.message.includes('DomainPlugin is required')) {
    console.error('[meridianos] Create a .ai/tenant.yaml file in your repo root, or set $AIOS_TENANT_CONFIG.');
    console.error('[meridianos] See docs/DEPLOY.md for the tenant.yaml schema.');
  }
  process.exit(1);
}

// --- System tray (User Story 1, FR-004: green/yellow/red status + quick-action menu) ---------
//
// A separate rotating-logger instance from scheduler.mjs's internal one (module-private there),
// but both append to the SAME `.ai/logs/daemon.log` file — safe, since every write is a single
// synchronous appendFileSync (see daemon-logger.mjs). This is what makes tray/service events
// diagnosable when the daemon runs as a Windows Service / launchd / systemd unit with no
// attached console (T024).
let trayLogger;
try {
  const { config } = createAios({});
  trayLogger = createRotatingLogger({ config });
} catch {
  trayLogger = { log: (_tag, msg) => console.log(`[meridianos] ${msg}`), error: (_tag, msg, err) => console.error(`[meridianos] ${msg}`, err ?? '') };
}

/** Open `url` in the OS default browser without any extra dependency. */
function openUrl(url) {
  exec(openUrlCommand(url), (err) => { if (err) trayLogger.error('tray', `failed to open ${url}`, err); });
}

async function pauseAllSpend() {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/analytics/spend-pause`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-aios-token': dashToken },
      body: JSON.stringify({ action: 'pause' }),
    });
    trayLogger.log('tray', res.ok ? 'All AI spend paused via tray menu' : `Pause All Spend request failed: HTTP ${res.status}`);
  } catch (err) {
    trayLogger.error('tray', 'Pause All Spend request failed', err);
  }
}

async function startSystemTray() {
  if (!shouldStartTray()) {
    trayLogger.log('tray', 'System tray disabled (headless environment or AIOS_DISABLE_TRAY=1)');
    return;
  }

  let SysTray;
  try {
    ({ default: SysTray } = await import('systray'));
  } catch (err) {
    trayLogger.error('tray', 'systray package unavailable — skipping tray icon', err);
    return;
  }

  let systray;
  try {
    systray = new SysTray({
      menu: {
        icon: getTrayIcon('yellow'), // unknown until the first health check completes
        title: 'MeridianOS',
        tooltip: 'MeridianOS',
        items: TRAY_MENU_ITEMS.map((title) => ({ title, tooltip: title, checked: false, enabled: true })),
      },
      debug: false,
      copyDir: true,
    });
  } catch (err) {
    trayLogger.error('tray', 'failed to start system tray icon', err);
    return;
  }

  systray.onClick((action) => {
    if (action.seq_id === 0) openUrl(`http://localhost:${port}`);
    else if (action.seq_id === 1) pauseAllSpend();
    else if (action.seq_id === 2) classifyHealth({ port }).then((status) => trayLogger.log('tray', `Status: ${status}`));
    else if (action.seq_id === 3) { trayLogger.log('tray', 'Quit requested from tray menu'); systray.kill(); process.exit(0); }
  });

  let lastStatus = null;
  async function refreshIcon() {
    const status = await classifyHealth({ port });
    if (status !== lastStatus) {
      lastStatus = status;
      systray.sendAction({ type: 'update-menu-icon', icon: getTrayIcon(status) });
      trayLogger.log('tray', `status changed → ${status}`);
    }
  }
  await refreshIcon();
  setInterval(refreshIcon, 15_000).unref();

  trayLogger.log('tray', 'System tray icon started');
}

await startSystemTray();
