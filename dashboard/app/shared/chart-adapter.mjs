export function chartTableModel({ title, unit, points = [], freshAsOf = null, scopeLabel = '', summary = null, maxPoints = 2000 } = {}) {
  const boundedMaximum = Math.min(2000, Math.max(0, Number(maxPoints) || 0));
  if (points.length > boundedMaximum) throw new Error(`Operational charts accept at most ${boundedMaximum.toLocaleString('en-US')} already-received points.`);
  return {
    title, unit, freshAsOf, scopeLabel, summary: summary ?? (points.length ? `${points.length} ${unit} samples in the selected scope.` : `No ${unit} samples in the selected scope.`),
    rows: points.map((point) => ({ at: point.at, value: point.value, sampleCount: point.sampleCount ?? 1, drilldown: point.drilldown ?? null })),
  };
}

export function prepareUPlotData(model) {
  return operationalPointColumns(model.rows);
}

export function measureChartWork(render, performanceRef = globalThis.performance) {
  performanceRef.mark?.('operational-chart-start'); const started = performanceRef.now();
  const result = render() ?? {};
  const durationMs = performanceRef.now() - started; performanceRef.mark?.('operational-chart-interactive');
  performanceRef.measure?.('operational-chart-render', 'operational-chart-start', 'operational-chart-interactive');
  return { ...result, durationMs, destroy: () => result.destroy?.() };
}

const text = (documentRef, tag, value) => Object.assign(documentRef.createElement(tag), { textContent: value });

function scopeDescription(scope) {
  if (!scope) return '';
  return `${scope.from ?? 'unknown'} inclusive to ${scope.to ?? 'unknown'} exclusive · UTC${scope.project ? ` · project ${scope.project}` : ''}${scope.provider ? ` · provider ${scope.provider}` : ''}`;
}

