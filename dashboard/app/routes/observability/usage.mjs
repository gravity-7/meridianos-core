import { make, link, number, money, instant, page, table, scopeText, iconLabel, badge } from '../../shared/view-helpers.mjs';
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

const dimensions = ['provider','model','project','agent','task','run'];

export async function renderRoute(context) {
  const dimension = context.url.searchParams.get('dimension'); const value = context.url.searchParams.get('value');
  const [usage, records] = await Promise.all([context.api.read('/usage'), context.api.read('/usage-records', { dimension, value, cursor: context.url.searchParams.get('cursor') })]); if (!context.isCurrent()) return;
  const view = page('Usage records', 'Token aggregates and allowlisted gateway evidence supporting cost and operational drill-downs.'); view.node.append(make('p', scopeText(context.scope), 'scope-summary'));

  // 1. Executive 6-Card Token & Volume KPI Grid
  const summaryGrid = make('div', null, 'usage-summary-grid');
  const totalToks = usage.summary.totalTokens || 0;
  const inputPct = totalToks ? Math.round((usage.summary.inputTokens / totalToks) * 100) : 0;
  const outputPct = totalToks ? Math.round((usage.summary.outputTokens / totalToks) * 100) : 0;
  const cachedPct = totalToks ? Math.round((usage.summary.cachedTokens / totalToks) * 100) : 0;

  summaryGrid.append(
    panelStat(document, 'Total Tokens', number(usage.summary.totalTokens), 'selected scope'),
    panelStat(document, 'Input Tokens', number(usage.summary.inputTokens), `${inputPct}% of total`, badge('prompt', 'info')),
    panelStat(document, 'Output Tokens', number(usage.summary.outputTokens), `${outputPct}% of total`, badge('generation', 'info')),
    panelStat(document, 'Cached Tokens', number(usage.summary.cachedTokens), `${cachedPct}% cache hit`, badge('cache savings', 'ok')),
    panelStat(document, 'Total Requests', number(usage.summary.requests), 'gateway calls'),
    panelStat(document, 'Token Integrity', usage.summary.unknownTokenEvents === 0 ? '100%' : `${number(usage.summary.unknownTokenEvents)} unmetered`, 'untracked token events', badge(usage.summary.unknownTokenEvents === 0 ? 'tracked' : 'partial', usage.summary.unknownTokenEvents === 0 ? 'ok' : 'warning'))
  );

  const semanticList = make('dl', null, 'panel-family-list definition-list visually-hidden');
  for (const [label, val] of [
    ['Input tokens', number(usage.summary.inputTokens)],
    ['Output tokens', number(usage.summary.outputTokens)],
    ['Cached tokens', number(usage.summary.cachedTokens)],
    ['Total tokens', number(usage.summary.totalTokens)],
    ['Requests', number(usage.summary.requests)],
    ['Unknown-token events', number(usage.summary.unknownTokenEvents)]
  ]) {
    semanticList.append(make('dt', label), make('dd', val, 'panel-family-val'));
  }
  view.node.append(summaryGrid, semanticList);

  // 2. Active Dimension Switcher
  const selectedDimension = dimensions.includes(dimension) ? dimension : 'provider';
  const nav = make('nav', null, 'subnav');
  nav.setAttribute('aria-label', 'Usage dimension');
  for (const item of dimensions) {
    const filterLink = link(inheritScope(`/app/observability/usage?dimension=${item}`, context.scope), item[0].toUpperCase() + item.slice(1));
    if (item === selectedDimension) {
      filterLink.classList.add('is-active');
      filterLink.setAttribute('aria-current', 'page');
    }
    nav.append(filterLink);
  }

  // 3. Trend Chart
  const chartPanel = dashboardPanel(document, { title: 'Total tokens over selected time', kind: 'graph', className: 'panel-full' }, nav);
  const chartTarget = make('div');
  chartPanel.append(chartTarget);
  view.node.append(chartPanel);

  // 4. Usage by Dimension Table
  const ranking = usage.breakdowns[selectedDimension] ?? [];
  const tablePanel = dashboardPanel(document, { title: `Usage by ${selectedDimension}`, kind: 'table' }, ranking.length ? table([selectedDimension, 'Tokens', 'Cost (USD)', 'Requests', 'Unknown cost', 'Evidence'], ranking.map((row) => [
    row.key,
    number(row.tokens),
    money(row.cost),
    number(row.requests),
    row.unknownCostEvents > 0 ? badge(`${number(row.unknownCostEvents)} unpriced`, 'warning') : badge('none', 'ok'),
    link(row.drilldown.href, 'View records →', 'drilldown-link')
  ]), `Usage breakdown by ${selectedDimension}`) : make('p', `No ${selectedDimension} usage drivers are available in this scope.`));
  view.node.append(tablePanel);

  if (dimension && value) view.node.append(make('p', `Supporting records are filtered to ${dimension}: ${value}.`, 'notice'));

  // 5. Supporting Records Table
  const recordsPanel = dashboardPanel(document, { title: 'Supporting gateway records', kind: 'table' }, table(['Time', 'Outcome', 'Provider / model', 'Agent', 'Task', 'Run', 'Tokens', 'Cost'], records.items.map((row) => [
    instant(row.ts),
    badge(row.outcome, row.outcome === 'ok' ? 'ok' : 'failed'),
    make('span', `${row.provider ?? 'Unattributed'} / ${row.model ?? 'Unattributed'}`, 'entity-tag'),
    row.agent ?? 'Unattributed',
    row.taskUrl ? link(row.taskUrl, row.taskId, 'drilldown-link') : 'Unattributed',
    row.runUrl ? link(row.runUrl, row.runId, 'drilldown-link') : 'Unattributed',
    number(row.totalTokens),
    money(row.costUsd)
  ]), 'Allowlisted gateway usage records in newest-first order'));

  // 6. Actions & Pagination
  const actionsRow = make('div', null, 'gateway-chart-actions');
  const exportBtn = link(`/api/operations/export?${new URLSearchParams({ ...Object.fromEntries(context.url.searchParams), view: 'usage' })}`, 'Export scoped usage records', 'btn-secondary export-btn');
  const freshness = make('p', `Fresh as of ${instant(usage.freshAsOf)}`, 'freshness');
  actionsRow.append(exportBtn, freshness);
  recordsPanel.append(actionsRow);

  if (records.nextCursor) {
    const params = new URLSearchParams(context.url.searchParams);
    params.set('cursor', records.nextCursor);
    recordsPanel.append(link(`${context.url.pathname}?${params}`, 'Next usage-record page →', 'btn-secondary'));
  }

  view.node.append(recordsPanel);
  context.root.replaceChildren(view.node);

  const rendered = renderOperationalChart(chartTarget, {
    id: 'token-series',
    title: 'Total tokens over selected time',
    unit: 'tokens',
    points: usage.series.totalTokens.points,
    freshAsOf: usage.freshAsOf,
    scopeLabel: scopeText(context.scope),
    summary: `${number(usage.summary.totalTokens)} total tokens across ${number(usage.summary.requests)} requests; ${usage.series.totalTokens.aggregation}.`
  });
  context.registerDispose(rendered.destroy);
}
