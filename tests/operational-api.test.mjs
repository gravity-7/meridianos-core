import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolvePaths } from '../config.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';
import { openDb } from '../db.mjs';
import { upsertTask } from '../state.mjs';
import { appendRun } from '../runlog.mjs';
import { openLedger } from '../gateway/ledger.mjs';
import { insertOperationalEvent } from './fixtures/operational-overview.mjs';
import { upsertAlertOccurrence } from '../dashboard/operational-alert-store.mjs';
import { createDashboardServer } from '../dashboard/server.mjs';

const FROM = '2026-08-11T00:00:00.000Z';
const TO = '2026-08-12T00:00:00.000Z';
const SCOPE = `from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}&project=project-a`;

function request(server, path, { method = 'GET', token = null, body = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path, method, headers: {
      ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
      ...(token ? { 'x-aios-token': token } : {}), ...headers,
    } }, (res) => {
      let data = ''; res.on('data', (chunk) => data += chunk); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data, json: () => JSON.parse(data) }));
    });
    req.on('error', reject); if (payload) req.write(payload); req.end();
  });
}

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'meridianos-operational-api-'));
  mkdirSync(join(root, '.ai'), { recursive: true });
  writeFileSync(join(root, '.ai', 'policy.yaml'), `kill_switch: false
agent_budget:
  warn_pct: 80
auto_merge: founder_only
ui_platform:
  enabled: true
gateway:
  tenant: tenant-a
analytics:
  budget:
    monthlyLimit: 100
dashboard:
  operations:
    polling_interval_ms: 10000
`);
  const config = resolvePaths({ domain: FIXTURE_DOMAIN, root });
  const db = openDb(undefined, config);
  upsertTask(db, { id: 'project-a/task-a', title: 'Task A', status: 'blocked', note: 'provider timeout' }, { now: FROM });
  upsertTask(db, { id: 'project-a/task-b', title: 'Task B', status: 'blocked', note: 'secondary fixture' }, { now: '2026-08-11T00:01:00.000Z' });
  const alert = upsertAlertOccurrence(db, { source: 'run', ruleId: 'failed-run', fingerprint: 'run-a-failed', severity: 'critical', title: 'Run failed', summary: 'Provider timeout', taskId: 'project-a/task-a', runId: 'run-a' }, { tenantId: 'tenant-a', projectId: 'project-a', correlationId: 'alert-corr', now: '2026-08-11T00:03:00.000Z' }).occurrence;
  upsertAlertOccurrence(db, { id: 'alert-warning', source: 'gateway', ruleId: 'gateway-warning', fingerprint: 'gateway-warning', severity: 'warning', title: 'Gateway warning', summary: 'Elevated latency' }, { tenantId: 'tenant-a', projectId: 'project-a', correlationId: 'warning-corr', now: '2026-08-11T00:04:00.000Z' });
  db.close();
  appendRun({ run_id: 'run-a', ts: '2026-08-11T00:02:00.000Z', task: 'project-a/task-a', provider: 'openai', model: 'gpt-test', agent: 'agent-a', outcome: 'failed', reason: 'timeout', note: 'Provider timeout' }, { config });
  const ledger = openLedger(undefined, { config }); insertOperationalEvent(ledger, { id: 'event-a', ts: '2026-08-11T00:02:01.000Z', task: 'project-a/task-a', runId: 'run-a', projectId: 'project-a', tenant: 'tenant-a', costUsd: 1.25 }); ledger.close();
  const server = createDashboardServer(config);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const shell = await request(server, '/app');
  return { root, config, server, alert, token: /AIOS_TOKEN = "([^"]+)"/.exec(shell.body)[1] };
}

test('operational API shares exact scope across overview, detail, alert, and cost evidence', async () => {
  const value = await fixture();
  try {
    const overview = await request(value.server, `/api/operations/overview?${SCOPE}`);
    assert.equal(overview.status, 200);
    assert.equal(overview.json().scope.project, 'project-a');
    assert.equal(overview.json().data.attention[0].id, value.alert.id);
    const task = await request(value.server, `/api/operations/tasks/${encodeURIComponent('project-a/task-a')}?${SCOPE}`);
    assert.equal(task.status, 200); assert.equal(task.json().data.task.id, 'project-a/task-a');
    const run = await request(value.server, `/api/operations/runs/run-a?${SCOPE}`);
    assert.equal(run.status, 200); assert.equal(run.json().data.recovery.retry.allowed, true);
    const cost = await request(value.server, `/api/operations/cost?${SCOPE}`);
    assert.equal(cost.status, 200); assert.equal(cost.json().data.summary.spend, 1.25);
    const invalid = await request(value.server, `/api/operations/overview?tenant=tenant-b&${SCOPE}`);
    assert.equal(invalid.status, 400); assert.equal(invalid.json().error.code, 'INVALID_SCOPE');
  } finally { await new Promise((resolve) => value.server.close(resolve)); rmSync(value.root, { recursive: true, force: true }); }
});

