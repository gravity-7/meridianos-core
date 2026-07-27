/**
 * register-conductor.mjs — cross-platform daemon registration script (Phase 0).
 *
 * Replaces scripts/register-conductor.ps1. Detects OS and registers the MeridianOS
 * daemon as a background service using the appropriate OS mechanism:
 *   Windows → Task Scheduler (schtasks)
 *   macOS   → launchd (~/Library/LaunchAgents)
 *   Linux   → systemd user service (~/.config/systemd/user)
 *
 * Usage: node scripts/register-conductor.mjs [--dry-run]
 */
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir, join, platform } from 'node:os';
import { resolve } from 'node:path';

const dryRun = process.argv.includes('--dry-run');
const daemonPath = resolve(process.argv[1], '../../daemon-entry.mjs');
const nodeExe = process.execPath;

function registerWindows() {
  const cmd = `schtasks /create /tn "MeridianOS-Daemon" /tr "${nodeExe} ${daemonPath}" /sc onlogon /rl highest /f`;
  if (dryRun) {
    console.log(`[MERIDIANOS] register-conductor [DRY RUN]: Would execute: ${cmd}`);
  } else {
    execSync(cmd, { stdio: 'inherit' });
    console.log('[MERIDIANOS] register-conductor: Registered as Windows scheduled task "MeridianOS-Daemon"');
  }
}

function registerMacOS() {
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
</plist>`;

  const launchAgentsDir = join(homedir(), 'Library', 'LaunchAgents');
  const plistPath = join(launchAgentsDir, 'com.meridianos.daemon.plist');

  if (dryRun) {
    console.log(`[MERIDIANOS] register-conductor [DRY RUN]: Would write plist to ${plistPath} and run launchctl load`);
    return;
  }

  mkdirSync(launchAgentsDir, { recursive: true });
  writeFileSync(plistPath, plist);
  execSync(`launchctl load ${plistPath}`, { stdio: 'inherit' });
  console.log('[MERIDIANOS] register-conductor: Registered as macOS launchd service');
}

function registerLinux() {
  const serviceUnit = `[Unit]
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

  const systemdDir = join(homedir(), '.config', 'systemd', 'user');
  const unitPath = join(systemdDir, 'meridianos-daemon.service');

  if (dryRun) {
    console.log(`[MERIDIANOS] register-conductor [DRY RUN]: Would write unit to ${unitPath} and run systemctl --user enable`);
    return;
  }

  mkdirSync(systemdDir, { recursive: true });
  writeFileSync(unitPath, serviceUnit);
  execSync('systemctl --user daemon-reload', { stdio: 'inherit' });
  execSync('systemctl --user enable meridianos-daemon', { stdio: 'inherit' });
  execSync('systemctl --user start meridianos-daemon', { stdio: 'inherit' });
  console.log('[MERIDIANOS] register-conductor: Registered as Linux systemd user service');
}

function main() {
  const os = platform();
  console.log(`[MERIDIANOS] register-conductor: Detected OS: ${os}`);

  if (os === 'win32') registerWindows();
  else if (os === 'darwin') registerMacOS();
  else if (os === 'linux') registerLinux();
  else {
    console.error(`[MERIDIANOS] register-conductor: Unsupported OS: ${os}. Fix: Register the daemon manually using your OS's service manager.`);
    process.exit(1);
  }
}

main();
