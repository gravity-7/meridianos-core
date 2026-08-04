#!/usr/bin/env node
/**
 * CLI for backing up / restoring the control-plane database (T197, Phase 10 polish).
 *
 * Usage:
 *   node scripts/backup-db.mjs backup [destDir]     # default destDir: .ai/backups
 *   node scripts/backup-db.mjs restore <backupPath>
 *   node scripts/backup-db.mjs list [destDir]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProjectManager } from '../control-plane.mjs';
import { listBackups } from '../db-backup.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BACKUP_DIR = path.join(__dirname, '..', '.ai', 'backups');

const [, , cmd, arg] = process.argv;

function usage() {
  console.error('Usage: node scripts/backup-db.mjs <backup|restore|list> [args]');
  process.exit(1);
}

if (!cmd) usage();

const pm = new ProjectManager();

try {
  if (cmd === 'backup') {
    const result = pm.backupDatabase(arg || DEFAULT_BACKUP_DIR);
    console.log(`Backup written: ${result.path} (${result.size} bytes)`);
  } else if (cmd === 'restore') {
    if (!arg) usage();
    pm.restoreDatabase(arg);
    console.log(`Restored control-plane.db from ${arg}`);
    console.log('Run reconcileAfterCrash on next start to reconcile any stale "running" rows from before the restore.');
  } else if (cmd === 'list') {
    const backups = listBackups(arg || DEFAULT_BACKUP_DIR, 'control-plane');
    if (backups.length === 0) {
      console.log('No backups found.');
    } else {
      for (const b of backups) console.log(`${b.mtime}  ${(b.size / 1024).toFixed(1)}KB  ${b.path}`);
    }
  } else {
    usage();
  }
} finally {
  pm.close();
}
