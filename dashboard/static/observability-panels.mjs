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

async function renderTimeseriesChart(el, { field, label, color, groupBy = 'provider' }) {
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

  // eslint-disable-next-line no-undef -- uPlot is a vendored global script, not an ES import
  new uPlot(
    {
      width: el.clientWidth || 380,
      height: 220,
      series: [{}, { label, stroke: color, width: 2, fill: `${color}22` }],
      axes: [
        { stroke: 'var(--text-muted, #888)', grid: { stroke: 'rgba(128,128,128,0.15)' } },
        { stroke: 'var(--text-muted, #888)', grid: { stroke: 'rgba(128,128,128,0.15)' } },
      ],
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
  el.innerHTML = totals
    .map(
      (t) => `
    <div style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:2px">
        <span>${t.provider}</span><span class="mono">$${t.cost.toFixed(4)}</span>
      </div>
      <div style="background:var(--surface-1);border-radius:4px;height:8px;overflow:hidden">
        <div style="background:var(--fill-accent,#3b82f6);height:100%;width:${Math.max(2, (t.cost / max) * 100)}%"></div>
      </div>
    </div>`,
    )
    .join('');
}

export function registerObservabilityPanels() {
  registerPanel('obs-cost-over-time', 'Cost Over Time', (el) =>
    renderTimeseriesChart(el, { field: 'cost', label: 'Cost (USD)', color: 'var(--text-accent, #4f8cff)' }));
  registerPanel('obs-token-usage', 'Token Usage', (el) =>
    renderTimeseriesChart(el, { field: 'tokens', label: 'Tokens', color: 'var(--text-success, #16a34a)' }));
  registerPanel('obs-provider-spend', 'Provider Spend Breakdown', renderProviderSpendBreakdown);
}
