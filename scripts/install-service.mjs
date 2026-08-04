#!/usr/bin/env node
/**
 * install-service — OS background-service registration for the packaged binary (User Story 1).
 *
 * Distinct from scripts/register-conductor.mjs (Phase 0), which registers the daemon as a
 * Windows *scheduled task* (schtasks, onlogon) for developer checkouts. This module registers a
 * true OS-managed background SERVICE per FR-002 / research.md #2, for non-technical end users of
 * the packaged binary:
 *   Windows → a real Windows Service via `sc.exe create ... start= auto`
 *   macOS   → a launchd LaunchAgent (~/Library/LaunchAgents/com.meridianos.daemon.plist)
 *   Linux   → a systemd --user unit (~/.config/systemd/user/meridianos.service)
 *
 * Every OS call is routed through an injectable `execImpl` (default: node:child_process
 * execFileSync) so tests can verify the exact command built without touching the real OS service
 * manager, and so a single machine's test run never leaves stray services registered.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRotatingLogger } from '../daemon-logger.mjs';
import { parseYaml } from '../yaml-lite.mjs';
import { openDb } from '../db.mjs';
import { recordBinaryInstalled } from '../telemetry.mjs';

export const SERVICE_NAME = 'MeridianOS';
const PLIST_PATH_SEGMENTS = ['Library', 'LaunchAgents', 'com.meridianos.daemon.plist'];
const SYSTEMD_PATH_SEGMENTS = ['.config', 'systemd', 'user', 'meridianos.service'];

function defaultExec(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8' });
}

/** Windows: register a real service via `sc.exe create`, then set it to start automatically. */
export function installWindowsService({ nodeExe, daemonPath, execImpl = defaultExec } = {}) {
  const binPath = `"${nodeExe}" "${daemonPath}"`;
  execImpl('sc.exe', ['create', SERVICE_NAME, `binPath=${binPath}`, 'start=', 'auto']);
  execImpl('sc.exe', ['start', SERVICE_NAME]);
  return { platform: 'win32', mechanism: 'sc.exe', serviceName: SERVICE_NAME };
}

/** macOS: write a launchd plist and load it (RunAtLoad ensures it also starts on next boot). */
export function installMacService({ nodeExe, daemonPath, execImpl = defaultExec, home = homedir() } = {}) {
  const plistPath = join(home, ...PLIST_PATH_SEGMENTS);
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.meridianos.daemon</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodeExe}</string>
        <string>${daemonPath}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
`;
  mkdirSync(join(home, 'Library', 'LaunchAgents'), { recursive: true });
  writeFileSync(plistPath, plist, 'utf8');
  execImpl('launchctl', ['load', plistPath]);
  return { platform: 'darwin', mechanism: 'launchd', plistPath };
}

/** Linux: write a systemd --user unit, enable it (boot persistence) and start it now. */
export function installLinuxService({ nodeExe, daemonPath, execImpl = defaultExec, home = homedir() } = {}) {
  const unitPath = join(home, ...SYSTEMD_PATH_SEGMENTS);
  const unit = `[Unit]
Description=MeridianOS Daemon
After=network.target

[Service]
Type=simple
ExecStart=${nodeExe} ${daemonPath}
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
`;
  mkdirSync(join(home, '.config', 'systemd', 'user'), { recursive: true });
  writeFileSync(unitPath, unit, 'utf8');
  execImpl('systemctl', ['--user', 'daemon-reload']);
  execImpl('systemctl', ['--user', 'enable', 'meridianos']);
  execImpl('systemctl', ['--user', 'start', 'meridianos']);
  return { platform: 'linux', mechanism: 'systemd', unitPath };
}

/** A daemon-logger instance (T024) rooted at `<daemonPath's dir>/.ai/logs` — install-service.mjs
 *  runs standalone, often before any AiosConfig exists, so this bypasses createAios() and calls
 *  createRotatingLogger's `logDir` override directly. Never throws (matches daemon-logger.mjs's
 *  "never crash the daemon" contract) — falls back to a console-only shim on failure. */
function defaultLogger(daemonPath) {
  try {
    return createRotatingLogger({ logDir: join(dirname(daemonPath), '.ai', 'logs') });
  } catch {
    return { log: (_tag, msg) => console.log(`[meridianos] ${msg}`), error: (_tag, msg, err) => console.error(`[meridianos] ${msg}`, err ?? '') };
  }
}

