import { make, link, badge, definitionList, money, number, instant, page, notice, scopeText, table, iconLabel } from '../../shared/view-helpers.mjs';
import { renderOperationalChart } from '../../shared/chart-adapter.mjs';
import { renderCircledMeter, dashboardPanel, renderPanelFamily } from '../../shared/dashboard-panels.mjs';
function panelStat(documentRef, title, value, caption, destination = null) {
  const panel = dashboardPanel(documentRef, { title, kind: 'stat' });
  const strong = make('strong', value == null ? '—' : String(value)); const footer = make('div', null, 'panel-stat-footer'); footer.append(make('span', caption ?? 'No data', 'stat-caption'));
  if (destination) { footer.append(link(destination.href, destination.label, 'panel-drilldown')); }
  panel.append(strong, footer); return panel;
}

function panelList(documentRef, title, items, emptyMessage) {
  const panel = dashboardPanel(documentRef, { title, kind: 'list', className: 'panel-list' });
  if (!items?.length) { panel.classList.add('panel-empty'); panel.append(make('strong', emptyMessage)); return panel; }
  const list = make('ul'); for (const item of items) { const row = make('li'); row.append(badge(item.severity, item.severity), make('span', ` ${item.title}`)); if (item.drilldown?.href) row.append(documentRef.createTextNode(' '), link(item.drilldown.href, 'Open')); list.append(row); } panel.append(list); return panel;
}

function trendHost(documentRef, title, metric, series, scope, unit, destination) {
  const host = make('div', null, 'dashboard-panel panel-graph');
  const target = make('div'); host.append(target);
  const rendered = renderOperationalChart(target, { id: `overview-${metric}`, title, unit, points: series?.points ?? [], freshAsOf: series?.freshAsOf, scopeLabel: scopeText(scope), summary: series?.points?.length ? `${title} uses ${series.aggregation ?? 'the selected scope aggregation'}.` : `No ${unit} data is available in this scope.` });
  if (destination) host.append(link(destination.href, destination.label, 'panel-drilldown'));
  return { host, rendered };
}

function familyPanel(documentRef, options) {
  const host = make('div'); renderPanelFamily(host, options); return host.firstElementChild;
}

