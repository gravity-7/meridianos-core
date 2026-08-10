/**
 * dashboard-utils — shared formatting/escaping helpers (010 — Frontend ES Module Migration, US1).
 * Every other feature module imports from here instead of redeclaring its own copy.
 *
 * `esc` consolidates two behaviors that used to differ: dashboard/index.html's old `esc()` escaped
 * only `&`/`<`/`>`; this file's `escapeHtml`-style behavior (already used under that name in 7 other
 * already-shipped panel modules) also escapes `'`/`"`. Both feed values into
 * `onclick="...('${esc(x)}')"`-style attribute strings built with single-quote delimiters — an
 * unescaped `'` breaks out of the attribute, and an unescaped `"` breaks out of any
 * `attr="${esc(x)}"`-style double-quoted attribute (a live instance of exactly that existed in
 * marketplace-panel.mjs's plugin-config-field `value="${escapeHtml(value)}"`, found while
 * consolidating this file). The quote-escaping behavior is kept everywhere.
 *
 * `relTime` consolidates two partial protections into one complete one: dashboard/index.html's old
 * version clamped a negative/future timestamp to `'0s'` but had no guard against an unparseable
 * `iso` (rendered the literal string `'NaNs'`); the version already used in governance-panel.mjs and
 * task-workflow-panel.mjs guards `NaN` (returns `'—'`) but had no negative clamp (rendered e.g.
 * `'-5s'`). This version keeps both.
 *
 * `fmt` (task-workflow-panel.mjs, agent-budget-panel.mjs) is deliberately NOT here — different
 * rounding convention (0 decimal places vs. this file's `formatNumber`'s 1), a per-panel display
 * choice, not a duplicate.
 */

export function esc(unsafe) {
  return (unsafe ?? '').toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function relTime(iso) {
  if (!iso) return '—';
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return '—';
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h';
  return Math.floor(h / 24) + 'd';
}

export function formatSpend(amount) {
  if (amount === 0) return '$0.00';
  if (amount < 0.01) return '$' + amount.toPrecision(2);
  return '$' + amount.toFixed(2);
}

export function formatNumber(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

export function shortModel(v) {
  if (!v) return '—';
  return String(v).replace('claude-', '').replace(/-/g, ' ').replace('opus 4 8', 'opus 4.8').replace('haiku 4 5', 'haiku 4.5');
}

export function badgeFor(s) {
  return s === 'in-progress' ? 'b-accent' : (s === 'blocked' ? 'b-warn' : (s === 'done' ? 'b-ok' : 'b-muted'));
}

export function outcomeBadge(o) {
  return o === 'ok' ? 'b-ok' : (o === 'skipped' ? 'b-warn' : ((o === 'failed' || o === 'blocked') ? 'b-danger' : 'b-muted'));
}
