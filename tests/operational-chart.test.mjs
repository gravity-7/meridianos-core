import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartTableModel, prepareUPlotData, measureChartWork, normalizeOperationalChartCall, renderOperationalChart } from '../dashboard/app/shared/chart-adapter.mjs';
import { makePointFixture } from './fixtures/operational-overview.mjs';

test('chart and table use the same bounded values, labels, units, and drill-downs', () => {
  const points = makePointFixture(2000).map((point, index) => ({ ...point, drilldown: { label: `Open ${index}`, href: `/app/observability/usage?point=${index}` } }));
  const model = chartTableModel({ title: 'Gateway requests', unit: 'requests', points, freshAsOf: '2026-08-11T00:00:00Z', scopeLabel: '[from,to)' });
  assert.equal(model.rows.length, 2000); assert.equal(model.rows[0].value, points[0].value); assert.equal(model.rows[0].drilldown.href, points[0].drilldown.href);
  assert.deepEqual(prepareUPlotData(model), [points.map((point) => Date.parse(point.at) / 1000), points.map((point) => point.value)]);
  assert.throws(() => chartTableModel({ title: 'Too much', unit: 'x', points: makePointFixture(2001) }), /2,000/);
});

test('chart performance instrumentation records scheduling-to-interactive work and disposal', () => {
  let time = 10; const marks = []; let disposed = false;
  const result = measureChartWork(() => ({ destroy: () => { disposed = true; } }), { now: () => (time += 4), mark: (name) => marks.push(name), measure: (name) => marks.push(name) });
  assert.equal(result.durationMs, 4); assert.deepEqual(marks, ['operational-chart-start', 'operational-chart-interactive', 'operational-chart-render']);
  result.destroy(); assert.equal(disposed, true);
});

test('exact object-form chart contract separates fallback hosts and returns bounded metrics', () => {
  const makeNode = (tag) => ({ tag, children: [], attributes: {}, clientWidth: 640, append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; }, setAttribute(name, value) { this.attributes[name] = value; }, remove() { this.removed = true; } });
  const documentRef = { createElement: makeNode, createDocumentFragment: () => makeNode('fragment'), getElementById: () => null };
  const host = makeNode('host'); const tableHost = makeNode('table-host'); const summaryHost = makeNode('summary-host');
  const series = { metric: 'requests', unit: 'requests', freshAsOf: '2026-08-11T00:00:00.000Z', scope: { from: '2026-08-10T00:00:00.000Z', to: '2026-08-11T00:00:00.000Z', project: 'project-a' }, points: makePointFixture(2) };
  const normalized = normalizeOperationalChartCall({ host, tableHost, summaryHost, series, label: 'Gateway requests', maxPoints: 2000 }, { documentRef });
  assert.equal(normalized.input.title, 'Gateway requests'); assert.equal(normalized.input.scopeLabel.includes('project project-a'), true);
  let now = 10; const result = renderOperationalChart({ host, tableHost, summaryHost, series, label: 'Gateway requests', maxPoints: 2000 }, { documentRef, uPlotCtor: null, performanceRef: { now: () => ++now, mark() {}, measure() {} } });
  assert.deepEqual(result.metrics, { pointCount: 2, interactiveMs: 1, longestTaskMs: 1 }); assert.equal(host.children.length, 1); assert.equal(tableHost.children.length, 1); assert.equal(summaryHost.children.length, 2);
  result.destroy(); assert.equal(host.children[0].removed, undefined, 'destroy() must not remove the section from the DOM — replaceChildren() in the route lifecycle handles DOM teardown atomically');
});
