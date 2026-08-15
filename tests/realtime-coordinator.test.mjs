import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRealtimeCoordinator } from '../dashboard/app/shared/realtime-coordinator.mjs';

function harness(overrides = {}) {
  const intervals = new Map(); let nextTimer = 1; const sources = []; const states = []; const refreshes = [];
  const documentRef = { hidden: false, listeners: new Map(), addEventListener(type, fn) { this.listeners.set(type, fn); }, removeEventListener(type) { this.listeners.delete(type); } };
  class Source {
    constructor(url) { this.url = url; this.listeners = new Map(); this.closed = false; sources.push(this); }
    addEventListener(type, fn) { this.listeners.set(type, fn); }
    close() { this.closed = true; }
    emit(type, value = {}) { (this.listeners.get(type) ?? this[`on${type}`])?.(value); }
  }
  const coordinator = createRealtimeCoordinator({
    url: () => '/api/operations/events?scope=a', scopeKey: () => 'scope-a', refresh: async (reason) => refreshes.push(reason),
    eventSourceFactory: (url) => new Source(url), setIntervalFn: (fn) => { const id = nextTimer++; intervals.set(id, fn); return id; },
    clearIntervalFn: (id) => intervals.delete(id), documentRef, pollingIntervalMs: 10_000,
    onState: (state) => states.push(state), ...overrides,
  });
  return { coordinator, intervals, sources, states, refreshes, documentRef };
}

test('polling is the default, uses one timer, pauses while hidden, and supports manual refresh', async () => {
  const value = harness(); value.coordinator.start();
  assert.equal(value.intervals.size, 1); value.coordinator.start(); assert.equal(value.intervals.size, 1);
  await value.coordinator.refreshNow(); assert.deepEqual(value.refreshes, ['manual']);
  value.documentRef.hidden = true; value.documentRef.listeners.get('visibilitychange')(); assert.equal(value.intervals.size, 0);
  value.documentRef.hidden = false; value.documentRef.listeners.get('visibilitychange')(); assert.equal(value.intervals.size, 1);
  value.coordinator.stop(); assert.equal(value.intervals.size, 0);
});

test('streaming is opt-in, rejects ordered duplicates, resumes, and falls back after three failures', async () => {
  const value = harness(); value.coordinator.start({ realtime: true });
  assert.equal(value.sources.length, 1); assert.equal(value.intervals.size, 0);
  value.sources[0].emit('message', { lastEventId: '2', data: '{"type":"run.changed"}' });
  value.sources[0].emit('message', { lastEventId: '2', data: '{"type":"run.changed"}' });
  value.sources[0].emit('alert.changed', { lastEventId: '3', data: '{"type":"alert.changed"}' });
  await Promise.resolve(); assert.deepEqual(value.refreshes, ['stream', 'stream']);
  value.sources[0].emit('error'); value.sources[0].emit('error'); value.sources[0].emit('error');
  assert.equal(value.sources[0].closed, true); assert.equal(value.intervals.size, 1);
  assert.equal(value.states.at(-1).mode, 'polling'); assert.match(value.states.at(-1).message, /fallback/i);
});

test('demo mode disables streaming and pending mutations defer remote refresh', async () => {
  let pending = true; const value = harness({ demo: true, hasPendingMutation: () => pending });
  value.coordinator.start({ realtime: true }); assert.equal(value.sources.length, 0); assert.equal(value.intervals.size, 1);
  await [...value.intervals.values()][0](); assert.equal(value.refreshes.length, 0);
  pending = false; await [...value.intervals.values()][0](); assert.deepEqual(value.refreshes, ['poll']);
});
