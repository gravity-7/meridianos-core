import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOperationalEventBroker } from '../dashboard/operational-events.mjs';

test('operational broker orders, scopes, replays, and resets bounded events', () => {
  const broker = createOperationalEventBroker({ maxEvents: 2, maxConnections: 2, heartbeatMs: 0, now: () => '2026-08-11T00:00:00.000Z' });
  const first = broker.publish({ type: 'alert.changed', tenantId: 't1', projectId: 'p1', entityId: 'a1' });
  const second = broker.publish({ type: 'run.changed', tenantId: 't2', projectId: null, entityId: 'r2' });
  const third = broker.publish({ type: 'cost.changed', tenantId: 't1', projectId: 'p1' });
  assert.throws(() => broker.publish({ type: 'run.recovery', tenantId: 't1' }), (error) => error.code === 'SSE_EVENT_TYPE');
  assert.equal(Number(third.id) > Number(first.id), true);
  const received = [];
  const unsub = broker.subscribe({ tenantId: 't1', projectId: 'p1' }, second.id, (event) => received.push(event));
  assert.deepEqual(received.map((event) => event.type), ['cost.changed']);
  broker.publish({ type: 'run.changed', tenantId: 't2', entityId: 'hidden' });
  assert.equal(received.length, 1);
  unsub();
  const reset = [];
  broker.subscribe({ tenantId: 't1', projectId: 'p1' }, 'missing', (event) => reset.push(event))();
  assert.equal(reset[0].type, 'reset');
  broker.close();
});

test('operational broker enforces its connection cap and cleans subscriptions', () => {
  const broker = createOperationalEventBroker({ maxConnections: 1, heartbeatMs: 0 });
  const close = broker.subscribe({ tenantId: 't' }, null, () => {});
  assert.throws(() => broker.subscribe({ tenantId: 't' }, null, () => {}), (error) => error.code === 'SSE_CAPACITY');
  close();
  const closeAgain = broker.subscribe({ tenantId: 't' }, null, () => {});
  closeAgain();
  broker.close();
});
