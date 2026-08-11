/**
 * User Store with Password Hashing
 * Uses Node.js crypto.scrypt for password hashing
 */

import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, '..', '.ai', 'control-plane.db');

// Password hashing parameters
const SCRYPT_PARAMS = {
  N: 16384,      // CPU/memory cost parameter
  r: 8,          // Block size parameter
  p: 1,          // Parallelization parameter
  keylen: 64,    // Length of derived key
  saltlen: 32    // Length of salt
};

/** Invitation material is disclosed to the delivery channel once; only this hash is durable. */
export function hashInvitationToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/**
 * Hash password using scrypt
 * @param {string} password - Plain text password
 * @returns {Promise<string>} Hashed password in format salt:hash
 */
export async function hashPassword(password) {
  const salt = crypto.randomBytes(SCRYPT_PARAMS.saltlen);
  const key = crypto.scryptSync(
    password,
    salt,
    SCRYPT_PARAMS.keylen,
    {
      N: SCRYPT_PARAMS.N,
      r: SCRYPT_PARAMS.r,
      p: SCRYPT_PARAMS.p
    }
  );

  const saltHex = salt.toString('hex');
  const keyHex = key.toString('hex');

  return `${saltHex}:${keyHex}`;
}

/**
 * Verify password against hash
 * @param {string} password - Plain text password
 * @param {string} hash - Hashed password in format salt:hash
 * @returns {boolean} True if password matches
 */
export function verifyPassword(password, hash) {
  try {
    const [saltHex, keyHex] = hash.split(':');
    if (!saltHex || !keyHex) {
      return false;
    }

    const salt = Buffer.from(saltHex, 'hex');
    const key = crypto.scryptSync(
      password,
      salt,
      SCRYPT_PARAMS.keylen,
      {
        N: SCRYPT_PARAMS.N,
        r: SCRYPT_PARAMS.r,
        p: SCRYPT_PARAMS.p
      }
    );

    const keyHexComputed = key.toString('hex');
    return crypto.timingSafeEqual(
      Buffer.from(keyHexComputed, 'hex'),
      Buffer.from(keyHex, 'hex')
    );
  } catch (error) {
    return false;
  }
}

/**
 * User Store class
 */
