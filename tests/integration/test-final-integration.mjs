/**
 * Final integration test across all user stories (T200, Phase 10 polish). Individual features
 * already have their own focused integration tests (test-project-lifecycle, test-soc2-report,
 * test-license-validation, etc.) — this suite instead exercises them TOGETHER, in one realistic
 * operator flow, at the module level (ProjectManager / TemplateLoader / auth / licensing /
 * compliance), the same layer every other integration test in this directory operates at. It
 * does not go through dashboard/server.mjs's HTTP layer — several of its project/compliance
 * route handlers are currently unimplemented (flagged separately as an out-of-scope bug), so an
 * HTTP-level walkthrough would fail on that unrelated gap rather than testing what this task is
 * about.
 *
 * Flow: US4 template → US1 project lifecycle → US2 auth token → US3 activity attribution →
 * US5 license/tier gating → US7 compliance reporting → T197 backup/restore, all against the
 * SAME control-plane database, in the SAME order an operator would actually hit them.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProjectManager, getTemplateLoader } from '../../control-plane.mjs';
import { generateToken, verifyToken } from '../../auth/jwt.mjs';
import { LicenseValidator } from '../../licensing/license-validate.mjs';
import { SOC2Report } from '../../compliance/reports/soc2.mjs';
import { GDPRReport } from '../../compliance/reports/gdpr.mjs';
import { ActivityLogger } from '../../compliance/audit-log.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.join(__dirname, '.test-final-integration.db');
const TEST_STATE_DIR = path.join(__dirname, '.test-final-integration-projects');
const TEST_BACKUP_DIR = path.join(__dirname, '.test-final-integration-backups');

describe('Final Cross-Story Integration (T200)', () => {
  let projectManager;
  let testUserId;

  before(async () => {
    for (const p of [TEST_DB_PATH, `${TEST_DB_PATH}-wal`, `${TEST_DB_PATH}-shm`]) {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    if (fs.existsSync(TEST_STATE_DIR)) fs.rmSync(TEST_STATE_DIR, { recursive: true, force: true });
    if (fs.existsSync(TEST_BACKUP_DIR)) fs.rmSync(TEST_BACKUP_DIR, { recursive: true, force: true });

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
      .run(testUserId, 'operator@example.com', 'hash', Math.floor(Date.now() / 1000));
    db.close();

    projectManager = new ProjectManager(TEST_DB_PATH);
  });

  after(() => {
    projectManager?.close();
    for (const p of [TEST_DB_PATH, `${TEST_DB_PATH}-wal`, `${TEST_DB_PATH}-shm`]) {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    // restoreDatabase() (T197) leaves a timestamped `<db>.pre-restore.<ts>` safety copy behind
    // by design — clean up whatever name it picked rather than guessing the exact timestamp.
    const dir = path.dirname(TEST_DB_PATH);
    const base = path.basename(TEST_DB_PATH);
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith(`${base}.pre-restore.`)) fs.unlinkSync(path.join(dir, f));
    }
    if (fs.existsSync(TEST_STATE_DIR)) fs.rmSync(TEST_STATE_DIR, { recursive: true, force: true });
    if (fs.existsSync(TEST_BACKUP_DIR)) fs.rmSync(TEST_BACKUP_DIR, { recursive: true, force: true });
  });

  let project;

  it('US4: lists available project templates', () => {
    const loader = getTemplateLoader();
    const templates = loader.list();
    assert.ok(templates.length > 0);
    assert.ok(templates.some((t) => t.id === 'blank' || t.name === 'blank'));
  });

  it('US1 + US4: creates a project from a template', () => {
    project = projectManager.createProject({
      name: 'final-integration-project',
      template: 'blank',
      config_path: path.join(TEST_STATE_DIR, 'final-integration-project', 'policy.yaml'),
      state_path: path.join(TEST_STATE_DIR, 'final-integration-project'),
      created_by: testUserId
    });
    assert.ok(project.id);
    assert.equal(project.status, 'stopped');
  });

  it('US2: issues and verifies a JWT for the operator', () => {
    const token = generateToken({ sub: testUserId, email: 'operator@example.com', role: 'admin' });
    const decoded = verifyToken(token);
    assert.ok(decoded, 'a freshly issued token must verify');
    assert.equal(decoded.sub, testUserId);
    assert.equal(decoded.role, 'admin');
  });

  it('US3: an activity log records and attributes a team action to a project', async () => {
    // Exercises ActivityLogger directly, on its own isolated DB — control-plane.mjs's
    // ProjectManager also logs project lifecycle actions via the SHARED default
    // getActivityLogger() singleton (repo `.ai/control-plane.db`), which this suite
    // deliberately avoids touching from a test.
    const logger = new ActivityLogger(':memory:');
    logger.log({ user_id: testUserId, project_id: project.id, action: 'task_comment_add', details: { comment: 'looks good' } });
    // ActivityLogger.log() is currently fire-and-forget internally (flagged separately) —
    // give its microtask a turn before querying.
    await new Promise((resolve) => setTimeout(resolve, 20));

    const feed = logger.query({ project_id: project.id });
    assert.equal(feed.length, 1);
    assert.equal(feed[0].action, 'task_comment_add');
    assert.equal(feed[0].user_id, testUserId);
    logger.close();
  });

  it('US5: a free-tier license denies a pro-only feature; pro allows it', () => {
    const licenseDb = new Database(':memory:');
    const validator = new LicenseValidator(licenseDb);
    const now = Math.floor(Date.now() / 1000);

    licenseDb.prepare(`
      INSERT INTO licenses (id, license_key, tier, status, features, customer_id, subscription_id, expires_at, last_validated, created_at, updated_at)
      VALUES ('lic-free', 'mer-free-test', 'free', 'active', ?, 'cust-free', NULL, ?, ?, ?, ?)
    `).run(JSON.stringify(['basic_agents']), now + 86400, now, now, now);

    const denied = validator.checkFeature('kubernetes_deploy');
    assert.equal(denied.success, true);
    assert.equal(denied.allowed, false, 'free tier must not have kubernetes_deploy');

    licenseDb.prepare("UPDATE licenses SET tier = 'pro', features = ? WHERE id = 'lic-free'")
      .run(JSON.stringify(['basic_agents', 'kubernetes_deploy']));
    const allowed = validator.checkFeature('kubernetes_deploy');
    assert.equal(allowed.allowed, true, 'pro tier must have kubernetes_deploy');

    licenseDb.close();
  });

  it('US7: SOC2 and GDPR compliance reports generate with valid structure', () => {
    const soc2 = new SOC2Report().generate();
    assert.equal(soc2.reportType, 'SOC2_Type_2_Draft');
    assert.ok(Array.isArray(soc2.accessLogs));

    const gdpr = new GDPRReport().generate();
    assert.ok(gdpr.generatedAt);
  });

  it('T197: backs up and restores the control-plane database mid-flow without losing the project', () => {
    const backup = projectManager.backupDatabase(TEST_BACKUP_DIR);
    assert.ok(fs.existsSync(backup.path));

    // Simulate drift: delete the project after the backup was taken.
    projectManager.db.prepare('DELETE FROM projects WHERE id = ?').run(project.id);
    assert.equal(projectManager.getProject(project.id), null);

    projectManager.restoreDatabase(backup.path);
    const restored = projectManager.getProject(project.id);
    assert.ok(restored, 'project must be back after restoring the pre-deletion backup');
    assert.equal(restored.name, 'final-integration-project');
  });

  it('T198: starting the project activates a live hot-reload snapshot of its policy.yaml', async () => {
    fs.mkdirSync(path.dirname(project.config_path), { recursive: true });
    fs.writeFileSync(project.config_path, 'version: 1\nwork:\n  max_parallel: 4\n');

    // spawnProcess actually spawns `node daemon-entry.mjs`; stub it so this test stays a fast,
    // hermetic unit-of-integration check rather than a real process-spawn test (that's covered
    // by test-project-lifecycle.mjs / test-project-autorestart.mjs already). Deliberately never
    // emits 'exit': monitorProcess's crash-auto-restart listener currently fires on ANY exit,
    // including a graceful stop (flagged separately) — emitting it here would schedule a 5s
    // timer that outlives this test file's teardown. Leaving the fake process "running" and
    // letting `after()`'s projectManager.close() clean up avoids that without masking it.
    const { EventEmitter } = await import('node:events');
    const originalSpawn = projectManager.spawnProcess;
    projectManager.spawnProcess = async () => {
      const fake = new EventEmitter();
      fake.pid = 999999;
      fake.stdout = new EventEmitter();
      fake.stderr = new EventEmitter();
      fake.kill = () => {};
      return fake;
    };
    try {
      await projectManager.startProject(project.id);
      const effective = projectManager.getEffectiveConfig(project.id);
      assert.equal(effective.work.max_parallel, 4);
    } finally {
      projectManager.spawnProcess = originalSpawn;
    }
  });
});
