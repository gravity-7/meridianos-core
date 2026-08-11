export const make = (tag, text = null, className = '') => {
  const node = document.createElement(tag); if (text != null) node.textContent = String(text); if (className) node.className = className; return node;
};
export const money = (value) => value == null ? 'Unknown' : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(value);
export const number = (value) => value == null ? 'Unknown' : new Intl.NumberFormat().format(value);
export const instant = (value) => value ? new Date(value).toLocaleString(undefined, { timeZone: 'UTC', timeZoneName: 'short' }) : 'Unknown';
export const link = (target, label, className = '') => { const node = make('a', label, className); node.href = target; return node; };
export const badge = (value, kind = value) => { const node = make('span', value, `badge badge-${kind}`); return node; };
export function card(title, ...children) { const node = make('section', null, 'card'); node.append(make('h2', title), ...children.filter(Boolean)); return node; }
export function definitionList(entries) {
  const dl = make('dl'); for (const [term, value] of entries) { const dd = make('dd'); dd.append(value?.nodeType ? value : document.createTextNode(String(value ?? 'Unknown'))); dl.append(make('dt', term), dd); } return dl;
}
export function table(headers, rows, captionText) {
  const tableNode = make('table', null, 'data-table'); tableNode.append(make('caption', captionText));
  const head = make('thead'); const hr = make('tr'); for (const header of headers) hr.append(make('th', header)); head.append(hr); tableNode.append(head);
  const body = make('tbody'); for (const row of rows) { const tr = make('tr'); for (const value of row) { const td = make('td'); td.append(value?.nodeType ? value : document.createTextNode(String(value ?? '—'))); tr.append(td); } body.append(tr); } tableNode.append(body); return tableNode;
}
export function page(title, intro = null) { const node = make('div', null, 'route-page'); const heading = make('h1', title); heading.tabIndex = -1; node.append(heading); if (intro) node.append(make('p', intro, 'lede')); return { node, heading }; }
export function notice(message, { error = false } = {}) { const node = make('div', message, error ? 'notice notice-error' : 'notice'); node.setAttribute('role', error ? 'alert' : 'status'); return node; }
export function scopeText(scope) { return `${scope.from} inclusive to ${scope.to} exclusive · UTC${scope.project ? ` · project ${scope.project}` : ''}${scope.provider ? ` · provider ${scope.provider}` : ''}`; }