/** T104 — best-effort, opt-in telemetry for a successful install. Swallows EVERYTHING (missing
 *  DomainPlugin, no policy.yaml yet, etc.) since this runs during first-run setup, often before
 *  the repo has a working tenant config at all — telemetry must never be why an install fails. */
function recordInstallTelemetry(daemonPath, result) {
  try {
    const repoRoot = dirname(daemonPath);
    const policyPath = join(repoRoot, '.ai', 'policy.yaml');
    if (!existsSync(policyPath)) return;
    const policy = parseYaml(readFileSync(policyPath, 'utf8'));
    if (policy?.telemetry?.enabled !== true) return;
    const db = openDb(join(repoRoot, '.ai', 'state', 'aios.db'), { repoRoot });
    recordBinaryInstalled(db, { platform: result.platform, mechanism: result.mechanism }, { policy });
    db.close?.();
  } catch { /* telemetry is best-effort */ }
}

/**
 * Install the daemon as an OS background service for `platform` (defaults to the current OS).
 * @param {{platform?: string, nodeExe?: string, daemonPath: string, execImpl?: Function, home?: string, logger?: object}} opts
 */
export function installService({ platform = process.platform, nodeExe = process.execPath, daemonPath, execImpl, home, logger } = {}) {
  if (!daemonPath) throw new Error('installService: daemonPath is required');
  logger = logger ?? defaultLogger(daemonPath);
  try {
    let result;
    if (platform === 'win32') result = installWindowsService({ nodeExe, daemonPath, execImpl });
    else if (platform === 'darwin') result = installMacService({ nodeExe, daemonPath, execImpl, home });
    else if (platform === 'linux') result = installLinuxService({ nodeExe, daemonPath, execImpl, home });
    else throw new Error(`installService: unsupported platform '${platform}'`);
    logger.log('install-service', `Registered background service via ${result.mechanism} on ${result.platform}`);
    recordInstallTelemetry(daemonPath, result);
    return result;
  } catch (err) {
    logger.error('install-service', `Service installation failed on ${platform}`, err);
    throw err;
  }
}

/**
 * T023 — verify the service is registered to auto-start on boot, without waiting for an actual
 * reboot. Parses the OS service manager's own registration state rather than the filesystem, so
 * it fails if `installService` silently no-opped.
 * @returns {{autoStart: boolean, detail: string}}
 */
export function verifyAutoStart({ platform = process.platform, execImpl = defaultExec, home = homedir(), logger, daemonPath } = {}) {
  logger = logger ?? (daemonPath ? defaultLogger(daemonPath) : { log() {}, error() {} });
  const result = (() => {
    try {
      if (platform === 'win32') {
        const out = execImpl('sc.exe', ['qc', SERVICE_NAME]);
        return { autoStart: /AUTO_START/i.test(out), detail: out.trim() };
      }
      if (platform === 'darwin') {
        if (!existsSync(join(home, ...PLIST_PATH_SEGMENTS))) return { autoStart: false, detail: 'plist not found' };
        const out = execImpl('launchctl', ['list', 'com.meridianos.daemon']);
        return { autoStart: /com\.meridianos\.daemon/.test(out), detail: out.trim() };
      }
      if (platform === 'linux') {
        const out = execImpl('systemctl', ['--user', 'is-enabled', 'meridianos']);
        return { autoStart: out.trim() === 'enabled', detail: out.trim() };
      }
      return { autoStart: false, detail: `unsupported platform '${platform}'` };
    } catch (err) {
      return { autoStart: false, detail: String(err?.message || err) };
    }
  })();
  logger.log('install-service', `Auto-start verification (${platform}): ${result.autoStart ? 'CONFIRMED' : 'NOT CONFIRMED'} — ${result.detail}`);
  return result;
}

// CLI entrypoint: `node scripts/install-service.mjs [--daemon-path=...]`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const daemonArg = process.argv.find((a) => a.startsWith('--daemon-path='));
  const daemonPath = daemonArg ? daemonArg.split('=')[1] : join(process.cwd(), 'daemon-entry.mjs');
  try {
    const result = installService({ daemonPath });
    console.log(`[meridianos] Installed background service (${result.mechanism}) on ${result.platform}`);
    const verify = verifyAutoStart({ platform: result.platform, daemonPath });
    console.log(verify.autoStart ? '[meridianos] Confirmed: service will auto-start on boot' : `[meridianos] WARNING: auto-start not confirmed — ${verify.detail}`);
  } catch (err) {
    console.error(`[meridianos] Service installation failed: ${err.message}`);
    process.exit(1);
  }
}