export class UserStore {
  constructor(dbPath = DB_PATH) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    
    // Initialize tables
    this.initializeTables();
  }

  /**
   * Initialize database tables
   */
  initializeTables() {
    // Create users table if not exists
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        full_name TEXT,
        role TEXT NOT NULL DEFAULT 'viewer',
        github_username TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_login INTEGER,
        is_active INTEGER NOT NULL DEFAULT 1
      )
    `);

    // Create projects table if not exists
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // Create project_users table if not exists
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS project_users (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(project_id, user_id)
      )
    `);

    // Create invitations table if not exists
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS invitations (
        id TEXT PRIMARY KEY,
        token TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL,
        project_id TEXT NOT NULL,
        role TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // Create indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);
      CREATE INDEX IF NOT EXISTS idx_project_users_project_id ON project_users(project_id);
      CREATE INDEX IF NOT EXISTS idx_project_users_user_id ON project_users(user_id);
      CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token);
      CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email);
      CREATE INDEX IF NOT EXISTS idx_invitations_project_id ON invitations(project_id);
      CREATE INDEX IF NOT EXISTS idx_invitations_expires_at ON invitations(expires_at);
    `);
  }

  /**
   * Create a new user
   * @param {Object} userData - User data
   * @returns {Object} Created user
   */
  async createUser(userData) {
    const { email, password, full_name, role } = userData;

    // Validate email format
    if (!this.isValidEmail(email)) {
      throw new Error('Invalid email format');
    }

    // Check if user already exists
    const existing = this.getUserByEmail(email);
    if (existing) {
      throw new Error('User already exists');
    }

    // Hash password
    const password_hash = await hashPassword(password);

    // Generate UUID
    const id = crypto.randomUUID();

    // role defaults to the column's own DEFAULT 'viewer' when omitted — validated here (not just
    // left to the DB) so a caller passing a typo'd role fails loudly instead of silently landing
    // whatever SQLite happens to accept.
    const VALID_ROLES = ['admin', 'operator', 'viewer'];
    if (role !== undefined && !VALID_ROLES.includes(role)) {
      throw new Error(`Invalid role '${role}' — must be one of ${VALID_ROLES.join(', ')}`);
    }

    const now = Math.floor(Date.now() / 1000);
    if (role) {
      this.db.prepare(`
        INSERT INTO users (id, email, password_hash, full_name, role, created_at, updated_at, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)
      `).run(id, email.toLowerCase(), password_hash, full_name, role, now, now);
    } else {
      this.db.prepare(`
        INSERT INTO users (id, email, password_hash, full_name, created_at, updated_at, is_active)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `).run(id, email.toLowerCase(), password_hash, full_name, now, now);
    }

    return this.getUserById(id);
  }

  /**
   * Get user by ID
   * @param {string} id - User ID
   * @returns {Object|null} User object or null
   */
  getUserById(id) {
    const stmt = this.db.prepare('SELECT * FROM users WHERE id = ?');
    const user = stmt.get(id);
    return user || null;
  }

  /**
   * Get user by email
   * @param {string} email - User email
   * @returns {Object|null} User object or null
   */
  getUserByEmail(email) {
    const stmt = this.db.prepare('SELECT * FROM users WHERE email = ?');
    const user = stmt.get(email.toLowerCase());
    return user || null;
  }

  /**
   * Verify user credentials
   * @param {string} email - User email
   * @param {string} password - Plain text password
   * @returns {Object|null} User object or null if invalid
   */
  verifyCredentials(email, password) {
    const user = this.getUserByEmail(email);
    if (!user || !user.is_active) {
      return null;
    }

    const isValid = verifyPassword(password, user.password_hash);
    if (!isValid) {
      return null;
    }

    // Update last login
    const updateStmt = this.db.prepare('UPDATE users SET last_login = ? WHERE id = ?');
    updateStmt.run(Math.floor(Date.now() / 1000), user.id);

    return user;
  }

  /**
   * Update user
   * @param {string} id - User ID
   * @param {Object} updates - Fields to update
   * @returns {Object|null} Updated user or null
   */
  updateUser(id, updates) {
    // github_username (008 — Team Collaboration, FR-014): needed to map a project member onto a
    // real GitHub identity for PR reviewer auto-assignment (see control-plane.mjs's
    // ReviewerAssigner) — no field authorization concern in letting a user set their own, unlike
    // `role`/`is_active` which stay admin-only at the HTTP layer (see dashboard/server.mjs's
    // handleUpdateCurrentUser, which only forwards full_name/github_username from a self-update).
    const allowedFields = ['full_name', 'is_active', 'github_username'];
    const fields = [];
    const values = [];

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }

    if (fields.length === 0) {
      return this.getUserById(id);
    }

    values.push(id);
    const stmt = this.db.prepare(`
      UPDATE users SET ${fields.join(', ')} WHERE id = ?
    `);
    stmt.run(...values);

    return this.getUserById(id);
  }

  /**
   * Change user password
   * @param {string} id - User ID
   * @param {string} oldPassword - Current password
   * @param {string} newPassword - New password
   * @returns {boolean} True if password changed
   */
  async changePassword(id, oldPassword, newPassword) {
    const user = this.getUserById(id);
    if (!user) {
      return false;
    }

    const isValid = verifyPassword(oldPassword, user.password_hash);
    if (!isValid) {
      return false;
    }

    const password_hash = await hashPassword(newPassword);
    const stmt = this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
    stmt.run(password_hash, id);

    return true;
  }

  /**
   * Validate email format
   * @param {string} email - Email address
   * @returns {boolean} True if valid
   */
  isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email) && email.length <= 255;
  }

  /**
   * Close database connection
   */
  close() {
    this.db.close();
  }
}

/**
 * Invitation Manager for handling team invitations
 */
export class InvitationManager {
  constructor(userStore) {
    this.userStore = userStore;
  }

  /**
   * Create a new invitation
   * @param {string} email - Email to invite
   * @param {string} projectId - Project ID
   * @param {string} role - Role to assign (admin, operator, viewer)
   * @returns {Object} Created invitation
   */
  create(email, projectId, role = 'viewer') {
    // Validate email
    if (!this.userStore.isValidEmail(email)) {
      throw new Error('Invalid email format');
    }

    // Validate role
    const validRoles = ['admin', 'operator', 'viewer'];
    if (!validRoles.includes(role)) {
      throw new Error(`Invalid role: ${role}. Must be one of: ${validRoles.join(', ')}`);
    }

    // Check if user already exists
    const existingUser = this.userStore.getUserByEmail(email);
    if (existingUser) {
      throw new Error('User already exists');
    }

    // Check if invitation already exists
    const existingInvitation = this.getInvitationByEmail(email, projectId);
    if (existingInvitation?.status === 'pending') {
      throw new Error('Invitation already exists for this user and project');
    }

    // Generate token and expiration
    const token = crypto.randomUUID();
    const expiresAt = Math.floor(Date.now() / 1000) + (24 * 60 * 60); // 24 hours

    // Insert invitation
    const stmt = this.userStore.db.prepare(`
      INSERT INTO invitations (id, token, email, project_id, role, expires_at, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    
    stmt.run(id, hashInvitationToken(token), email.toLowerCase(), projectId, role, expiresAt, 'pending', now, now);

    return {
      id,
      token,
      email,
      project_id: projectId,
      role,
      expires_at: expiresAt,
      status: 'pending'
    };
  }

  /**
   * Accept an invitation
   * @param {string} token - Invitation token
   * @param {string} password - User password
   * @returns {Object} Acceptance result
   */
  async accept(token, password) {
    // Validate token
    const invitation = this.validate(token);
    if (!invitation.valid) {
      return { success: false, error: invitation.error };
    }

    // Create user
    const userData = {
      email: invitation.email,
      password,
      full_name: invitation.email.split('@')[0] // Use email prefix as name
    };

    let user;
    try {
      user = await this.userStore.createUser(userData);
    } catch (error) {
      return { success: false, error: error.message };
    }

    // Add user to project
    this.addUserToProject(user.id, invitation.project_id, invitation.role);

    // Mark invitation as accepted
    this.markAsAccepted(token);

    return {
      success: true,
      user,
      project_id: invitation.project_id,
      role: invitation.role
    };
  }

  /**
   * Validate an invitation token
   * @param {string} token - Invitation token
   * @returns {Object} Validation result
   */
  validate(token) {
    // The raw fallback preserves acceptance of pre-UXF-005 rows during migration; newly created
    // invitations always persist the hash above.
    const stmt = this.userStore.db.prepare('SELECT * FROM invitations WHERE token IN (?, ?)');
    const invitation = stmt.get(hashInvitationToken(token), token);

    if (!invitation) {
      return { valid: false, error: 'Invalid invitation token' };
    }

    if (invitation.status !== 'pending') {
      return { valid: false, error: 'Invitation has already been processed' };
    }

    if (invitation.expires_at < Math.floor(Date.now() / 1000)) {
      return { valid: false, error: 'Invitation has expired' };
    }

    return {
      valid: true,
      id: invitation.id,
      email: invitation.email,
      project_id: invitation.project_id,
      role: invitation.role,
      expires_at: invitation.expires_at
    };
  }

  /**
   * Get invitation by email and project
   * @param {string} email - Email address
   * @param {string} projectId - Project ID
   * @returns {Object|null} Invitation or null
   */
  getInvitationByEmail(email, projectId) {
    const stmt = this.userStore.db.prepare('SELECT * FROM invitations WHERE email = ? AND project_id = ?');
    return stmt.get(email.toLowerCase(), projectId);
  }

  /**
   * Mark invitation as accepted
   * @param {string} token - Invitation token
   */
  markAsAccepted(token) {
    const stmt = this.userStore.db.prepare(`
      UPDATE invitations 
      SET status = 'accepted', updated_at = ? 
      WHERE token IN (?, ?)
    `);
    stmt.run(Math.floor(Date.now() / 1000), hashInvitationToken(token), token);
  }

  /**
   * Add user to project
   * @param {string} userId - User ID
   * @param {string} projectId - Project ID
   * @param {string} role - Role to assign
   */
  addUserToProject(userId, projectId, role = 'viewer') {
    const stmt = this.userStore.db.prepare(`
      INSERT INTO project_users (id, project_id, user_id, role, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    
    stmt.run(id, projectId, userId, role, now, now);
  }

  /**
   * List invitations for a project
   * @param {string} projectId - Project ID
   * @returns {Array} List of invitations
   */
  listProjectInvitations(projectId) {
    const stmt = this.userStore.db.prepare('SELECT * FROM invitations WHERE project_id = ? ORDER BY created_at DESC');
    return stmt.all(projectId);
  }

  /**
   * Revoke an invitation
   * @param {string} token - Invitation token
   * @returns {boolean} True if revoked
   */
  revoke(token) {
    const stmt = this.userStore.db.prepare(`
      UPDATE invitations 
      SET status = 'revoked', updated_at = ? 
      WHERE token IN (?, ?) AND status = 'pending'
    `);
    const result = stmt.run(Math.floor(Date.now() / 1000), hashInvitationToken(token), token);
    return result.changes > 0;
  }
}

// Singleton instance
let userStoreInstance = null;

/**
 * Get singleton UserStore instance
 * @returns {UserStore} UserStore instance
 */
export function getUserStore() {
  if (!userStoreInstance) {
    userStoreInstance = new UserStore();
  }
  return userStoreInstance;
}
