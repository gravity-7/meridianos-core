import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../db.mjs';
import { upsertTask, transition } from '../state.mjs';
import { appendRun } from '../runlog.mjs';
import { openOperationalLedger, insertOperationalEvent } from './fixtures/operational-overview.mjs';
import { getOperationalRun, getOperationalTask, listOperationalTasks } from '../dashboard/operational-runs.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'meridianos-operations-runs-'));
  const config = { dbPath: ':memory:', runsPath: join(root, 'runs.jsonl') };
  const db = openDb(':memory:', config);
  const ledger = openOperationalLedger();
  upsertTask(db, { id: 'project-a/task-a', title: 'Task A', status: 'ready-for-impl', owner: 'agent-a' }, { now: '2026-08-11T00:00:00.000Z' });
  transition(db, { taskId: 'project-a/task-a', to: 'in-progress', actor: 'agent-a', note: 'started', now: '2026-08-11T00:01:00.000Z' });
  appendRun({ run_id: 'run-a', ts: '2026-08-11T00:02:00.000Z', task: 'project-a/task-a', agent: 'agent-a', provider: 'openai', model: 'gpt-test', outcome: 'failed', reason: 'timeout', usage: { totalTokens: 15 }, note: 'safe timeout summary' }, { config });
  insertOperationalEvent(ledger, { id: 'event-a', ts: '2026-08-11T00:02:01.000Z', task: 'project-a/task-a', runId: 'run-a', costUsd: 1.25 });
  return { root, config, db, ledger, scope: { tenantId: 'tenant-a', projectId: 'project-a', provider: null, from: '2026-08-11T00:00:00.000Z', to: '2026-08-12T00:00:00.000Z' } };
}

test('task detail combines scoped identity, history, runs, alerts, and ledger cost', () => {
  const value = fixture();
  const detail = getOperationalTask({ ...value, taskId: 'project-a/task-a', actor: { id: 'viewer-a', role: 'viewer' } });
  assert.equal(detail.task.id, 'project-a/task-a');
  assert.equal(detail.runs[0].run_id, 'run-a');
  assert.equal(detail.cost.spend, 1.25);
  assert.equal(detail.history.at(-1).to_state, 'in-progress');
  assert.equal(detail.drilldown.entityType, 'task');
  value.db.close(); value.ledger.close(); rmSync(value.root, { recursive: true });
});

test('run detail exposes attribution, chronological evidence, eligibility, and retained gaps', () => {
  const value = fixture();
  const detail = getOperationalRun({ ...value, runId: 'run-a', actor: { id: 'operator-a', role: 'operator' } });
  assert.equal(detail.run.run_id, 'run-a');
  assert.equal(detail.attribution.costUsd, 1.25);
  assert.equal(detail.recovery.retry.allowed, true);
  assert.equal(detail.evidence.items[0].run_id, 'run-a');
  assert.match(detail.retention.disclosure, /available/i);
  value.db.close(); value.ledger.close(); rmSync(value.root, { recursive: true });
});

test('task list is project-scoped and returns stable detail destinations', () => {
  const value = fixture();
  upsertTask(value.db, { id: 'project-b/task-b', title: 'Other', status: 'blocked' });
  const result = listOperationalTasks({ db: value.db, scope: value.scope });
  assert.deepEqual(result.items.map((task) => task.id), ['project-a/task-a']);
  assert.match(result.items[0].drilldown.href, /^\/app\/operations\/tasks\/project-a%2Ftask-a\?/);
  value.db.close(); value.ledger.close(); rmSync(value.root, { recursive: true });
});
