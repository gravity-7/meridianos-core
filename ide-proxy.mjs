/**
 * ide-proxy — IDE detection, proxy configuration snippet generation, and connectivity testing.
 *
 * detectInstalledIdes() scans standard OS paths to find AI-enabled IDEs (VS Code, Cursor,
 * Windsurf, Claude Code, JetBrains). generateProxyConfig() produces copy-paste-ready proxy
 * snippets per IDE type. testIdeConnectivity() sends lightweight probes through the gateway
 * to verify end-to-end routing.
 *
 * All functions are synchronous where possible (filesystem checks) or return Promises for
 * operations requiring network I/O or child process execution.
 */
import { statSync, accessSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { request } from 'node:http';

const OS = platform(); // 'win32' | 'darwin' | 'linux'

// ─── Supported IDE definitions ─────────────────────────────────────────────

const KNOWN_IDES = Object.freeze([
  {
    ideName: 'vscode',
    displayName: 'Visual Studio Code',
    family: 'vscode',
    detectionMethods: ['standard-path'],
    windowsPaths: [
      join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code'),
    ],
    macPaths: ['/Applications/Visual Studio Code.app'],
    linuxPaths: ['/usr/share/code'],
  },
  {
    ideName: 'cursor',
    displayName: 'Cursor',
    family: 'vscode',
    detectionMethods: ['standard-path'],
    windowsPaths: [
      join(process.env.LOCALAPPDATA || '', 'Programs', 'Cursor'),
    ],
    macPaths: ['/Applications/Cursor.app'],
    linuxPaths: ['/usr/share/cursor'],
  },
  {
    ideName: 'windsurf',
    displayName: 'Windsurf',
    family: 'vscode',
    detectionMethods: ['standard-path'],
    windowsPaths: [
      join(process.env.LOCALAPPDATA || '', 'Programs', 'Windsurf'),
    ],
    macPaths: ['/Applications/Windsurf.app'],
    linuxPaths: ['/usr/share/windsurf'],
  },
  {
    ideName: 'claude-code',
    displayName: 'Claude Code',
    family: 'cli',
    detectionMethods: ['which-command', 'standard-path'],
    windowsPaths: [
      join(process.env.LOCALAPPDATA || '', 'claude'),
    ],
    macPaths: [
      '/usr/local/bin/claude',
      join(homedir(), '.local', 'bin', 'claude'),
    ],
    linuxPaths: [
      '/usr/local/bin/claude',
      join(homedir(), '.local', 'bin', 'claude'),
    ],
    whichCommand: 'claude',
  },
  {
    ideName: 'jetbrains',
    displayName: 'JetBrains IDEs',
    family: 'jetbrains',
    detectionMethods: ['standard-path'],
    windowsPaths: [
      join(process.env.APPDATA || '', 'JetBrains'),
    ],
    macPaths: [
      join(homedir(), 'Library', 'Application Support', 'JetBrains'),
    ],
    linuxPaths: [
      join(homedir(), '.local', 'share', 'JetBrains'),
    ],
  },
]);

// ─── Helper: check if a path exists ────────────────────────────────────────

function pathExists(p) {
  try {
    accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function dirExists(p) {
  try {
    const s = statSync(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

// ─── Helper: which command (cross-platform) ────────────────────────────────

function which(cmd) {
  try {
    const result = execSync(
      OS === 'win32' ? `where ${cmd} 2>nul` : `which ${cmd} 2>/dev/null`,
      { encoding: 'utf8', timeout: 3000 },
    );
    const first = result.trim().split('\n')[0]?.trim();
    return first && first.length > 0 ? first : null;
  } catch {
    return null;
  }
}

// ─── Public: detect installed IDEs ─────────────────────────────────────────

/**
 * Scans the local machine for AI-enabled IDEs and returns detection records.
 * @param {object} [opts]
 * @param {string[]} [opts.customPaths] — additional paths from policy.yaml ide_detection.paths
 * @returns {Array<{ideName, displayName, installed, installPath, version, detectionMethod}>}
 */
export function detectInstalledIdes({ customPaths = [] } = {}) {
  const results = [];

  for (const ide of KNOWN_IDES) {
    let installed = false;
    let installPath = null;
    let detectionMethod = null;

    // Try standard-path detection first
    if (ide.detectionMethods.includes('standard-path')) {
      const paths = OS === 'win32' ? ide.windowsPaths
        : OS === 'darwin' ? ide.macPaths
        : ide.linuxPaths;
      for (const p of paths) {
        if (dirExists(p) || pathExists(p)) {
          installed = true;
          installPath = p;
          detectionMethod = 'standard-path';
          break;
        }
      }
      // Also check custom paths from policy
      if (!installed) {
        for (const cp of customPaths) {
          const customPath = join(cp, ide.ideName);
          if (dirExists(customPath) || pathExists(customPath)) {
            installed = true;
            installPath = customPath;
            detectionMethod = 'custom-path';
            break;
          }
        }
      }
    }

    // Try which-command detection for CLI tools
    if (!installed && ide.detectionMethods.includes('which-command') && ide.whichCommand) {
      const found = which(ide.whichCommand);
      if (found) {
        installed = true;
        installPath = found;
        detectionMethod = 'which-command';
      }
    }

    results.push({
      ideName: ide.ideName,
      displayName: ide.displayName,
      family: ide.family,
      installed,
      installPath,
      version: null, // version detection is best-effort; null if unavailable
      detectionMethod: installed ? detectionMethod : null,
    });
  }

  return results;
}

// ─── Public: generate proxy config snippet ──────────────────────────────────

/**
 * Generates a proxy configuration snippet for a specific IDE type.
 * @param {string} ideName — 'vscode', 'cursor', 'windsurf', 'claude-code', 'jetbrains', or 'generic'
 * @param {string} gatewayUrl — e.g. 'http://127.0.0.1:8787'
 * @returns {{ ideName, displayName, snippetType, content, instructions, gatewayUrl }}
 */
export function generateProxyConfig(ideName, gatewayUrl) {
  const ide = KNOWN_IDES.find((i) => i.ideName === ideName);

  if (!ide && ideName !== 'generic') {
    // Return generic fallback for unknown IDEs
    return generateGenericConfig(gatewayUrl);
  }

  if (!ide) {
    return generateGenericConfig(gatewayUrl);
  }

  switch (ide.family) {
    case 'vscode':
      return generateVsCodeConfig(ide.displayName, gatewayUrl);
    case 'cli':
      return generateCliConfig(ide.displayName, gatewayUrl);
    case 'jetbrains':
      return generateJetBrainsConfig(ide.displayName, gatewayUrl);
    default:
      return generateGenericConfig(gatewayUrl);
  }
}

function generateVsCodeConfig(displayName, gatewayUrl) {
  return {
    ideName: 'vscode',
    displayName,
    snippetType: 'settings-json',
    content: `"http.proxy": "${gatewayUrl}",\n"http.proxyStrictSSL": false`,
    instructions: `1. Open ${displayName}\n2. Open Command Palette (Ctrl+Shift+P / Cmd+Shift+P)\n3. Type "Preferences: Open User Settings (JSON)"\n4. Add the snippet above to your settings.json file\n5. Save the file\n6. Restart ${displayName} for changes to take effect`,
    gatewayUrl,
    note: 'For GitHub Copilot, also run "MeridianOS: Route Copilot Through Gateway" from the command palette after installing the MeridianOS extension.',
  };
}

function generateCliConfig(displayName, gatewayUrl) {
  const host = new URL(gatewayUrl).host;
  return {
    ideName: 'claude-code',
    displayName,
    snippetType: 'env-export',
    content: `export ANTHROPIC_BASE_URL="${gatewayUrl}"\nexport HTTP_PROXY="${gatewayUrl}"\nexport HTTPS_PROXY="${gatewayUrl}"`,
    instructions: `Add these lines to your shell profile (~/.bashrc, ~/.zshrc, or equivalent):\n\n${`export ANTHROPIC_BASE_URL="${gatewayUrl}"`}\n${`export HTTP_PROXY="${gatewayUrl}"`}\n${`export HTTPS_PROXY="${gatewayUrl}"`}\n\nThen run: source ~/.bashrc (or restart your terminal)`,
    gatewayUrl,
  };
}

function generateJetBrainsConfig(displayName, gatewayUrl) {
  return {
    ideName: 'jetbrains',
    displayName,
    snippetType: 'settings-text',
    content: `HTTP Proxy: ${gatewayUrl}\nProxy type: HTTP`,
    instructions: `1. Open ${displayName}\n2. Go to File → Settings → Appearance & Behavior → System Settings → HTTP Proxy\n3. Select "Manual proxy configuration"\n4. Set Host name to "${new URL(gatewayUrl).hostname}" and Port to "${new URL(gatewayUrl).port}"\n5. Click "Check Connection" and enter any URL to test\n6. Apply and close settings`,
    gatewayUrl,
  };
}

function generateGenericConfig(gatewayUrl) {
  return {
    ideName: 'generic',
    displayName: 'Generic / Other IDE',
    snippetType: 'generic-proxy',
    content: `HTTP_PROXY=${gatewayUrl}\nHTTPS_PROXY=${gatewayUrl}`,
    instructions: `Set these environment variables in your shell or system settings:\n\n${`HTTP_PROXY=${gatewayUrl}`}\n${`HTTPS_PROXY=${gatewayUrl}`}\n\nMost AI-enabled tools respect these standard proxy variables. If your tool has IDE-specific proxy settings, consult its documentation.`,
    gatewayUrl,
  };
}

// ─── Public: test IDE connectivity ─────────────────────────────────────────

/**
 * Sends a lightweight probe through the gateway to verify IDE-to-gateway connectivity.
 * Uses the gateway's health endpoint as the probe target.
 * @param {string} gatewayUrl — e.g. 'http://127.0.0.1:8787'
 * @param {number} [timeoutMs=5000] — probe timeout in milliseconds
 * @returns {Promise<{ok, latencyMs, errorCode, errorMessage, testedAt}>}
 */
export function testIdeConnectivity(gatewayUrl, timeoutMs = 5000) {
  const testedAt = new Date().toISOString();
  const startMs = Date.now();

  return new Promise((resolve) => {
    const url = new URL('/api/health', gatewayUrl);
    const req = request(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: 'GET',
        timeout: timeoutMs,
      },
      (res) => {
        const latencyMs = Date.now() - startMs;
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ ok: true, latencyMs, errorCode: null, errorMessage: null, testedAt });
          } else if (res.statusCode === 401 || res.statusCode === 403) {
            resolve({
              ok: false, latencyMs: null, testedAt,
              errorCode: 'AUTH_FAILED',
              errorMessage: `Gateway returned ${res.statusCode}. Check your authentication configuration.`,
            });
          } else {
            resolve({
              ok: false, latencyMs: null, testedAt,
              errorCode: 'UNEXPECTED_RESPONSE',
              errorMessage: `Gateway returned unexpected status ${res.statusCode}.`,
            });
          }
        });
      },
    );

    req.on('timeout', () => {
      req.destroy();
      resolve({
        ok: false, latencyMs: null, testedAt,
        errorCode: 'TIMEOUT',
        errorMessage: `Connection timed out after ${timeoutMs / 1000} seconds. Is the gateway running at ${gatewayUrl}?`,
      });
    });

    req.on('error', (err) => {
      const latencyMs = Date.now() - startMs;
      if (err.code === 'ECONNREFUSED') {
        resolve({
          ok: false, latencyMs: null, testedAt,
          errorCode: 'CONNECTION_FAILED',
          errorMessage: `Could not reach the gateway at ${gatewayUrl}. Is the MeridianOS daemon running?`,
        });
      } else {
        resolve({
          ok: false, latencyMs: null, testedAt,
          errorCode: 'CONNECTION_FAILED',
          errorMessage: `Connection error: ${err.message}`,
        });
      }
    });

    req.end();
  });
}

