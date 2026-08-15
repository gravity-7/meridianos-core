import { make, definitionList, notice, page, table } from '../shared/view-helpers.mjs';

const ROUTES = Object.freeze({
  'provider-list': ['/api/management/providers', 'Integrations', 'providers'],
  'provider-detail': ['/api/management/providers/', 'Provider integration', 'provider'],
  'api-keys': ['/api/management/api-keys', 'API keys', 'keys'],
  'webhooks': ['/api/management/webhooks/', 'Webhook delivery history', 'attempts'],
  'webhook-detail': ['/api/management/webhooks/', 'Webhook delivery detail', 'attempts'],
  'members': ['/api/management/access/memberships', 'Members and invitations', 'memberships'],
  'member-detail': ['/api/management/access/effective-permissions', 'Effective permissions', 'permissions'],
  'billing': ['/api/management/billing', 'Billing and entitlements', 'billing'],
  'security': ['/api/management/audit', 'Security and management evidence', 'events'],
  'audit': ['/api/management/audit', 'Management audit evidence', 'events'],
  'tenant-settings': ['/api/management/billing', 'Tenant settings and policy impact', 'billing'],
});

async function read(path) {
  const response = await fetch(path, { headers: { 'x-aios-token': window.AIOS_TOKEN, 'x-correlation-id': crypto.randomUUID() }, credentials: 'same-origin', cache: 'no-store' });
  const body = await response.json().catch(() => ({})); if (!response.ok || body.ok === false) throw new Error(body.error?.message || 'Management data is unavailable for this access scope.'); return body;
}
function safeRows(value) { if (!Array.isArray(value)) return []; return value.map((row) => Object.entries(row).filter(([key]) => !/secret|token|credential|password/i.test(key)).map(([, v]) => typeof v === 'object' ? JSON.stringify(v) : String(v ?? '—'))); }
export async function renderRoute(context) {
  const [base, title, field] = ROUTES[context.route.id] ?? []; if (!base) throw new Error('Management route is unavailable.');
  let path = base;
  if (context.route.id === 'provider-detail') path += encodeURIComponent(context.route.params.providerId);
  if (context.route.id.startsWith('webhook-')) path += `${encodeURIComponent(context.route.params.webhookId)}/attempts`;
  const data = await read(path); if (!context.isCurrent()) return;
  const view = page(title, 'Authorized management information is scoped by the server. Sensitive credential material is never rendered in this application route.');
  const value = data[field];
  if (Array.isArray(value)) {
    const rows = safeRows(value); const headings = value[0] ? Object.keys(value[0]).filter((key) => !/secret|token|credential|password/i.test(key)) : ['Status'];
    view.node.append(rows.length ? table(headings, rows, `Scoped ${title.toLowerCase()}`) : notice('No retained records are available in the current scope.'));
  } else if (value && typeof value === 'object') view.node.append(definitionList(Object.entries(value).filter(([key]) => !/secret|token|credential|password/i.test(key)).map(([key, item]) => [key, typeof item === 'object' ? JSON.stringify(item) : item])));
  else view.node.append(notice('No management information is available in the current scope.'));
  const feedback = make('p', data.correlationId ? `Support correlation: ${data.correlationId}` : 'Changes require reauthentication and explicit confirmation where applicable.', 'muted'); feedback.setAttribute('role', 'status'); view.node.append(feedback); context.root.replaceChildren(view.node);
}
