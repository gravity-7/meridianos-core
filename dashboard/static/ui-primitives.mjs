/** Accessible primitives shared by platform routes. They create semantic DOM only; callers own data. */
const node = (tag, text) => Object.assign(document.createElement(tag), text == null ? {} : { textContent: text });

export function actionButton(label, { pending = false, disabled = false, onClick } = {}) {
  const button = node('button', pending ? `${label}…` : label);
  button.type = 'button'; button.disabled = disabled || pending; button.setAttribute('aria-busy', String(pending));
  if (onClick) button.addEventListener('click', onClick);
  return button;
}

export function labeledInput(labelText, { id, type = 'text', value = '' } = {}) {
  const label = node('label', labelText); const input = document.createElement('input');
  if (typeof id === 'string' && id) { input.id = id; label.htmlFor = id; }
  input.type = type; input.value = value; label.append(input);
  return { label, input };
}

export function feedback(message, { error = false } = {}) {
  const region = node('p', message); region.className = 'feedback';
  region.setAttribute('role', error ? 'alert' : 'status'); region.setAttribute('aria-live', error ? 'assertive' : 'polite');
  return region;
}

export function emptyState(title, message) {
  const section = document.createElement('section'); section.className = 'empty-state';
  section.append(node('h2', title), node('p', message)); return section;
}

export function modal(title, content, { returnFocus } = {}) {
  const dialog = document.createElement('dialog'); dialog.className = 'modal'; dialog.setAttribute('aria-label', title);
  const close = actionButton('Close', { onClick: () => dialog.close() });
  dialog.append(node('h2', title), content, close);
  dialog.addEventListener('close', () => returnFocus?.focus());
  dialog.addEventListener('keydown', (event) => { if (event.key === 'Escape') dialog.close(); });
  return dialog;
}
