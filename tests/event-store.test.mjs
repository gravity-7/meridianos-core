import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db.mjs';
import { upsertTask } from '../state.mjs';
import { emit, info, warn, error, readEvents, pruneEvents, recentVerdicts } from '../event-log.mjs';
import { createEventStore } from '../event-store.mjs';

function freshDb() { return openDb(':memory:'); }

test('createEventStore(db).emit(...) round-trips exactly like event-log.emit(db, ...)', () => {
  const db = freshDb();
  const store = createEventStore(db);
  store.emit('info', 'scheduler', 'start', { port: 4317 });
  store.emit('warn', 'watchdog', 'tick-slow', 'took 5s');
  const rows = store.readEvents();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].source, 'watchdog');
  assert.equal(rows[0].level, 'warn');
  assert.equal(rows[1].source, 'scheduler');
  assert.equal(rows[1].event, 'start');
  assert.equal(JSON.parse(rows[1].detail).port, 4317);
});

test('store.info/warn/error/fatal thread through to the SAME rows a bare event-log call would produce', () => {
  const db = freshDb();
  const store = createEventStore(db);
  store.info('scheduler', 'heartbeat');
  store.warn('verifier', 'check-fail', { task: 'F1' });
  store.error('escalation', 'push-fail', { msg: 'timeout' });
  store.fatal('scheduler', 'unrecoverable');
  assert.equal(readEvents(db, { level: 'info' }).length, 1);
  assert.equal(readEvents(db, { level: 'warn' }).length, 1);
  assert.equal(readEvents(db, { level: 'error' }).length, 1);
  assert.equal(readEvents(db, { level: 'fatal' }).length, 1);
});

test('store.readEvents(opts) filters by level and source exactly like the bare function', () => {
  const db = freshDb();
  const store = createEventStore(db);
  store.info('scheduler', 'start');
  store.info('planner', 'promote');
  store.info('scheduler', 'heartbeat');
  assert.equal(store.readEvents({ source: 'scheduler' }).length, 2);
  assert.equal(store.readEvents({ source: 'planner' }).length, 1);
  assert.deepEqual(store.readEvents({ source: 'scheduler' }), readEvents(db, { source: 'scheduler' }));
});

test('store.pruneEvents(opts) keeps only the last N rows, same as event-log.pruneEvents', () => {
  const db = freshDb();
  const store = createEventStore(db);
  for (let i = 0; i < 10; i++) store.emit('info', 'test', `e${i}`);
  assert.equal(store.readEvents({ limit: 100 }).length, 10);
  const deleted = store.pruneEvents({ keep: 3 });
  assert.equal(deleted, 7);
  assert.equal(store.readEvents({ limit: 100 }).length, 3);
});

test('a write via the store is visible to a bare event-log.readEvents on the SAME db handle', () => {
  const db = freshDb();
  const store = createEventStore(db);
  store.emit('info', 'gateway', 'start', { url: 'http://localhost:0' });
  const bare = readEvents(db);
  assert.equal(bare.length, 1);
  assert.equal(bare[0].event, 'start');
});

test('emit never throws on a closed db (store mirrors event-log\'s never-throw contract)', () => {
  const db = freshDb();
  const store = createEventStore(db);
  db.close();
  assert.doesNotThrow(() => store.emit('info', 'test', 'after-close'));
  assert.deepEqual(store.readEvents(), []);
});

// --- recentVerdicts (promoted from verifier.mjs into event-log.mjs; carried on the EventStore) ---

const T0 = '2026-07-03T00:00:00.000Z';

test('store.recentVerdicts() matches event-log.recentVerdicts(db, ...) exactly', () => {
  const db = openDb(':memory:');
  upsertTask(db, { id: 'F-1', title: 'one', owner: 'agent-a', status: 'ready-for-impl', priority: 5 }, { now: T0 });
  db.prepare(`INSERT INTO history(ts, task_id, from_state, to_state, actor, op, note) VALUES (?,?,?,?,?,?,?)`)
    .run(T0, 'F-1', 'in-review', 'done', 'verifier', 'transition', 'auto-merged by verifier (verifier_gated)');
  db.prepare('UPDATE tasks SET pr = ? WHERE id = ?').run('42', 'F-1');

  const store = createEventStore(db);
  const viaStore = store.recentVerdicts();
  const viaBare = recentVerdicts(db);
  assert.deepEqual(viaStore, viaBare);
  assert.equal(viaStore.length, 1);
  assert.equal(viaStore[0].task, 'F-1');
  assert.equal(viaStore[0].pr, '42');
  assert.equal(viaStore[0].verdict, 'pass');
  assert.equal(viaStore[0].mergedBy, 'verifier');
});

test('store.recentVerdicts respects the limit option', () => {
  const db = openDb(':memory:');
  for (let i = 0; i < 5; i++) {
    upsertTask(db, { id: `F-${i}`, title: `t${i}`, owner: 'agent-a', status: 'ready-for-impl', priority: 5 }, { now: T0 });
    db.prepare(`INSERT INTO history(ts, task_id, from_state, to_state, actor, op, note) VALUES (?,?,?,?,?,?,?)`)
      .run(T0, `F-${i}`, 'in-review', 'done', 'verifier', 'transition', 'merged');
  }
  const store = createEventStore(db);
  assert.equal(store.recentVerdicts({ limit: 2 }).length, 2);
});
