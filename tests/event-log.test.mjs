import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db.mjs';
import { emit, info, warn, error, readEvents, pruneEvents } from '../event-log.mjs';

function freshDb() { return openDb(':memory:'); }

test('emit inserts a row and readEvents returns it newest-first', () => {
  const db = freshDb();
  emit(db, 'info', 'scheduler', 'start', { port: 4317 });
  emit(db, 'warn', 'watchdog', 'tick-slow', 'took 5s');
  const rows = readEvents(db);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].source, 'watchdog');
  assert.equal(rows[0].level, 'warn');
  assert.equal(rows[1].source, 'scheduler');
  assert.equal(rows[1].event, 'start');
  assert.equal(JSON.parse(rows[1].detail).port, 4317);
});

test('readEvents filters by level', () => {
  const db = freshDb();
  info(db, 'scheduler', 'heartbeat');
  warn(db, 'verifier', 'check-fail', { task: 'F1' });
  error(db, 'escalation', 'push-fail', { msg: 'timeout' });
  assert.equal(readEvents(db, { level: 'error' }).length, 1);
  assert.equal(readEvents(db, { level: 'warn' }).length, 1);
  assert.equal(readEvents(db, { level: 'info' }).length, 1);
});

test('readEvents filters by source', () => {
  const db = freshDb();
  info(db, 'scheduler', 'start');
  info(db, 'planner', 'promote');
  info(db, 'scheduler', 'heartbeat');
  assert.equal(readEvents(db, { source: 'scheduler' }).length, 2);
  assert.equal(readEvents(db, { source: 'planner' }).length, 1);
});

test('pruneEvents keeps only the last N rows', () => {
  const db = freshDb();
  for (let i = 0; i < 10; i++) emit(db, 'info', 'test', `e${i}`);
  assert.equal(readEvents(db, { limit: 100 }).length, 10);
  const deleted = pruneEvents(db, { keep: 3 });
  assert.equal(deleted, 7);
  assert.equal(readEvents(db, { limit: 100 }).length, 3);
});

test('emit never throws on a closed db', () => {
  const db = freshDb();
  db.close();
  assert.doesNotThrow(() => emit(db, 'info', 'test', 'after-close'));
});

test('readEvents returns empty array on a closed db', () => {
  const db = freshDb();
  db.close();
  assert.deepEqual(readEvents(db), []);
});

test('invalid level defaults to info', () => {
  const db = freshDb();
  emit(db, 'bogus', 'test', 'bad-level');
  const rows = readEvents(db);
  assert.equal(rows[0].level, 'info');
});
