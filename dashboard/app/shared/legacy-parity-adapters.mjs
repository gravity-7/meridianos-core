import { normalizeTrend, normalizeWidget } from './dashboard-contracts.mjs';
import { dashboardPanel, renderCircledMeter } from './dashboard-panels.mjs';

const emptySeries = (metric, unit = 'count') => ({ metric, unit, points: [], aggregation: 'none', freshAsOf: null });

/** Normalize legacy read-model names into the stable root-board contract. */
export function buildDashboardBoard({ scope = null, overview = {}, gateway = {}, usage = {}, cost = {}, alerts = [], work = {} } = {}) {
  const health = overview.health ?? gateway.summary ?? {};
  const trends = overview.trends ?? {};
  const board = {
    scope,
    attention: overview.attention ?? alerts,
    health: {
      state: health.state ?? (health.errors ? 'degraded' : health.requests ? 'healthy' : 'empty'),
      requests: health.requests ?? 0,
      errors: health.errors ?? 0,
      errorRate: health.errorRate ?? 0,
      drilldown: health.drilldown ?? null,
    },
    work: {
      activeAgents: work.activeAgents ?? overview.work?.activeAgents ?? 0,
      queuedTasks: work.queuedTasks ?? overview.work?.queuedTasks ?? 0,
      failedRuns: work.failedRuns ?? overview.work?.failedRuns ?? 0,
      blockedTasks: work.blockedTasks ?? overview.work?.blockedTasks ?? 0,
      drilldowns: work.drilldowns ?? overview.work?.drilldowns ?? {},
    },
    cost: { ...(overview.cost ?? cost.summary ?? cost), drilldown: overview.cost?.drilldown ?? null },
    usage: overview.usage ?? usage.summary ?? usage,
    trends: {
      requests: normalizeTrend(trends.requests ?? gateway.series?.requests ?? emptySeries('requests')),
      errorRate: normalizeTrend(trends.errorRate ?? gateway.series?.errorRate ?? emptySeries('errorRate', '%')),
      latencyP50: normalizeTrend(trends.latencyP50 ?? gateway.series?.latencyP50 ?? emptySeries('latencyP50', 'ms')),
      latencyP95: normalizeTrend(trends.latencyP95 ?? gateway.series?.latencyP95 ?? emptySeries('latencyP95', 'ms')),
      tokens: normalizeTrend(trends.tokens ?? usage.series?.totalTokens ?? emptySeries('tokens', 'tokens')),
      cost: normalizeTrend(trends.cost ?? cost.series?.cost ?? emptySeries('cost', 'USD')),
    },
    freshAsOf: overview.freshAsOf ?? gateway.freshAsOf ?? usage.freshAsOf ?? cost.freshAsOf ?? null,
  };
  return board;
}

/** Render a widget state while keeping an equivalent semantic text surface. */
export function renderDashboardWidget(host, widget = {}) {
  const documentRef = host.ownerDocument ?? document;
  const normalized = normalizeWidget(widget);
  if (normalized.kind === 'meter') {
    renderCircledMeter(host, normalized);
  } else {
    const panel = dashboardPanel(documentRef, { title: normalized.title ?? 'Metric', kind: normalized.kind ?? 'panel' });
    const status = documentRef.createElement('p'); status.className = 'widget-status'; status.textContent = normalized.state === 'ready' ? normalized.summary ?? 'Ready.' : normalized.state === 'empty' ? 'No data in this scope.' : normalized.state === 'loading' ? 'Loading…' : normalized.state === 'error' ? 'Unable to load this metric.' : 'Metric unavailable.';
    panel.append(status); host.replaceChildren(panel);
  }
  return { destroy: () => host.replaceChildren() };
}
