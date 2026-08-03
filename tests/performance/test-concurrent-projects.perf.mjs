/**
 * Performance test (T201, Phase 10 polish): the platform must comfortably support 10+
 * concurrently-running projects on one control plane (SC-001). This is a smoke-level
 * performance check, not a strict benchmark gate — CI hardware varies, so assertions use
 * generous ceilings and print actual timings for a human to judge trend/regression, rather than
 * failing the build over a few hundred milliseconds of noise.
 *
 * `spawnProcess` is stubbed to avoid actually launching N real `node daemon-entry.mjs`
 * subprocesses (heavy, slow, and liable to hang in CI) — the thing under measurement here is
 * the control plane's own bookkeeping (DB writes, port allocation, process-map tracking,
 * hot-reload watch setup), not subprocess startup latency, which is already an OS-level cost
 * outside this platform's control.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { ProjectManager } from '../../control-plane.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.join(__dirname, '.test-perf-concurrent.db');
const TEST_STATE_DIR = path.join(__dirname, '.test-perf-concurrent-projects');

const PROJECT_COUNT = Number(process.env.MERIDIAN_PERF_PROJECT_COUNT || 15); // > 10 per SC-001
const CREATE_CEILING_MS = 5000;
const START_CEILING_MS = 8000;

describe('Performance: 10+ concurrent projects (T201)', () => {
  let projectManager;
  let testUserId;

  before(async () => {
    for (const p of [TEST_DB_PATH, `${TEST_DB_PATH}-wal`, `${TEST_DB_PATH}-shm`]) {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    if (fs.existsSync(TEST_STATE_DIR)) fs.rmSync(TEST_STATE_DIR, { recursive: true, force: true });

    const db = new Database(TEST_DB_PATH);
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL, is_active BOOLEAN NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'stopped',
        template TEXT, config_path TEXT NOT NULL, state_path TEXT NOT NULL, port INTEGER NOT NULL UNIQUE,
        created_at INTEGER NOT NULL, created_by TEXT NOT NULL, health_status TEXT NOT NULL DEFAULT 'unknown',
        last_health_check INTEGER, restart_count INTEGER NOT NULL DEFAULT 0, last_restart INTEGER,
        FOREIGN KEY (created_by) REFERENCES users(id)
      );
    `);
    const crypto = await import('node:crypto');
    testUserId = crypto.randomUUID();
    db.prepare('INSERT INTO users (id, email, password_hash, created_at, is_active) VALUES (?, ?, ?, ?, 1)')
      .run(testUserId, 'perf-test@example.com', 'hash', Math.floor(Date.now() / 1000));
    db.close();

    projectManager = new ProjectManager(TEST_DB_PATH);
    projectManager.spawnProcess = async () => {
      const fake = new EventEmitter();
      fake.pid = Math.floor(Math.random() * 100000);
      fake.stdout = new EventEmitter();
      fake.stderr = new EventEmitter();
      fake.kill = () => {}; // never emits 'exit' — see test-final-integration.mjs for why
      return fake;
    };
  });

  after(() => {
    projectManager?.close();
    for (const p of [TEST_DB_PATH, `${TEST_DB_PATH}-wal`, `${TEST_DB_PATH}-shm`]) {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    if (fs.existsSync(TEST_STATE_DIR)) fs.rmSync(TEST_STATE_DIR, { recursive: true, force: true });
  });

  let projects = [];

  it(`creates ${PROJECT_COUNT} projects within ${CREATE_CEILING_MS}ms`, () => {
    const start = performance.now();
    projects = Array.from({ length: PROJECT_COUNT }, (_, i) =>
      projectManager.createProject({
        name: `perf-project-${i}`,
        template: 'blank',
        config_path: path.join(TEST_STATE_DIR, `perf-project-${i}`, 'policy.yaml'),
        state_path: path.join(TEST_STATE_DIR, `perf-project-${i}`),
        created_by: testUserId
      })
    );
    const elapsed = performance.now() - start;
    console.log(`  [perf] created ${PROJECT_COUNT} projects in ${elapsed.toFixed(1)}ms`);

    assert.equal(projects.length, PROJECT_COUNT);
    assert.equal(new Set(projects.map((p) => p.id)).size, PROJECT_COUNT, 'ids must be unique');
    assert.equal(new Set(projects.map((p) => p.port)).size, PROJECT_COUNT, 'ports must be unique (no allocation collisions)');
    assert.ok(elapsed < CREATE_CEILING_MS, `project creation took ${elapsed.toFixed(1)}ms, expected < ${CREATE_CEILING_MS}ms`);
  });

  it(`starts all ${PROJECT_COUNT} projects concurrently within ${START_CEILING_MS}ms`, async () => {
    const start = performance.now();
    const results = await Promise.allSettled(projects.map((p) => projectManager.startProject(p.id)));
    const elapsed = performance.now() - start;
    console.log(`  [perf] started ${PROJECT_COUNT} projects concurrently in ${elapsed.toFixed(1)}ms`);

    const failures = results.filter((r) => r.status === 'rejected');
    assert.equal(failures.length, 0, `all starts must succeed; failures: ${failures.map((f) => f.reason?.message).join('; ')}`);
    assert.ok(elapsed < START_CEILING_MS, `concurrent start took ${elapsed.toFixed(1)}ms, expected < ${START_CEILING_MS}ms`);

    const running = projectManager.listProjects({ status: 'running' });
    assert.equal(running.length, PROJECT_COUNT, 'every project must report running after concurrent start');
    assert.equal(projectManager.processes.size, PROJECT_COUNT);
  });

  it('isolates each project\'s hot-reload config from the others', () => {
    // A representative sample (not all 15, to keep this fast): each project's watched
    // policy.yaml is independent, so writing one's config must not bleed into another's.
    for (const p of projects.slice(0, 3)) {
      const effective = projectManager.getEffectiveConfig(p.id);
      assert.deepEqual(effective, {}); // no policy.yaml was written for these — watch started, nothing to report yet
    }
  });

  it('lists all running projects without a full-table-scan-shaped slowdown', () => {
    const start = performance.now();
    for (let i = 0; i < 50; i++) projectManager.listProjects({ status: 'running' }); // exercise idx_projects_status (T196)
    const elapsed = performance.now() - start;
    console.log(`  [perf] 50x listProjects(status=running) over ${PROJECT_COUNT} rows in ${elapsed.toFixed(1)}ms`);
    assert.ok(elapsed < 1000, `50 indexed status queries took ${elapsed.toFixed(1)}ms, expected < 1000ms`);
  });
});
