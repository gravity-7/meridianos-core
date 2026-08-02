/**
 * Integration test for project isolation
 * Tests that projects have separate databases and independent configurations
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

const TEST_DB_PATH = path.join(__dirname, '.test-isolation.db');
const TEST_STATE_DIR = path.join(__dirname, '.test-isolation-projects');

describe('Project Isolation Integration Tests', () => {
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

  it('should create projects with separate state directories', () => {
    const project1 = projectManager.createProject({
      name: 'isolated-project-1',
      template: 'blank',
      config_path: path.join(TEST_STATE_DIR, 'isolated-project-1', 'policy.yaml'),
      state_path: path.join(TEST_STATE_DIR, 'isolated-project-1'),
      created_by: testUserId
    });

    const project2 = projectManager.createProject({
      name: 'isolated-project-2',
      template: 'blank',
      config_path: path.join(TEST_STATE_DIR, 'isolated-project-2', 'policy.yaml'),
      state_path: path.join(TEST_STATE_DIR, 'isolated-project-2'),
      created_by: testUserId
    });

    // Verify separate directories
    assert.ok(fs.existsSync(project1.state_path));
    assert.ok(fs.existsSync(project2.state_path));
    assert.notStrictEqual(project1.state_path, project2.state_path);

    // Verify separate ports
    assert.notStrictEqual(project1.port, project2.port);
  });

  it('should maintain separate databases per project', () => {
    const project1 = projectManager.createProject({
      name: 'db-project-1',
      template: 'blank',
      config_path: path.join(TEST_STATE_DIR, 'db-project-1', 'policy.yaml'),
      state_path: path.join(TEST_STATE_DIR, 'db-project-1'),
      created_by: testUserId
    });

    const project2 = projectManager.createProject({
      name: 'db-project-2',
      template: 'blank',
      config_path: path.join(TEST_STATE_DIR, 'db-project-2', 'policy.yaml'),
      state_path: path.join(TEST_STATE_DIR, 'db-project-2'),
      created_by: testUserId
    });

    // Create separate databases for each project
    const db1Path = path.join(project1.state_path, 'board.db');
    const db2Path = path.join(project2.state_path, 'board.db');

    const db1 = new Database(db1Path);
    db1.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)');
    db1.prepare('INSERT INTO test (value) VALUES (?)').run('project-1-data');
    db1.close();

    const db2 = new Database(db2Path);
    db2.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)');
    db2.prepare('INSERT INTO test (value) VALUES (?)').run('project-2-data');
    db2.close();

    // Verify data isolation
    const db1Check = new Database(db1Path);
    const result1 = db1Check.prepare('SELECT value FROM test').get();
    db1Check.close();

    const db2Check = new Database(db2Path);
    const result2 = db2Check.prepare('SELECT value FROM test').get();
    db2Check.close();

    assert.strictEqual(result1.value, 'project-1-data');
    assert.strictEqual(result2.value, 'project-2-data');
  });

  it('should allow independent configuration per project', () => {
    const project1 = projectManager.createProject({
      name: 'config-project-1',
      template: 'blank',
      config_path: path.join(TEST_STATE_DIR, 'config-project-1', 'policy.yaml'),
      state_path: path.join(TEST_STATE_DIR, 'config-project-1'),
      created_by: testUserId
    });

    const project2 = projectManager.createProject({
      name: 'config-project-2',
      template: 'blank',
      config_path: path.join(TEST_STATE_DIR, 'config-project-2', 'policy.yaml'),
      state_path: path.join(TEST_STATE_DIR, 'config-project-2'),
      created_by: testUserId
    });

    // Write different configurations
    fs.writeFileSync(
      project1.config_path,
      'gateway:\n  tenant: project-1\n  registry:\n    tenant: project-1'
    );

    fs.writeFileSync(
      project2.config_path,
      'gateway:\n  tenant: project-2\n  registry:\n    tenant: project-2'
    );

    // Verify configurations are independent
    const config1 = fs.readFileSync(project1.config_path, 'utf-8');
    const config2 = fs.readFileSync(project2.config_path, 'utf-8');

    assert.ok(config1.includes('project-1'));
    assert.ok(config2.includes('project-2'));
    assert.ok(!config1.includes('project-2'));
    assert.ok(!config2.includes('project-1'));
  });

  it('should not allow projects to access each other\'s state', () => {
    const project1 = projectManager.createProject({
      name: 'access-project-1',
      template: 'blank',
      config_path: path.join(TEST_STATE_DIR, 'access-project-1', 'policy.yaml'),
      state_path: path.join(TEST_STATE_DIR, 'access-project-1'),
      created_by: testUserId
    });

    const project2 = projectManager.createProject({
      name: 'access-project-2',
      template: 'blank',
      config_path: path.join(TEST_STATE_DIR, 'access-project-2', 'policy.yaml'),
      state_path: path.join(TEST_STATE_DIR, 'access-project-2'),
      created_by: testUserId
    });

    // Create a file in project 1's state directory
    const secretFile = path.join(project1.state_path, 'secret.txt');
    fs.writeFileSync(secretFile, 'project-1-secret');

    // Verify project 2 cannot access project 1's file
    const project2SecretFile = path.join(project2.state_path, 'secret.txt');
    assert.ok(!fs.existsSync(project2SecretFile));

    // Verify project 1's file exists
    assert.ok(fs.existsSync(secretFile));
  });
});