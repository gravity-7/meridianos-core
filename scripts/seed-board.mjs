#!/usr/bin/env node
/**
 * seed-board.mjs — creates MeridianOS tasks on the mos-dev board from the 11 feature specs.
 * Run once to populate the empty board. Idempotent (won't duplicate existing tasks).
 *
 * Usage: node scripts/seed-board.mjs
 */

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const REPO = 'c:/projects/mos-dev';
const DB_PATH = join(REPO, '.ai', 'state', 'aios.db');
const FEATURES_DIR = 'c:/projects/meridianos-core/docs/features';

const FEATURES = [
  { id: 'F001', title: 'Live Dogfood Deny Artifact', owner: 'builder', priority: 10, spec: 'F001-live-dogfood-deny-artifact.md', note: '✅ DONE — deny artifact produced 2026-07-19' },
  { id: 'F002', title: 'Gateway npm Publication & Distribution', owner: 'builder', priority: 20, spec: 'F002-gateway-npm-publication.md' },
  { id: 'F006', title: 'Azure DevOps Connector', owner: 'builder', priority: 15, spec: 'F006-azure-devops-connector.md' },
  { id: 'F004', title: 'Gateway Spend Dashboard v0.1', owner: 'builder', priority: 30, spec: 'F004-gateway-spend-dashboard.md' },
  { id: 'F005', title: 'License Key System & Stripe Billing', owner: 'builder', priority: 40, spec: 'F005-license-key-stripe-billing.md' },
  { id: 'F007', title: 'Slack Integration', owner: 'builder', priority: 50, spec: 'F007-slack-integration.md' },
  { id: 'F008', title: 'Competitive Comparison & Content Pages', owner: 'docs-writer', priority: 60, spec: 'F008-competitive-comparison-content.md' },
  { id: 'F009', title: 'Demo Video & Pitch Production', owner: 'designer', priority: 70, spec: 'F009-demo-video-pitch.md' },
  { id: 'F010', title: 'Community & Prospect Pipeline', owner: 'designer', priority: 80, spec: 'F010-community-prospect-pipeline.md' },
  { id: 'F011', title: 'Product Hunt Launch Package', owner: 'designer', priority: 90, spec: 'F011-product-hunt-launch.md' },
  { id: 'F003', title: 'MeridianOS Marketing Website [DEFERRED]', owner: 'designer', priority: 100, spec: 'F003-marketing-website.md', note: '⚠️ DEFERRED — execute last' },
];

function readSpec(specFile) {
  const path = join(FEATURES_DIR, specFile);
  try { return readFileSync(path, 'utf8'); } catch { return null; }
}

function main() {
  if (!existsSync(DB_PATH)) {
    console.error('Board DB not found at', DB_PATH);
    console.error('Is the daemon running? It creates the DB on first boot.');
    process.exit(1);
  }

  const db = new DatabaseSync(DB_PATH);
  const now = new Date().toISOString();

  console.log('Seeding mos-dev board...\n');

  for (const f of FEATURES) {
    const existing = db.prepare('SELECT id, status FROM tasks WHERE id = ?').get(f.id);
    if (existing) {
      console.log(`⏭️  ${f.id}: already exists (${existing.status})`);
      continue;
    }

    // Write spec file
    const specContent = readSpec(f.spec);
    if (specContent) {
      const specDir = join(REPO, '.ai', 'features', f.id);
      mkdirSync(specDir, { recursive: true });
      const specPath = join(specDir, 'spec.md');
      // Use the feature ID as the spec file reference
      // (full spec is in meridianos-core docs/features/)
    }

    db.prepare(`
      INSERT INTO tasks(id, type, title, status, owner, priority, complexity, lane, spec, note, created_at, updated_at)
      VALUES (?, 'feature', ?, 'proposed', ?, ?, 3, 'standard', ?, ?, ?, ?)
    `).run(
      f.id,
      f.title,
      f.owner || 'both',
      f.priority,
      `.ai/features/${f.id}/spec.md`,
      f.note || null,
      now,
      now,
    );

    console.log(`✅ ${f.id}: CREATED — "${f.title}" [${f.owner}]`);
  }

  // Count total
  const count = db.prepare('SELECT COUNT(*) as cnt FROM tasks').get();
  console.log(`\n📋 Board now has ${count.cnt} tasks.`);

  db.close();
}

main();
