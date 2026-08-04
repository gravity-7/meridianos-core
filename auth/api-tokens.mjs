/**
 * API Token Manager
 * Manages API key generation, validation, and revocation
 */

import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, '..', '.ai', 'control-plane.db');

/**
 * API Token Manager class
 */
export class APITokenManager {
  constructor(dbPath = DB_PATH) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
  }

  /**
   * Generate API token
   * @param {string} userId - User ID
   * @param {string} name - Token name
   * @param {string} scope - Token scope
   * @param {number} expiresIn - Expiration time in seconds (optional)
   * @returns {Object} Generated token
   */
  generateToken(userId, name, scope, expiresIn = null) {
    // Generate random token
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Calculate expiration
    const expiresAt = expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : null;

    // Insert into database
    const id = crypto.randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO api_tokens (id, user_id, name, token_hash, scope, created_at, expires_at, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `);

    stmt.run(id, userId, name, tokenHash, scope, Math.floor(Date.now() / 1000), expiresAt);

    return {
      id,
      token,
      name,
      scope,
      created_at: Math.floor(Date.now() / 1000),
      expires_at: expiresAt
    };
  }

  /**
   * Validate API token
   * @param {string} token - API token to validate
   * @returns {Object|null} Token data or null if invalid
   */
  validateToken(token) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const stmt = this.db.prepare(`
      SELECT t.*, u.email, u.full_name
      FROM api_tokens t
      JOIN users u ON t.user_id = u.id
      WHERE t.token_hash = ? AND t.is_active = 1 AND u.is_active = 1
    `);

    const result = stmt.get(tokenHash);
    if (!result) {
      return null;
    }

    // Check expiration
    if (result.expires_at && result.expires_at < Math.floor(Date.now() / 1000)) {
      return null;
    }

    // Update last used
    const updateStmt = this.db.prepare('UPDATE api_tokens SET last_used = ? WHERE id = ?');
    updateStmt.run(Math.floor(Date.now() / 1000), result.id);

    return {
      id: result.id,
      user_id: result.user_id,
      name: result.name,
      scope: result.scope,
      email: result.email,
      full_name: result.full_name
    };
  }

  /**
   * Revoke API token
   * @param {string} tokenId - Token ID
   * @param {string} userId - User ID (for authorization)
   * @returns {boolean} True if revoked
   */
  revokeToken(tokenId, userId) {
    const stmt = this.db.prepare(`
      UPDATE api_tokens SET is_active = 0
      WHERE id = ? AND user_id = ?
    `);

    const result = stmt.run(tokenId, userId);
    return result.changes > 0;
  }

  /**
   * List API tokens for user
   * @param {string} userId - User ID
   * @returns {Array} List of tokens
   */
  listTokens(userId) {
    const stmt = this.db.prepare(`
      SELECT id, name, scope, created_at, expires_at, last_used, is_active
      FROM api_tokens
      WHERE user_id = ?
      ORDER BY created_at DESC
    `);

    return stmt.all(userId);
  }

  /**
   * Close database connection
   */
  close() {
    this.db.close();
  }
}

// ─── Local REST API keys (Phase 7: api/v1) ──────────────────────────────────────────────────
//
// Distinct from APITokenManager above: that class authenticates the cloud multi-tenant SaaS
// control plane against control-plane.db (better-sqlite3, user-scoped tokens). The functions
// below back the LOCAL, single-machine public REST API (`Authorization: Bearer mk-{id}`) and
// operate on the `api_keys` table in the main AIOS state DB (node:sqlite, schema.sql) via an
// injected `db` handle — no ambient connection, consistent with the rest of this package.

const VALID_SCOPES = new Set([
  'tasks:read', 'tasks:write',
  'costs:read',
  'providers:read', 'providers:write',
  'config:read', 'config:write',
]);

/** Generate a `mk-{32 hex chars}` key id — matches data-model.md's `^mk-[a-zA-Z0-9]{32}$`. */
function generateKeyId() {
  return `mk-${crypto.randomBytes(16).toString('hex')}`;
}

/**
 * Create and persist a new local REST API key.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{name: string, scopes: string[]|string}} opts  scopes as an array or comma-separated string
 * @returns {{id: string, name: string, scopes: string, created_at: number, is_active: number}}
 */
export function generateApiKey(db, { name, scopes }) {
  const scopeList = Array.isArray(scopes) ? scopes : String(scopes || '').split(',').map((s) => s.trim()).filter(Boolean);
  const invalid = scopeList.filter((s) => !VALID_SCOPES.has(s));
  if (scopeList.length === 0 || invalid.length > 0) {
    throw new Error(`Invalid scopes: ${invalid.length ? invalid.join(', ') : '(none provided)'}`);
  }
  const id = generateKeyId();
  const createdAt = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO api_keys (id, name, scopes, created_at, is_active) VALUES (?, ?, ?, ?, 1)`,
  ).run(id, name, scopeList.join(','), createdAt);
  return { id, name, scopes: scopeList.join(','), created_at: createdAt, is_active: 1 };
}

