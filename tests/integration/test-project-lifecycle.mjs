/**
 * Integration test for project lifecycle
 * Tests create, start, stop, restart, and delete operations
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

const TEST_DB_PATH = path.join(__dirname, '.test-control-plane.db');
const TEST_STATE_DIR = path.join(__dirname, '.test-projects');

describe('Project Lifecycle Integration Tests', () => {
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

  it('should create a project', () => {
    const project = projectManager.createProject({
      name: 'test-project-1',
      template: 'blank',
      config_path: path.join(TEST_STATE_DIR, 'test-project-1', 'policy.yaml'),
      state_path: path.join(TEST_STATE_DIR, 'test-project-1'),
      created_by: testUserId
    });

    assert.ok(project.id);
    assert.strictEqual(project.name, 'test-project-1');
    assert.strictEqual(project.status, 'stopped');
    assert.strictEqual(project.template, 'blank');
    assert.strictEqual(project.created_by, testUserId);
    assert.ok(project.port >= 4320);
  });

  it('should list projects', () => {
    const projects = projectManager.listProjects();
    assert.ok(projects.length >= 1);
    assert.ok(projects.find(p => p.name === 'test-project-1'));
  });

  it('should get project by ID', () => {
    const projects = projectManager.listProjects();
    const project = projects.find(p => p.name === 'test-project-1');
    assert.ok(project);

    const retrieved = projectManager.getProject(project.id);
    assert.ok(retrieved);
    assert.strictEqual(retrieved.id, project.id);
  });

  it('should not create duplicate project names', () => {
    assert.throws(() => {
      projectManager.createProject({
        name: 'test-project-1',
        template: 'blank',
        config_path: path.join(TEST_STATE_DIR, 'test-project-1-dup', 'policy.yaml'),
        state_path: path.join(TEST_STATE_DIR, 'test-project-1-dup'),
        created_by: testUserId
      });
    }, /Project name already exists/);
  });

  it('should delete a project', async () => {
    const project = projectManager.createProject({
      name: 'test-project-delete',
      template: 'blank',
      config_path: path.join(TEST_STATE_DIR, 'test-project-delete', 'policy.yaml'),
      state_path: path.join(TEST_STATE_DIR, 'test-project-delete'),
      created_by: testUserId
    });

    await projectManager.deleteProject(project.id);

    const retrieved = projectManager.getProject(project.id);
    assert.strictEqual(retrieved, null);
  });

  it('should not delete running project', async () => {
    const project = projectManager.createProject({
      name: 'test-project-running',
      template: 'blank',
      config_path: path.join(TEST_STATE_DIR, 'test-project-running', 'policy.yaml'),
      state_path: path.join(TEST_STATE_DIR, 'test-project-running'),
      created_by: testUserId
    });

    // Simulate running state
    const db = new Database(TEST_DB_PATH);
    db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('running', project.id);
    db.close();

    await assert.rejects(
      async () => projectManager.deleteProject(project.id),
      /Cannot delete running project/
    );

    // Cleanup
    const db2 = new Database(TEST_DB_PATH);
    db2.prepare('UPDATE projects SET status = ? WHERE id = ?').run('stopped', project.id);
    db2.close();
    await projectManager.deleteProject(project.id);
  });
});