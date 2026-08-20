import { make, link, number, money, instant, page, table, definitionList, scopeText } from '../../shared/view-helpers.mjs';
import { renderOperationalChart } from '../../shared/chart-adapter.mjs';
import { inheritScope } from '../../shared/operational-scope.mjs';
import { dashboardPanel } from '../../shared/dashboard-panels.mjs';

const dimensions = ['provider','model','project','agent','task','run'];

export async function renderRoute(context) {
  const dimension = context.url.searchParams.get('dimension'); const value = context.url.searchParams.get('value');
  const [usage, records] = await Promise.all([context.api.read('/usage'), context.api.read('/usage-records', { dimension, value, cursor: context.url.searchParams.get('cursor') })]); if (!context.isCurrent()) return;
  const view = page('Usage records', 'Token aggregates and allowlisted gateway evidence supporting cost and operational drill-downs.'); view.node.append(make('p', scopeText(context.scope), 'scope-summary'));
  view.node.append(dashboardPanel(document, { title: 'Summary', kind: 'list' }, definitionList([['Input tokens', number(usage.summary.inputTokens)], ['Output tokens', number(usage.summary.outputTokens)], ['Cached tokens', number(usage.summary.cachedTokens)], ['Total tokens', number(usage.summary.totalTokens)], ['Requests', number(usage.summary.requests)], ['Unknown-token events', number(usage.summary.unknownTokenEvents)]])));
  const selectedDimension = dimensions.includes(dimension) ? dimension : 'provider'; const nav = make('nav', null, 'subnav'); nav.setAttribute('aria-label', 'Usage dimension'); for (const item of dimensions) nav.append(link(inheritScope(`/app/observability/usage?dimension=${item}`, context.scope), item[0].toUpperCase() + item.slice(1))); 
  const chartPanel = dashboardPanel(document, { title: 'Trend', kind: 'graph' }, nav); const chartTarget = make('div'); chartPanel.append(chartTarget); view.node.append(chartPanel);
  const ranking = usage.breakdowns[selectedDimension] ?? []; const tablePanel = dashboardPanel(document, { title: `Usage by ${selectedDimension}`, kind: 'table' }, ranking.length ? table([selectedDimension, 'Tokens', 'Cost (USD)', 'Requests', 'Unknown cost', 'Evidence'], ranking.map((row) => [row.key, number(row.tokens), money(row.cost), number(row.requests), number(row.unknownCostEvents), link(row.drilldown.href, `Open ${row.key} evidence`)]), `Usage breakdown by ${selectedDimension}`) : make('p', `No ${selectedDimension} usage drivers are available in this scope.`)); view.node.append(tablePanel);
  if (dimension && value) view.node.append(make('p', `Supporting records are filtered to ${dimension}: ${value}.`, 'notice'));
  const recordsPanel = dashboardPanel(document, { title: 'Supporting gateway records', kind: 'table' }, table(['Time', 'Outcome', 'Provider / model', 'Agent', 'Task', 'Run', 'Tokens', 'Cost'], records.items.map((row) => [instant(row.ts), row.outcome, `${row.provider ?? 'Unattributed'} / ${row.model ?? 'Unattributed'}`, row.agent ?? 'Unattributed', row.taskUrl ? link(row.taskUrl, row.taskId) : 'Unattributed', row.runUrl ? link(row.runUrl, row.runId) : 'Unattributed', number(row.totalTokens), money(row.costUsd)]), 'Allowlisted gateway usage records in newest-first order')); view.node.append(recordsPanel);
  if (records.nextCursor) { const params = new URLSearchParams(context.url.searchParams); params.set('cursor', records.nextCursor); view.node.append(link(`${context.url.pathname}?${params}`, 'Next usage-record page')); }
  view.node.append(link(`/api/operations/export?${new URLSearchParams({ ...Object.fromEntries(context.url.searchParams), view: 'usage' })}`, 'Export scoped usage records'));
  context.root.replaceChildren(view.node); const rendered = renderOperationalChart(chartTarget, { id: 'token-series', title: 'Total tokens over selected time', unit: 'tokens', points: usage.series.totalTokens.points, freshAsOf: usage.freshAsOf, scopeLabel: scopeText(context.scope), summary: `${number(usage.summary.totalTokens)} total tokens across ${number(usage.summary.requests)} requests; ${usage.series.totalTokens.aggregation}.` }); context.registerDispose(rendered.destroy);
}
