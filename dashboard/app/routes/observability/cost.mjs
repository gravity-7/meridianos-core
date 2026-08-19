import { make, link, money, number, instant, page, table, definitionList, scopeText } from '../../shared/view-helpers.mjs';
import { renderOperationalChart } from '../../shared/chart-adapter.mjs';
import { inheritScope } from '../../shared/operational-scope.mjs';
import { dashboardPanel } from '../../shared/dashboard-panels.mjs';

const dimensions = ['provider','model','project','agent','task','run'];
export async function renderRoute(context) {
  const data = await context.api.read('/cost'); if (!context.isCurrent()) return; const dimension = dimensions.includes(context.url.searchParams.get('dimension')) ? context.url.searchParams.get('dimension') : 'provider';
  const view = page('Cost drivers and budget', 'Selected-scope spend and traceable provider, model, project, task, and run attribution from the canonical gateway ledger.'); view.node.append(make('p', scopeText(context.scope), 'scope-summary'));
  view.node.append(dashboardPanel(document, { title: 'Summary', kind: 'list' }, definitionList([['Selected-scope spend', money(data.summary.spend)], ['Unknown-cost events', number(data.summary.unknownCostEvents)], ['Currency', data.summary.currency], ['Current-month period', `${data.summary.budget.periodFrom} to ${data.summary.budget.periodTo}`], ['Current-month spend', money(data.summary.budget.spend)], ['Monthly limit', money(data.summary.budget.monthlyLimit)], ['Forecast (trailing-seven-day rule)', money(data.summary.budget.forecast)]]), make('p', data.summary.budget.periodLabel, 'notice')));
  const nav = make('nav', null, 'subnav'); nav.setAttribute('aria-label', 'Cost dimension'); for (const value of dimensions) nav.append(link(inheritScope(`/app/observability/cost?dimension=${value}`, context.scope), value[0].toUpperCase() + value.slice(1))); 
  const chartPanel = dashboardPanel(document, { title: 'Cost over selected time', kind: 'graph' }, nav); const chartTarget = make('div'); chartPanel.append(chartTarget); view.node.append(chartPanel);
  const ranking = data.breakdowns[dimension]; const tablePanel = dashboardPanel(document, { title: `Cost by ${dimension}`, kind: 'table' }, table([dimension, 'Cost (USD)', 'Tokens', 'Requests', 'Share', 'Unknown cost', 'Evidence'], ranking.map((row) => [row.key, money(row.cost), number(row.tokens), number(row.requests), `${row.share}%`, number(row.unknownCostEvents), link(row.drilldown.href, `Open ${row.key} usage records`)]), `Cost drivers by ${dimension}; totals reconcile to selected-scope spend within currency rounding.`)); view.node.append(tablePanel);
  view.node.append(link(`/api/operations/export?${new URLSearchParams({ ...Object.fromEntries(context.url.searchParams), view: 'cost' })}`, 'Export scoped cost evidence'), make('p', `Fresh as of ${instant(data.freshAsOf)}`, 'freshness'));
  context.root.replaceChildren(view.node); const rendered = renderOperationalChart(chartTarget, { id: 'cost-series', title: 'Cost over selected time', unit: 'USD', points: data.series.cost.points, freshAsOf: data.freshAsOf, scopeLabel: scopeText(context.scope), summary: `Selected-scope spend is ${money(data.summary.spend)}; ${data.series.cost.aggregation}.` }); context.registerDispose(rendered.destroy);
}
