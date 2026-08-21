const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : 0));
const SVG_NS = ['http:', '', 'www.w3.org', '2000', 'svg'].join('/');

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
export function renderPanelFamily(host, { title, kind = 'stat', value = null, percent = null, caption = '', rows = [], emptyMessage = 'No data in this scope.', href = null, linkLabel = 'Open evidence', budget = null } = {}) {
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
    if (budget) {
      const card = documentRef.createElement('div');
      card.className = 'budget-signals-card';
      const bHeader = documentRef.createElement('div');
      bHeader.className = 'budget-signals-header';
      const spendEl = documentRef.createElement('span');
      spendEl.className = 'budget-signals-spend';
      spendEl.textContent = budget.spendFormatted ?? '$0.00';
      const capEl = documentRef.createElement('span');
      capEl.className = 'budget-signals-cap';
      capEl.textContent = budget.limitFormatted ? `of ${budget.limitFormatted} limit` : 'No limit configured';
      bHeader.append(spendEl, capEl);

      const track = documentRef.createElement('div');
      track.className = 'budget-progress-track';
      const bar = documentRef.createElement('div');
      const pct = Math.min(100, Math.max(0, Number(budget.percent) || 0));
      bar.className = `budget-progress-bar ${pct >= 90 ? 'is-bad' : pct >= 70 ? 'is-warn' : 'is-good'}`;
      bar.style.width = `${pct}%`;
      track.append(bar);

      const bFooter = documentRef.createElement('div');
      bFooter.className = 'budget-signals-footer';
      const pctLabel = documentRef.createElement('span');
      pctLabel.textContent = `${pct.toFixed(0)}% consumed`;
      const forecastPill = documentRef.createElement('span');
      const fStatus = budget.forecastStatus ?? 'is-on-track';
      forecastPill.className = `budget-forecast-pill ${fStatus}`;
      forecastPill.textContent = budget.forecastLabel ?? 'On track';
      bFooter.append(pctLabel, forecastPill);

      card.append(bHeader, track, bFooter);
      panel.append(card);
    }
    const table = documentRef.createElement('table'); table.className = `data-table panel-family-table${budget ? ' visually-hidden' : ''}`; const captionNode = documentRef.createElement('caption'); captionNode.className = 'visually-hidden'; captionNode.textContent = title; table.append(captionNode);
    const head = documentRef.createElement('thead'); const headerRow = documentRef.createElement('tr'); for (const label of ['Signal', 'Value']) { const th = documentRef.createElement('th'); th.scope = 'col'; th.textContent = label; headerRow.append(th); } head.append(headerRow); table.append(head);
    const body = documentRef.createElement('tbody'); for (const row of rows) { const tr = documentRef.createElement('tr'); const name = documentRef.createElement('th'); name.scope = 'row'; name.textContent = row.label ?? 'Metric'; const valueCell = documentRef.createElement('td'); valueCell.append(row.value?.nodeType ? row.value : documentRef.createTextNode(String(row.value ?? '—'))); tr.append(name, valueCell); body.append(tr); } table.append(body); panel.append(table);
  } else if (kind === 'snapshot-grid') {
    const grid = documentRef.createElement('div');
    grid.className = 'operational-snapshot-grid';
    for (const item of rows) {
      const tile = documentRef.createElement('div');
      tile.className = 'snapshot-tile';
      const tileHeader = documentRef.createElement('div');
      tileHeader.className = 'snapshot-tile-header';
      if (item.icon) {
        const iconWrap = documentRef.createElement('span');
        iconWrap.className = 'snapshot-tile-icon';
        const svg = documentRef.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('class', 'nav-icon'); svg.setAttribute('aria-hidden', 'true');
        const use = documentRef.createElementNS(SVG_NS, 'use');
        use.setAttribute('href', `/static/icons/nav-sprite.svg#${item.icon}`);
        svg.append(use);
        iconWrap.append(svg);
        tileHeader.append(iconWrap);
      }
      const label = documentRef.createElement('span');
      label.textContent = String(item.label ?? '');
      tileHeader.append(label);

      const tileVal = documentRef.createElement('div');
      tileVal.className = 'snapshot-tile-value';
      if (item.hasPulse) {
        const dot = documentRef.createElement('span');
        dot.className = 'pulse-dot';
        dot.setAttribute('aria-hidden', 'true');
        tileVal.append(dot);
      }
      if (item.value?.nodeType) {
        tileVal.append(item.value);
      } else {
        tileVal.append(documentRef.createTextNode(String(item.value ?? '—')));
      }

      tile.append(tileHeader, tileVal);
      grid.append(tile);
    }
    const list = documentRef.createElement('dl'); list.className = 'panel-family-list definition-list visually-hidden';
    for (const row of rows) {
      const dt = documentRef.createElement('dt'); dt.textContent = String(row.label ?? 'Event');
      const dd = documentRef.createElement('dd'); dd.className = 'panel-family-val';
      dd.append(row.value?.nodeType ? row.value.cloneNode(true) : documentRef.createTextNode(String(row.value ?? '')));
      list.append(dt, dd);
    }
    panel.append(grid, list);
  } else {
    const list = documentRef.createElement('dl'); list.className = 'panel-family-list definition-list';
    if (!rows.length) { const empty = documentRef.createElement('p'); empty.className = 'panel-family-empty'; empty.textContent = emptyMessage; list.append(empty); }
    for (const row of rows) {
      const dt = documentRef.createElement('dt');
      if (row.icon) {
        const svg = documentRef.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('class', 'nav-icon'); svg.setAttribute('aria-hidden', 'true');
        svg.style.color = 'var(--muted)'; svg.style.width = '1.15rem'; svg.style.height = '1.15rem'; svg.style.flex = '0 0 1.15rem';
        const use = documentRef.createElementNS(SVG_NS, 'use');
        use.setAttribute('href', `/static/icons/nav-sprite.svg#${row.icon}`);
        svg.append(use);
        dt.append(svg, document.createTextNode(String(row.label ?? 'Event')));
      } else if (row.label?.nodeType) {
        dt.append(row.label);
      } else {
        dt.append(document.createTextNode(String(row.label ?? 'Event')));
      }
      const dd = documentRef.createElement('dd');
      dd.className = 'panel-family-val';
      dd.append(row.value?.nodeType ? row.value : documentRef.createTextNode(String(row.value ?? '')));
      list.append(dt, dd);
    }
    panel.append(list);
  }
  if (href) { const link = documentRef.createElement('a'); link.href = href; link.className = 'panel-drilldown'; link.textContent = linkLabel; panel.append(link); }
  host.replaceChildren(panel); return panel;
}
