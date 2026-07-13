import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../db.mjs';
import { upsertTask } from '../state.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER = join(HERE, 'helpers', 'race-worker.mjs');

function runWorker(dbPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', WORKER], {
      env: { ...process.env, AIOS_DB: dbPath },
    });
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`worker exited ${code}: ${err}`));
      try { resolve(JSON.parse(out.trim())); } catch { reject(new Error(`bad worker output: '${out}' err='${err}'`)); }
    });
  });
}

test('N OS processes race for one task → exactly one wins, the rest see it leased', async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'aios-race-')), 'race.db');
  const db = openDb(dbPath);
  upsertTask(db, { id: 'RACE', title: 'contended', owner: 'claude', status: 'ready-for-impl', priority: 1 });
  db.close();

  const N = 6;
  const results = await Promise.all(Array.from({ length: N }, () => runWorker(dbPath)));
  const winners = results.filter((r) => r.won);
  assert.equal(winners.length, 1, `expected exactly one winner, got ${winners.length}: ${JSON.stringify(results)}`);
  assert.ok(
    results.filter((r) => !r.won).every((r) => r.reason === 'leased'),
    `all losers should report 'leased': ${JSON.stringify(results)}`,
  );
});
