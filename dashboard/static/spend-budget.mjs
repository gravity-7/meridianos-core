/**
 * spend-budget — 010 Frontend ES Module Migration, US3. Analytics KPI tiles, budget-intelligence
 * card, provider-spend-7d card, and founder-usage card — already confirmed non-duplicate content by
 * 009's US1 (T017) direct code comparison against the themed uPlot observability panels, so this
 * just gives that content a real module home rather than re-litigating that analysis.
 *
 * Self-registers with poll-dispatcher.mjs for fetchAnalytics/fetchBudget, same as US4/US5/US6 —
 * dashboard-bootstrap.mjs (US9) won't need to know this area exists beyond importing it once.
 * `fmt()` stays in dashboard/index.html (a page-level display helper, not one of the migrated
 * functions) — reached here via `window.fmt`, the same bridge policy-levers.mjs's syncReadouts uses.
 */
import { esc, formatSpend, formatNumber } from './dashboard-utils.mjs';
import { reportError } from './client-error-log.mjs';
import { registerPollHandler } from './poll-dispatcher.mjs';

export function renderFounderUsage(b) {
  const el = document.getElementById('founderUsage'); if (!el || !b) return;
  const roster = Object.keys(b.mayClaim || {});
  const anyFounder = roster.some(a => b[a] && b[a].founder);
  if (!anyFounder) { el.textContent = 'founder usage · —'; return; }
  const pair = (f) => f ? `<span class="mono">${window.fmt(f.last5h.billable)}</span> 5h / <span class="mono">${window.fmt(f.last7d.billable)}</span> wk` : '—';
  const parts = roster.map(a => `${esc(a)} ${pair(b[a] && b[a].founder)}`);
  el.innerHTML = `founder usage (read-only, ${esc(b.attribution === 'total' ? 'counted in the gauges above' : 'not gated')}) · ${parts.join(' · ')}`;
}

export function renderProviderCost(last7d) {
  const el = document.getElementById('providerCostGrid'); if (!el) return;
  const entries = Object.entries(last7d || {}).sort((a, b) => (b[1].cost || 0) - (a[1].cost || 0));
  if (!entries.length) { el.innerHTML = '<div style="font-size:12px;color:var(--text-muted)">no provider spend recorded</div>'; return; }
  el.innerHTML = entries.map(([name, p]) => {
    const costStr = p.cost > 0 ? formatSpend(p.cost) : (p.costUnknownRuns > 0 ? `— (${p.costUnknownRuns} runs unpriced)` : '$0.00');
    return `<div class="tile"><div style="font-size:12px;color:var(--text-secondary)">${esc(name)}</div>` +
      `<div style="display:flex;align-items:baseline;gap:4px"><span class="mono" style="font-size:22px;font-weight:500">${costStr}</span></div>` +
      `<div class="mono" style="font-size:11px;color:var(--text-muted)">${window.fmt(p.billable)} tok · ${p.runs} run${p.runs === 1 ? '' : 's'}</div></div>`;
  }).join('');
}

let analyticsRangeDays = 30;