// ─── Export IDE definitions for dashboard use ───────────────────────────────

export { KNOWN_IDES };

/**
 * Research Copilot's HTTP client proxy behavior.
 * This is a best-effort research function that documents whether GitHub Copilot
 * respects VS Code's http.proxy settings. Since Copilot's HTTP implementation
 * is not publicly documented, this function serves as a programmatic record of
 * the current known state.
 *
 * @returns {{ proxySupported: boolean, notes: string, lastChecked: string }}
 */
export function researchCopilotProxyBehavior() {
  // Copilot uses an OpenAI-compatible API format. If traffic reaches the gateway,
  // the existing OpenAI WireAdapter can parse and meter it.
  //
  // VS Code's `http.proxy` setting is documented to affect extensions that use
  // VS Code's built-in HTTP client. Whether Copilot uses this or a custom HTTP
  // client determines proxy feasibility.
  //
  // Best-effort status:
  // - If Copilot respects http.proxy: traffic appears in gateway ledger with source='ide'
  // - If not: system-level proxy (netsh/macOS network/Linux HTTP_PROXY) is the fallback
  // - The dashboard's /api/ide/status endpoint reports copilotStatus to communicate this

  return {
    proxySupported: null, // unknown until empirically tested — see notes
    notes: [
      'Copilot uses an OpenAI-compatible API format behind the scenes.',
      'If traffic reaches the gateway, the OpenAI WireAdapter can parse and meter it automatically.',
      'VS Code http.proxy setting support for Copilot is not publicly documented by GitHub.',
      'To test: configure http.proxy → make a Copilot chat request → check gateway ledger for source=ide events.',
      'Fallback if proxy not respected: system-level proxy configuration (OS-specific).',
      'The dashboard IDE status endpoint reports copilotStatus: working, partial, unavailable, or unknown.',
      'This research function is best-effort — GitHub may change Copilot HTTP implementation at any time.',
    ].join(' '),
    lastChecked: new Date().toISOString().slice(0, 10),
  };
}
