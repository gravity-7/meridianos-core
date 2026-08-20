const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : 0));

export function meterModel({ title, value, max = 100, unit = '%', status = 'unknown', thresholds = { warning: 70, critical: 90 }, empty = false } = {}) {
  const numericValue = Number(value);
  const numericMax = Number(max);
  const hasData = !empty && Number.isFinite(numericValue) && Number.isFinite(numericMax) && numericMax > 0;
  const percent = hasData ? clamp((numericValue / numericMax) * 100) : 0;
  const level = !hasData ? 'empty' : percent >= thresholds.critical ? 'critical' : percent >= thresholds.warning ? 'warning' : 'ok';
  return { title, value: hasData ? numericValue : null, max: hasData ? numericMax : null, unit, percent, status: status === 'unknown' ? level : status, level, label: hasData ? `${numericValue} ${unit}` : 'No data' };
}

export function renderCircledMeter(host, input = {}) {
  const model = meterModel(input);
  const documentRef = host.ownerDocument ?? document;
  const panel = documentRef.createElement('section'); panel.className = `dashboard-panel meter-panel meter-${model.level}`; panel.setAttribute('aria-labelledby', `${input.id ?? 'meter'}-title`);
  const heading = documentRef.createElement('h2'); heading.id = `${input.id ?? 'meter'}-title`; heading.textContent = model.title;
  const ring = documentRef.createElement('div'); ring.className = 'circled-meter'; ring.setAttribute('role', 'img'); ring.setAttribute('aria-label', `${model.title}: ${model.label}; status ${model.status}`); ring.style.setProperty('--meter-percent', `${model.percent}%`); ring.dataset.status = model.status;
  const value = documentRef.createElement('strong'); value.className = 'meter-value'; value.textContent = model.value == null ? '—' : String(model.value);
  const unit = documentRef.createElement('span'); unit.className = 'meter-unit'; unit.textContent = model.value == null ? '' : model.unit;
  const state = documentRef.createElement('span'); state.className = 'meter-state'; state.textContent = model.value == null ? 'No data' : model.status;
  ring.append(value, unit); panel.append(heading, ring, state);
  const details = documentRef.createElement('p'); details.className = 'meter-details'; details.textContent = model.value == null ? 'No metric data is available in this scope.' : `${model.percent.toFixed(0)}% of ${model.max} ${model.unit}`; panel.append(details);
  host.replaceChildren(panel); return { model, destroy: () => {} };
}

export function dashboardPanel(documentRef, { title, kind = 'panel', className = '' } = {}, ...children) {
  const panel = documentRef.createElement('section'); panel.className = `dashboard-panel panel-${kind}${className ? ` ${className}` : ''}`; const heading = documentRef.createElement('h2');
  if (title?.nodeType) heading.append(title); else heading.textContent = title ?? '';
  panel.append(heading, ...children.filter(Boolean)); return panel;
}

/**
 * Render one of the compact monitoring panel families used by the dashboard.
 * The renderer deliberately keeps the data surface semantic (lists/tables/text)
 * so every visual treatment has an accessible equivalent and remains useful
 * when CSS, color, or charting support is unavailable.
 */
export function renderPanelFamily(host, { title, kind = 'stat', value = null, percent = null, caption = '', rows = [], emptyMessage = 'No data in this scope.', href = null, linkLabel = 'Open evidence' } = {}) {
  const documentRef = host.ownerDocument ?? document;
  const panel = dashboardPanel(documentRef, { title, kind });
  if (kind === 'stat' || kind === 'gauge' || kind === 'bar-gauge') {
    const body = documentRef.createElement('div'); body.className = `panel-family-value panel-family-${kind}`; if (Number.isFinite(Number(percent))) body.style.setProperty('--bar-gauge-percent', `${Math.max(0, Math.min(100, Number(percent)))}%`);
    const strong = documentRef.createElement('strong'); strong.textContent = value == null ? '—' : String(value); body.append(strong);
    if (caption) { const detail = documentRef.createElement('span'); detail.className = 'panel-family-caption'; detail.textContent = caption; body.append(detail); }
    panel.append(body);
  } else if (kind === 'heatmap') {
    const heatmap = documentRef.createElement('div'); heatmap.className = 'panel-heatmap-grid'; heatmap.setAttribute('role', 'img'); heatmap.setAttribute('aria-label', `${title}: ${rows.length ? 'metric intensity grid' : emptyMessage}`);
    for (const row of rows.slice(0, 48)) { const cell = documentRef.createElement('span'); cell.className = `heat-cell heat-${row.level ?? 'empty'}`; cell.title = row.label ?? ''; cell.setAttribute('aria-hidden', 'true'); heatmap.append(cell); }
    if (!rows.length) heatmap.append(Object.assign(documentRef.createElement('span'), { className: 'heatmap-empty', textContent: emptyMessage }));
    panel.append(heatmap);
  } else if (kind === 'table') {
    const table = documentRef.createElement('table'); table.className = 'data-table panel-family-table'; const captionNode = documentRef.createElement('caption'); captionNode.className = 'visually-hidden'; captionNode.textContent = title; table.append(captionNode);
    const head = documentRef.createElement('thead'); const headerRow = documentRef.createElement('tr'); for (const label of ['Signal', 'Value']) { const th = documentRef.createElement('th'); th.scope = 'col'; th.textContent = label; headerRow.append(th); } head.append(headerRow); table.append(head);
    const body = documentRef.createElement('tbody'); for (const row of rows) { const tr = documentRef.createElement('tr'); const name = documentRef.createElement('th'); name.scope = 'row'; name.textContent = row.label ?? 'Metric'; const valueCell = documentRef.createElement('td'); valueCell.append(row.value?.nodeType ? row.value : documentRef.createTextNode(String(row.value ?? '—'))); tr.append(name, valueCell); body.append(tr); } table.append(body); panel.append(table);
  } else {
    const list = documentRef.createElement('ul'); list.className = 'panel-family-list';
    if (!rows.length) { const empty = documentRef.createElement('li'); empty.className = 'panel-family-empty'; empty.textContent = emptyMessage; list.append(empty); }
    for (const row of rows) { const item = documentRef.createElement('li'); item.className = 'panel-family-row'; const label = documentRef.createElement('span'); label.append(row.label?.nodeType ? row.label : documentRef.createTextNode(String(row.label ?? 'Event'))); const valueNode = documentRef.createElement('strong'); valueNode.append(row.value?.nodeType ? row.value : documentRef.createTextNode(String(row.value ?? ''))); item.append(label, valueNode); list.append(item); }
    panel.append(list);
  }
  if (href) { const link = documentRef.createElement('a'); link.href = href; link.className = 'panel-drilldown'; link.textContent = linkLabel; panel.append(link); }
  host.replaceChildren(panel); return panel;
}
