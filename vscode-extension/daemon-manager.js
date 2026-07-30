/**
 * daemon-manager.js — MeridianOS Daemon Lifecycle Management
 *
 * Manages the MeridianOS daemon process lifecycle:
 * - Checks Node.js availability
 * - Downloads and installs the MeridianOS npm package
 * - Launches setup wizard in VS Code Webview
 * - Starts/stops the daemon synchronized with VS Code lifecycle
 * - Health checks the daemon via dashboard API
 */
const vscode = require('vscode');
const { spawn, execSync } = require('child_process');
const http = require('http');
const path = require('path');
const os = require('os');

const DASHBOARD_URL = process.env.MERIDIAN_DASHBOARD_URL || 'http://localhost:4317';
const DASHBOARD_PORT = 4317;
const HEALTH_CHECK_TIMEOUT_MS = 5000;

/**
 * Check if Node.js ≥ 22 is available.
 * @returns {{ ok: boolean, version: string | null, downloadUrl: string | null }}
 */
function checkNodeJs() {
  try {
    const version = execSync('node --version', { encoding: 'utf8', timeout: 5000 }).trim();
    const major = parseInt(version.replace('v', '').split('.')[0], 10);
    if (major >= 22) {
      return { ok: true, version, downloadUrl: null };
    }
    return {
      ok: false, version,
      downloadUrl: 'https://nodejs.org/en/download/',
    };
  } catch {
    return {
      ok: false, version: null,
      downloadUrl: 'https://nodejs.org/en/download/',
    };
  }
}

/**
 * Check if the MeridianOS daemon is running by polling the dashboard health endpoint.
 * @returns {Promise<{ running: boolean, port: number }>}
 */
function checkDaemonHealth() {
  return new Promise((resolve) => {
    const req = http.get(`${DASHBOARD_URL}/api/status`, { timeout: HEALTH_CHECK_TIMEOUT_MS }, (res) => {
      resolve({ running: res.statusCode >= 200 && res.statusCode < 500, port: DASHBOARD_PORT });
    });
    req.on('error', () => resolve({ running: false, port: DASHBOARD_PORT }));
    req.on('timeout', () => { req.destroy(); resolve({ running: false, port: DASHBOARD_PORT }); });
  });
}

/**
 * Start the MeridianOS daemon as a detached child process.
 * @returns {import('child_process').ChildProcess | null}
 */
function startDaemon(repoRoot) {
  try {
    const daemonEntry = path.join(repoRoot || process.cwd(), 'daemon-entry.mjs');
    const child = spawn('node', [daemonEntry], {
      detached: true,
      stdio: 'ignore',
      cwd: repoRoot || process.cwd(),
      env: { ...process.env },
    });
    child.unref();
    return child;
  } catch {
    return null;
  }
}

/**
 * Stop the MeridianOS daemon by sending SIGTERM.
 */
function stopDaemon(process) {
  if (process && !process.killed) {
    try {
      process.kill('SIGTERM');
    } catch {
      // Process may already be dead
    }
  }
}

/**
 * Download and install the MeridianOS npm package. Uses the extension's global
 * storage path for the installation directory.
 * @param {string} installPath — directory to install into
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
function downloadAndInstallDaemon(installPath) {
  return new Promise((resolve) => {
    try {
      execSync(`npm install @gravity-7/meridianos-core --prefix "${installPath}"`, {
        encoding: 'utf8',
        timeout: 120000,
        stdio: 'pipe',
        cwd: installPath,
      });
      resolve({ ok: true, message: 'MeridianOS daemon installed successfully.' });
    } catch (e) {
      // Fallback: if npm registry isn't available, try local install
      try {
        const localPath = path.join(installPath, '..', '..', '..', 'meridianos-core');
        execSync(`npm install "${localPath}" --prefix "${installPath}"`, {
          encoding: 'utf8',
          timeout: 60000,
          stdio: 'pipe',
        });
        resolve({ ok: true, message: 'MeridianOS daemon installed from local path.' });
      } catch {
        resolve({
          ok: false,
          message: `Failed to install MeridianOS: ${e.message}. Check your network connection and npm configuration.`,
        });
      }
    }
  });
}

/**
 * Launch the setup wizard in a VS Code Webview Panel.
 */
function launchWizardInWebview(context) {
  const panel = vscode.window.createWebviewPanel(
    'meridianosSetup',
    'MeridianOS Setup Wizard',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );

  panel.webview.html = getWizardHtml();
  return panel;
}

function getWizardHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MeridianOS Setup</title>
  <style>
    body { font-family: var(--vscode-font-family, sans-serif); padding: 20px; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
    h1 { font-size: 1.5em; margin-bottom: 20px; }
    .step { margin-bottom: 30px; padding: 15px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; }
    .step h2 { font-size: 1.1em; margin-bottom: 10px; }
    .status { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 0.85em; }
    .ok { background: #1a7f37; color: white; }
    .pending { background: #9a6700; color: white; }
    .error { background: #cf222e; color: white; }
    button { padding: 8px 16px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; cursor: pointer; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    a { color: var(--vscode-textLink-foreground); }
  </style>
</head>
<body>
  <h1>MeridianOS Setup Wizard</h1>
  <p>This wizard will guide you through setting up MeridianOS. The setup should take about 10 minutes.</p>
  <div class="step">
    <h2>1. Node.js Check</h2>
    <p>MeridianOS requires Node.js 22 or later.</p>
    <div id="node-check">Checking...</div>
  </div>
  <div class="step">
    <h2>2. Install MeridianOS</h2>
    <p>Download and install the MeridianOS daemon package.</p>
    <div id="install-status">Waiting for Node.js check...</div>
  </div>
  <div class="step">
    <h2>3. Configure Providers</h2>
    <p>Open the dashboard to configure your AI providers.</p>
    <button id="open-dashboard">Open Dashboard</button>
  </div>
  <div class="step">
    <h2>4. Connect Your IDE</h2>
    <p>Configure your IDE to route AI traffic through MeridianOS.</p>
    <button id="connect-ide">Connect IDE</button>
  </div>
  <script>
    // This webview communicates setup progress back to the extension
    const vscode = acquireVsCodeApi();
    document.getElementById('open-dashboard').addEventListener('click', () => {
      vscode.postMessage({ command: 'openDashboard' });
    });
    document.getElementById('connect-ide').addEventListener('click', () => {
      vscode.postMessage({ command: 'connectIde' });
    });
  </script>
</body>
</html>`;
}

module.exports = {
  checkNodeJs,
  checkDaemonHealth,
  startDaemon,
  stopDaemon,
  downloadAndInstallDaemon,
  launchWizardInWebview,
};
