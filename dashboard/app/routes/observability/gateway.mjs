import { make, link, number, instant, page, scopeText, iconLabel, badge } from '../../shared/view-helpers.mjs';
import { renderOperationalChart } from '../../shared/chart-adapter.mjs';
import { inheritScope } from '../../shared/operational-scope.mjs';
import { dashboardPanel } from '../../shared/dashboard-panels.mjs';

function panelStat(documentRef, title, value, caption, badgeNode = null) {
  const panel = dashboardPanel(documentRef, { title, kind: 'stat' });
  const strong = make('strong', value == null ? '—' : String(value));
  const footer = make('div', null, 'panel-stat-footer');
  footer.append(make('span', caption ?? 'No data', 'stat-caption'));
  if (badgeNode) footer.append(badgeNode);
  panel.append(strong, footer);
  return panel;
}

const metrics = {
  requests: ['Requests', 'requests'],
  errorRate: ['Error rate', '%'],
  latencyP50: ['Median latency', 'ms'],
  latencyP95: ['95th percentile latency', 'ms']
};

export async function renderRoute(context) {
  const data = await context.api.read('/gateway');
  if (!context.isCurrent()) return;
  const selected = metrics[context.url.searchParams.get('metric')] ? context.url.searchParams.get('metric') : 'requests';
  const view = page('Gateway health and usage', 'Canonical gateway-ledger request, error, and latency evidence.');
  view.node.append(make('p', scopeText(context.scope), 'scope-summary'));

  // 6-Card Executive KPI Summary Grid
  const summaryGrid = make('div', null, 'gateway-summary-grid');
  summaryGrid.append(
    panelStat(document, 'Total Requests', number(data.summary.requests), 'selected scope'),
    panelStat(document, 'Errors', number(data.summary.errors), `${data.summary.errorRate}% error rate`, badge(data.summary.errors > 0 ? 'degraded' : 'ok', data.summary.errors > 0 ? 'warning' : 'ok')),
    panelStat(document, 'Error Rate', `${data.summary.errorRate}%`, 'error budget', badge(data.summary.errorRate > 5 ? 'critical' : data.summary.errorRate > 1 ? 'warning' : 'healthy', data.summary.errorRate > 5 ? 'critical' : data.summary.errorRate > 1 ? 'warning' : 'ok')),
    panelStat(document, 'Median Latency', data.summary.latencyP50 != null ? `${data.summary.latencyP50} ms` : '—', 'typical response (P50)'),
    panelStat(document, '95th Percentile', data.summary.latencyP95 != null ? `${data.summary.latencyP95} ms` : '—', 'tail latency SLA', badge(data.summary.latencyP95 >= 1000 ? 'breached' : data.summary.latencyP95 >= 500 ? 'warning' : 'sla met', data.summary.latencyP95 >= 1000 ? 'critical' : data.summary.latencyP95 >= 500 ? 'warning' : 'ok')),
    panelStat(document, 'Sample Integrity', data.summary.missingLatencySamples === 0 ? '100%' : `${number(data.summary.requests - data.summary.missingLatencySamples)} / ${number(data.summary.requests)}`, `${number(data.summary.missingLatencySamples)} missing`, badge(data.summary.missingLatencySamples === 0 ? 'recorded' : 'partial', data.summary.missingLatencySamples === 0 ? 'ok' : 'warning'))
  );

  // Hidden semantic list for screen-reader & test parity
  const semanticList = make('dl', null, 'panel-family-list definition-list visually-hidden');
  for (const [icon, label, value] of [
    ['topology', 'Requests', number(data.summary.requests)],
    ['alert-circle', 'Errors', number(data.summary.errors)],
    ['percent', 'Error rate', `${data.summary.errorRate}%`],
    ['clock', 'Median latency', `${data.summary.latencyP50 ?? 'Unknown'} ms`],
    ['clock', 'P95 latency', `${data.summary.latencyP95 ?? 'Unknown'} ms`],
    ['alert-circle', 'Missing latency samples', number(data.summary.missingLatencySamples)]
  ]) {
    const dt = make('dt', label);
    const dd = make('dd', value, 'panel-family-val');
    semanticList.append(dt, dd);
  }

  view.node.append(summaryGrid, semanticList);

  // Metric Switcher Subnav Toolbar
  const nav = make('nav', null, 'subnav');
  nav.setAttribute('aria-label', 'Gateway metric');
  for (const [key, [label]] of Object.entries(metrics)) {
    const item = link(inheritScope(`/app/observability/gateway?metric=${key}`, context.scope), label);
    if (key === selected) {
      item.classList.add('is-active');
      item.setAttribute('aria-current', 'page');
    }
    nav.append(item);
  }

  // Chart Panel & Action Bar
  const chartPanel = dashboardPanel(document, { title: metrics[selected][0], kind: 'graph', className: 'panel-full gateway-chart-panel' }, nav);
  const host = make('div');
  const actionsRow = make('div', null, 'gateway-chart-actions');
  const exportBtn = link(`/api/operations/export?${new URLSearchParams({ ...Object.fromEntries(context.url.searchParams), view: 'gateway' })}`, 'Export scoped gateway evidence', 'btn-secondary export-btn');
  const freshness = make('p', `Fresh as of ${instant(data.freshAsOf)}`, 'freshness');
  actionsRow.append(exportBtn, freshness);
  chartPanel.append(host, actionsRow);
  view.node.append(chartPanel);

  context.root.replaceChildren(view.node);

  const series = data.series[selected];
  const rendered = renderOperationalChart(host, {
    id: `gateway-${selected}`,
    title: metrics[selected][0],
    unit: metrics[selected][1],
    points: series.points,
    freshAsOf: series.freshAsOf ?? data.freshAsOf,
    scopeLabel: scopeText(context.scope),
    summary: `${metrics[selected][0]} uses ${series.aggregation}.`
  });
  context.registerDispose(rendered.destroy);
}
