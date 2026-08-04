/**
 * daemon-manager — Electron desktop app's daemon lifecycle (FR-005/FR-006 support): spawn the
 * MeridianOS daemon when the app opens, stop it gracefully when the window closes, and restart
 * it (re-reading keys from the OS keychain) when the app reopens (spec Acceptance Scenario 5).
 *
 * Pure Node — no `electron` import — so it's testable with injected `spawnImpl`/`fetchImpl`,
 * mirroring vscode-extension/daemon-manager.mjs's approach for the same underlying daemon.
 */
import { join } from 'node:path';

const DEFAULT_PORT = 4317;
const HEALTH_TIMEOUT_MS = 3000;
const POLL_INTERVAL_MS = 300;

/**
 * Spawn the daemon as a child process with the given env merged over `process.env`.
 * `AIOS_DISABLE_TRAY=1` is always set — Electron provides its own native tray (desktop/main.js),
 * so the packaged-binary tray (daemon-entry.mjs + `systray`) would just be a redundant second icon.
 * @param {{repoRoot: string, env?: object, spawnImpl: Function, port?: number}} opts
 * @returns {import('node:child_process').ChildProcess}
 */
export function spawnDaemon({ repoRoot, env = {}, spawnImpl, port = DEFAULT_PORT }) {
  const daemonEntry = join(repoRoot, 'daemon-entry.mjs');
  return spawnImpl(process.execPath, [daemonEntry], {
    cwd: repoRoot,
    env: { ...process.env, ...env, AIOS_DISABLE_TRAY: '1', AIOS_DASHBOARD_PORT: String(port) },
    stdio: 'pipe',
  });
}

/** Stop a spawned daemon gracefully (SIGTERM), never throwing on an already-dead process. */
export function stopDaemon(child) {
  if (!child || child.killed) return;
  try { child.kill('SIGTERM'); } catch { /* already exited */ }
}

/** One-shot health probe against the dashboard's liveness endpoint. */
async function probeHealth({ port, fetchImpl }) {
  try {
    const res = await fetchImpl(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Poll until the daemon answers /healthz or `timeoutMs` elapses.
 * @param {{port?: number, fetchImpl?: Function, timeoutMs?: number, sleepImpl?: Function}} opts
 * @returns {Promise<boolean>} true if the daemon became healthy in time
 */
export async function waitForHealthy({ port = DEFAULT_PORT, fetchImpl = fetch, timeoutMs = 30_000, sleepImpl = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeHealth({ port, fetchImpl })) return true;
    await sleepImpl(POLL_INTERVAL_MS);
  }
  return false;
}

/**
 * Full startup sequence: spawn the daemon with the given env, then wait for it to become
 * healthy. Returns the child process regardless of outcome — callers decide what "not healthy in
 * time" means for their UI (e.g. show an error banner rather than a blank window).
 * @param {{repoRoot: string, env?: object, spawnImpl: Function, fetchImpl?: Function, port?: number, timeoutMs?: number}} opts
 */
export async function startDaemonAndWait(opts) {
  const child = spawnDaemon(opts);
  const healthy = await waitForHealthy({ port: opts.port, fetchImpl: opts.fetchImpl, timeoutMs: opts.timeoutMs });
  return { child, healthy };
}
