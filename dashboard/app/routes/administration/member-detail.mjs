import { page, iconLabel, listPanel } from '../../shared/view-helpers.mjs'; import { managementRequest } from '../../shared/management-actions.mjs';
export async function renderRoute(context) {
  const data = await managementRequest('/api/management/access/effective-permissions'); if (!context.isCurrent()) return;
  const view = page('Effective permissions', 'This explanation is informational. The server independently authorizes every read and mutation.');
  view.node.append(listPanel(document, {
    title: iconLabel('shield-check', 'Effective permissions breakdown', { size: '1.25rem', strokeWidth: 2.2, color: 'inherit' }),
    rows: Object.entries(data.permissions).map(([key, value]) => ({
      icon: 'shield-check',
      label: key,
      value: Array.isArray(value) ? value.join(', ') || 'None' : String(value)
    }))
  }));
  context.root.replaceChildren(view.node);
}
