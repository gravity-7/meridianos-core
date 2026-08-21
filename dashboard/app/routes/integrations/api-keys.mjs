import { make, notice, page, table, formPanel, badge } from '../../shared/view-helpers.mjs';
import { managementRequest, showOneTimeSecret, typedConfirmation } from '../../shared/management-actions.mjs';

export async function renderRoute(context) {
  const data = await managementRequest('/api/management/api-keys'); if (!context.isCurrent()) return; const view = page('API keys', 'Create scoped credentials, disclose material once, rotate with bounded overlap, or revoke after recent reauthentication and typed confirmation.');
  const feedback = make('div', null, 'management-feedback'); feedback.setAttribute('role', 'status'); const form = make('form', null, 'management-form'); const name = make('input'); name.id = 'api-key-name'; name.required = true; name.name = 'name'; name.placeholder = 'e.g. ci-pipeline'; const scopes = make('input'); scopes.id = 'api-key-scopes'; scopes.name = 'scopes'; scopes.value = 'config:read'; const create = make('button', 'Create API key', 'btn-primary'); const nameLabel = make('label', 'Key name'); nameLabel.htmlFor = name.id; nameLabel.append(name); const scopeLabel = make('label', 'Scopes (comma-separated)'); scopeLabel.htmlFor = scopes.id; scopeLabel.append(scopes); form.append(nameLabel, scopeLabel, create);
  const formCard = formPanel(document, { title: 'Generate API key', icon: 'key', subtitle: 'Create a new scoped key for automated workloads and API access.' }, form);
  const disclose = async (result, opener) => { const revealed = await managementRequest(`/api/management/api-keys/${encodeURIComponent(result.key.id)}/disclose`, { method: 'POST', body: { nonce: result.disclosure.nonce } }); showOneTimeSecret({ secret: revealed.disclosure.secret, opener, onClose: () => { feedback.textContent = 'The one-time disclosure was cleared.'; void context.refresh(); } }); };
  form.addEventListener('submit', async (event) => { event.preventDefault(); create.disabled = true; try { const result = await managementRequest('/api/management/api-keys', { method: 'POST', body: { name: name.value, scopes: scopes.value.split(',').map((item) => item.trim()).filter(Boolean) } }); await disclose(result, create); } catch (error) { feedback.replaceChildren(notice(error.message, { error: true })); } finally { create.disabled = false; } });
  const rows = data.keys.map((key) => {
    const rotate = make('button', 'Rotate', 'btn-secondary'); rotate.type = 'button';
    rotate.addEventListener('click', async () => { const result = await managementRequest(`/api/management/api-keys/${encodeURIComponent(key.id)}/rotate`, { method: 'POST', body: { overlapMs: 3600000 } }); await disclose(result, rotate); });
    const revoke = make('button', 'Revoke', 'btn-danger'); revoke.type = 'button';
    revoke.addEventListener('click', () => typedConfirmation({ title: `Revoke ${key.name}`, instruction: `Type REVOKE ${key.name} after reauthentication.`, confirmLabel: 'Revoke key', opener: revoke, onConfirm: async (value, reauthToken) => { await managementRequest(`/api/management/api-keys/${encodeURIComponent(key.id)}/revoke`, { method: 'POST', body: { confirmation: value }, reauthToken }); feedback.textContent = 'Key revoked.'; void context.refresh(); } }));
    return [key.name, key.scopes.join(', '), badge(key.active ? 'Active' : 'Revoked', key.active ? 'ok' : 'denied'), rotate, revoke];
  });
  view.node.append(formCard, feedback, rows.length ? table(['Name', 'Scopes', 'State', 'Rotate', 'Revoke'], rows, 'Scoped API keys') : notice('No API keys exist in this scope.')); context.root.replaceChildren(view.node);
}
