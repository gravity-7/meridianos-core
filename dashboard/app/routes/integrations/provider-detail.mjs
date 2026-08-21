import { make, notice, page, iconLabel, listPanel } from '../../shared/view-helpers.mjs';
import { managementRequest } from '../../shared/management-actions.mjs';

export async function renderRoute(context) {
  const id = encodeURIComponent(context.route.params.providerId);
  const data = await managementRequest(`/api/management/providers/${id}`); if (!context.isCurrent()) return;
  const view = page(`Provider ${data.provider.name}`, 'Safe diagnostics show a category and correlation, never submitted credential material.');
  const feedback = make('div', null, 'management-feedback'); feedback.setAttribute('role', 'status');
  const test = make('button', 'Test connection', 'btn-primary'); test.type = 'button';
  const run = async (retry = false) => {
    test.disabled = true;
    try {
      const result = await managementRequest(`/api/management/providers/${id}/${retry ? 'retry' : 'test'}`, { method: 'POST', body: {} });
      feedback.textContent = `${result.result.status || result.result.diagnostic || 'completed'} · ${result.correlationId}`;
    } catch (error) {
      feedback.replaceChildren(notice(error.message, { error: true }));
    } finally {
      test.disabled = false;
    }
  };
  test.addEventListener('click', () => void run());
  const retry = make('button', 'Retry test', 'btn-secondary'); retry.type = 'button';
  retry.addEventListener('click', () => void run(true));
  const actions = make('div', null, 'management-actions');
  actions.append(test, retry);
  const entries = Object.entries(data.provider).filter(([key]) => !/credential|secret/i.test(key));
  const providerPanel = listPanel(document, {
    title: iconLabel('plug', `Provider ${data.provider.name} settings`, { size: '1.25rem', strokeWidth: 2.2, color: 'inherit' }),
    rows: entries.map(([key, val]) => ({
      label: iconLabel('settings', key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())),
      value: String(val)
    }))
  });
  view.node.append(providerPanel, actions, feedback);
  context.root.replaceChildren(view.node);
}
