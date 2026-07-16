/**
 * event-log — persistent structured logging for the AIOS daemon.
 * Every lifecycle event, error, and outcome lands in the SQLite `events` table.
 * The module never throws — a logging failure must never crash the daemon.
 */

const VALID_LEVELS = new Set(['info', 'warn', 'error', 'fatal']);

export function emit(db, level, source, event, detail) {
  try {
    if (!VALID_LEVELS.has(level)) level = 'info';
    const ts = new Date().toISOString();
    const detailStr = detail != null ? (typeof detail === 'string' ? detail : JSON.stringify(detail)) : null;
    db.prepare('INSERT INTO events (ts, level, source, event, detail) VALUES (?, ?, ?, ?, ?)')
      .run(ts, level, source, event, detailStr);
  } catch { /* logging must never crash the daemon */ }
}

export const info  = (db, source, event, detail) => emit(db, 'info',  source, event, detail);
export const warn  = (db, source, event, detail) => emit(db, 'warn',  source, event, detail);
export const error = (db, source, event, detail) => emit(db, 'error', source, event, detail);
export const fatal = (db, source, event, detail) => emit(db, 'fatal', source, event, detail);

export function readEvents(db, { limit = 50, level, source } = {}) {
  try {
    const clauses = [];
    const params = [];
    if (level) { clauses.push('level = ?'); params.push(level); }
    if (source) { clauses.push('source = ?'); params.push(source); }
    const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';
    params.push(limit);
    return db.prepare(`SELECT seq, ts, level, source, event, detail FROM events${where} ORDER BY seq DESC LIMIT ?`).all(...params);
  } catch { return []; }
}

export function pruneEvents(db, { keep = 5000 } = {}) {
  try {
    const max = db.prepare('SELECT MAX(seq) AS m FROM events').get()?.m;
    if (max == null) return 0;
    const cutoff = max - keep;
    if (cutoff <= 0) return 0;
    return db.prepare('DELETE FROM events WHERE seq <= ?').run(cutoff).changes;
  } catch { return 0; }
}

// Promoted from verifier.mjs (D2 bite #2, stage 2a) — bodies byte-identical; verifier.mjs
// re-exports this by name so existing external importers keep working.

/** Recently merged tasks (transitions to `done`) for the dashboard `verifier.recent`. */
export function recentVerdicts(db, { limit = 10 } = {}) {
  return db.prepare(
    `SELECT h.ts AS ts, h.task_id AS task, t.pr AS pr, h.actor AS actor
       FROM history h LEFT JOIN tasks t ON t.id = h.task_id
      WHERE h.op = 'transition' AND h.to_state = 'done' ORDER BY h.seq DESC LIMIT ?`,
  ).all(limit).map((r) => ({ task: r.task, pr: r.pr ?? null, verdict: 'pass', ts: r.ts, mergedBy: r.actor || null }));
}
