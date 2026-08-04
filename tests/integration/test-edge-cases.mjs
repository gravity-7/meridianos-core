/**
 * Integration tests for Phase 10 polish edge cases (T195):
 *   1. Control-plane crash: a fresh ProjectManager reconciles stale 'running' rows left behind
 *      by a crashed prior instance, instead of reporting a phantom running project.
 *   2. Concurrent config changes: two OS processes writing DIFFERENT keys to the same
 *      policy.yaml at the same time must not lose either update (writePolicy's file lock).
 *   3. License server unreachable: LicenseRefresh.refreshFromServer degrades gracefully (no
 *      throw, no DB corruption) when the remote license server can't be reached.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { ProjectManager } from '../../control-plane.mjs';
import { LicenseValidator } from '../../licensing/license-validate.mjs';
import { LicenseRefresh } from '../../licensing/license-refresh.mjs';
import { parseYaml } from '../../yaml-lite.mjs';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECTS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'stopped',
    template TEXT,
    config_path TEXT NOT NULL,
    state_path TEXT NOT NULL,
    port INTEGER NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    created_by TEXT NOT NULL,
    health_status TEXT NOT NULL DEFAULT 'unknown',
    last_health_check INTEGER,
    restart_count INTEGER NOT NULL DEFAULT 0,
    last_restart INTEGER,
    FOREIGN KEY (created_by) REFERENCES users(id)
  );
`;

describe('Edge Case Integration Tests (T195)', () => {
  describe('1. Control-plane crash recovery', () => {
    const TEST_DB_PATH = path.join(__dirname, '.test-edge-crash.db');
    const TEST_STATE_DIR = path.join(__dirname, '.test-edge-crash-projects');
    let testUserId;
    let crashedInstanceDb; // the "first" instance's raw handle — never closed via the normal
                            // lifecycle (that's the simulated crash), but still needs releasing
                            // before Windows will let the test file be deleted in `after`.

    before(async () => {
      if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
      if (fs.existsSync(TEST_STATE_DIR)) fs.rmSync(TEST_STATE_DIR, { recursive: true, force: true });

      const db = new Database(TEST_DB_PATH);
      db.exec(PROJECTS_SCHEMA);
      const crypto = await import('node:crypto');
      testUserId = crypto.randomUUID();
      db.prepare('INSERT INTO users (id, email, password_hash, created_at, is_active) VALUES (?, ?, ?, ?, 1)')
        .run(testUserId, 'crash-test@example.com', 'hash', Math.floor(Date.now() / 1000));
      db.close();
    });

    after(() => {
      try { crashedInstanceDb?.close(); } catch { /* already closed / never opened */ }
      if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
      if (fs.existsSync(TEST_STATE_DIR)) fs.rmSync(TEST_STATE_DIR, { recursive: true, force: true });
    });

    it('marks a project stuck in "running" as stopped/down when a new ProjectManager starts (simulated crash)', () => {
      // First "instance": create + mark a project running, then simulate a hard crash by
      // just dropping the reference — no stopProject, no graceful shutdown, no ProjectManager
      // .close(). (The raw db handle is released in `after`, purely so Windows will allow
      // deleting the test file afterward — a real OS process crash would release it too, just
      // not through application code, which is exactly the scenario under test: no in-memory
      // state, including `processes`, survives.)
      const first = new ProjectManager(TEST_DB_PATH);
      crashedInstanceDb = first.db;
      const project = first.createProject({
        name: 'crash-recovery-project',
        template: 'blank',
        config_path: path.join(TEST_STATE_DIR, 'crash-recovery-project', 'policy.yaml'),
        state_path: path.join(TEST_STATE_DIR, 'crash-recovery-project'),
        created_by: testUserId
      });
      first.db.prepare("UPDATE projects SET status = 'running' WHERE id = ?").run(project.id);

      // Second "instance": a fresh ProjectManager over the SAME db, as if the control plane
      // process was restarted after the crash.
      const second = new ProjectManager(TEST_DB_PATH);
      try {
        const recovered = second.getProject(project.id);
        assert.equal(recovered.status, 'stopped', 'stale running row must be reconciled to stopped');
        assert.equal(recovered.health_status, 'down');
        assert.equal(second.processes.has(project.id), false, 'no process handle should exist post-crash');
      } finally {
        second.close();
      }
    });

    it('reconcileAfterCrash is a no-op when no projects are stuck running', () => {
      const pm = new ProjectManager(TEST_DB_PATH);
      try {
        const reconciled = pm.reconcileAfterCrash();
        assert.deepEqual(reconciled, []);
      } finally {
        pm.close();
      }
    });
  });

  describe('2. Concurrent config changes', () => {
    const TEST_POLICY_PATH = path.join(__dirname, '.test-edge-concurrent-policy.yaml');
    const CHILD_SCRIPT = path.join(__dirname, 'fixtures', 'write-policy-child.mjs');

    const SAMPLE_POLICY = `version: 1
kill_switch: false
work:
  max_parallel: 2
quiet_hours:
  enabled: false
  from: "01:00"
`;

    before(() => {
      fs.writeFileSync(TEST_POLICY_PATH, SAMPLE_POLICY);
    });

    after(() => {
      for (const f of [TEST_POLICY_PATH, `${TEST_POLICY_PATH}.lock`]) {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      }
    });

    function runChild(dottedPath, value) {
      return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [CHILD_SCRIPT, TEST_POLICY_PATH, dottedPath, String(value)], {
          stdio: 'pipe'
        });
        let stderr = '';
        child.stderr.on('data', (d) => { stderr += d; });
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`child exited ${code}: ${stderr}`))));
        child.on('error', reject);
      });
    }

    it('two concurrent writers updating different keys both land (no lost update)', async () => {
      await Promise.all([
        runChild('work.max_parallel', 7),
        runChild('quiet_hours.enabled', true)
      ]);

      const final = parseYaml(fs.readFileSync(TEST_POLICY_PATH, 'utf8'));
      assert.equal(final.work.max_parallel, 7, 'first writer\'s update must survive the race');
      assert.equal(final.quiet_hours.enabled, true, 'second writer\'s update must survive the race');
      // Every other line/value must still be intact.
      assert.equal(final.kill_switch, false);
      assert.equal(final.quiet_hours.from, '01:00');
    });

    it('does not leave a stale lock file behind after a successful write', async () => {
      await runChild('work.max_parallel', 3);
      assert.equal(fs.existsSync(`${TEST_POLICY_PATH}.lock`), false);
    });
  });

  describe('3. License server unreachable', () => {
    const TEST_LICENSE_DB_PATH = path.join(__dirname, '.test-edge-license.db');
    let db;
    let validator;
    let licenseKey;

    before(() => {
      if (fs.existsSync(TEST_LICENSE_DB_PATH)) fs.unlinkSync(TEST_LICENSE_DB_PATH);
      db = new Database(TEST_LICENSE_DB_PATH);
      validator = new LicenseValidator(db); // creates the licenses table
      // getLimits() also reads `projects`/`users` for usage counts — minimal empty tables so
      // that call path works the same way it would against the real control-plane.db.
      db.exec(`
        CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY);
      `);

      // NOTE: LicenseKey.generate()/validate() has a pre-existing, unrelated round-trip bug
      // (flagged separately) — freshly generated keys currently fail LicenseKey.validate()
      // even in-process. This test isn't about that crypto round-trip; it's about
      // LicenseRefresh degrading gracefully when the remote server is unreachable, so seed the
      // `licenses` row directly, the same shape LicenseValidator.validate() would have written.
      licenseKey = 'mer-edge-test-license-key';
      const now = Math.floor(Date.now() / 1000);
      db.prepare(`
        INSERT INTO licenses (id, license_key, tier, status, features, customer_id, subscription_id, expires_at, last_validated, created_at, updated_at)
        VALUES (?, ?, 'pro', 'active', ?, 'cust-edge-case', NULL, ?, ?, ?, ?)
      `).run(
        'lic-edge-case',
        licenseKey,
        JSON.stringify(['unlimited_agents', 'kubernetes_deploy']),
        now + 86400 * 30,
        now,
        now,
        now
      );
    });

    after(() => {
      db?.close();
      if (fs.existsSync(TEST_LICENSE_DB_PATH)) fs.unlinkSync(TEST_LICENSE_DB_PATH);
    });

    it('refreshFromServer resolves with a failure result (not a throw) when fetch rejects', async () => {
      const refresh = new LicenseRefresh(db, { licenseServerUrl: 'https://license.invalid.example' });
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => { throw new Error('network unreachable (simulated)'); };
      try {
        const result = await refresh.refreshFromServer(licenseKey);
        assert.equal(result.success, false);
        assert.match(result.error, /network unreachable/);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('refreshFromServer resolves with a failure result when the server responds non-OK', async () => {
      const refresh = new LicenseRefresh(db, { licenseServerUrl: 'https://license.invalid.example' });
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => ({ ok: false, status: 503 });
      try {
        const result = await refresh.refreshFromServer(licenseKey);
        assert.equal(result.success, false);
        assert.match(result.error, /503/);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('an unreachable server does not corrupt the locally cached license row', async () => {
      const before_ = db.prepare('SELECT * FROM licenses WHERE license_key = ?').get(licenseKey);
      const refresh = new LicenseRefresh(db, { licenseServerUrl: 'https://license.invalid.example' });
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => { throw new Error('timeout (simulated)'); };
      try {
        await refresh.refreshFromServer(licenseKey);
      } catch {
        // refreshFromServer itself must not throw; if it does, that's the bug under test.
      } finally {
        globalThis.fetch = originalFetch;
      }
      const after_ = db.prepare('SELECT * FROM licenses WHERE license_key = ?').get(licenseKey);
      assert.deepEqual(after_, before_, 'license row must be untouched after a failed server call');
    });

    it('checkFeature/getLimits keep working off the local cache while the server is unreachable', () => {
      const check = validator.checkFeature('kubernetes_deploy');
      assert.equal(check.success, true);
      const limits = validator.getLimits();
      assert.equal(limits.success, true);
    });
  });
});
