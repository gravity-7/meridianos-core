import { notice, page, iconLabel, badge } from '../../shared/view-helpers.mjs';
import { renderPanelFamily } from '../../shared/dashboard-panels.mjs';
import { managementRequest } from '../../shared/management-actions.mjs';

export async function renderRoute(context) {
  const data = await managementRequest('/api/management/billing'); if (!context.isCurrent()) return;
  const billing = data.billing;
  const view = page('Billing and entitlements', 'Source and availability are explicit; unavailable values are never represented as zero.');
  const host = document.createElement('div');
  renderPanelFamily(host, {
    title: iconLabel('database', 'Billing and environment configuration', { size: '1.25rem', strokeWidth: 2.2, color: 'inherit' }),
    kind: 'snapshot-grid',
    rows: [
      { icon: 'database', label: 'Environment', value: badge(billing.environment, 'info'), hasPulse: billing.environment === 'production' },
      { icon: 'settings', label: 'Mode', value: badge(billing.mode, billing.mode === 'normal' ? 'ok' : 'warning') },
      { icon: 'shield-check', label: 'Limits', value: billing.limits ? (typeof billing.limits === 'object' ? Object.entries(billing.limits).map(([k, v]) => `${k}: ${v}`).join(', ') : String(billing.limits)) : 'Standard' },
      { icon: 'shield-check', label: 'Entitlements', value: billing.entitlements?.length ? `${billing.entitlements.length} Active Grants` : 'Standard' }
    ]
  });
  const snapshotPanel = host.firstElementChild || host;
  view.node.append(snapshotPanel);
  if (billing.mode !== 'normal') view.node.append(notice('Mutating billing and policy actions are unavailable in the current mode.'));
  context.root.replaceChildren(view.node);
}
