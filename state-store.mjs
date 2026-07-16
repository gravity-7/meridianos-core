/**
 * state-store — a per-`db` facade over state.mjs's bare functions (ADR 0001 D2: StateStore).
 * `createStateStore(db)` returns an object where every DB-BOUND state.mjs function is pre-bound
 * to that `db`, so `store.fn(args)` is EXACTLY `state.fn(db, args)` — same transaction, same
 * handle, nothing reimplemented.
 *
 * This is a pure interface/facade wrap: it imports `* as state` and binds, so it stays
 * automatically in sync with state.mjs's signatures and never drifts from them. `state.mjs`
 * itself is UNCHANGED — it keeps exporting every bare function (backward-compat for cross-repo
 * callers, e.g. PV's `tools/aios/cli.mjs`, which still calls `fn(db, …)` directly).
 *
 * Internal core modules build one of these at the top of each public function that receives a
 * `db` (`const store = createStateStore(db)`) and call `store.fn(…)` instead of `state.fn(db,
 * …)` — a pure rename at every call site, never a behavior change.
 */
import * as state from './state.mjs';

// Every DB-BOUND state.mjs function (first param is always `db`). Pure, non-db helpers
// (parseJsonArray, nowIso) are NOT in this list — they are re-exposed as direct passthroughs
// below instead of being (incorrectly) bound to a db they don't take.
const DB_BOUND_FNS = [
  'getTask', 'listTasks', 'listSprints', 'listPIs', 'upsertTask', 'seedTasks', 'upsertPI',
  'upsertSprint', 'claimTask', 'heartbeat', 'releaseLease', 'forceReleaseLease',
  'releaseAllLeases', 'pruneHistory', 'reapExpiredLeases', 'transition', 'blockTask',
  'annotateTask', 'setGovernanceFlags', 'nextEligibleTask',
];

/** Build a StateStore bound to one `db` handle: `store.fn(args)` ≡ `state.fn(db, args)`. */
export function createStateStore(db) {
  const store = {};
  for (const name of DB_BOUND_FNS) {
    store[name] = (...args) => state[name](db, ...args);
  }
  // Non-db passthroughs — re-exposed for callers that hold a store and want the pure helpers
  // too, without a second import. NOT rebound (they don't take a db).
  store.parseJsonArray = state.parseJsonArray;
  store.nowIso = state.nowIso;
  store.DEFAULT_TTL_MS = state.DEFAULT_TTL_MS;
  store.DAY = state.DAY;
  return store;
}
