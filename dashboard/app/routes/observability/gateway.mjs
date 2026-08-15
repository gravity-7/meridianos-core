import { make, link, number, instant, page, definitionList, scopeText } from '../../shared/view-helpers.mjs';
import { renderOperationalChart } from '../../shared/chart-adapter.mjs';
import { inheritScope } from '../../shared/operational-scope.mjs';

const metrics = { requests: ['Requests', 'requests'], errorRate: ['Error rate', '%'], latencyP50: ['Median latency', 'ms'], latencyP95: ['95th percentile latency', 'ms'] };
export async function renderRoute(context) {
  const data = await context.api.read('/gateway'); if (!context.isCurrent()) return; const selected = metrics[context.url.searchParams.get('metric')] ? context.url.searchParams.get('metric') : 'requests';
  const view = page('Gateway health and usage', 'Canonical gateway-ledger request, error, and latency evidence.'); view.node.append(make('p', scopeText(context.scope), 'scope-summary'));
  view.node.append(definitionList([['Requests', number(data.summary.requests)], ['Errors', number(data.summary.errors)], ['Error rate', `${data.summary.errorRate}%`], ['Median latency', `${data.summary.latencyP50 ?? 'Unknown'} ms`], ['P95 latency', `${data.summary.latencyP95 ?? 'Unknown'} ms`], ['Missing latency samples', number(data.summary.missingLatencySamples)]]));
  const nav = make('nav', null, 'subnav'); nav.setAttribute('aria-label', 'Gateway metric'); for (const [key,[label]] of Object.entries(metrics)) nav.append(link(inheritScope(`/app/observability/gateway?metric=${key}`, context.scope), label)); view.node.append(nav);
  const host = make('div'); view.node.append(host, link(`/api/operations/export?${new URLSearchParams({ ...Object.fromEntries(context.url.searchParams), view: 'gateway' })}`, 'Export scoped gateway evidence'), make('p', `Fresh as of ${instant(data.freshAsOf)}`, 'freshness'));
  context.root.replaceChildren(view.node); const series = data.series[selected]; const rendered = renderOperationalChart(host, { id: `gateway-${selected}`, title: metrics[selected][0], unit: metrics[selected][1], points: series.points, freshAsOf: series.freshAsOf ?? data.freshAsOf, scopeLabel: scopeText(context.scope), summary: `${metrics[selected][0]} uses ${series.aggregation}.` }); context.registerDispose(rendered.destroy);
}
