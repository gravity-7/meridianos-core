/**
 * telemetry — OPT-IN, LOCAL-ONLY usage analytics for the multi-tenant control plane (T199,
 * Phase 10 polish). Follows the same convention as `compliance/audit-log.mjs`'s
 * ActivityLogger/getActivityLogger: a `__dirname`-relative default under `.ai/`, overridable for
 * tests, no injected AiosConfig — this module lives at the control-plane/platform level
 * alongside licensing and compliance, not inside the tenant-agnostic AIOS core.
 *
 * Collects anonymous COUNTS of platform activity (project lifecycle events, template usage,
 * report generation) to a local SQLite table. Nothing is ever sent over the network by this
 * module — "opt-in" means the platform operator explicitly enables local collection
 * (`$MERIDIAN_TELEMETRY=1`, or `MERIDIAN_TELEMETRY_OPT_IN=true` in the environment); if neither
 * is set, `recordEvent` is a silent, cheap no-op. There is no default-on collection and no
 * outbound transmission of any kind — an operator who wants this data shipped anywhere does so
 * themselves, out of band, from the local store this module writes.
 *
 * Events carry no personally-identifying content: an event name, an optional project id (already
 * an opaque UUID, not a name/email), and a small non-identifying payload the caller supplies.
 */
import Database from 'better-sqlite3';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, '.ai', 'control-plane.db');

function isEnabled(env = process.env) {
  return env.MERIDIAN_TELEMETRY === '1' || env.MERIDIAN_TELEMETRY_OPT_IN === 'true';
}

export class TelemetryCollector {
  #db;
  #enabled;

  /**
   * @param {string} [dbPath] - defaults to the shared control-plane.db (same convention as
   *   ActivityLogger); tests pass an isolated path.
   * @param {{env?: object}} [options] - `env` overrides `process.env` for opt-in checks (tests).
   */
  constructor(dbPath = DB_PATH, { env = process.env } = {}) {
    this.#enabled = isEnabled(env);
    this.#db = new Database(dbPath);
    this.#db.pragma('journal_mode = WAL');
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS telemetry_events (
        id TEXT PRIMARY KEY,
        event TEXT NOT NULL,
        project_id TEXT,
        payload TEXT NOT NULL DEFAULT '{}',
        ts INTEGER NOT NULL
      )
    `);
    this.#db.exec(`
      CREATE INDEX IF NOT EXISTS idx_telemetry_events_event ON telemetry_events(event);
      CREATE INDEX IF NOT EXISTS idx_telemetry_events_ts ON telemetry_events(ts);
    `);
  }

  /** Whether this collector is currently allowed to record (opt-in gate). */
  isEnabled() {
    return this.#enabled;
  }

  /**
   * Record one anonymous usage event. No-op (and no DB write at all) unless telemetry is
   * opted in. Never throws on a malformed payload — telemetry must never break the caller's
   * actual operation.
   * @param {string} event - short event name, e.g. 'project_created', 'report_generated'
   * @param {{project_id?: string, [k: string]: any}} [payload]
   */
  record(event, payload = {}) {
    if (!this.#enabled) return { recorded: false, reason: 'opted_out' };
    try {
      const { project_id = null, ...rest } = payload;
      this.#db.prepare(`
        INSERT INTO telemetry_events (id, event, project_id, payload, ts)
        VALUES (?, ?, ?, ?, ?)
      `).run(crypto.randomUUID(), event, project_id, JSON.stringify(rest), Math.floor(Date.now() / 1000));
      return { recorded: true };
    } catch (error) {
      return { recorded: false, reason: 'error', error: error.message };
    }
  }

  /** Summarize recorded events for the trailing `days` (default 30) into per-event counts. */
  summarize({ days = 30 } = {}) {
    const since = Math.floor(Date.now() / 1000) - days * 86400;
    const rows = this.#db.prepare(
      'SELECT event, COUNT(*) as count FROM telemetry_events WHERE ts >= ? GROUP BY event'
    ).all(since);
    const byEvent = {};
    let total = 0;
    for (const row of rows) {
      byEvent[row.event] = row.count;
      total += row.count;
    }
    return { total, byEvent, days };
  }

  close() {
    this.#db.close();
  }
}

let collectorInstance = null;

/** Get the singleton TelemetryCollector (same pattern as getActivityLogger). */
export function getTelemetryCollector() {
  if (!collectorInstance) {
    collectorInstance = new TelemetryCollector();
  }
  return collectorInstance;
}

/** Test helper: reset the singleton so a fresh env/dbPath can be picked up. */
export function _resetTelemetryCollector() {
  try { collectorInstance?.close(); } catch { /* best-effort */ }
  collectorInstance = null;
}
