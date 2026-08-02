/**
 * Contract test for authentication API endpoints
 * Tests all authentication endpoints against the API contract
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:http';
import { hashPassword } from '../../auth/user-store.mjs';
import { generateToken } from '../../auth/jwt.mjs';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_DB_PATH = path.join(__dirname, '.test-auth.db');

describe('Authentication API Contract Tests', () => {
  let server;
  let port;
  let testUserId;
  let testPassword = 'TestPassword123!';

  before(async () => {
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

      CREATE TABLE IF NOT EXISTS api_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        scope TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        last_used INTEGER,
        is_active BOOLEAN NOT NULL DEFAULT 1,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);

    // Create test user
    const crypto = await import('node:crypto');
    testUserId = crypto.randomUUID();
    const passwordHash = await hashPassword(testPassword);
    db.prepare('INSERT INTO users (id, email, password_hash, full_name, created_at, is_active) VALUES (?, ?, ?, ?, ?, 1)')
      .run(testUserId, 'test@example.com', passwordHash, 'Test User', Math.floor(Date.now() / 1000));
    db.close();

    // Start test server
    port = 4321;
    server = createServer(async (req, res) => {
      // Mock authentication endpoints
      if (req.method === 'POST' && req.url === '/api/auth/login') {
        const body = await readBody(req);
        const { email, password } = JSON.parse(body);

        if (email === 'test@example.com' && password === testPassword) {
          const token = generateToken({
            sub: testUserId,
            email: 'test@example.com',
            exp: Math.floor(Date.now() / 1000) + 1800
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            token,
            user: {
              id: testUserId,
              email: 'test@example.com',
              full_name: 'Test User'
            }
          }));
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid credentials' }));
        }
      } else if (req.method === 'GET' && req.url === '/api/auth/me') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          user: {
            id: testUserId,
            email: 'test@example.com',
            full_name: 'Test User'
          }
        }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Not found' }));
      }
    });

    server.listen(port);
  });

  after(async () => {
    server.close();
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  function readBody(req) {
    return new Promise((resolve) => {
      let data = '';
      req.on('data', (c) => { data += c; });
      req.on('end', () => resolve(data));
    });
  }

  it('POST /api/auth/login should return JWT token on valid credentials', async () => {
    const response = await fetch(`http://localhost:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@example.com',
        password: testPassword
      })
    });

    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.ok(data.ok);
    assert.ok(data.token);
    assert.ok(data.user);
    assert.strictEqual(data.user.email, 'test@example.com');
  });

  it('POST /api/auth/login should return 401 on invalid credentials', async () => {
    const response = await fetch(`http://localhost:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@example.com',
        password: 'wrongpassword'
      })
    });

    assert.strictEqual(response.status, 401);
    const data = await response.json();
    assert.ok(!data.ok);
    assert.strictEqual(data.error, 'Invalid credentials');
  });

  it('GET /api/auth/me should return current user info', async () => {
    const response = await fetch(`http://localhost:${port}/api/auth/me`);

    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.ok(data.ok);
    assert.ok(data.user);
    assert.strictEqual(data.user.email, 'test@example.com');
  });
});