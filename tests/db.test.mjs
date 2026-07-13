/**
 * db.test.mjs — proof that openDb() honors an injected AiosConfig for its default DB path
 * (DI-2). Every existing caller passes an explicit `path` (usually ':memory:'), so this is the
 * one behavior that was only reachable via the implicit singleton before this bite.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../db.mjs';
import { resolvePaths } from '../config.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';

test('openDb() with no explicit path falls back to the injected config.dbPath, not the singleton', () => {
  const root = mkdtempSync(join(tmpdir(), 'aios-db-di2-'));
  try {
    const config = resolvePaths({ root, domain: FIXTURE_DOMAIN });
    const db = openDb(undefined, config);
    try {
      assert.ok(existsSync(config.dbPath), 'the DB file was created at the injected config\'s dbPath');
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('openDb(path) still wins over any config (explicit path takes precedence)', () => {
  const root = mktempConfigRoot();
  try {
    const config = resolvePaths({ root, domain: FIXTURE_DOMAIN });
    const db = openDb(':memory:', config);
    try {
      // ':memory:' never touches config.dbPath at all.
      assert.ok(!existsSync(config.dbPath));
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function mktempConfigRoot() {
  return mkdtempSync(join(tmpdir(), 'aios-db-di2-'));
}
