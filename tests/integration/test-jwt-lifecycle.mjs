/**
 * Integration test for JWT token lifecycle
 * Tests token generation, validation, expiration, and refresh
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generateToken, verifyToken, refreshToken, decodeToken } from '../../auth/jwt.mjs';

describe('JWT Token Lifecycle Integration Tests', () => {
  it('should generate valid JWT token', () => {
    const payload = {
      sub: 'user-123',
      email: 'test@example.com',
      role: 'admin'
    };

    const token = generateToken(payload);

    assert.ok(token);
    assert.ok(typeof token === 'string');
    assert.ok(token.split('.').length === 3); // header.payload.signature
  });

  it('should verify valid JWT token', () => {
    const payload = {
      sub: 'user-123',
      email: 'test@example.com',
      role: 'admin'
    };

    const token = generateToken(payload);
    const decoded = verifyToken(token);

    assert.ok(decoded);
    assert.strictEqual(decoded.sub, 'user-123');
    assert.strictEqual(decoded.email, 'test@example.com');
    assert.strictEqual(decoded.role, 'admin');
    assert.ok(decoded.iat);
    assert.ok(decoded.exp);
  });

  it('should reject invalid JWT token', () => {
    const invalidToken = 'invalid.token.here';
    const decoded = verifyToken(invalidToken);

    assert.strictEqual(decoded, null);
  });

  it('should reject tampered JWT token', () => {
    const payload = {
      sub: 'user-123',
      email: 'test@example.com'
    };

    const token = generateToken(payload);
    const tamperedToken = token.slice(0, -1) + 'X'; // Change last character

    const decoded = verifyToken(tamperedToken);

    assert.strictEqual(decoded, null);
  });

  it('should reject expired JWT token', () => {
    const payload = {
      sub: 'user-123',
      email: 'test@example.com',
      exp: Math.floor(Date.now() / 1000) - 3600 // Expired 1 hour ago
    };

    const token = generateToken(payload);
    const decoded = verifyToken(token);

    assert.strictEqual(decoded, null);
  });

  it('should refresh JWT token', () => {
    const payload = {
      sub: 'user-123',
      email: 'test@example.com',
      role: 'admin'
    };

    const originalToken = generateToken(payload);
    const newToken = refreshToken(originalToken, 3600); // 1 hour

    assert.ok(newToken);
    assert.notStrictEqual(originalToken, newToken);

    const originalDecoded = verifyToken(originalToken);
    const newDecoded = verifyToken(newToken);

    assert.strictEqual(originalDecoded.sub, newDecoded.sub);
    assert.strictEqual(originalDecoded.email, newDecoded.email);
    assert.strictEqual(originalDecoded.role, newDecoded.role);
    assert.ok(newDecoded.exp > originalDecoded.exp);
  });

  it('should return null when refreshing invalid token', () => {
    const invalidToken = 'invalid.token.here';
    const newToken = refreshToken(invalidToken);

    assert.strictEqual(newToken, null);
  });

  it('should decode JWT token without verification', () => {
    const payload = {
      sub: 'user-123',
      email: 'test@example.com',
      role: 'admin'
    };

    const token = generateToken(payload);
    const decoded = decodeToken(token);

    assert.ok(decoded);
    assert.strictEqual(decoded.sub, 'user-123');
    assert.strictEqual(decoded.email, 'test@example.com');
    assert.strictEqual(decoded.role, 'admin');
  });

  it('should return null when decoding invalid token format', () => {
    const invalidToken = 'invalid';
    const decoded = decodeToken(invalidToken);

    assert.strictEqual(decoded, null);
  });

  it('should include iat timestamp in token', () => {
    const payload = {
      sub: 'user-123',
      email: 'test@example.com'
    };

    const before = Math.floor(Date.now() / 1000);
    const token = generateToken(payload);
    const after = Math.floor(Date.now() / 1000);

    const decoded = verifyToken(token);
    assert.ok(decoded.iat >= before);
    assert.ok(decoded.iat <= after);
  });

  it('should set default expiration if not provided', () => {
    const payload = {
      sub: 'user-123',
      email: 'test@example.com'
    };

    const token = generateToken(payload);
    const decoded = verifyToken(token);

    const now = Math.floor(Date.now() / 1000);
    assert.ok(decoded.exp > now);
    assert.ok(decoded.exp <= now + 1800); // Default 30 minutes
  });
});