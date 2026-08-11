import { operationalPollingInterval } from './legacy-adapters.mjs';

const operationalEventTypes = ['overview.changed', 'task.changed', 'run.changed', 'alert.changed', 'cost.changed', 'reset'];

export function createRealtimeCoordinator({
  url, scopeKey, refresh, eventSourceFactory = (value) => new EventSource(value),
  setIntervalFn = setInterval, clearIntervalFn = clearInterval, documentRef = globalThis.document,
  pollingIntervalMs = 10_000, failureThreshold = 3, demo = false,
  hasPendingMutation = () => false, onState = () => {},
} = {}) {
  pollingIntervalMs = operationalPollingInterval(pollingIntervalMs);
  let timer = null;
  let source = null;
  let active = false;
  let failures = 0;
  let lastEventId = null;
  let mode = 'stopped';
  let preferredRealtime = false;

  const setState = (next, message) => { mode = next; onState({ mode, message, lastEventId, scopeKey: scopeKey() }); };
  const refreshScoped = async (reason) => {
    if (!active || documentRef?.hidden || hasPendingMutation()) return false;
    const key = scopeKey();
    await refresh(reason, key);
    return key === scopeKey();
  };
  const stopPolling = () => { if (timer != null) clearIntervalFn(timer); timer = null; };
  const startPolling = (message = 'Polling every 10 seconds.') => {
    source?.close?.(); source = null; stopPolling();
    if (!active || documentRef?.hidden) return;
    timer = setIntervalFn(() => refreshScoped('poll'), pollingIntervalMs);
    timer?.unref?.(); setState('polling', message);
  };
  const acceptEvent = (event) => {
    const id = String(event.lastEventId || '');
    if (id && lastEventId != null && Number(id) <= Number(lastEventId)) return;
    if (id) lastEventId = id;
    let payload = {};
    try { payload = JSON.parse(event.data || '{}'); } catch { return; }
    void refreshScoped(payload.type === 'reset' ? 'stream-reset' : 'stream');
  };
  const startStream = () => {
    if (demo || typeof eventSourceFactory !== 'function') return startPolling(demo ? 'Realtime is disabled for demo data; polling is active.' : 'Streaming is unavailable; polling fallback is active.');
    stopPolling(); source?.close?.(); failures = 0;
    const streamUrl = new URL(url(), globalThis.location?.origin || 'http://localhost');
    if (lastEventId) streamUrl.searchParams.set('lastEventId', lastEventId);
    source = eventSourceFactory(`${streamUrl.pathname}${streamUrl.search}`);
    source.addEventListener?.('open', () => { failures = 0; setState('streaming', 'Realtime updates connected.'); });
    source.addEventListener?.('message', acceptEvent);
    for (const type of operationalEventTypes) source.addEventListener?.(type, acceptEvent);
    source.addEventListener?.('error', () => {
      failures++;
      setState('reconnecting', `Realtime reconnect ${failures} of ${failureThreshold}.`);
      if (failures >= failureThreshold) startPolling('Realtime failed three times; polling fallback is active.');
    });
    setState('streaming', 'Connecting realtime updates…');
  };
  const visibility = () => {
    if (!active) return;
    if (documentRef.hidden) { stopPolling(); source?.close?.(); source = null; setState('paused', 'Updates paused while this tab is hidden.'); }
    else { void refreshScoped('visible'); preferredRealtime ? startStream() : startPolling(); }
  };

  return {
    start({ realtime = false } = {}) {
      if (active) return;
      active = true; preferredRealtime = realtime; documentRef?.addEventListener?.('visibilitychange', visibility);
      realtime ? startStream() : startPolling();
    },
    setRealtime(enabled) { preferredRealtime = Boolean(enabled); if (!active) return; enabled ? startStream() : startPolling(); },
    refreshNow: () => refreshScoped('manual'),
    stop() {
      active = false; stopPolling(); source?.close?.(); source = null;
      documentRef?.removeEventListener?.('visibilitychange', visibility); setState('stopped', 'Updates stopped.');
    },
    get state() { return { mode, lastEventId, failures }; },
  };
}
