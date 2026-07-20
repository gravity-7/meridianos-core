import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { openLedger, appendEvent } from '../gateway/ledger.mjs';
import {
  getSpendSummary,
  getAgentSpend,
  getModelSpend,
  getDenialEvents,
  getRecentEvents,
} from '../dashboard/gateway-api.mjs';
import { createDashboardServer } from '../dashboard/server.mjs';
import { resolvePaths } from '../config.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';

const config = resolvePaths({ domain: FIXTURE_DOMAIN });

function seedTestLedger() {
  const ledger = openLedger(':memory:');
  
  appendEvent(ledger, {
    id: 'evt-1',
    ts: '2026-07-21T01:00:00.000Z',
    tenant: 'pv',
    agent: 'builder',
    session: 'sess-1',
    task: 'F004',
    runId: 'run-1',
    requestId: 'req-1',
    provider: 'deepseek',
    model: 'deepseek-chat',
    wire: 'anthropic',
    upstreamStatus: 200,
    latencyMs: 1200,
    inputTokens: 1000,
    outputTokens: 200,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 1200,
    costUsd: 0.05,
    enforcementDecision: 'allow',
    capWindow: null,
  });

  appendEvent(ledger, {
    id: 'evt-2',
    ts: '2026-07-21T01:05:00.000Z',
    tenant: 'pv',
    agent: 'builder',
    session: 'sess-1',
    task: 'F004',
    runId: 'run-1',
    requestId: 'req-2',
    provider: 'deepseek',
    model: 'deepseek-chat',
    wire: 'anthropic',
    upstreamStatus: 200,
    latencyMs: 800,
    inputTokens: 500,
    outputTokens: 100,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 600,
    costUsd: 0.025,
    enforcementDecision: 'allow',
    capWindow: null,
  });

  appendEvent(ledger, {
    id: 'evt-3',
    ts: '2026-07-21T01:10:00.000Z',
    tenant: 'pv',
    agent: 'antigravity',
    session: 'sess-2',
    task: 'F004',
    runId: 'run-2',
    requestId: 'req-3',
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    wire: 'anthropic',
    upstreamStatus: 403,
    latencyMs: 50,
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    totalTokens: null,
    costUsd: null,
    enforcementDecision: 'deny',
    capWindow: '5h',
  });

  return ledger;
}

test('getSpendSummary computes accurate aggregate metrics', () => {
  const ledger = seedTestLedger();
  const summary = getSpendSummary(ledger);
  assert.equal(summary.totalCalls, 3);
  assert.equal(summary.totalCost, 0.075);
  assert.equal(summary.totalTokens, 1800);
  assert.equal(summary.denyCount, 1);
  assert.equal(summary.activeAgents, 2);
});

test('getAgentSpend computes per-agent breakdown accurately', () => {
  const ledger = seedTestLedger();
  const agents = getAgentSpend(ledger);
  assert.equal(agents.length, 2);
  const builder = agents.find((a) => a.agent === 'builder');
  assert.equal(builder.calls, 2);
  assert.equal(builder.inputTokens, 1500);
  assert.equal(builder.outputTokens, 300);
  assert.equal(builder.costUsd, 0.075);
  assert.equal(builder.denyCount, 0);

  const antigravity = agents.find((a) => a.agent === 'antigravity');
  assert.equal(antigravity.calls, 1);
  assert.equal(antigravity.denyCount, 1);
});

test('getModelSpend computes per-model usage and percentages', () => {
  const ledger = seedTestLedger();
  const models = getModelSpend(ledger);
  assert.equal(models.length, 2);
  const deepseek = models.find((m) => m.provider === 'deepseek');
  assert.equal(deepseek.calls, 2);
  assert.equal(deepseek.costUsd, 0.075);
  assert.equal(deepseek.percentage, 100);
});

test('getDenialEvents filters deny decisions sorted newest first', () => {
  const ledger = seedTestLedger();
  const denials = getDenialEvents(ledger);
  assert.equal(denials.length, 1);
  assert.equal(denials[0].agent, 'antigravity');
  assert.equal(denials[0].capWindow, '5h');
});

test('getRecentEvents retrieves token events newest first', () => {
  const ledger = seedTestLedger();
  const events = getRecentEvents(ledger, 50);
  assert.equal(events.length, 3);
  assert.equal(events[0].id, 'evt-3');
});

test('HTTP GET /api/summary, /api/agents, /api/models, /api/denials, /api/events', async () => {
  const server = createDashboardServer(config);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  const fetchJson = (path) =>
    new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
      });
      req.on('error', reject);
      req.end();
    });

  try {
    const summaryRes = await fetchJson('/api/summary');
    assert.equal(summaryRes.status, 200);
    assert.equal(typeof summaryRes.body.totalCost, 'number');

    const agentsRes = await fetchJson('/api/agents');
    assert.equal(agentsRes.status, 200);
    assert.ok(Array.isArray(agentsRes.body));

    const modelsRes = await fetchJson('/api/models');
    assert.equal(modelsRes.status, 200);
    assert.ok(Array.isArray(modelsRes.body));

    const denialsRes = await fetchJson('/api/denials');
    assert.equal(denialsRes.status, 200);
    assert.ok(Array.isArray(denialsRes.body));

    const eventsRes = await fetchJson('/api/events');
    assert.equal(eventsRes.status, 200);
    assert.ok(Array.isArray(eventsRes.body));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
