/**
 * DB handle for the AIOS state core. Zero-dependency: uses Node's built-in `node:sqlite`
 * (Node >= 22.5). WAL + a busy timeout give us a single-writer, ACID store on one local
 * file — exactly what makes atomic task claims race-free when Claude and Antigravity run
 * co-located on the same host.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNoteMarkers } from './sensitive.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SCHEMA_PATH = join(HERE, 'schema.sql');

/**
 * Open (creating + migrating if needed) the state DB.
 * @param {string} [path]    ':memory:' for tests, else a file path. Falls back to $AIOS_DB
 *                           then the repo default .ai/state/aios.db.
 * @param {object} config    the injected AiosConfig (REQUIRED) — its `dbPath` is used when
 *                           `path` is omitted.
 */
export function openDb(path, config) {
  const dbPath = path || config.dbPath;
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });

  const db = new DatabaseSync(dbPath);
  // busy_timeout MUST be set first: it governs every later statement, including the
  // journal_mode switch and the CREATE TABLEs in migrate(). Set it after them and a
  // concurrent open would hit SQLITE_BUSY instantly (0ms timeout) instead of waiting.
  db.exec('PRAGMA busy_timeout = 5000;');  // a losing claimant waits, then sees the task leased
  db.exec('PRAGMA journal_mode = WAL;');   // concurrent readers + one writer
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(readFileSync(SCHEMA_PATH, 'utf8')); // all statements are CREATE ... IF NOT EXISTS
  db.prepare(
    `INSERT INTO schema_meta(key, value) VALUES ('version', '1')
       ON CONFLICT(key) DO NOTHING`,
  ).run();

  // Forward migration: add task_type column to existing DBs (safe to re-run — ALTER TABLE
  // throws "duplicate column" if it already exists from the CREATE TABLE, which we swallow).
  try { db.exec('ALTER TABLE tasks ADD COLUMN task_type TEXT'); } catch { /* already exists */ }

  // §6 governance + park state as DURABLE columns (reversible, additive-nullable migration).
  // Same idempotent pattern: each ALTER throws "duplicate column" on a DB that already has it
  // (fresh DBs get them from the CREATE TABLE), which we swallow.
  try { db.exec('ALTER TABLE tasks ADD COLUMN approved_at TEXT'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE tasks ADD COLUMN snoozed_until TEXT'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE tasks ADD COLUMN skipped_at TEXT'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE tasks ADD COLUMN skip_reason TEXT'); } catch { /* already exists */ }
  backfillGovernanceColumns(db);
}

/**
 * One-time, idempotent, NON-DESTRUCTIVE backfill: lift any legacy §6 note markers into the new
 * columns so approvals/parks made before this migration aren't lost on upgrade. Only ever fills a
 * column that is still NULL (so re-running is a pure no-op, and a founder decision made AFTER the
 * upgrade via the columns is never overwritten by a stale note marker). The note itself is left
 * untouched. Runs after the ALTERs, so the new columns are guaranteed to exist.
 */
export function backfillGovernanceColumns(db) {
  const rows = db.prepare(
    `SELECT id, note, updated_at, approved_at, snoozed_until, skipped_at
       FROM tasks
      WHERE note IS NOT NULL
        AND (approved_at IS NULL OR snoozed_until IS NULL OR skipped_at IS NULL)`,
  ).all();
  for (const r of rows) {
    const m = parseNoteMarkers(r.note);
    if (r.approved_at == null && m.approved) {
      db.prepare('UPDATE tasks SET approved_at = ? WHERE id = ?').run(r.updated_at, r.id);
    }
    if (r.snoozed_until == null && m.snoozedUntil) {
      db.prepare('UPDATE tasks SET snoozed_until = ? WHERE id = ?').run(m.snoozedUntil, r.id);
    }
    if (r.skipped_at == null && m.skipped) {
      db.prepare('UPDATE tasks SET skipped_at = ?, skip_reason = ? WHERE id = ?').run(r.updated_at, m.skipReason ?? null, r.id);
    }
  }
}
