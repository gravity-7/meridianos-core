import { make, link, badge, instant, page, table, scopeText } from '../../shared/view-helpers.mjs';
import { inheritScope } from '../../shared/operational-scope.mjs';

export async function renderRoute(context) {
  const status = context.url.searchParams.get('status'); const severity = context.url.searchParams.get('severity');
  const data = await context.api.read('/alerts', { status, severity, cursor: context.url.searchParams.get('cursor') }); if (!context.isCurrent()) return;
  const view = page('Operational alerts', 'Canonical alert occurrences ordered by severity and recency. Acknowledged alerts remain visible.'); view.node.append(make('p', scopeText(context.scope), 'scope-summary'));
  const destination = (nextStatus, nextSeverity) => { const params = new URLSearchParams(); if (nextStatus) params.set('status', nextStatus); if (nextSeverity) params.set('severity', nextSeverity); return inheritScope(`/app/observability/alerts${params.size ? `?${params}` : ''}`, context.scope); };
  const filterContainer = make('div', null, 'alerts-filter-container');

  // Status Filter Section
  const statusSection = make('div', null, 'alert-filter-group');
  const statusLabel = make('div', null, 'filter-group-label');
  statusLabel.append(make('span', 'Lifecycle Status', 'filter-title'));
  const statusFilters = make('nav', null, 'subnav alert-pill-group'); statusFilters.setAttribute('aria-label', 'Alert status');
  for (const [value, label] of [[null,'All Statuses'],['open','Open'],['acknowledged','Acknowledged'],['resolved','Resolved']]) {
    const item = link(destination(value, severity), label);
    if ((status === value) || (!status && !value)) { item.classList.add('is-active'); item.setAttribute('aria-current', 'page'); }
    statusFilters.append(item);
  }
  statusSection.append(statusLabel, statusFilters);

  // Severity Filter Section
  const severitySection = make('div', null, 'alert-filter-group');
  const severityLabel = make('div', null, 'filter-group-label');
  severityLabel.append(make('span', 'Severity Level', 'filter-title'));
  const severityFilters = make('nav', null, 'subnav alert-pill-group'); severityFilters.setAttribute('aria-label', 'Alert severity');
  for (const [value, label] of [[null,'All Severities'],['critical','Critical'],['warning','Warning'],['info','Info']]) {
    const item = link(destination(status, value), label);
    if (value) item.classList.add(`sev-${value}`);
    if ((severity === value) || (!severity && !value)) { item.classList.add('is-active'); item.setAttribute('aria-current', 'page'); }
    severityFilters.append(item);
  }
  severitySection.append(severityLabel, severityFilters);

  filterContainer.append(statusSection, severitySection);
  view.node.append(filterContainer);
  const rows = data.items.map((alert) => [link(alert.drilldown.href, alert.title), badge(alert.severity, alert.severity), badge(alert.status, alert.status), alert.affectedEntity, String(alert.occurrenceCount), instant(alert.lastSeenAt)]);
  view.node.append(rows.length ? table(['Alert', 'Severity', 'Status', 'Affected entity', 'Occurrences', 'Last seen'], rows, 'Scoped operational alert occurrences') : make('p', 'No alerts match this scope and lifecycle filter.', 'empty-state'));
  if (data.nextCursor) { const params = new URLSearchParams(context.url.searchParams); params.set('cursor', data.nextCursor); view.node.append(link(`${context.url.pathname}?${params}`, 'Next alert page')); }
  context.root.replaceChildren(view.node);
}
