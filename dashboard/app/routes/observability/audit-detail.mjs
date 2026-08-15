import { make, badge, instant, page, definitionList, scopeText } from '../../shared/view-helpers.mjs';

export async function renderRoute(context) {
  const data = await context.api.read(`/audit/${encodeURIComponent(context.route.params.auditId)}`); if (!context.isCurrent()) return;
  const view = page(`Audit evidence ${data.id}`, 'Immutable evidence for one operational lifecycle or remediation event.'); view.node.append(make('p', scopeText(context.scope), 'scope-summary'));
  view.node.append(definitionList([['Event', data.event_type], ['Result', badge(data.result, data.result)], ['Time', instant(data.created_at)], ['Actor', data.actor_id], ['Actor role', data.actor_role], ['Authorized tenant', data.tenant_id], ['Authorized project', data.project_id ?? 'All authorized projects'], ['Target', `${data.target_type}: ${data.target_id}`], ['Before', JSON.stringify(data.before ?? { status: data.from_status, severity: data.from_severity })], ['After', JSON.stringify(data.after ?? { status: data.to_status, severity: data.to_severity })], ['Reason', data.reason], ['Correlation ID', data.correlation_id], ['Metadata', JSON.stringify(data.metadata ?? {})]]));
  context.root.replaceChildren(view.node);
}
