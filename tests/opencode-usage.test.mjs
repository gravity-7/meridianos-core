import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { opencodeUsageForDirectory, defaultOpencodeDbPath } from '../opencode-usage.mjs';

// Mirrors the real opencode `session` table (verified against the installed 1.17.15 CLI's
// ~/.local/share/opencode/opencode.db) — only the columns opencodeUsageForDirectory reads.
function makeDb(dir) {
  const dbPath = join(dir, 'opencode.db');
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE session (
    id text PRIMARY KEY, directory text NOT NULL, model text,
    tokens_input integer DEFAULT 0, tokens_output integer DEFAULT 0,
    tokens_reasoning integer DEFAULT 0, tokens_cache_read integer DEFAULT 0,
    tokens_cache_write integer DEFAULT 0
  )`);
  return { db, dbPath };
}

test('opencodeUsageForDirectory reads a session row matched by worktree directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oc-usage-'));
  const { db, dbPath } = makeDb(dir);
  db.prepare(`INSERT INTO session (id, directory, model, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    'ses_1', 'C:/projects/.aios-worktrees/aios__F-task-abc123', '{"id":"deepseek-chat","providerID":"deepseek","variant":"default"}',
    8242, 98, 0, 8320, 0,
  );
  db.close();

  const u = opencodeUsageForDirectory('C:/projects/.aios-worktrees/aios__F-task-abc123', { dbPath });
  assert.equal(u.input, 8242);
  assert.equal(u.output, 98);
  assert.equal(u.billable, 8340);
  assert.equal(u.cacheRead, 8320);
  assert.equal(u.model, 'deepseek-chat');
  assert.equal(u.providerID, 'deepseek');
});

test('matches a Windows backslash worktree path against opencode\'s forward-slash directory column', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oc-usage-'));
  const { db, dbPath } = makeDb(dir);
  db.prepare(`INSERT INTO session (id, directory, model, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    'ses_2', 'C:/projects/.aios-worktrees/aios__F-task-xyz', '{"id":"gemma4:e4b","providerID":"ollama"}',
    100, 20, 0, 0, 0,
  );
  db.close();

  const u = opencodeUsageForDirectory('C:\\projects\\.aios-worktrees\\aios__F-task-xyz', { dbPath });
  assert.ok(u, 'expected a match despite the backslash/forward-slash mismatch');
  assert.equal(u.billable, 120);
});

test('folds tokens_reasoning into output and tokens_cache_write into input (fresh-work convention)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oc-usage-'));
  const { db, dbPath } = makeDb(dir);
  db.prepare(`INSERT INTO session (id, directory, model, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write)
    VALUES (?,?,?,?,?,?,?,?)`).run('ses_3', '/repo/wt', null, 1000, 200, 300, 50, 400);
  db.close();

  const u = opencodeUsageForDirectory('/repo/wt', { dbPath });
  assert.equal(u.input, 1400);  // 1000 + 400 cache-write
  assert.equal(u.output, 500);  // 200 + 300 reasoning
  assert.equal(u.billable, 1900);
  assert.equal(u.model, null); // no model JSON — fails soft
});

test('returns null when the db file does not exist', () => {
  const missing = join(tmpdir(), 'does-not-exist-' + Math.random().toString(36).slice(2), 'opencode.db');
  assert.equal(opencodeUsageForDirectory('/anything', { dbPath: missing }), null);
});

test('returns null when the db exists but no session matches this directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oc-usage-'));
  const { db, dbPath } = makeDb(dir);
  db.prepare(`INSERT INTO session (id, directory, tokens_input, tokens_output) VALUES (?,?,?,?)`)
    .run('ses_4', '/repo/some-other-run', 999, 999);
  db.close();

  assert.equal(opencodeUsageForDirectory('/repo/wt-nobody-ran', { dbPath }), null);
});

test('returns null for a falsy directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oc-usage-'));
  const { dbPath } = makeDb(dir);
  assert.equal(opencodeUsageForDirectory(null, { dbPath }), null);
  assert.equal(opencodeUsageForDirectory('', { dbPath }), null);
});

test('sums multiple session rows for the same directory (defensive — normally exactly one)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oc-usage-'));
  const { db, dbPath } = makeDb(dir);
  const ins = db.prepare(`INSERT INTO session (id, directory, model, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write) VALUES (?,?,?,?,?,?,?,?)`);
  ins.run('a', '/repo/wt', '{"id":"m1","providerID":"deepseek"}', 100, 10, 0, 0, 0);
  ins.run('b', '/repo/wt', '{"id":"m1","providerID":"deepseek"}', 50, 5, 0, 0, 0);
  db.close();

  const u = opencodeUsageForDirectory('/repo/wt', { dbPath });
  assert.equal(u.input, 150);
  assert.equal(u.output, 15);
});

test('defaultOpencodeDbPath honors XDG_DATA_HOME, falls back to ~/.local/share', () => {
  const home = '/home/tester';
  const had = Object.prototype.hasOwnProperty.call(process.env, 'XDG_DATA_HOME');
  const prev = process.env.XDG_DATA_HOME;
  try {
    delete process.env.XDG_DATA_HOME;
    assert.equal(defaultOpencodeDbPath(home).replace(/\\/g, '/'), '/home/tester/.local/share/opencode/opencode.db');
    process.env.XDG_DATA_HOME = '/custom/data';
    assert.equal(defaultOpencodeDbPath(home).replace(/\\/g, '/'), '/custom/data/opencode/opencode.db');
  } finally {
    if (had) process.env.XDG_DATA_HOME = prev; else delete process.env.XDG_DATA_HOME;
  }
});
