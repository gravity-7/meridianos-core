import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendRun, readRuns, queryRuns, queryRunEvidence } from '../runlog.mjs';

test('appendRun writes records and readRuns returns them newest-first, with a limit', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'runlog-')), 'log.jsonl');
  appendRun({ run_id: 'a', agent: 'claude', outcome: 'ok', task: 'F1' }, { path, now: 1000 });
  appendRun({ run_id: 'b', agent: 'claude', outcome: 'noop' }, { path, now: 2000 });
  appendRun({ run_id: 'c', agent: 'antigravity', outcome: 'ok' }, { path, now: 3000 });
  assert.deepEqual(readRuns({ path }).map((r) => r.run_id), ['c', 'b', 'a']);
  assert.equal(readRuns({ path })[0].ts, new Date(3000).toISOString());
  assert.deepEqual(readRuns({ path, limit: 2 }).map((r) => r.run_id), ['c', 'b']);
});

test('appendRun fills run_id / ts / outcome defaults', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'runlog-')), 'log.jsonl');
  const rec = appendRun({ agent: 'claude' }, { path, now: 5000 });
  assert.ok(rec.run_id);
  assert.equal(rec.outcome, 'noop');
  assert.equal(rec.ts, new Date(5000).toISOString());
  assert.equal(rec.usage, null); // 1.6: additive field, defaults to null (unknown), never fabricated
});

test('appendRun persists a usage object when given one (1.6)', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'runlog-')), 'log.jsonl');
  const usage = { inputTokens: 80, outputTokens: 20, totalTokens: 100, provider: 'deepseek', model: 'deepseek-chat' };
  const rec = appendRun({ agent: 'claude', harness: 'opencode', provider: 'deepseek', tokens: 100, usage }, { path, now: 1 });
  assert.deepEqual(rec.usage, usage);
  assert.deepEqual(readRuns({ path })[0].usage, usage);
});

test('readRuns tolerates a torn line and a missing file', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'runlog-')), 'log.jsonl');
  assert.deepEqual(readRuns({ path }), []); // missing file
  appendRun({ run_id: 'ok1', agent: 'claude' }, { path, now: 1 });
  appendFileSync(path, '{ not valid json\n');
  const recs = readRuns({ path });
  assert.equal(recs.length, 1);
  assert.equal(recs[0].run_id, 'ok1');
});

test('queryRuns uses default 50/max 200 and keeps a fixed append snapshot', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'runlog-')), 'log.jsonl');
  for (let i = 0; i < 75; i++) appendRun({ run_id: `r${i}`, task: 'project-a/task', provider: 'openai', outcome: i % 2 ? 'ok' : 'failed' }, { path, now: i + 1 });
  const first = queryRuns({ path, scope: { tenantId: 'tenant-a', projectId: 'project-a', provider: 'openai' } });
  assert.equal(first.items.length, 50);
  assert.ok(first.nextCursor);
  appendRun({ run_id: 'new-after-snapshot', task: 'project-a/task', provider: 'openai' }, { path, now: 1000 });
  const second = queryRuns({ path, scope: { tenantId: 'tenant-a', projectId: 'project-a', provider: 'openai' }, cursor: first.nextCursor, limit: 999 });
  assert.equal(second.items.length, 25);
  assert.equal(second.items.some((run) => run.run_id === 'new-after-snapshot'), false);
  assert.equal(second.limit, 200);
  assert.equal(second.snapshot, first.snapshot);
});

test('queryRuns rejects malformed and cross-filter cursors', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'runlog-')), 'log.jsonl');
  appendRun({ run_id: 'one', task: 'project-a/task', provider: 'openai' }, { path, now: 1 });
  appendRun({ run_id: 'two', task: 'project-a/task', provider: 'openai' }, { path, now: 2 });
  assert.throws(() => queryRuns({ path, cursor: 'broken', scope: { tenantId: 't' } }), (error) => error.code === 'INVALID_CURSOR');
  const page = queryRuns({ path, limit: 1, scope: { tenantId: 't', provider: 'openai' } });
  assert.throws(() => queryRuns({ path, cursor: page.nextCursor, scope: { tenantId: 't', provider: 'other' } }), (error) => error.code === 'INVALID_CURSOR');
});

test('queryRunEvidence is chronological and excludes raw prompt/provider bodies', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'runlog-')), 'log.jsonl');
  appendRun({ run_id: 'r1', task: 'p/t', outcome: 'failed', reason: 'timeout', note: 'safe note', prompt: 'secret prompt', response: 'provider body' }, { path, now: 2 });
  const page = queryRunEvidence({ path, runId: 'r1', scope: { tenantId: 't' } });
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].reason, 'timeout');
  assert.equal('prompt' in page.items[0], false);
  assert.equal('response' in page.items[0], false);
});