/**
 * Validate a bearer token (`mk-{...}`, with or without the `Bearer ` prefix already stripped)
 * and, if valid, bump `last_used_at`. Returns the key row or `null`.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} token
 */
export function validateApiKey(db, token) {
  if (typeof token !== 'string' || !/^mk-[a-zA-Z0-9]{32}$/.test(token)) return null;
  const row = db.prepare('SELECT * FROM api_keys WHERE id = ? AND is_active = 1').get(token);
  if (!row) return null;
  db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(Math.floor(Date.now() / 1000), token);
  return row;
}

/** Does an api_keys row's scopes include `scope`? */
export function hasScope(apiKeyRow, scope) {
  if (!apiKeyRow?.scopes) return false;
  return apiKeyRow.scopes.split(',').map((s) => s.trim()).includes(scope);
}

/** Revoke a local API key (is_active = 0). Returns true if a row was changed. */
export function revokeApiKey(db, id) {
  return db.prepare('UPDATE api_keys SET is_active = 0 WHERE id = ?').run(id).changes > 0;
}

/** List local API keys, most recently created first. */
export function listApiKeys(db) {
  return db.prepare('SELECT id, name, scopes, created_at, last_used_at, is_active FROM api_keys ORDER BY created_at DESC').all();
}

/**
 * Rotate a local API key: mint a brand-new `mk-{...}` key with the SAME name/scopes, then revoke
 * the old one — atomically (one transaction), so a reader never observes a moment with zero
 * active keys for that credential. The returned object's `id` is the NEW key — every caller
 * holding the old value must switch to it. This is a hard rotation, not a grace-period
 * dual-validity one: the threat model here is "a leaked key must stop working immediately," not
 * "eventually."
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} id  the CURRENT key id (`mk-{...}`) to rotate
 * @returns {{id: string, name: string, scopes: string, created_at: number, is_active: number}}
 * @throws {Error} if `id` doesn't exist or is already revoked
 */
export function rotateApiKey(db, id) {
  const existing = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id);
  if (!existing) throw new Error(`API key not found: ${id}`);
  if (!existing.is_active) throw new Error(`API key is already revoked: ${id}`);

  db.exec('BEGIN IMMEDIATE');
  try {
    const rotated = generateApiKey(db, { name: existing.name, scopes: existing.scopes });
    db.prepare('UPDATE api_keys SET is_active = 0 WHERE id = ?').run(id);
    db.exec('COMMIT');
    return rotated;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw err;
  }
}

// Singleton instance
let apiTokenManagerInstance = null;

/**
 * Get singleton APITokenManager instance
 * @returns {APITokenManager} APITokenManager instance
 */
export function getAPITokenManager() {
  if (!apiTokenManagerInstance) {
    apiTokenManagerInstance = new APITokenManager();
  }
  return apiTokenManagerInstance;
}