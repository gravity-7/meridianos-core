/**
 * telemetry — opt-in, LOCAL-ONLY usage counters for Phase 7 features (T104): binary installs,
 * plugin installs, and cloud control-plane connections. Off by default (`policy.telemetry.enabled`
 * must be explicitly `true` — Configuration over Code, constitution V) and, even when on, never
 * phones home: events are appended to the SAME `events` table every other subsystem's structured
 * logging already uses (event-log.mjs), queryable locally via `readEvents()` like anything else.
 * There is no network call anywhere in this module — "telemetry" here means "a local, inspectable
 * count of what happened," not analytics sent to a third party.
 */
import { info as logInfo, readEvents } from './event-log.mjs';

const SOURCE = 'telemetry';

/** Read `policy.telemetry.enabled` (default false — opt-in only). */
function isEnabled(policy) {
  return policy?.telemetry?.enabled === true;
}

/**
 * Record one telemetry event, IF telemetry is enabled. A no-op otherwise (never throws either
 * way — telemetry must never affect the feature it's counting).
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} event  e.g. 'binary.installed', 'plugin.installed', 'cloud.connected'
 * @param {object} [detail]  small, non-sensitive JSON-serializable detail (e.g. {os: 'windows'})
 * @param {{policy?: object}} [opts]
 */
export function recordEvent(db, event, detail, { policy } = {}) {
  try {
    if (!isEnabled(policy)) return;
    logInfo(db, SOURCE, event, detail);
  } catch { /* telemetry must never break the feature it's observing */ }
}

// ─── Phase 7 convenience wrappers — one per feature this task calls out ────────────────────

export const recordBinaryInstalled = (db, { platform, mechanism }, opts) =>
  recordEvent(db, 'binary.installed', { platform, mechanism }, opts);

export const recordPluginInstalled = (db, { pluginId }, opts) =>
  recordEvent(db, 'plugin.installed', { pluginId }, opts);

export const recordCloudConnected = (db, { orgId }, opts) =>
  recordEvent(db, 'cloud.connected', { orgId }, opts);

/** Summarize recorded telemetry (counts per event type) — what a user sees if they ask "what
 *  have you been counting?" (transparency for an opt-in feature). */
export function summarize(db, { limit = 1000 } = {}) {
  const events = readEvents(db, { limit, source: SOURCE });
  const counts = {};
  for (const e of events) counts[e.event] = (counts[e.event] ?? 0) + 1;
  return counts;
}
