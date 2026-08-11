import { make, link, badge, instant, page, table, scopeText } from '../../shared/view-helpers.mjs';
import { inheritScope } from '../../shared/operational-scope.mjs';

export async function renderRoute(context) {
  const status = context.url.searchParams.get('status'); const severity = context.url.searchParams.get('severity');
  const data = await context.api.read('/alerts', { status, severity, cursor: context.url.searchParams.get('cursor') }); if (!context.isCurrent()) return;
  const view = page('Operational alerts', 'Canonical alert occurrences ordered by severity and recency. Acknowledged alerts remain visible.'); view.node.append(make('p', scopeText(context.scope), 'scope-summary'));
  const destination = (nextStatus, nextSeverity) => { const params = new URLSearchParams(); if (nextStatus) params.set('status', nextStatus); if (nextSeverity) params.set('severity', nextSeverity); return inheritScope(`/app/observability/alerts${params.size ? `?${params}` : ''}`, context.scope); };
  const statusFilters = make('nav', null, 'subnav'); statusFilters.setAttribute('aria-label', 'Alert status');
  for (const [value, label] of [[null,'All statuses'],['open','Open'],['acknowledged','Acknowledged'],['resolved','Resolved']]) statusFilters.append(link(destination(value, severity), label));
  const severityFilters = make('nav', null, 'subnav'); severityFilters.setAttribute('aria-label', 'Alert severity');
  for (const [value, label] of [[null,'All severities'],['critical','Critical'],['warning','Warning'],['info','Info']]) severityFilters.append(link(destination(status, value), label));
  view.node.append(statusFilters, severityFilters);
  const rows = data.items.map((alert) => [link(alert.drilldown.href, alert.title), badge(alert.severity, alert.severity), badge(alert.status, alert.status), alert.affectedEntity, String(alert.occurrenceCount), instant(alert.lastSeenAt)]);
  view.node.append(rows.length ? table(['Alert', 'Severity', 'Status', 'Affected entity', 'Occurrences', 'Last seen'], rows, 'Scoped operational alert occurrences') : make('p', 'No alerts match this scope and lifecycle filter.', 'empty-state'));
  if (data.nextCursor) { const params = new URLSearchParams(context.url.searchParams); params.set('cursor', data.nextCursor); view.node.append(link(`${context.url.pathname}?${params}`, 'Next alert page')); }
  context.root.replaceChildren(view.node);
}
