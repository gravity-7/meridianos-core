import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendRun, readRuns } from '../runlog.mjs';

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
