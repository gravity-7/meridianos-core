import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupDatabase, backupDatabaseTimestamped, restoreDatabase, listBackups, pruneBackups } from '../db-backup.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_PATH = path.join(__dirname, '.test-backup-src.db');
const BACKUP_DIR = path.join(__dirname, '.test-backup-dir');

function cleanup() {
  if (fs.existsSync(SRC_PATH)) fs.unlinkSync(SRC_PATH);
  if (fs.existsSync(BACKUP_DIR)) fs.rmSync(BACKUP_DIR, { recursive: true, force: true });
  for (const ext of ['-wal', '-shm']) {
    if (fs.existsSync(`${SRC_PATH}${ext}`)) fs.unlinkSync(`${SRC_PATH}${ext}`);
  }
}

describe('db-backup', () => {
  before(cleanup);
  after(cleanup);

  test('backupDatabase writes a snapshot that contains the source data', () => {
    const db = new Database(SRC_PATH);
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    db.prepare('INSERT INTO t (v) VALUES (?)').run('hello');

    const destPath = path.join(BACKUP_DIR, 'snapshot.db');
    const result = backupDatabase(db, destPath);
    assert.equal(result.path, destPath);
    assert.ok(result.size > 0);
    assert.ok(fs.existsSync(destPath));

    const backupDb = new Database(destPath, { readonly: true });
    const row = backupDb.prepare('SELECT v FROM t WHERE id = 1').get();
    assert.equal(row.v, 'hello');
    backupDb.close();
    db.close();
  });

  test('backupDatabase overwrites an existing file at destPath', () => {
    const db = new Database(SRC_PATH);
    db.exec('CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, v TEXT)');
    db.exec('DELETE FROM t');
    db.prepare('INSERT INTO t (v) VALUES (?)').run('second-pass');

    const destPath = path.join(BACKUP_DIR, 'snapshot.db'); // same path as previous test
    backupDatabase(db, destPath);
    const backupDb = new Database(destPath, { readonly: true });
    const rows = backupDb.prepare('SELECT v FROM t').all();
    assert.deepEqual(rows.map((r) => r.v), ['second-pass']);
    backupDb.close();
    db.close();
  });

  test('backupDatabaseTimestamped builds a prefixed, timestamped filename', () => {
    const db = new Database(SRC_PATH);
    const result = backupDatabaseTimestamped(db, BACKUP_DIR, 'control-plane');
    assert.match(path.basename(result.path), /^control-plane-.+\.db$/);
    db.close();
  });

  test('backupDatabase locks the backup file down to 0600 on POSIX (security-audit.md §6)', { skip: process.platform === 'win32' }, () => {
    const db = new Database(SRC_PATH);
    const destPath = path.join(BACKUP_DIR, 'perms.db');
    backupDatabase(db, destPath);
    const mode = fs.statSync(destPath).mode & 0o777;
    assert.equal(mode, 0o600);
    db.close();
  });

  test('restoreDatabase replaces destPath with the backup contents and keeps a pre-restore copy', () => {
    const srcDb = new Database(SRC_PATH);
    srcDb.pragma('journal_mode = WAL');
    srcDb.exec('CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, v TEXT)');
    srcDb.exec('DELETE FROM t');
    srcDb.prepare('INSERT INTO t (v) VALUES (?)').run('pre-corruption');
    const backupPath = path.join(BACKUP_DIR, 'good.db');
    backupDatabase(srcDb, backupPath);

    // Simulate the live DB drifting/getting corrupted after the backup was taken.
    srcDb.exec('DELETE FROM t');
    srcDb.prepare('INSERT INTO t (v) VALUES (?)').run('corrupted-state');
    srcDb.close();

    const result = restoreDatabase(backupPath, SRC_PATH);
    assert.equal(result.path, SRC_PATH);
    assert.ok(result.preRestoreCopy && fs.existsSync(result.preRestoreCopy));

    const restored = new Database(SRC_PATH, { readonly: true });
    const rows = restored.prepare('SELECT v FROM t').all();
    assert.deepEqual(rows.map((r) => r.v), ['pre-corruption']);
    restored.close();

    fs.unlinkSync(result.preRestoreCopy);
  });

  test('restoreDatabase throws when the backup file does not exist', () => {
    assert.throws(() => restoreDatabase(path.join(BACKUP_DIR, 'nope.db'), SRC_PATH), /backup file not found/);
  });

  test('listBackups/pruneBackups', () => {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const db = new Database(':memory:');
    for (let i = 0; i < 5; i++) {
      backupDatabase(db, path.join(BACKUP_DIR, `p-${i}.db`));
    }
    db.close();

    const all = listBackups(BACKUP_DIR, 'p-');
    assert.equal(all.length, 5);

    const deleted = pruneBackups(BACKUP_DIR, 'p-', 2);
    assert.equal(deleted.length, 3);
    assert.equal(listBackups(BACKUP_DIR, 'p-').length, 2);
  });

  test('listBackups returns [] for a directory that does not exist', () => {
    assert.deepEqual(listBackups(path.join(__dirname, '.nonexistent-backup-dir')), []);
  });
});
