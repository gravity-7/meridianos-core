import { renderPanelFamily, dashboardPanel } from './dashboard-panels.mjs';

export const make = (tag, text = null, className = '') => {
  const node = document.createElement(tag); if (text != null) node.textContent = String(text); if (className) node.className = className; return node;
};
export const money = (value) => value == null ? 'Unknown' : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(value);
export const number = (value) => value == null ? 'Unknown' : new Intl.NumberFormat().format(value);
export const instant = (value) => value ? new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }) : 'Unknown';
export const link = (target, label, className = '') => { const node = make('a', label, className); node.href = target; return node; };
export const badge = (value, kind = value) => { const node = make('span', value, `badge badge-${kind}`); return node; };
export const iconLabel = (iconId, labelText, { size = '1.15rem', strokeWidth = 2, color = 'var(--muted)' } = {}) => {
  const container = make('span', null, 'icon-label');
  container.style.display = 'inline-flex'; container.style.alignItems = 'center'; container.style.gap = '0.4rem';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'nav-icon'); svg.setAttribute('aria-hidden', 'true');
  svg.style.color = color;
  svg.style.width = size; svg.style.height = size; svg.style.flex = `0 0 ${size}`;
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `/static/icons/nav-sprite.svg#${iconId}`);
  if (strokeWidth !== 2) use.style.strokeWidth = strokeWidth;
  svg.append(use);
  container.append(svg, document.createTextNode(labelText));
  return container;
};

export function listPanel(doc, options = {}) {
  const host = (doc ?? document).createElement('div');
  renderPanelFamily(host, { kind: 'list', ...options });
  const panel = host.firstElementChild;
  if (options.className) panel.classList.add(...options.className.split(' ').filter(Boolean));
  return panel;
}

export function formPanel(doc, { title, icon, subtitle = '', className = '' } = {}, ...children) {
  const documentRef = doc ?? document;
  const panel = dashboardPanel(documentRef, {
    title: icon ? iconLabel(icon, title, { size: '1.2rem', strokeWidth: 2.2, color: 'inherit' }) : title,
    kind: 'form',
    className: `management-form-panel${className ? ` ${className}` : ''}`
  });
  if (subtitle) {
    const p = make('p', subtitle, 'panel-subtitle');
    panel.append(p);
  }
  panel.append(...children.filter(Boolean));
  return panel;
}

export function card(title, ...children) { const node = make('section', null, 'card'); node.append(make('h2', title), ...children.filter(Boolean)); return node; }

export function definitionList(entries) {
  const dl = make('dl', null, 'panel-family-list definition-list');
  for (const [term, value] of entries) {
    const dt = make('dt');
    dt.append(term?.nodeType ? term : document.createTextNode(String(term ?? '—')));
    const dd = make('dd', null, 'panel-family-val');
    dd.append(value?.nodeType ? value : document.createTextNode(String(value ?? 'Unknown')));
    dl.append(dt, dd);
  }
  return dl;
}
export function table(headers, rows, captionText) {
  const tableNode = make('table', null, 'data-table'); tableNode.append(make('caption', captionText));
  const head = make('thead'); const hr = make('tr'); for (const header of headers) hr.append(make('th', header)); head.append(hr); tableNode.append(head);
  const body = make('tbody'); for (const row of rows) { const tr = make('tr'); for (const value of row) { const td = make('td'); td.append(value?.nodeType ? value : document.createTextNode(String(value ?? '—'))); tr.append(td); } body.append(tr); } tableNode.append(body); return tableNode;
}
export function page(title, intro = null) { const node = make('div', null, 'route-page'); const heading = make('h1', title); heading.tabIndex = -1; node.append(heading); if (intro) node.append(make('p', intro, 'lede')); return { node, heading }; }
export function notice(message, { error = false } = {}) { const node = make('div', message, error ? 'notice notice-error' : 'notice'); node.setAttribute('role', error ? 'alert' : 'status'); return node; }
export function scopeText(scope) {
  try {
    const fromF = new Intl.DateTimeFormat(navigator.language, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const toF = new Intl.DateTimeFormat(navigator.language, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
    const fromStr = fromF.format(new Date(scope.from));
    const toStr = toF.format(new Date(scope.to));
    return `${fromStr} - ${toStr}${scope.project ? ` • project ${scope.project}` : ''}${scope.provider ? ` • provider ${scope.provider}` : ''}`;
  } catch {
    return `${scope.from} inclusive to ${scope.to} exclusive • Local time${scope.project ? ` • project ${scope.project}` : ''}${scope.provider ? ` • provider ${scope.provider}` : ''}`;
  }
}
