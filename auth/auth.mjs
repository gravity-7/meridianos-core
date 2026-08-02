/**
 * Authentication and Authorization Middleware
 * Handles JWT and API key validation, role-based access control
 */

import { verifyToken, decodeToken } from './jwt.mjs';
import { getUserStore } from './user-store.mjs';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, '..', '.ai', 'control-plane.db');

// Role hierarchy: admin > operator > viewer
const ROLE_HIERARCHY = {
  admin: 3,
  operator: 2,
  viewer: 1
};

/**
 * Authentication middleware
 * Validates JWT tokens and API keys
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware function
 */
export async function authenticate(req, res, next) {
  try {
    // Check Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }

    const [scheme, token] = authHeader.split(' ');
    if (!scheme || !token) {
      return res.status(401).json({ error: 'Invalid authorization header format' });
    }

    let user = null;

    if (scheme.toLowerCase() === 'bearer') {
      // JWT token authentication
      const payload = verifyToken(token);
      if (!payload) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }

      const userStore = getUserStore();
      user = userStore.getUserById(payload.sub);
      if (!user || !user.is_active) {
        return res.status(401).json({ error: 'User not found or inactive' });
      }

      req.user = user;
      req.tokenPayload = payload;
    } else if (scheme.toLowerCase() === 'apikey') {
      // API key authentication
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      const db = new Database(DB_PATH);
      const stmt = db.prepare(`
        SELECT t.*, u.*
        FROM api_tokens t
        JOIN users u ON t.user_id = u.id
        WHERE t.token_hash = ? AND t.is_active = 1 AND u.is_active = 1
      `);
      const result = stmt.get(tokenHash);
      db.close();

      if (!result) {
        return res.status(401).json({ error: 'Invalid API key' });
      }

      // Check expiration
      if (result.expires_at && result.expires_at < Math.floor(Date.now() / 1000)) {
        return res.status(401).json({ error: 'API key expired' });
      }

      // Update last used
      const updateStmt = db.prepare('UPDATE api_tokens SET last_used = ? WHERE id = ?');
      updateStmt.run(Math.floor(Date.now() / 1000), result.id);

      req.user = {
        id: result.user_id,
        email: result.email,
        full_name: result.full_name,
        is_active: result.is_active
      };
      req.apiToken = {
        id: result.id,
        name: result.name,
        scope: result.scope
      };
    } else {
      return res.status(401).json({ error: 'Unsupported authentication scheme' });
    }

    next();
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(500).json({ error: 'Authentication failed' });
  }
}

/**
 * Authorization middleware
 * Checks if user has required role for the action
 * @param {string} requiredRole - Minimum required role
 * @returns {Function} Middleware function
 */
export function authorize(requiredRole) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Get user's role for the project (if project_id is in request)
    let userRole = 'viewer'; // Default role

    if (req.params.project_id) {
      const db = new Database(DB_PATH);
      const stmt = db.prepare(`
        SELECT role FROM project_users
        WHERE project_id = ? AND user_id = ?
      `);
      const result = stmt.get(req.params.project_id, req.user.id);
      db.close();

      if (result) {
        userRole = result.role;
      }
    } else {
      // For non-project-specific endpoints, check if user is admin
      const db = new Database(DB_PATH);
      const stmt = db.prepare(`
        SELECT role FROM project_users
        WHERE user_id = ? AND role = 'admin'
        LIMIT 1
      `);
      const result = stmt.get(req.user.id);
      db.close();

      if (result) {
        userRole = 'admin';
      }
    }

    // Check role hierarchy
    const userLevel = ROLE_HIERARCHY[userRole] || 0;
    const requiredLevel = ROLE_HIERARCHY[requiredRole] || 0;

    if (userLevel < requiredLevel) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        required: requiredRole,
        current: userRole
      });
    }

    req.userRole = userRole;
    next();
  };
}

/**
 * Check if user has specific permission
 * @param {Object} req - Request object
 * @param {string} permission - Permission to check
 * @returns {boolean} True if user has permission
 */
export function hasPermission(req, permission) {
  if (!req.user || !req.userRole) {
    return false;
  }

  const rolePermissions = {
    admin: ['*'], // All permissions
    operator: [
      'project:create',
      'project:start',
      'project:stop',
      'project:restart',
      'project:read',
      'task:create',
      'task:update',
      'task:delete',
      'task:read',
      'config:read',
      'config:update',
      'user:invite'
    ],
    viewer: [
      'project:read',
      'task:read',
      'config:read'
    ]
  };

  const permissions = rolePermissions[req.userRole] || [];

  // Admin has all permissions
  if (permissions.includes('*')) {
    return true;
  }

  return permissions.includes(permission);
}

/**
 * Optional authentication middleware
 * Attaches user info if authenticated, but doesn't require it
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware function
 */
export async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return next();
    }

    const [scheme, token] = authHeader.split(' ');
    if (!scheme || !token) {
      return next();
    }

    if (scheme.toLowerCase() === 'bearer') {
      const payload = verifyToken(token);
      if (payload) {
        const userStore = getUserStore();
        const user = userStore.getUserById(payload.sub);
        if (user && user.is_active) {
          req.user = user;
          req.tokenPayload = payload;
        }
      }
    }

    next();
  } catch (error) {
    // Don't fail on optional auth errors
    next();
  }
}