test('global search is additive, bounded, scoped, and returns no unsafe task fields', async () => {
  const value = await fixture();
  try {
    const search = await request(value.server, `/api/operations/search?${SCOPE}&q=task`);
    assert.equal(search.status, 200);
    const body = search.json();
    assert.equal(body.scope.project, 'project-a');
    assert.ok(body.data.results.some((item) => item.kind === 'task' && item.id === 'project-a/task-a'));
    assert.ok(body.data.results.every((item) => item.scope.projectId === 'project-a' || item.kind === 'route'));
    assert.equal(body.data.results.some((item) => 'note' in item || 'raw' in item || 'prompt' in item), false);
    const invalidScope = await request(value.server, `/api/operations/search?tenant=tenant-b&${SCOPE}&q=task`);
    assert.equal(invalidScope.status, 400);
    assert.equal(invalidScope.json().error.code, 'INVALID_SCOPE');
    const invalidQuery = await request(value.server, `/api/operations/search?${SCOPE}&q=${'x'.repeat(81)}`);
    assert.equal(invalidQuery.status, 400);
    assert.equal(invalidQuery.json().error.code, 'SEARCH_QUERY_INVALID');
  } finally { await new Promise((resolve) => value.server.close(resolve)); rmSync(value.root, { recursive: true, force: true }); }
});

test('operational pagination, evidence availability, correlated metadata, and export formats match the additive contract', async () => {
  const value = await fixture();
  try {
    const overview = await request(value.server, `/api/operations/overview?${SCOPE}`, { headers: { 'x-correlation-id': 'read-correlation' } });
    assert.equal(overview.json().meta.correlationId, 'read-correlation'); assert.match(overview.json().meta.freshAsOf, /^2026-|^20\d\d-/);
    const tasks = await request(value.server, `/api/operations/tasks?${SCOPE}&status=blocked&limit=1`); const taskBody = tasks.json();
    assert.equal(taskBody.data.items.length, 1); assert.ok(taskBody.data.page.nextCursor); assert.equal(taskBody.data.page.limit, 1);
    const taskNext = await request(value.server, `/api/operations/tasks?${SCOPE}&status=blocked&limit=1&cursor=${encodeURIComponent(taskBody.data.page.nextCursor)}`);
    assert.notEqual(taskNext.json().data.items[0].id, taskBody.data.items[0].id); assert.equal(taskNext.json().data.page.snapshot, taskBody.data.page.snapshot);
    const taskMismatch = await request(value.server, `/api/operations/tasks?${SCOPE}&status=ready-for-impl&limit=1&cursor=${encodeURIComponent(taskBody.data.page.nextCursor)}`); assert.equal(taskMismatch.status, 400); assert.equal(taskMismatch.json().error.code, 'INVALID_CURSOR');
    const alerts = await request(value.server, `/api/operations/alerts?${SCOPE}&limit=1`); const alertBody = alerts.json(); assert.ok(alertBody.data.page.nextCursor);
    const alertsNext = await request(value.server, `/api/operations/alerts?${SCOPE}&limit=1&cursor=${encodeURIComponent(alertBody.data.page.nextCursor)}`); assert.notEqual(alertBody.data.items[0].id, alertsNext.json().data.items[0].id);
    const detail = await request(value.server, `/api/operations/alerts/${value.alert.id}?${SCOPE}`); assert.equal(detail.json().data.actions.acknowledge.allowed, true); assert.equal(detail.json().data.actions.retry.allowed, true); assert.equal(detail.json().data.evidenceAvailability.alert.earliestAvailableAt, '2026-08-11T00:03:00.000Z'); assert.equal(detail.json().data.evidenceAvailability.ledger.earliestAvailableAt, '2026-08-11T00:02:01.000Z');
    const logs = await request(value.server, `/api/operations/runs/run-a/logs?${SCOPE}&limit=1`); assert.equal(logs.json().data.limit, 1); assert.ok(logs.json().data.snapshot);
    const jsonExport = await request(value.server, `/api/operations/export?${SCOPE}&view=gateway&format=json`); assert.equal(jsonExport.headers['content-type'], 'application/json'); assert.equal(jsonExport.json().data.units.latencyMs, 'ms'); assert.equal(jsonExport.json().data.rows[0].latencyMs, 100);
    const csvExport = await request(value.server, `/api/operations/export?${SCOPE}&view=cost&format=csv`, { headers: { 'x-correlation-id': 'export-correlation' } }); assert.match(csvExport.headers['content-type'], /text\/csv/); assert.equal(csvExport.headers['x-correlation-id'], 'export-correlation'); assert.match(csvExport.body, /scopeFrom/); assert.match(csvExport.body, /USD/);
    const invalidExport = await request(value.server, `/api/operations/export?${SCOPE}&view=secret&format=json`); assert.equal(invalidExport.status, 400); assert.equal(invalidExport.json().error.code, 'INVALID_EXPORT');
  } finally { await new Promise((resolve) => value.server.close(resolve)); rmSync(value.root, { recursive: true, force: true }); }
});

