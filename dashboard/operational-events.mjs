export class OperationalEventError extends Error {
  constructor(code, message) { super(message); this.name = 'OperationalEventError'; this.code = code; }
}

export const OPERATIONAL_EVENT_TYPES = Object.freeze(['overview.changed', 'task.changed', 'run.changed', 'alert.changed', 'cost.changed', 'reset']);
const eventTypes = new Set(OPERATIONAL_EVENT_TYPES);

const registeredBrokers = new WeakMap();
export function registerOperationalEventBroker(key, broker) { if (key && typeof key === 'object') registeredBrokers.set(key, broker); return broker; }
export function unregisterOperationalEventBroker(key, broker) { if (registeredBrokers.get(key) === broker) registeredBrokers.delete(key); }
export function publishRegisteredOperationalEvent(key, event) { const broker = registeredBrokers.get(key); return broker ? broker.publish(event) : null; }

function matchesScope(event, scope) {
  if (event.tenantId !== scope.tenantId) return false;
  if (!scope.projectId) return true;
  return event.projectId == null || event.projectId === scope.projectId;
}

export function createOperationalEventBroker({ maxEvents = 1000, maxConnections = 32, heartbeatMs = 15_000, now = () => new Date().toISOString(), setIntervalFn = setInterval, clearIntervalFn = clearInterval } = {}) {
  let sequence = 0;
  let closed = false;
  let heartbeat = null;
  const events = [];
  const subscribers = new Set();

  const ensureHeartbeat = () => {
    if (!heartbeatMs || heartbeat || subscribers.size === 0) return;
    heartbeat = setIntervalFn(() => {
      for (const sub of subscribers) sub.sink({ comment: 'heartbeat', occurredAt: now() });
    }, heartbeatMs);
    heartbeat?.unref?.();
  };
  const stopHeartbeat = () => {
    if (heartbeat && subscribers.size === 0) { clearIntervalFn(heartbeat); heartbeat = null; }
  };

  function publish(input) {
    if (closed) throw new OperationalEventError('SSE_CLOSED', 'event broker is closed');
    if (!eventTypes.has(input?.type) || input.type === 'reset') throw new OperationalEventError('SSE_EVENT_TYPE', 'operational event type is unsupported');
    const event = Object.freeze({
      id: String(++sequence), type: input.type, tenantId: input.tenantId,
      projectId: input.projectId ?? null, entityId: input.entityId ?? null,
      correlationId: input.correlationId ?? null, occurredAt: input.occurredAt ?? now(),
    });
    events.push(event);
    while (events.length > maxEvents) events.shift();
    for (const sub of subscribers) if (matchesScope(event, sub.scope)) sub.sink(event);
    return event;
  }

  function subscribe(scope, resumeId, sink) {
    if (closed) throw new OperationalEventError('SSE_CLOSED', 'event broker is closed');
    if (!scope?.tenantId) throw new OperationalEventError('SSE_SCOPE', 'tenant scope is required');
    if (subscribers.size >= maxConnections) throw new OperationalEventError('SSE_CAPACITY', 'event stream capacity reached');
    if (resumeId != null) {
      const index = events.findIndex((event) => event.id === String(resumeId));
      if (index < 0) sink({ id: String(++sequence), type: 'reset', tenantId: scope.tenantId, projectId: scope.projectId ?? null, entityId: null, correlationId: null, occurredAt: now() });
      else for (const event of events.slice(index + 1)) if (matchesScope(event, scope)) sink(event);
    }
    const sub = { scope: { tenantId: scope.tenantId, projectId: scope.projectId ?? null }, sink };
    subscribers.add(sub);
    ensureHeartbeat();
    let active = true;
    return () => { if (!active) return; active = false; subscribers.delete(sub); stopHeartbeat(); };
  }

  function close() {
    closed = true;
    subscribers.clear();
    if (heartbeat) clearIntervalFn(heartbeat);
    heartbeat = null;
    events.length = 0;
  }

  return { publish, subscribe, close, get size() { return subscribers.size; } };
}