export function normalizeOperationalChartCall(containerOrContract, inputOrRuntime, runtime = {}) {
  if (!containerOrContract?.host) return { container: containerOrContract, input: inputOrRuntime, runtime, tableHost: null, summaryHost: null };
  const contract = containerOrContract; const series = contract.series ?? {};
  return {
    container: contract.host,
    input: {
      id: contract.id ?? `operational-${String(contract.label ?? series.metric ?? 'metric').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      title: contract.label ?? series.metric ?? 'Operational metric', unit: contract.unit ?? series.unit ?? 'value',
      points: Array.isArray(series) ? series : (series.points ?? []), freshAsOf: contract.freshAsOf ?? series.freshAsOf ?? null,
      scopeLabel: contract.scopeLabel ?? scopeDescription(series.scope), summary: contract.summary ?? (typeof series.summary === 'string' ? series.summary : null),
      maxPoints: contract.maxPoints ?? 2000,
    },
    runtime: inputOrRuntime ?? {}, tableHost: contract.tableHost ?? null, summaryHost: contract.summaryHost ?? null,
  };
}

export function renderOperationalChart(containerOrContract, inputOrRuntime, runtime = {}) {
  const normalized = normalizeOperationalChartCall(containerOrContract, inputOrRuntime, runtime);
  const { container, input, tableHost, summaryHost } = normalized;
  const { documentRef = document, uPlotCtor = globalThis.uPlot, performanceRef = globalThis.performance } = normalized.runtime;
  const model = chartTableModel(input);
  const measured = measureChartWork(() => {
    const section = documentRef.createElement('section'); section.className = 'chart-panel'; section.setAttribute('aria-labelledby', `${input.id}-title`);
    const headerRow = documentRef.createElement('div'); headerRow.className = 'chart-header-row';
    const heading = text(documentRef, 'h2', model.title); heading.id = `${input.id}-title`;
    headerRow.append(heading);

    if (model.rows.length) {
      const lastPoint = model.rows[model.rows.length - 1];
      const sumValue = model.rows.reduce((acc, r) => acc + (Number(r.value) || 0), 0);
      let badgeText = '';
      if (input.unit === 'USD') {
        badgeText = `$${Number(lastPoint.value || 0).toFixed(2)}`;
      } else if (input.unit === 'ms') {
        badgeText = `${Number(lastPoint.value || 0).toFixed(0)} ms`;
      } else if (input.unit === 'requests' || input.unit === 'tokens') {
        badgeText = sumValue >= 1000000 ? `${(sumValue / 1000000).toFixed(1)}M ${input.unit}` : sumValue >= 1000 ? `${(sumValue / 1000).toFixed(1)}k ${input.unit}` : `${sumValue} ${input.unit}`;
      } else {
        badgeText = `${lastPoint.value} ${input.unit}`;
      }
      const badgeEl = text(documentRef, 'span', badgeText);
      badgeEl.className = 'chart-summary-badge';
      headerRow.append(badgeEl);
    }

    const summary = text(documentRef, 'p', model.summary); summary.className = 'chart-summary';
    const freshLabel = model.freshAsOf ? new Date(model.freshAsOf).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }) : 'unknown';
    const meta = text(documentRef, 'p', `Series: ${model.unit} · ${model.scopeLabel} · Fresh as of ${freshLabel}`); meta.className = 'chart-meta';
    const visual = documentRef.createElement('div'); visual.className = 'chart-visual'; visual.setAttribute('aria-hidden', 'true');
    const existingDetails = documentRef.getElementById(`${input.id}-table`);
    const details = documentRef.createElement('details'); details.className = 'chart-table'; details.id = `${input.id}-table`; details.open = existingDetails ? existingDetails.open : !uPlotCtor;
    details.append(text(documentRef, 'summary', `Data table for ${model.title}`));
    const table = documentRef.createElement('table');
    const caption = text(documentRef, 'caption', `${model.title}. Values in ${model.unit}. ${model.scopeLabel}`); table.append(caption);
    const head = documentRef.createElement('thead'); const headRow = documentRef.createElement('tr');
    for (const value of ['Time (UTC)', `Value (${model.unit})`, 'Samples', 'Evidence']) headRow.append(text(documentRef, 'th', value));
    head.append(headRow); table.append(head);
    const body = documentRef.createElement('tbody'); const fragment = documentRef.createDocumentFragment();
    for (const row of model.rows) {
      const tr = documentRef.createElement('tr'); tr.append(text(documentRef, 'td', row.at), text(documentRef, 'td', String(row.value)), text(documentRef, 'td', String(row.sampleCount)));
      const evidence = documentRef.createElement('td');
      if (row.drilldown?.href) { const link = text(documentRef, 'a', row.drilldown.label || 'Open evidence'); link.href = row.drilldown.href; evidence.append(link); }
      else evidence.textContent = 'No linked record';
      tr.append(evidence); fragment.append(tr);
    }
    body.append(fragment); table.append(body); details.append(table); section.append(headerRow);
    if (summaryHost && summaryHost !== container) summaryHost.replaceChildren(summary, meta); else section.append(summary, meta);
    section.append(visual);
    if (tableHost && tableHost !== container) tableHost.replaceChildren(details); else section.append(details);
    container.replaceChildren(section);
    let plot = null;
    if (uPlotCtor && model.rows.length) {
      const accent = documentRef.defaultView?.getComputedStyle?.(documentRef.documentElement)?.getPropertyValue('--accent')?.trim() || '#315efb';
      const fillGradient = (self) => {
        const ctx = self?.ctx;
        if (!ctx || !self?.bbox) return 'rgba(47, 125, 225, 0.12)';
        try {
          const gradient = ctx.createLinearGradient(0, self.bbox.top, 0, self.bbox.top + self.bbox.height);
          gradient.addColorStop(0, 'rgba(47, 125, 225, 0.28)');
          gradient.addColorStop(1, 'rgba(47, 125, 225, 0.01)');
          return gradient;
        } catch { return 'rgba(47, 125, 225, 0.12)'; }
      };
      plot = new uPlotCtor({
        width: Math.max(280, visual.clientWidth || 640),
        height: 240,
        series: [{}, { label: model.unit, stroke: accent, width: 2, fill: fillGradient }],
        axes: [{}, { label: model.unit, grid: { stroke: 'rgba(128, 128, 128, 0.12)', width: 1 } }]
      }, prepareUPlotData(model), visual);
    } else if (!model.rows.length) { visual.className = 'chart-visual panel-empty'; visual.replaceChildren(text(documentRef, 'p', `No ${model.unit} data in this scope.`)); }
    const resize = () => { if (plot && visual.clientWidth) plot.setSize({ width: visual.clientWidth, height: 240 }); };
    globalThis.addEventListener?.('resize', resize);
    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
      try {
        resizeObserver = new ResizeObserver(() => resize());
        resizeObserver.observe(visual);
      } catch {}
    }
    return { model, plot, resize, destroy() { resizeObserver?.disconnect(); globalThis.removeEventListener?.('resize', resize); plot?.destroy?.(); } };
  }, performanceRef);
  measured.metrics = { pointCount: model.rows.length, interactiveMs: measured.durationMs, longestTaskMs: measured.durationMs };
  return measured;
}
import { operationalPointColumns } from './legacy-adapters.mjs';
