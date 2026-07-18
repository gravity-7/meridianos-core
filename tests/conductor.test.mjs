/**
 * conductor tests — the mechanical relaunch decision + the lease guard (card C8).
 * No spawning, no network: we exercise the PURE `decide()` and the filesystem lease primitives.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, pidAlive, acquireLease, MAX_LEASE_MS } from '../conductor.mjs';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const LEASE = join(ROOT, '.ai', 'state', 'orchestrator.lease');
const now = 1_700_000_000_000;

function clearLease() { try { rmSync(LEASE); } catch { /* absent */ } }

test('decide: skips when an orchestrator is alive (double-spawn guard)', () => {
  const r = decide({ now, lease: { pid: 123 }, leaseAlive: true, continuity: {} });
  assert.equal(r.spawn, false);
  assert.match(r.reason, /alive/);
});

test('decide: skips when the last session halted', () => {
  const r = decide({ now, lease: null, leaseAlive: false, continuity: { exit_class: 'halt' } });
  assert.equal(r.spawn, false);
  assert.match(r.reason, /halt/);
});

test('decide: skips when resume_at is in the future', () => {
  const future = new Date(now + 60_000).toISOString();
  const r = decide({ now, lease: null, leaseAlive: false, continuity: { resume_at: future } });
  assert.equal(r.spawn, false);
  assert.match(r.reason, /resume_at/);
});

test('decide: spawns when window is open and no live lease (past resume_at, cards preserved)', () => {
  const past = new Date(now - 60_000).toISOString();
  const continuity = { resume_at: past, in_flight_cards: [{ card: 'C2' }, { card: 'C4' }] };
  const r = decide({ now, lease: null, leaseAlive: false, continuity });
  assert.equal(r.spawn, true);
  // the drill's "zero lost cards" invariant: decide() never mutates the board it reads
  assert.equal(continuity.in_flight_cards.length, 2);
});

test('pidAlive: current process is alive; an impossible pid is not', () => {
  assert.equal(pidAlive(process.pid), true);
  assert.equal(pidAlive(2_147_483_646), false);
  assert.equal(pidAlive(0), false);
});

test('acquireLease: wins on a free slot, refuses to steal a live lease, reclaims a dead one', () => {
  mkdirSync(dirname(LEASE), { recursive: true });
  clearLease();
  // free slot → win
  assert.equal(acquireLease(process.pid, now), true);
  assert.equal(JSON.parse(readFileSync(LEASE, 'utf8')).pid, process.pid);
  // a live lease (this very process) is never stolen
  assert.equal(acquireLease(424242, now), false);
  // a dead-PID lease is reclaimable
  writeFileSync(LEASE, JSON.stringify({ pid: 2_147_483_646, acquired_at: new Date(now).toISOString() }));
  assert.equal(acquireLease(process.pid, now), true);
  // a stale (too-old) lease is reclaimable even if the PID looks alive
  writeFileSync(LEASE, JSON.stringify({ pid: process.pid, acquired_at: new Date(now - MAX_LEASE_MS - 1).toISOString() }));
  assert.equal(acquireLease(12345, now), true);
  clearLease();
  assert.equal(existsSync(LEASE), false);
});
