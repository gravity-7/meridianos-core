/**
 * client-error-log — dashboard error-visibility hardening (009 — Dashboard Modernization,
 * US3/FR-006/FR-007). `reportError()` is the one way a caught dashboard error should be handled: it
 * always updates a visible in-DOM error state immediately (this half is never itself silently
 * swallowed — it's synchronous DOM work, not a network call), then best-effort forwards the error to
 * `POST /api/client-error` so it's durable in daemon.log and diagnosable without devtools ever
 * having been open. The `x-aios-token` CSRF header is attached automatically by
 * `dashboard/index.html`'s global `fetch` wrapper — this module never touches it directly.
 */
import { esc as escapeHtml } from './dashboard-utils.mjs';

/**
 * @param {string} source - panel/function name; identifies where the error came from
 * @param {unknown} error - the caught error (an Error instance or an arbitrary thrown value)
 * @param {object} [opts]
 * @param {HTMLElement} [opts.panelEl] - if given, its content is replaced with a visible error state
 * @param {'error'|'info'} [opts.severity] - 'info' renders a quieter, non-alarming state for expected
 *   degradation (e.g. an optional integration not configured) rather than a real failure — see the
 *   "not available" comment-only catch sites dashboard/index.html used to have for the class this is for
 */
export function reportError(source, error, opts = {}) {
  const { panelEl, severity = 'error' } = opts;
  const message = error instanceof Error ? error.message : String(error ?? 'unknown error');
  const stack = error instanceof Error ? error.stack : undefined;

  if (panelEl) renderPanelError(panelEl, message, severity);

  // Best-effort only: if the network itself is down there is nothing more useful this can do — but
  // the panel's visible state above has already been set, so this failure mode is never fully
  // silent the way the bug this module fixes was.
  fetch('/api/client-error', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source, message, stack, timestamp: new Date().toISOString() }),
  }).catch(() => {});
}

function renderPanelError(panelEl, message, severity) {
  const tone = severity === 'info'
    ? { bg: 'var(--bg-secondary)', color: 'var(--text-muted)', icon: 'ℹ' }
    : { bg: 'var(--bg-danger)', color: 'var(--text-danger)', icon: '⚠' };
  panelEl.innerHTML = `<div style="padding:12px;border-radius:var(--radius,6px);background:${tone.bg};color:${tone.color};font-size:12px;line-height:1.4">${tone.icon} ${escapeHtml(message)}</div>`;
}
