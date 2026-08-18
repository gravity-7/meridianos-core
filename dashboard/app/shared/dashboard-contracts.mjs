export const WIDGET_STATES = Object.freeze(['loading', 'ready', 'empty', 'partial', 'stale', 'unavailable', 'error']);
export const TREND_METRICS = Object.freeze(['requests', 'errors', 'errorRate', 'latencyP50', 'latencyP95', 'tokens', 'cost']);

export function normalizeWidget(widget = {}) {
  const state = WIDGET_STATES.includes(widget.state) ? widget.state : 'unavailable';
  return { id: String(widget.id ?? 'widget'), title: String(widget.title ?? 'Operational widget'), kind: String(widget.kind ?? 'panel'), state, freshAsOf: widget.freshAsOf ?? null, scopeLabel: String(widget.scopeLabel ?? ''), summary: String(widget.summary ?? ''), drilldown: widget.drilldown ?? null };
}

export function normalizeTrend(series = {}) {
  const metric = TREND_METRICS.includes(series.metric) ? series.metric : 'requests';
  const points = Array.isArray(series.points) ? series.points.slice(0, 2000) : [];
  return { metric, unit: series.unit ?? 'value', points, aggregation: series.aggregation ?? 'none', freshAsOf: series.freshAsOf ?? null };
}
