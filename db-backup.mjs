/**
 * db-backup — point-in-time backup/restore for the platform's SQLite databases (T197, Phase 10
 * polish). Backs the control plane's `control-plane.db` and any per-project state DB.
 *
 * Uses `VACUUM INTO`, plain SQL supported by both `better-sqlite3` (control-plane.db,
 * licensing/compliance DBs) and Node's built-in `node:sqlite` (per-project state DBs) — so this
 * module works against either binding without caring which one opened the handle. `VACUUM INTO`
 * also produces a consistent snapshot safely even while the source DB is open in WAL mode with
 * concurrent readers/writers, unlike a raw filesystem copy of the `.db` file (which can race the
 * WAL and produce a torn, unusable copy).
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * Write a consistent snapshot of `db` to `destPath`.
 * @param {{prepare: Function}} db - an open DB handle (better-sqlite3 or node:sqlite)
 * @param {string} destPath - where to write the backup file (parent dirs created as needed)
 * @returns {{path: string, size: number, timestamp: string}}
 */
export function backupDatabase(db, destPath) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  if (fs.existsSync(destPath)) fs.unlinkSync(destPath); // VACUUM INTO refuses to overwrite
  db.prepare('VACUUM INTO ?').run(destPath);
  // VACUUM INTO creates destPath with the process's default umask, which can be more permissive
  // than appropriate for a file that may contain password hashes, JWT session data, and license
  // keys (security-audit.md §6). Lock it down on POSIX; a no-op on Windows, which has no chmod
  // bit model — NTFS ACLs are the platform's equivalent and out of scope for a portable fix here.
  if (process.platform !== 'win32') {
    try { fs.chmodSync(destPath, 0o600); } catch { /* best-effort */ }
  }
  return { path: destPath, size: fs.statSync(destPath).size, timestamp: new Date().toISOString() };
}

/**
 * Build a timestamped backup path under `backupDir` and back `db` up to it.
 * @param {{prepare: Function}} db
 * @param {string} backupDir
 * @param {string} [prefix] - filename prefix, e.g. 'control-plane'
 */
export function backupDatabaseTimestamped(db, backupDir, prefix = 'backup') {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return backupDatabase(db, path.join(backupDir, `${prefix}-${ts}.db`));
}

/**
 * Restore `destPath` from a backup file. The caller MUST close any open handle on `destPath`
 * before calling this — swapping a SQLite file out from under a live handle corrupts the WAL.
 * A safety copy of the current file is kept alongside (`<destPath>.pre-restore.<ts>`) unless
 * `keepPreRestoreCopy` is false, and any stale `-wal`/`-shm` sidecar files are removed so the
 * restored file isn't merged with WAL frames that no longer apply to it.
 * @param {string} backupPath
 * @param {string} destPath
 * @param {{keepPreRestoreCopy?: boolean}} [options]
 * @returns {{path: string, restoredFrom: string, preRestoreCopy: string|null}}
 */
export function restoreDatabase(backupPath, destPath, { keepPreRestoreCopy = true } = {}) {
  if (!fs.existsSync(backupPath)) {
    throw new Error(`restoreDatabase: backup file not found: ${backupPath}`);
  }

  let preRestoreCopy = null;
  if (keepPreRestoreCopy && fs.existsSync(destPath)) {
    preRestoreCopy = `${destPath}.pre-restore.${Date.now()}`;
    fs.copyFileSync(destPath, preRestoreCopy);
  }

  for (const ext of ['-wal', '-shm']) {
    const sidecar = `${destPath}${ext}`;
    if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
  }

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(backupPath, destPath);
  return { path: destPath, restoredFrom: backupPath, preRestoreCopy };
}

/** List `*.db` backups in `backupDir` matching `prefix`, newest first. */
export function listBackups(backupDir, prefix = '') {
  if (!fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.db'))
    .map((f) => {
      const full = path.join(backupDir, f);
      const stat = fs.statSync(full);
      return { file: f, path: full, size: stat.size, mtime: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.mtime.localeCompare(a.mtime));
}

/** Delete backups beyond the `keep` most-recent (by mtime) for `prefix`. Returns deleted paths. */
export function pruneBackups(backupDir, prefix = '', keep = 7) {
  const stale = listBackups(backupDir, prefix).slice(keep);
  for (const b of stale) fs.unlinkSync(b.path);
  return stale.map((b) => b.path);
}
