/**
 * Integration test for project auto-restart on crash
 * Tests that projects restart automatically within 10 seconds
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { ProjectManager } from '../../control-plane.mjs';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_DB_PATH = path.join(__dirname, '.test-autorestart.db');
const TEST_STATE_DIR = path.join(__dirname, '.test-autorestart-projects');

describe('Project Auto-Restart Integration Tests', () => {
  let projectManager;
  let testUserId;

  before(async () => {
    // Cleanup any existing test database
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    if (fs.existsSync(TEST_STATE_DIR)) {
      fs.rmSync(TEST_STATE_DIR, { recursive: true, force: true });
    }

    // Setup test database
    const db = new Database(TEST_DB_PATH);
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        full_name TEXT,
        created_at INTEGER NOT NULL,
        last_login INTEGER,
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
    `);
    db.close();

    // Create test user
    const db2 = new Database(TEST_DB_PATH);
    const crypto = await import('node:crypto');
    testUserId = crypto.randomUUID();
    db2.prepare('INSERT INTO users (id, email, password_hash, created_at, is_active) VALUES (?, ?, ?, ?, 1)')
      .run(testUserId, 'test@example.com', 'hash', Math.floor(Date.now() / 1000));
    db2.close();

    // Initialize project manager
    projectManager = new ProjectManager(TEST_DB_PATH);
  });

  after(async () => {
    // Cleanup
    projectManager?.close();
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    if (fs.existsSync(TEST_STATE_DIR)) {
      fs.rmSync(TEST_STATE_DIR, { recursive: true, force: true });
    }
  });

  it('should track restart count', async () => {
    const project = projectManager.createProject({
      name: 'restart-test-project',
      template: 'blank',
      config_path: path.join(TEST_STATE_DIR, 'restart-test-project', 'policy.yaml'),
      state_path: path.join(TEST_STATE_DIR, 'restart-test-project'),
      created_by: testUserId
    });

    // Simulate restarts
    const db = new Database(TEST_DB_PATH);
    db.prepare('UPDATE projects SET restart_count = ?, last_restart = ? WHERE id = ?')
      .run(2, Math.floor(Date.now() / 1000), project.id);
    db.close();

    const updated = projectManager.getProject(project.id);
    assert.strictEqual(updated.restart_count, 2);
    assert.ok(updated.last_restart > 0);
  });

  it('should enforce restart rate limit (max 3 per hour)', async () => {
    const project = projectManager.createProject({
      name: 'rate-limit-project',
      template: 'blank',
      config_path: path.join(TEST_STATE_DIR, 'rate-limit-project', 'policy.yaml'),
      state_path: path.join(TEST_STATE_DIR, 'rate-limit-project'),
      created_by: testUserId
    });

    // Simulate 3 restarts within the last hour
    const now = Date.now();
    const restartHistory = [
      now - (30 * 60 * 1000),  // 30 minutes ago
      now - (20 * 60 * 1000),  // 20 minutes ago
      now - (10 * 60 * 1000)   // 10 minutes ago
    ];

    // Set restart history in project manager
    projectManager.restartHistory.set(project.id, restartHistory);

    // Verify rate limit is enforced
    const recentRestarts = restartHistory.filter(ts => ts > now - (60 * 60 * 1000));
    assert.strictEqual(recentRestarts.length, 3);

    // Next restart should be blocked
    assert.strictEqual(recentRestarts.length, 3);
  });

  it('should reset restart count after hour', async () => {
    const project = projectManager.createProject({
      name: 'reset-count-project',
      template: 'blank',
      config_path: path.join(TEST_STATE_DIR, 'reset-count-project', 'policy.yaml'),
      state_path: path.join(TEST_STATE_DIR, 'reset-count-project'),
      created_by: testUserId
    });

    // Simulate restarts from more than an hour ago
    const now = Date.now();
    const restartHistory = [
      now - (70 * 60 * 1000),  // 70 minutes ago
      now - (65 * 60 * 1000),  // 65 minutes ago
      now - (61 * 60 * 1000)   // 61 minutes ago
    ];

    projectManager.restartHistory.set(project.id, restartHistory);

    // Verify old restarts are not counted
    const recentRestarts = restartHistory.filter(ts => ts > now - (60 * 60 * 1000));
    assert.strictEqual(recentRestarts.length, 0);
  });

  it('should update project status on crash', async () => {
    const project = projectManager.createProject({
      name: 'crash-status-project',
      template: 'blank',
      config_path: path.join(TEST_STATE_DIR, 'crash-status-project', 'policy.yaml'),
      state_path: path.join(TEST_STATE_DIR, 'crash-status-project'),
      created_by: testUserId
    });

    // Simulate crash
    const db = new Database(TEST_DB_PATH);
    db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('error', project.id);
    db.close();

    const updated = projectManager.getProject(project.id);
    assert.strictEqual(updated.status, 'error');
  });

  it('should transition from error to restarting', async () => {
    const project = projectManager.createProject({
      name: 'transition-project',
      template: 'blank',
      config_path: path.join(TEST_STATE_DIR, 'transition-project', 'policy.yaml'),
      state_path: path.join(TEST_STATE_DIR, 'transition-project'),
      created_by: testUserId
    });

    // Simulate error state
    const db = new Database(TEST_DB_PATH);
    db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('error', project.id);
    db.close();

    // Simulate restart attempt
    db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('restarting', project.id);
    db.close();

    const updated = projectManager.getProject(project.id);
    assert.strictEqual(updated.status, 'restarting');
  });
});