export function setAnalyticsRange(days, fetchNow = true) {
  analyticsRangeDays = days;
  document.querySelectorAll('.ar-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.ar-btn[data-range="${days}"]`)?.classList.add('active');
  const labels = {1:'Today',7:'7 days',30:'30 days',90:'90 days'};
  document.getElementById('analyticsDateRange').textContent = '· last ' + (labels[days]||days+'d');
  if (fetchNow) fetchAnalytics();
}
window.setAnalyticsRange = setAnalyticsRange;

// 009 — Dashboard Modernization (US1/FR-002): the hand-rolled LineChart/DonutChart canvas classes
// that used to render here were removed — superseded by the themed uPlot panels in the Settings &
// Observability workspace (observability-panels.mjs). See fetchAnalytics() below for the KPI-tile
// logic that stayed, and dashboard-source-quality.test.mjs for the regression guard.

export async function fetchAnalytics() {
  const from = new Date(Date.now()-analyticsRangeDays*86400000).toISOString();
  const to = new Date().toISOString();
  try {
    document.getElementById('analyticsLoading').style.display='block';
    document.getElementById('analyticsEmpty').style.display='none';
    document.getElementById('analyticsError').style.display='none';

    // 009 — Dashboard Modernization (US1/FR-002): only `overview` is fetched now — timeseries/
    // breakdown were fetched solely to feed the removed LineChart/DonutChart canvases; that same
    // data is now rendered by the themed uPlot panels in the Settings & Observability workspace,
    // which fetch it themselves (observability-panels.mjs). Fetching it here too would just be
    // redundant network traffic for data nothing on this page uses anymore.
    const ovr = await fetch(`/api/analytics/overview?from=${from}&to=${to}`).then(r=>r.json());

    document.getElementById('analyticsLoading').style.display='none';

    if (!ovr.totalSpend && !ovr.totalTokens && !ovr.totalApiCalls) {
      document.getElementById('analyticsEmpty').style.display='block';
      return;
    }

    // KPI cards
    document.getElementById('kvTotalSpend').textContent = formatSpend(ovr.totalSpend||0);
    document.getElementById('kvChange').textContent = ovr.spendChangePct!=null ? (ovr.spendChangePct>=0?'+':'')+ovr.spendChangePct+'%' : '—';
    document.getElementById('kvChange').style.color = ovr.spendChangePct>0?'var(--text-danger)':(ovr.spendChangePct<0?'var(--text-success)':'');
    document.getElementById('kvTokens').textContent = formatNumber(ovr.totalTokens||0);
    document.getElementById('kvCalls').textContent = formatNumber(ovr.totalApiCalls||0);
    document.getElementById('kvTopProvider').textContent = ovr.topProvider ? `${ovr.topProvider.name} (${ovr.topProvider.pct}%)` : '—';
    document.getElementById('kvTopModel').textContent = ovr.topModel ? ovr.topModel.name.split('-').slice(0,3).join('-') : '—';

  } catch(e) {
    document.getElementById('analyticsLoading').style.display='none';
    document.getElementById('analyticsError').style.display='block';
    console.error('Analytics fetch error:', e);
  }
}

export function exportAnalyticsCSV() {
  const from = new Date(Date.now()-analyticsRangeDays*86400000).toISOString();
  const to = new Date().toISOString();
  const a = document.createElement('a');
  a.href = `/api/analytics/export?from=${from}&to=${to}`;
  a.download = `analytics-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}
window.exportAnalyticsCSV = exportAnalyticsCSV;

// ─── P5: Budget Intelligence (T042) ────────────────────────────────────────

export async function fetchBudget() {
  try {
    const r = await fetch('/api/analytics/budget').then(r=>r.json());
    document.getElementById('bvSpend').textContent = formatSpend(r.spendToDate||0);
    document.getElementById('bvForecast').textContent = formatSpend(r.projectedTotal||0);
    document.getElementById('bvBurn').textContent = 'burn: '+formatSpend(r.dailyBurnRate||0)+'/day';
    document.getElementById('bvPct').textContent = (r.pctUsed||0)+'% of $'+(r.budget?.amount||0);
    document.getElementById('budgetMeter').style.width = Math.min(100, r.pctUsed||0)+'%';
    if (r.pctUsed > 90) document.getElementById('budgetMeter').style.background = 'var(--fill-danger)';
    else if (r.pctUsed > 70) document.getElementById('budgetMeter').style.background = 'var(--text-warning)';

    document.getElementById('bvStatus').textContent = r.status||'on-track';
    if (r.status === 'over-budget') document.getElementById('bvStatus').style.color = 'var(--text-danger)';
    else if (r.status === 'at-risk') document.getElementById('bvStatus').style.color = 'var(--text-warning)';
    else document.getElementById('bvStatus').style.color = 'var(--text-success)';

    document.getElementById('budgetStatus').textContent = '· '+(r.status||'on-track')+' · '+formatSpend(r.spendToDate||0)+' / '+formatSpend(r.budget?.amount||0);

    // Spend pause state
    try {
      const pr = await fetch('/api/analytics/spend-pause').then(r=>r.json());
      if (pr.isPaused) {
        document.getElementById('pauseSpendBtn').textContent = '▶ Resume AI Spend';
        document.getElementById('pauseSpendBtn').style.background = 'var(--bg-success)';
        document.getElementById('pauseSpendBtn').style.color = 'var(--text-success)';
        document.getElementById('pauseReason').textContent = 'Paused: '+(pr.reason||'manual');
      } else {
        document.getElementById('pauseSpendBtn').textContent = '⏸ Pause AI Spend';
        document.getElementById('pauseSpendBtn').style.background = 'var(--bg-danger)';
        document.getElementById('pauseSpendBtn').style.color = 'var(--text-danger)';
        document.getElementById('pauseReason').textContent = '';
      }
    } catch (e) { reportError('fetchBudget-spendPause', e, { severity: 'info' }); }
  } catch (e) { reportError('fetchBudget', e); }
}

export async function toggleSpendPause() {
  const btn = document.getElementById('pauseSpendBtn');
  const isPaused = btn.textContent.includes('Resume');
  const action = isPaused ? 'resume' : 'pause';
  const reason = action === 'pause' ? prompt('Reason for pausing AI spend?') || 'Manual pause' : '';
  try {
    const r = await fetch('/api/analytics/spend-pause', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-aios-token': '__AIOS_TOKEN__' },
      body: JSON.stringify({ action, reason }),
    }).then(r=>r.json());
    fetchBudget();
  } catch(e) { alert('Failed: '+e.message); }
}
window.toggleSpendPause = toggleSpendPause;

// ─── P5: Alerts (T052) ─────────────────────────────────────────────────────

export async function testAlert() {
  document.getElementById('testAlertResult').textContent = 'Sending...';
  try {
    const r = await fetch('/api/analytics/alerts/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-aios-token': '__AIOS_TOKEN__' },
      body: '{}',
    }).then(r=>r.json());
    document.getElementById('testAlertResult').textContent = r.ok ? '✓ Sent to '+r.results.length+' channel(s)' : '✗ '+r.error;
    // Refresh alert history
    try {
      const ar = await fetch('/api/analytics/alerts/config').then(r=>r.json());
      document.getElementById('alertsSummary').textContent = '· '+(ar.channels||[]).length+' channel(s), '+(ar.rules||[]).length+' rule(s)';
    } catch (e) { reportError('testAlert-refreshConfig', e, { severity: 'info' }); }
  } catch(e) { document.getElementById('testAlertResult').textContent = '✗ '+e.message; reportError('testAlert', e); }
}
window.testAlert = testAlert;

registerPollHandler(fetchAnalytics);
registerPollHandler(fetchBudget);

// Auto-load on page open — must be here, after analyticsRangeDays/setAnalyticsRange are defined.
// fetchNow=false: the startup poll() cycle (see dashboard/index.html's startPolling()) already
// fetches analytics once fully chained, so fetching here too would just double the request on
// every page load.
setAnalyticsRange(7, false);
