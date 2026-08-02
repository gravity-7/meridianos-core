/**
 * JWT Token Generation and Validation
 * Uses Node.js crypto module for HMAC-SHA256 signing
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SECRET_PATH = path.join(__dirname, '..', '.ai', 'auth', 'jwt-secret');

// JWT token structure: header.payload.signature
// Header: {"alg":"HS256","typ":"JWT"}
// Payload: {sub, iat, exp, ...claims}

const JWT_HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  .toString('base64url');

/**
 * Load JWT secret from file
 */
function loadSecret() {
  if (!fs.existsSync(SECRET_PATH)) {
    throw new Error('JWT secret not found. Run scripts/generate-jwt-secret.mjs');
  }
  return fs.readFileSync(SECRET_PATH, 'utf-8').trim();
}

/**
 * Generate JWT token
 * @param {Object} payload - Token payload (sub, exp, etc.)
 * @param {number} expiresIn - Expiration time in seconds (default: 30 minutes)
 * @returns {string} JWT token
 */
export function generateToken(payload, expiresIn = 1800) {
  const secret = loadSecret();

  // Add issued at timestamp and expiration
  const tokenPayload = {
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: payload.exp || (Math.floor(Date.now() / 1000) + expiresIn)
  };

  // Encode payload
  const encodedPayload = Buffer.from(JSON.stringify(tokenPayload))
    .toString('base64url');

  // Create signature
  const data = `${JWT_HEADER}.${encodedPayload}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64url');

  return `${data}.${signature}`;
}

/**
 * Verify JWT token
 * @param {string} token - JWT token to verify
 * @returns {Object|null} Decoded payload or null if invalid
 */
export function verifyToken(token) {
  try {
    const secret = loadSecret();

    const [header, payload, signature] = token.split('.');
    if (!header || !payload || !signature) {
      return null;
    }

    // Verify signature
    const data = `${header}.${payload}`;
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(data)
      .digest('base64url');

    if (signature !== expectedSignature) {
      return null;
    }

    // Decode payload
    const decoded = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf-8')
    );

    // Check expiration
    if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return decoded;
  } catch (error) {
    return null;
  }
}

/**
 * Refresh JWT token
 * @param {string} token - Current JWT token
 * @param {number} expiresIn - Expiration time in seconds (default: 30 minutes)
 * @returns {string|null} New JWT token or null if invalid
 */
export function refreshToken(token, expiresIn = 1800) {
  const payload = verifyToken(token);
  if (!payload) {
    return null;
  }

  // Remove old timestamps
  const { iat, exp, ...claims } = payload;

  // Set new expiration
  const newPayload = {
    ...claims,
    exp: Math.floor(Date.now() / 1000) + expiresIn
  };

  return generateToken(newPayload);
}

/**
 * Decode JWT token without verification (for debugging)
 * @param {string} token - JWT token
 * @returns {Object|null} Decoded payload or null if invalid format
 */
export function decodeToken(token) {
  try {
    const [, payload] = token.split('.');
    if (!payload) {
      return null;
    }

    return JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf-8')
    );
  } catch (error) {
    return null;
  }
}