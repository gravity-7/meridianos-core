/**
 * control-plane.test — card C5 (control plane MVP, ADR 0001 D3.2). Hermetic: every project's
 * `root` is a fresh temp dir (own state store, own worktree root, own policy.yaml), and every test
 * injects a stub `tick` — no real agent is launched, no network touched, no dependence on the
 * ambient repo `.ai/` state (BUG-1 test-env caveat).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createControlPlane } from '../control-plane.mjs';

function tempRoot(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function makeRecord(overrides = {}) {
  return {
    name: 'proj-a',
    roster: ['solo'],
    modelRouting: { solo: { medium: 'solo-medium-model' } },
    root: tempRoot('mos-cp-'),
    ...overrides,
  };
}

// ---- AC1: add + list ------------------------------------------------------------------------

test('AC1: add(validRecord) registers a project; list() returns its id/name/root/tenant', () => {
  const cp = createControlPlane();
  const root = tempRoot('mos-cp-ac1-');
  const id = cp.add(makeRecord({ name: 'alpha', root, tenant: 'tenant-alpha' }));

  assert.equal(id, 'alpha');
  const list = cp.list();
  assert.equal(list.length, 1);
  assert.deepEqual(list[0], { id: 'alpha', name: 'alpha', root, tenant: 'tenant-alpha' });
});

test('AC1b: tenant defaults to the project name when no explicit tenant/policy.gateway.tenant exists', () => {
  const cp = createControlPlane();
  const root = tempRoot('mos-cp-ac1b-');
  cp.add(makeRecord({ name: 'no-tenant-proj', root }));
  const [handle] = cp.list();
  assert.equal(handle.tenant, 'no-tenant-proj');
});

// ---- AC2: invalid record rejected, naming the field -----------------------------------------

test('AC2: add(invalidRecord) missing "roster" throws naming the field; project is NOT added', () => {
  const cp = createControlPlane();
  const bad = { name: 'bad-proj', modelRouting: { solo: { medium: 'x' } }, root: tempRoot('mos-cp-ac2-') };

  assert.throws(() => cp.add(bad), /roster:/);
  assert.equal(cp.list().length, 0);
});

test('AC2b: add(record) missing "root" throws naming root; project is NOT added', () => {
  const cp = createControlPlane();
  const { root, ...noRoot } = makeRecord({ name: 'no-root-proj' });

  assert.throws(() => cp.add(noRoot), /root:/);
  assert.equal(cp.list().length, 0);
});

// ---- AC3: tickAll invokes stub tick once per project, each with its OWN aios config ----------

test('AC3: tickAll() ticks each of 2 projects once, each with its own isolated config/root/tenant', async () => {
  const calls = [];
  const stubTick = async ({ config, project }) => {
    calls.push({ project, repoRoot: config.repoRoot });
    return { ticked: project.id };
  };

  const cp = createControlPlane({ tick: stubTick });
  const rootA = tempRoot('mos-cp-ac3a-');
  const rootB = tempRoot('mos-cp-ac3b-');
  cp.add(makeRecord({ name: 'proj-a', root: rootA, tenant: 'tenant-a' }));
  cp.add(makeRecord({ name: 'proj-b', root: rootB, tenant: 'tenant-b' }));

  const results = await cp.tickAll();

  assert.equal(calls.length, 2, 'stub tick invoked exactly once per project');
  assert.equal(results.length, 2);
  assert.deepEqual(results.map((r) => r.ok), [true, true]);

  const [callA, callB] = calls;
  // Proof of isolation: two DIFFERENT project configs — different repoRoots, different projects.
  assert.notEqual(callA.repoRoot, callB.repoRoot);
  assert.equal(callA.repoRoot, rootA);
  assert.equal(callB.repoRoot, rootB);
  assert.notEqual(callA.project.tenant, callB.project.tenant);
  assert.equal(callA.project.tenant, 'tenant-a');
  assert.equal(callB.project.tenant, 'tenant-b');
  assert.notEqual(callA.project.root, callB.project.root);

  assert.deepEqual(results.find((r) => r.id === 'proj-a').result, { ticked: 'proj-a' });
  assert.deepEqual(results.find((r) => r.id === 'proj-b').result, { ticked: 'proj-b' });
});

// ---- AC4: one project's tick throwing never aborts/contaminates the others ------------------

test('AC4: a throwing project tick is isolated — the other project still ticks and returns ok:true', async () => {
  const stubTick = async ({ project }) => {
    if (project.id === 'sick') throw new Error('boom: sick project exploded');
    return { healthy: true };
  };

  const cp = createControlPlane({ tick: stubTick });
  cp.add(makeRecord({ name: 'sick', root: tempRoot('mos-cp-ac4-sick-') }));
  cp.add(makeRecord({ name: 'well', root: tempRoot('mos-cp-ac4-well-') }));

  const results = await cp.tickAll();
  assert.equal(results.length, 2);

  const sick = results.find((r) => r.id === 'sick');
  const well = results.find((r) => r.id === 'well');

  assert.equal(sick.ok, false);
  assert.ok(sick.error instanceof Error);
  assert.match(sick.error.message, /boom: sick project exploded/);

  assert.equal(well.ok, true);
  assert.deepEqual(well.result, { healthy: true });
  // No cross-contamination: the healthy result carries no trace of the sick project's error.
  assert.equal(well.error, undefined);
});

// ---- AC5: createControlPlane is exported; remove() works too --------------------------------

test('AC5: createControlPlane is exported and usable with only stub tick + minimal records', () => {
  assert.equal(typeof createControlPlane, 'function');
  const cp = createControlPlane({ tick: async () => ({}) });
  assert.equal(typeof cp.add, 'function');
  assert.equal(typeof cp.tickAll, 'function');
  assert.equal(typeof cp.list, 'function');
  assert.equal(typeof cp.remove, 'function');
});

test('remove(id) unregisters a project; a second remove() returns false', () => {
  const cp = createControlPlane({ tick: async () => ({}) });
  const id = cp.add(makeRecord({ name: 'transient', root: tempRoot('mos-cp-rm-') }));

  assert.equal(cp.remove(id), true);
  assert.equal(cp.list().length, 0);
  assert.equal(cp.remove(id), false);
});

// ---- seeding via the `projects` constructor option -------------------------------------------

test('createControlPlane({projects}) seeds the fleet at construction time', () => {
  const cp = createControlPlane({
    projects: [
      makeRecord({ name: 'seed-a', root: tempRoot('mos-cp-seed-a-') }),
      makeRecord({ name: 'seed-b', root: tempRoot('mos-cp-seed-b-') }),
    ],
  });
  assert.deepEqual(cp.list().map((p) => p.id).sort(), ['seed-a', 'seed-b']);
});

test('add() rejects a duplicate project name without touching the existing registration', () => {
  const cp = createControlPlane();
  const root = tempRoot('mos-cp-dup-');
  cp.add(makeRecord({ name: 'dup', root }));
  assert.throws(() => cp.add(makeRecord({ name: 'dup', root: tempRoot('mos-cp-dup2-') })), /already registered/);
  assert.equal(cp.list().length, 1);
});
