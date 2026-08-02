#!/usr/bin/env node
/**
 * Initialize control plane database with schema
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, '..', '.ai', 'control-plane.db');
const SCHEMA_PATH = path.join(__dirname, '..', 'schema', 'control-plane-schema.sql');

// Ensure .ai directory exists
const aiDir = path.join(__dirname, '..', '.ai');
if (!fs.existsSync(aiDir)) {
  fs.mkdirSync(aiDir, { recursive: true });
}

// Initialize database
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Read and execute schema
const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
db.exec(schema);

// Create indexes
db.pragma('optimize');

console.log(`Control plane database initialized at: ${DB_PATH}`);
console.log('Schema applied successfully');

db.close();