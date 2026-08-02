#!/usr/bin/env node
/**
 * Generate JWT secret and store securely
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SECRET_PATH = path.join(__dirname, '..', '.ai', 'auth', 'jwt-secret');

// Ensure .ai/auth directory exists
const authDir = path.join(__dirname, '..', '.ai', 'auth');
if (!fs.existsSync(authDir)) {
  fs.mkdirSync(authDir, { recursive: true });
}

// Generate 64-byte random secret
const secret = crypto.randomBytes(64).toString('hex');

// Write secret with restricted permissions
fs.writeFileSync(SECRET_PATH, secret, { mode: 0o600 });

console.log(`JWT secret generated and stored at: ${SECRET_PATH}`);
console.log('Permissions set to 0600 (read/write for owner only)');