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