test('alert lifecycle and retry mutations require dashboard authorization and return audit destinations', async () => {
  const value = await fixture();
  try {
    const denied = await request(value.server, `/api/operations/alerts/${value.alert.id}/acknowledge?${SCOPE}`, { method: 'POST', body: { expectedVersion: 1, reason: 'Investigating' } });
    assert.equal(denied.status, 403);
    const demoDenied = await request(value.server, `/api/operations/alerts/${value.alert.id}/acknowledge?${SCOPE}&demo=true`, { method: 'POST', token: value.token, body: { expectedVersion: 1, reason: 'Demo attempt' } });
    assert.equal(demoDenied.status, 403); assert.equal(demoDenied.json().error.code, 'DEMO_READ_ONLY');
    const acknowledged = await request(value.server, `/api/operations/alerts/${value.alert.id}/acknowledge?${SCOPE}`, { method: 'POST', token: value.token, body: { expectedVersion: 1, reason: 'Investigating' } });
    assert.equal(acknowledged.status, 200);
    assert.equal(acknowledged.json().data.occurrence.status, 'acknowledged');
    assert.match(acknowledged.json().data.audit.href, /^\/app\/observability\/audit\//);
    const audit = await request(value.server, `/api/operations/audit/${acknowledged.json().data.event.id}?${SCOPE}`);
    assert.equal(audit.status, 200); assert.equal(audit.json().data.result, 'succeeded');
    const retry = await request(value.server, `/api/operations/runs/run-a/retry?${SCOPE}`, { method: 'POST', token: value.token, headers: { 'idempotency-key': 'retry-run-a' }, body: { reason: 'Transient provider timeout' } });
    assert.equal(retry.status, 200); assert.equal(retry.json().data.ok, true); assert.match(retry.json().data.taskUrl, /project-a%2Ftask-a/); assert.match(retry.json().data.newRunUrl, /task=project-a%2Ftask-a/); assert.match(retry.json().data.newRunUrl, /project=project-a/);
    const duplicate = await request(value.server, `/api/operations/runs/run-a/retry?${SCOPE}`, { method: 'POST', token: value.token, headers: { 'idempotency-key': 'retry-run-a' }, body: { reason: 'Transient provider timeout' } });
    assert.equal(duplicate.status, 200); assert.equal(duplicate.json().data.duplicate, true);
    const updatedRun = await request(value.server, `/api/operations/runs/run-a?${SCOPE}`); assert.match(updatedRun.json().data.retryHistory[0].audit.href, /^\/app\/observability\/audit\//); assert.equal(updatedRun.json().data.retryHistory[0].result, 'succeeded');
  } finally { await new Promise((resolve) => value.server.close(resolve)); rmSync(value.root, { recursive: true, force: true }); }
});

test('static application route modules are additive and traversal safe', async () => {
  const value = await fixture();
  try {
    const module = await request(value.server, '/static/app/route-registry.mjs');
    assert.equal(module.status, 200); assert.match(module.headers['content-type'], /text\/javascript/);
    const traversal = await request(value.server, '/static/app/%2e%2e/server.mjs');
    assert.equal(traversal.status, 404);
  } finally { await new Promise((resolve) => value.server.close(resolve)); rmSync(value.root, { recursive: true, force: true }); }
});

test('same-origin SSE publishes ordered scoped lifecycle events', async () => {
  const value = await fixture();
  let streamRequest;
  try {
    const received = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timed out waiting for operational event')), 3000);
      streamRequest = http.request({ host: '127.0.0.1', port: value.server.address().port, path: `/api/operations/events?${SCOPE}` }, (res) => {
        assert.equal(res.statusCode, 200); assert.match(res.headers['content-type'], /text\/event-stream/); assert.equal(res.headers['cache-control'], 'no-cache');
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
          const match = /id: ([^\n]+)\nevent: ([^\n]+)\ndata: ([^\n]+)\n\n/.exec(data);
          if (match) { clearTimeout(timeout); resolve({ id: match[1], type: match[2], event: JSON.parse(match[3]) }); streamRequest.destroy(); }
        });
      });
      streamRequest.on('error', (error) => { if (error.code !== 'ECONNRESET') reject(error); }); streamRequest.end();
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    const mutation = await request(value.server, `/api/operations/alerts/${value.alert.id}/acknowledge?${SCOPE}`, { method: 'POST', token: value.token, body: { expectedVersion: 1, reason: 'Investigating via stream' } });
    assert.equal(mutation.status, 200);
    const message = await received;
    assert.equal(message.id, '1'); assert.equal(message.type, 'alert.changed'); assert.equal(message.event.type, 'alert.changed'); assert.equal(message.event.entityId, value.alert.id);
  } finally { streamRequest?.destroy(); await new Promise((resolve) => value.server.close(resolve)); rmSync(value.root, { recursive: true, force: true }); }
});
