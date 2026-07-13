import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeUsage, readTranscript, projectDirFor } from '../claude-usage.mjs';

const line = (ts, { input = 0, output = 0, cw = 0, cr = 0, model = 'claude-opus-4-8' }) =>
  JSON.stringify({ timestamp: new Date(ts).toISOString(), message: { role: 'assistant', model, usage: { input_tokens: input, output_tokens: output, cache_creation_input_tokens: cw, cache_read_input_tokens: cr } } });

test('claudeUsage buckets transcript usage into 5h / 7d windows', () => {
  const now = Date.parse('2026-07-03T12:00:00Z');
  const dir = mkdtempSync(join(tmpdir(), 'claude-usage-'));
  const recent = line(now - 1 * 3600 * 1000, { input: 100, output: 50, cw: 20, cr: 9999 }); // billable 170
  const old = line(now - 3 * 24 * 3600 * 1000, { input: 200, output: 100 });                 // billable 300
  const userLine = JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } });
  writeFileSync(join(dir, 's1.jsonl'), [recent, userLine, old].join('\n') + '\n');

  const u = claudeUsage({ dir, now });
  assert.equal(u.last5h.billable, 170);
  assert.equal(u.last5h.messages, 1);
  assert.equal(u.last5h.cacheRead, 9999);        // tracked, not billable
  assert.equal(u.last7d.billable, 170 + 300);
  assert.equal(u.last7d.messages, 2);
  assert.equal(u.total.messages, 2);
});

test('weekStartMs anchors the week window to the plan boundary instead of trailing 7d', () => {
  const now = Date.parse('2026-07-05T12:00:00Z');
  const weekStartMs = Date.parse('2026-07-05T06:00:00Z'); // plan week recycled 6h ago
  const dir = mkdtempSync(join(tmpdir(), 'claude-usage-'));
  const beforeBoundary = line(weekStartMs - 3600 * 1000, { input: 500, output: 0 }); // in trailing 7d, OUT of plan week
  const afterBoundary = line(weekStartMs + 3600 * 1000, { input: 40, output: 10 });  // in plan week
  writeFileSync(join(dir, 's.jsonl'), [beforeBoundary, afterBoundary].join('\n') + '\n');

  const rolling = claudeUsage({ dir, now });
  assert.equal(rolling.last7d.billable, 550);
  const anchored = claudeUsage({ dir, now, weekStartMs });
  assert.equal(anchored.last7d.billable, 50);
  assert.equal(anchored.total.billable, 550); // all-time unaffected
});

test('session5h: activity-anchored 5h sessions — current session only, zero once expired', () => {
  const t0 = Date.parse('2026-07-05T00:00:00Z');
  const H = 3600 * 1000;
  const dir = mkdtempSync(join(tmpdir(), 'claude-usage-'));
  // session 1 opens at t0; next activity at t0+6h is past t0+5h → opens session 2
  writeFileSync(join(dir, 's.jsonl'), [
    line(t0, { input: 100, output: 0 }),
    line(t0 + 1 * H, { input: 30, output: 0 }),   // still session 1
    line(t0 + 6 * H, { input: 7, output: 0 }),    // session 2
  ].join('\n') + '\n');

  // inside session 2 → only its usage counts; reset is 5h after ITS start
  const inS2 = claudeUsage({ dir, now: t0 + 7 * H, session5h: true });
  assert.equal(inS2.last5h.billable, 7);
  assert.deepEqual(inS2.fiveHourSession, { start: t0 + 6 * H, resetAt: t0 + 11 * H });

  // rolling for comparison: trailing 5h at t0+7h skips session-1 usage too, but has no resetAt
  const rolling = claudeUsage({ dir, now: t0 + 7 * H });
  assert.equal(rolling.fiveHourSession, null);

  // after session 2 expires → the 5h window is EMPTY until the next activity
  const expired = claudeUsage({ dir, now: t0 + 12 * H, session5h: true });
  assert.equal(expired.last5h.billable, 0);
  assert.deepEqual(expired.fiveHourSession, { start: null, resetAt: null });
});

test('readTranscript skips non-usage lines and bad JSON, never throws', () => {
  const dir = mkdtempSync(join(tmpdir(), 'claude-usage-'));
  const p = join(dir, 's.jsonl');
  writeFileSync(p, ['not json at all', JSON.stringify({ message: { role: 'user' } }), line(Date.now(), { input: 5, output: 5 })].join('\n'));
  const recs = readTranscript(p);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].billable, 10);
});

test('projectDirFor encodes a cwd the way Claude Code names its transcript dir', () => {
  assert.equal(projectDirFor('C:\\projects\\propertyverdict'), 'C--projects-propertyverdict');
});
