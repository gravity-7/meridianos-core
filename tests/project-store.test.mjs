import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../db.mjs';
import { upsertTask, getTask } from '../state.mjs';
import { render } from '../render.mjs';
import { createProjectStore } from '../project-store.mjs';
import { resolvePaths } from '../config.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';

const T0 = '2026-07-03T00:00:00.000Z';

function freshConfig() {
  const repoRoot = mkdtempSync(join(tmpdir(), 'aios-projectstore-'));
  return resolvePaths({ root: repoRoot, domain: FIXTURE_DOMAIN });
}

test('createProjectStore exposes .state, .docs, .render', () => {
  const config = freshConfig();
  const db = openDb(':memory:', config);
  const ps = createProjectStore({ db, config });
  assert.equal(typeof ps.state, 'object');
  assert.equal(typeof ps.state.getTask, 'function');
  assert.equal(typeof ps.docs, 'object');
  assert.equal(typeof ps.docs.write, 'function');
  assert.equal(typeof ps.render, 'function');
});

test('.state is a real StateStore bound to the SAME db — writes are visible to bare state.mjs calls', () => {
  const config = freshConfig();
  const db = openDb(':memory:', config);
  const ps = createProjectStore({ db, config });
  ps.state.upsertTask({ id: 'F-1', title: 'one', owner: 'agent-a', status: 'ready-for-impl', priority: 5 }, { now: T0 });
  assert.equal(getTask(db, 'F-1').id, 'F-1');
});

test('.docs is a real DocStore scoped to config.repoRoot', () => {
  const config = freshConfig();
  const db = openDb(':memory:', config);
  const ps = createProjectStore({ db, config });
  const rel = join('.ai', 'inbox', 'F-1.handoff.md');
  ps.docs.write(rel, 'hello');
  assert.equal(ps.docs.read(rel), 'hello');
  assert.equal(readFileSync(join(config.repoRoot, rel), 'utf8'), 'hello');
});

test('.render() writes the two projections byte-for-byte identical to calling render(db, meta, config) directly', () => {
  const configA = freshConfig();
  mkdirSync(join(configA.repoRoot, '.ai', 'state'), { recursive: true });
  const dbA = openDb(':memory:', configA);
  upsertTask(dbA, { id: 'F-1', title: 'one', owner: 'agent-a', status: 'ready-for-impl', priority: 5 }, { now: T0 });
  const meta = { milestones: ['m1'], founder_actions: ['do x'] };
  render(dbA, meta, configA);
  const directJson = readFileSync(configA.boardJson, 'utf8');
  const directMd = readFileSync(configA.boardMd, 'utf8');

  const configB = freshConfig();
  mkdirSync(join(configB.repoRoot, '.ai', 'state'), { recursive: true });
  const dbB = openDb(':memory:', configB);
  upsertTask(dbB, { id: 'F-1', title: 'one', owner: 'agent-a', status: 'ready-for-impl', priority: 5 }, { now: T0 });
  const ps = createProjectStore({ db: dbB, config: configB });
  ps.render(meta);
  const storeJson = readFileSync(configB.boardJson, 'utf8');
  const storeMd = readFileSync(configB.boardMd, 'utf8');

  assert.equal(storeJson, directJson);
  assert.equal(storeMd, directMd);
});
