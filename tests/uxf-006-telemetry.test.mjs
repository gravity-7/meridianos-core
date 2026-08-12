import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUxfEvent, recordUxfEvent } from '../dashboard/uxf-telemetry.mjs';

test('UXF telemetry is an allowlisted, pseudonymous envelope', () => {
  const event = createUxfEvent({
    event: 'global_search_used', route: '/app/operations/tasks?query=secret', scopeKey: 'tenant-a/alpha', role: 'operator',
    featureFlag: 'uxf006', durationMs: 42, outcome: 'success', query: 'api-key-secret', prompt: 'never', apiKey: 'sk-secret', rawRequest: '{secret}',
  });
  assert.equal(event.event, 'global_search_used');
  assert.equal(event.route, '/app/operations/tasks');
  assert.notEqual(event.scope, 'tenant-a/alpha');
  assert.equal(event.durationMs, 42);
  assert.deepEqual(Object.keys(event).sort(), ['durationMs', 'event', 'featureFlag', 'outcome', 'role', 'route', 'scope', 'timestamp']);
  assert.equal(JSON.stringify(event).includes('secret'), false);
});

test('UXF telemetry rejects unsupported events and unsafe values without throwing', () => {
  assert.equal(createUxfEvent({ event: 'not_allowed', route: '/app', scopeKey: 'x' }), null);
  assert.equal(createUxfEvent({ event: 'global_search_used', route: 'javascript:prompt(1)', scopeKey: 'x', role: 'admin', outcome: 'success' }), null);
  assert.equal(createUxfEvent({ event: 'global_search_used', route: '/app', scopeKey: 'x', outcome: 'raw secret' }), null);
});

test('recordUxfEvent is opt-in, safe for broken sinks, and never breaks callers', () => {
  const recorded = [];
  assert.equal(recordUxfEvent((event) => recorded.push(event), { event: 'command_executed', route: '/app', scopeKey: 'x', role: 'operator', outcome: 'success' }, { enabled: false }), false);
  assert.equal(recorded.length, 0);
  assert.equal(recordUxfEvent((event) => recorded.push(event), { event: 'command_executed', route: '/app', scopeKey: 'x', role: 'operator', outcome: 'success' }, { enabled: true }), true);
  assert.equal(recorded.length, 1);
  assert.equal(recordUxfEvent(() => { throw new Error('sink'); }, { event: 'command_executed', route: '/app', scopeKey: 'x', role: 'operator', outcome: 'success' }, { enabled: true }), false);
});
