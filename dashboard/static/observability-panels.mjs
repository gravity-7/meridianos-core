/**
 * observability-panels — uPlot-backed chart panels for the Settings/Observability workspace
 * (008 — End-User Configurability, US1/FR-013). Reads the EXISTING `/api/analytics/*` and
 * `/api/ledger/*` endpoints — no new backend data model, this is a rendering upgrade over data
 * that already exists (see spec.md's "Context: What Already Exists").
 *
 * Three panels per FR-013: cost-over-time (time series), token usage (time series), provider
 * spend breakdown (bar — uPlot has no pie chart primitive, so this is proportional horizontal
 * bars over `/api/ledger/spend-by-provider`, satisfying "actual chart, not a restyled tile").
 */
import { registerPanel } from './settings-workspace.mjs';

// 009 — Dashboard Modernization (US5/FR-010): read design-tokens.css's custom properties via
// getComputedStyle so light/dark mode is picked up automatically — no separate dark-mode branch
// needed here, the CSS already handles which value is active.
function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// Stable per-identity color assignment, cached for the page's lifetime. Assigned in FIRST-SEEN
// order, never by sort position — per the dataviz skill's rule "color follows the entity, never its
// rank": a provider must keep its color across re-renders even as cost-sorted order shifts.
const categoricalAssignments = new Map();
function categoricalColor(key) {
  if (!categoricalAssignments.has(key)) {
    const slot = (categoricalAssignments.size % 8) + 1;
    categoricalAssignments.set(key, cssVar(`--chart-series-${slot}`, '#2a78d6'));
  }
  return categoricalAssignments.get(key);
}

/** Shared uPlot axis/grid styling, reading design-tokens.css's/index.html's existing chrome tokens
 *  — one place so every chart's axes look identical instead of each panel picking its own. */
function uplotAxisTheme() {
  const muted = cssVar('--text-muted', '#94a3b8');
  const grid = cssVar('--border', 'rgba(128,128,128,0.15)');
  return { stroke: muted, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid } };
}

/** Transform queryTimeseries()'s `{ series: [{ label, data: [{ts, cost, tokens}] }] }` shape into
 *  uPlot's `[xs[], ys[]]` column format, summing `field` across every series per timestamp
 *  bucket — a single combined line, not a per-provider breakdown (that's the bar panel's job). */
function toUplotData(timeseries, field) {
  const byTs = new Map();
  for (const s of timeseries.series ?? []) {
    for (const point of s.data) {
      const ms = Date.parse(point.ts);
      if (Number.isNaN(ms)) continue;
      const sec = Math.floor(ms / 1000);
      byTs.set(sec, (byTs.get(sec) ?? 0) + (point[field] ?? 0));
    }
  }
  const xs = [...byTs.keys()].sort((a, b) => a - b);
  const ys = xs.map((x) => byTs.get(x));
  return [xs, ys];
}

async function renderTimeseriesChart(el, { field, label, colorKey, groupBy = 'provider' }) {
  el.innerHTML = '<div class="workspace-panel-loading">Loading…</div>';
  let timeseries;
  try {
    const res = await fetch(`/api/analytics/timeseries?groupBy=${groupBy}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    timeseries = await res.json();
  } catch (err) {
    el.innerHTML = `<div class="workspace-panel-error">Chart unavailable: ${String(err.message ?? err)}</div>`;
    return;
  }

  el.innerHTML = '';
  const data = toUplotData(timeseries, field);
  if (data[0].length === 0) {
    el.innerHTML = '<div class="workspace-panel-empty">No data in this window yet.</div>';
    return;
  }

  // Single series → dataviz skill's categorical rule ("second sequential context takes the next
  // categorical slot's hue") rather than borrowing a semantic accent/success color that doesn't
  // actually mean "cost" or "tokens". No legend needed per the skill's own rule (legend required at
  // 2+ series, none for one) — uPlot's built-in cursor tooltip (on by default, not suppressed below)
  // already covers the interactive-hover requirement for a single line.
  const color = categoricalColor(colorKey);
  const axisTheme = uplotAxisTheme();
  // eslint-disable-next-line no-undef -- uPlot is a vendored global script, not an ES import
  new uPlot(
    {
      width: el.clientWidth || 380,
      height: 220,
      series: [{}, { label, stroke: color, width: 2, fill: `${color}22` }],
      axes: [axisTheme, axisTheme],
    },
    data,
    el,
  );
}

/** Flatten providerBreakdownFromLedger()'s `{ [provider]: { [model]: {calls,tokens,cost} } }`
 *  into per-provider totals, sorted descending by cost. */
function totalsByProvider(breakdown) {
  const totals = [];
  for (const [provider, models] of Object.entries(breakdown ?? {})) {
    let cost = 0;
    for (const m of Object.values(models)) cost += m.cost ?? 0;
    totals.push({ provider, cost });
  }
  return totals.sort((a, b) => b.cost - a.cost);
}

async function renderProviderSpendBreakdown(el) {
  el.innerHTML = '<div class="workspace-panel-loading">Loading…</div>';
  let body;
  try {
    const res = await fetch('/api/ledger/spend-by-provider');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    body = await res.json(); // { ok, available, providers: { [provider]: { [model]: {calls,tokens,cost} } } }
  } catch (err) {
    el.innerHTML = `<div class="workspace-panel-error">Breakdown unavailable: ${String(err.message ?? err)}</div>`;
    return;
  }

  const totals = totalsByProvider(body.providers);
  if (totals.length === 0) {
    el.innerHTML = '<div class="workspace-panel-empty">No provider spend recorded yet.</div>';
    return;
  }

  const max = Math.max(...totals.map((t) => t.cost), 0.0001);
  // Genuinely categorical (one bar per provider) — each provider gets a stable slot via
  // categoricalColor() (first-seen order, cached) rather than every bar sharing one accent color.
  // The provider name is already rendered as a direct label next to each bar, which is what makes
  // this safe under the palette's "relief required" contrast WARN (dataviz skill: identity must
  // never be color-alone when a slot is sub-3:1 against the surface).
  el.innerHTML = totals
    .map(
      (t) => `
    <div style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:2px">
        <span>${t.provider}</span><span class="mono">$${t.cost.toFixed(4)}</span>
      </div>
      <div style="background:var(--surface-1);border-radius:4px;height:8px;overflow:hidden">
        <div style="background:${categoricalColor(t.provider)};height:100%;width:${Math.max(2, (t.cost / max) * 100)}%"></div>
      </div>
    </div>`,
    )
    .join('');
}

export function registerObservabilityPanels() {
  // colorKey order here IS the first-seen order that decides categorical slot assignment — cost
  // gets slot 1 (blue), tokens gets slot 2 (orange), matching the dataviz skill's guidance for two
  // simultaneous single-series sequential contexts.
  registerPanel('obs-cost-over-time', 'Cost Over Time', (el) =>
    renderTimeseriesChart(el, { field: 'cost', label: 'Cost (USD)', colorKey: 'cost' }));
  registerPanel('obs-token-usage', 'Token Usage', (el) =>
    renderTimeseriesChart(el, { field: 'tokens', label: 'Tokens', colorKey: 'tokens' }));
  registerPanel('obs-provider-spend', 'Provider Spend Breakdown', renderProviderSpendBreakdown);
}
