/**
 * event-store — a per-`db` facade over event-log.mjs's bare functions (ADR 0001 D2: EventStore).
 * `createEventStore(db)` returns an object where every DB-BOUND event-log.mjs function is
 * pre-bound to that `db`, so `store.fn(args)` is EXACTLY `events.fn(db, args)` — same handle,
 * nothing reimplemented. Also carries `recentVerdicts` (promoted from verifier.mjs into
 * event-log.mjs — see verifier.mjs's re-export) since it is itself an event/history read, not
 * task state.
 *
 * This is a pure interface/facade wrap: it imports `* as events` and binds, so it stays
 * automatically in sync with event-log.mjs's signatures and never drifts from them.
 * `event-log.mjs` itself is UNCHANGED in shape — it keeps exporting every bare function
 * (backward-compat for cross-repo callers, e.g. PV's `tools/aios/cli.mjs`, which still calls
 * `fn(db, …)` directly).
 *
 * Internal core modules build one of these at the top of each public function that receives a
 * `db` (`const events = createEventStore(db)`) and call `events.fn(…)` instead of `event-log.fn(db,
 * …)` — a pure rename at every call site, never a behavior change.
 */
import * as events from './event-log.mjs';

// Every DB-BOUND event-log.mjs function (first param is always `db`).
const DB_BOUND_FNS = ['emit', 'info', 'warn', 'error', 'fatal', 'readEvents', 'pruneEvents', 'recentVerdicts'];

/** Build an EventStore bound to one `db` handle: `store.fn(args)` ≡ `events.fn(db, args)`. */
export function createEventStore(db) {
  const store = {};
  for (const name of DB_BOUND_FNS) {
    store[name] = (...args) => events[name](db, ...args);
  }
  return store;
}
