/**
 * tray-status — pure decision logic behind daemon-entry.mjs's system tray icon (FR-004):
 * whether to start a tray at all in this environment, and how to classify daemon health into
 * green/yellow/red. Split out from daemon-entry.mjs (which owns the actual systray wiring —
 * constructing the menu, handling clicks, calling sendAction) purely so this logic is unit
 * testable without spinning up a real tray icon or a live daemon.
 */

/** Headless environments (Docker/CI, or Linux with no X/Wayland session) can't show a tray icon —
 *  skip rather than let systray-portable hang waiting for a display that will never appear.
 *  @param {{env?: object, platform?: string}} [ctx]  injectable for tests; defaults to `process`. */
export function shouldStartTray({ env = process.env, platform = process.platform } = {}) {
  if (env.AIOS_DISABLE_TRAY === '1') return false;
  if (env.CI) return false; // never block an automated test/build run waiting on a GUI
  if (platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY) return false;
  return true;
}

/**
 * Classify daemon health into the tray's green/yellow/red (FR-004). Reachability failures and an
 * active budget kill-switch are 'red'; a warn/critical escalation is 'yellow'/'red' respectively;
 * otherwise 'green'. Never throws — a classification failure is itself reported as 'red'.
 * @param {{port: number, fetchImpl?: Function}} opts
 * @returns {Promise<'green'|'yellow'|'red'>}
 */
export async function classifyHealth({ port, fetchImpl = fetch }) {
  try {
    const health = await fetchImpl(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(3000) });
    if (!health.ok) return 'red';
  } catch {
    return 'red';
  }
  try {
    const res = await fetchImpl(`http://127.0.0.1:${port}/api/status`, { signal: AbortSignal.timeout(3000) });
    const body = await res.json();
    if (body.kill_switch) return 'red';
    const escalations = body.escalations ?? [];
    if (escalations.some((e) => e.severity === 'critical')) return 'red';
    if (escalations.some((e) => e.severity === 'warn')) return 'yellow';
    return 'green';
  } catch {
    return 'yellow'; // reachable but degraded — not the same as fully down
  }
}

/** The OS command used to open `url` in the default browser (child_process.exec takes this
 *  verbatim) — pulled out as a pure function so tests can assert on it without actually spawning
 *  a browser. */
export function openUrlCommand(url, platform = process.platform) {
  if (platform === 'win32') return `start "" "${url}"`;
  if (platform === 'darwin') return `open "${url}"`;
  return `xdg-open "${url}"`;
}

/** The tray's fixed menu, in seq_id order (FR-004's four quick actions). */
export const TRAY_MENU_ITEMS = ['Open Dashboard', 'Pause All Spend', 'Status', 'Quit'];
