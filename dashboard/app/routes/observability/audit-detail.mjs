import { make, badge, instant, page, scopeText, iconLabel, listPanel } from '../../shared/view-helpers.mjs';

export async function renderRoute(context) {
  const data = await context.api.read(`/audit/${encodeURIComponent(context.route.params.auditId)}`); if (!context.isCurrent()) return;
  const view = page(`Audit evidence ${data.id}`, 'Immutable evidence for one operational lifecycle or remediation event.'); view.node.append(make('p', scopeText(context.scope), 'scope-summary'));
  view.node.append(listPanel(document, {
    title: iconLabel('shield-check', 'Audit event properties', { size: '1.25rem', strokeWidth: 2.2, color: 'inherit' }),
    rows: [
      { label: iconLabel('shield-check', 'Event'), value: data.event_type },
      { label: iconLabel('shield-check', 'Result'), value: badge(data.result, data.result) },
      { label: iconLabel('clock', 'Time'), value: instant(data.created_at) },
      { label: iconLabel('users', 'Actor'), value: data.actor_id },
      { label: iconLabel('users', 'Actor role'), value: data.actor_role },
      { label: iconLabel('shield-check', 'Authorized tenant'), value: data.tenant_id },
      { label: iconLabel('layout-dashboard', 'Authorized project'), value: data.project_id ?? 'All authorized projects' },
      { label: iconLabel('plug', 'Target'), value: `${data.target_type}: ${data.target_id}` },
      { label: iconLabel('layers', 'Before'), value: JSON.stringify(data.before ?? { status: data.from_status, severity: data.from_severity }) },
      { label: iconLabel('layers', 'After'), value: JSON.stringify(data.after ?? { status: data.to_status, severity: data.to_severity }) },
      { label: iconLabel('alert-circle', 'Reason'), value: data.reason },
      { label: iconLabel('topology', 'Correlation ID'), value: data.correlation_id },
      { label: iconLabel('settings', 'Metadata'), value: JSON.stringify(data.metadata ?? {}) }
    ]
  }));
  context.root.replaceChildren(view.node);
}
