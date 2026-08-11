import { make, notice } from './view-helpers.mjs';

export async function managementRequest(path, { method = 'GET', body, reauthToken } = {}) {
  const headers = { 'x-aios-token': window.AIOS_TOKEN, 'x-correlation-id': crypto.randomUUID() }; if (body !== undefined) headers['content-type'] = 'application/json'; if (reauthToken) headers['x-management-reauth'] = reauthToken;
  const response = await fetch(path, { method, headers, credentials: 'same-origin', cache: 'no-store', body: body === undefined ? undefined : JSON.stringify(body) }); const value = await response.json().catch(() => ({})); if (!response.ok || value.ok === false) throw new Error(value.error?.message || value.error?.code || 'The management action was not completed.'); return value;
}

// The secret only exists in this transient dialog text node. Closing, Escape, cancellation,
// navigation, or an error removes both the node and its handlers before focus returns.
export function showOneTimeSecret({ secret, opener, onClose = () => {} }) {
  const dialog = document.createElement('dialog'); dialog.setAttribute('aria-label', 'One-time API key disclosure'); const value = make('code', secret); value.dataset.managementSecret = 'true'; const close = make('button', 'I stored this key'); close.type = 'button'; const warning = notice('Copy this value now. It cannot be shown again after this dialog closes.', { error: false });
  const clear = () => { value.textContent = ''; dialog.replaceChildren(); dialog.remove(); opener?.focus(); onClose(); };
  close.addEventListener('click', () => { dialog.close(); }); dialog.addEventListener('cancel', (event) => { event.preventDefault(); dialog.close(); }); dialog.addEventListener('close', clear, { once: true }); dialog.append(make('h2', 'Store your API key'), warning, value, close); document.body.append(dialog); dialog.showModal(); close.focus(); return dialog;
}

export function typedConfirmation({ title, instruction, confirmLabel, opener, onConfirm }) {
  const dialog = document.createElement('dialog'); dialog.setAttribute('aria-label', title); const field = make('input'); field.type = 'text'; field.autocomplete = 'off'; const submit = make('button', confirmLabel); submit.type = 'submit'; const form = make('form'); form.method = 'dialog'; form.append(make('h2', title), make('p', instruction), field, submit); form.addEventListener('submit', async (event) => { event.preventDefault(); try { await onConfirm(field.value); dialog.close(); } catch (error) { form.append(notice(error.message, { error: true })); field.focus(); } }); dialog.addEventListener('close', () => { dialog.remove(); opener?.focus(); }, { once: true }); dialog.append(form); document.body.append(dialog); dialog.showModal(); field.focus(); return dialog;
}