export async function renderRoute(context) {
  const data = await context.api.read('/overview'); if (!context.isCurrent()) return;
  const view = page('Operational overview', 'High-signal operations, spend, and system health in one scoped dashboard.');
  const toolbar = make('div', null, 'dashboard-toolbar'); toolbar.append(make('p', scopeText(context.scope), 'scope-summary'), make('p', `Fresh as of ${instant(data.freshAsOf)}`, 'freshness')); view.node.append(toolbar);

  const attention = make('section', null, 'attention-region dashboard-panel panel-full'); attention.append(make('h2', 'Attention now'));
  if (!data.attention.length) attention.append(notice(data.attentionSummary));
  else { const list = make('ol', null, 'attention-list'); for (const item of data.attention) { const row = make('li', null, `attention-item severity-${item.severity}`); row.append(badge(item.severity, item.severity), make('strong', item.title), make('p', item.summary), make('p', `Affected: ${item.affectedEntity} · Last seen ${instant(item.lastSeenAt)} · ${number(item.occurrenceCount)} occurrence(s)`, 'muted'), link(item.drilldown.href, item.drilldown.label)); list.append(row); } attention.append(list); }
  view.node.append(attention);

  const grid = make('div', null, 'dashboard-grid');
  grid.append(
    panelStat(document, 'Requests', data.health.requests, 'selected scope', data.health.drilldown),
    panelStat(document, 'Errors', data.health.errors, `${data.health.errorRate}% error rate`, data.health.drilldown),
    panelStat(document, 'Active agents', data.work.activeAgents, 'current leases', data.work.drilldowns.tasks),
    panelStat(document, 'Queued tasks', data.work.queuedTasks, 'awaiting work', data.work.drilldowns.tasks),
    panelStat(document, 'Failed runs', data.work.failedRuns, 'selected interval', data.work.drilldowns.runs),
    panelStat(document, 'Blocked tasks', data.work.blockedTasks, 'requires review', data.work.drilldowns.tasks),
  );

  const costMeter = make('div'); const costMax = Number(data.cost.budget?.monthlyLimit) > 0 ? Number(data.cost.budget.monthlyLimit) : Number(data.cost.spend) > 0 ? Number(data.cost.spend) : 0; renderCircledMeter(costMeter, { id: 'overview-cost-meter', title: 'Cost used', value: costMax ? Number(data.cost.spend) : null, max: costMax, unit: 'USD', status: costMax ? undefined : 'empty' }); grid.append(Object.assign(costMeter, { className: 'dashboard-panel panel-meter' }));
  const tokenValue = Number(data.usage?.totalTokens) || 0; const tokenMax = tokenValue ? Math.ceil(tokenValue * 1.2) : 0; const tokenMeter = make('div'); renderCircledMeter(tokenMeter, { id: 'overview-token-meter', title: 'Tokens used', value: tokenMax ? tokenValue : null, max: tokenMax, unit: 'tokens', status: tokenMax ? undefined : 'empty' }); grid.append(Object.assign(tokenMeter, { className: 'dashboard-panel panel-meter' }));
  const budgetLimit = Number(data.cost.budget?.monthlyLimit) || 0; const budgetMeter = make('div'); renderCircledMeter(budgetMeter, { id: 'overview-budget-meter', title: 'Budget consumed', value: budgetLimit ? Number(data.cost.spend) : null, max: budgetLimit, unit: 'USD', status: budgetLimit ? undefined : 'empty' }); grid.append(Object.assign(budgetMeter, { className: 'dashboard-panel panel-meter' }));

  const latencyRows = (data.trends?.latencyP95?.points ?? []).slice(-24).map((point, index) => {
    const value = Number(point.value); const level = !Number.isFinite(value) ? 'empty' : value >= 1000 ? 'critical' : value >= 500 ? 'warning' : 'ok'; return { level, label: `Latency sample ${index + 1}: ${Number.isFinite(value) ? `${value} ms` : 'No data'}` };
  });
  const errorRateGauge = familyPanel(document, { title: 'Error rate gauge', kind: 'bar-gauge', value: `${data.health.errorRate}%`, percent: data.health.errorRate, caption: `${data.health.requests} requests in scope`, href: data.health.drilldown.href, linkLabel: 'Open gateway evidence' });
  errorRateGauge.classList.add('span-3');
  const latencyHeatmap = familyPanel(document, { title: 'Latency heatmap', kind: 'heatmap', rows: latencyRows, emptyMessage: 'No latency samples in this scope.', href: '/app/observability/gateway?metric=latencyP95', linkLabel: 'Open latency evidence' });
  latencyHeatmap.style.gridColumn = '1 / -1';
  const budgetSignals = familyPanel(document, { title: 'Budget signals', kind: 'table', rows: [
    { label: 'Spend', value: money(data.cost.spend) },
    { label: 'Monthly limit', value: data.cost.budget?.monthlyLimit ? money(data.cost.budget.monthlyLimit) : 'Not configured' },
    { label: 'Forecast', value: data.cost.budget?.forecast == null ? 'Not available' : money(data.cost.budget.forecast) },
  ], href: data.cost.drilldown.href, linkLabel: 'Open cost drivers' });
  budgetSignals.classList.add('span-5');

  const recentActivity = familyPanel(document, { title: 'Recent activity', kind: 'list', rows: (data.attention ?? []).slice(0, 5).map((item) => ({ label: item.title, value: item.severity })), emptyMessage: 'No recent alerts in this scope.', href: '/app/observability/alerts', linkLabel: 'Open alert list' });
  recentActivity.classList.add('span-4');

  grid.append(errorRateGauge, budgetSignals, recentActivity, latencyHeatmap);

  const requests = trendHost(document, 'Request volume', 'requests', data.trends?.requests, context.scope, 'requests', data.health.drilldown); grid.append(requests.host); context.registerDispose(requests.rendered.destroy);
  const latency = trendHost(document, 'Latency P95', 'latency-p95', data.trends?.latencyP95, context.scope, 'ms', { href: '/app/observability/gateway?metric=latencyP95', label: 'Open latency evidence' }); grid.append(latency.host); context.registerDispose(latency.rendered.destroy);
  const spend = trendHost(document, 'Cost over time', 'cost', data.trends?.cost, context.scope, 'USD', data.cost.drilldown); grid.append(spend.host); context.registerDispose(spend.rendered.destroy);
  const tokenTrend = trendHost(document, 'Token usage', 'tokens', data.trends?.tokens, context.scope, 'tokens', { href: '/app/observability/usage', label: 'Open token evidence' }); grid.append(tokenTrend.host); context.registerDispose(tokenTrend.rendered.destroy);
  const driverPanel = familyPanel(document, { title: iconLabel('dashboard-grid', 'Operational snapshot', { size: '1.35rem', strokeWidth: 2.5, color: 'inherit' }), kind: 'list', rows: [
    { label: iconLabel('topology', 'Gateway state'), value: badge(data.health.state, data.health.state) },
    { label: iconLabel('database', 'Spend'), value: money(data.cost.spend) },
    { label: iconLabel('layout-dashboard', 'Budget period'), value: data.cost.budget?.periodLabel ?? 'Unknown' },
    { label: iconLabel('chart-bars', 'Usage requests'), value: number(data.usage?.requests ?? 0) }
  ], href: '/app/observability/cost', linkLabel: 'Open cost drivers' });
  driverPanel.style.gridColumn = '1 / -1';
  grid.append(driverPanel);
  view.node.append(grid);
  context.root.replaceChildren(view.node);
}
