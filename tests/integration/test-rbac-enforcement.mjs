/**
 * Integration test for RBAC enforcement
 * Tests role-based access control for admin, operator, and viewer roles
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { authorize, hasPermission } from '../../auth/auth.mjs';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_DB_PATH = path.join(__dirname, '.test-rbac.db');

describe('RBAC Enforcement Integration Tests', () => {
  let testUserId;
  let testProjectId;

  before(async () => {
    // Cleanup any existing test database
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
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

      CREATE TABLE IF NOT EXISTS project_users (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(project_id, user_id)
      );
    `);

    // Create test user and project
    const crypto = await import('node:crypto');
    testUserId = crypto.randomUUID();
    testProjectId = crypto.randomUUID();

    db.prepare('INSERT INTO users (id, email, password_hash, created_at, is_active) VALUES (?, ?, ?, ?, 1)')
      .run(testUserId, 'test@example.com', 'hash', Math.floor(Date.now() / 1000));

    db.prepare(`INSERT INTO projects (id, name, status, config_path, state_path, port, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(testProjectId, 'test-project', 'stopped', '/config', '/state', 4320, Math.floor(Date.now() / 1000), testUserId);

    db.close();
  });

  after(async () => {
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  it('should allow admin to perform all actions', () => {
    const req = {
      user: { id: testUserId },
      params: { project_id: testProjectId },
      userRole: 'admin'
    };

    assert.ok(hasPermission(req, 'project:create'));
    assert.ok(hasPermission(req, 'project:delete'));
    assert.ok(hasPermission(req, 'user:manage'));
    assert.ok(hasPermission(req, 'config:update'));
  });

  it('should allow operator to perform project and task actions', () => {
    const req = {
      user: { id: testUserId },
      params: { project_id: testProjectId },
      userRole: 'operator'
    };

    assert.ok(hasPermission(req, 'project:create'));
    assert.ok(hasPermission(req, 'project:start'));
    assert.ok(hasPermission(req, 'task:create'));
    assert.ok(hasPermission(req, 'config:update'));
    assert.ok(hasPermission(req, 'user:invite'));
  });

  it('should deny operator from user management', () => {
    const req = {
      user: { id: testUserId },
      params: { project_id: testProjectId },
      userRole: 'operator'
    };

    assert.ok(!hasPermission(req, 'user:manage'));
  });

  it('should allow viewer to read only', () => {
    const req = {
      user: { id: testUserId },
      params: { project_id: testProjectId },
      userRole: 'viewer'
    };

    assert.ok(hasPermission(req, 'project:read'));
    assert.ok(hasPermission(req, 'task:read'));
    assert.ok(hasPermission(req, 'config:read'));
  });

  it('should deny viewer from write actions', () => {
    const req = {
      user: { id: testUserId },
      params: { project_id: testProjectId },
      userRole: 'viewer'
    };

    assert.ok(!hasPermission(req, 'project:create'));
    assert.ok(!hasPermission(req, 'project:start'));
    assert.ok(!hasPermission(req, 'task:create'));
    assert.ok(!hasPermission(req, 'config:update'));
  });

  it('should enforce role hierarchy: admin > operator > viewer', () => {
    const adminReq = { user: { id: testUserId }, params: { project_id: testProjectId }, userRole: 'admin' };
    const operatorReq = { user: { id: testUserId }, params: { project_id: testProjectId }, userRole: 'operator' };
    const viewerReq = { user: { id: testUserId }, params: { project_id: testProjectId }, userRole: 'viewer' };

    // Admin can do everything
    assert.ok(hasPermission(adminReq, 'project:delete'));
    assert.ok(hasPermission(adminReq, 'user:manage'));

    // Operator cannot do admin-only actions
    assert.ok(!hasPermission(operatorReq, 'project:delete'));
    assert.ok(!hasPermission(operatorReq, 'user:manage'));

    // Viewer cannot do operator actions
    assert.ok(!hasPermission(viewerReq, 'project:start'));
    assert.ok(!hasPermission(viewerReq, 'task:create'));
  });

  it('should return false for unauthenticated user', () => {
    const req = { user: null };

    assert.ok(!hasPermission(req, 'project:read'));
    assert.ok(!hasPermission(req, 'task:read'));
  });

  it('should return false for user without role', () => {
    const req = {
      user: { id: testUserId },
      params: { project_id: testProjectId }
    };

    assert.ok(!hasPermission(req, 'project:read'));
  });

  it('should handle unknown permissions gracefully', () => {
    const req = {
      user: { id: testUserId },
      params: { project_id: testProjectId },
      userRole: 'admin'
    };

    // Admin has wildcard permission
    assert.ok(hasPermission(req, 'unknown:permission'));
  });
});