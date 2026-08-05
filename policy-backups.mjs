/**
 * policy-backups — list and restore the timestamped `policy.backup.*.yaml` snapshots that
 * `policy-write.mjs`'s `writePolicy` (and `provider-wizard.mjs`'s `writePolicyWithBackup`) create
 * on every write (008 — End-User Configurability, US1/FR-003).
 *
 * Restoring is itself a write: it goes through `writePolicy`-adjacent backup-then-replace so a bad
 * restore never destroys the state it replaced, and the restored content is gated by
 * `validatePolicy` before it's ever swapped into the live file — an invalid backup (or one written
 * by code with since-changed validation rules) can't silently break the running daemon.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { parseYaml } from './yaml-lite.mjs';
import { validatePolicy } from './policy-validate.mjs';

// Timestamp segment is `[^.]+` (no periods — the ISO timestamp's own `.` was already turned into
// `-` before the file was named) and may itself carry a `-<N>` collision suffix; both cases match
// this single greedy group without a separate alternative.
const BACKUP_RE = /^(.+)\.backup\.([^.]+)\.yaml$/;

/**
 * List every `<basename>.backup.<timestamp>.yaml` file found alongside `policy.yaml` in `repoRoot`,
 * newest first. Never throws — an unreadable directory just yields no backups.
 *
 * @param {string} repoRoot - directory containing policy.yaml and its backups (e.g. `.ai/` in the real daemon)
 * @returns {Array<{ filename: string, timestamp: string }>}
 */
export function listBackups(repoRoot) {
  let entries;
  try {
    entries = readdirSync(repoRoot);
  } catch {
    return [];
  }
  const backups = [];
  for (const filename of entries) {
    const m = BACKUP_RE.exec(filename);
    if (m) backups.push({ filename, timestamp: m[2] });
  }
  backups.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
  return backups;
}

/**
 * Restore a specific backup by timestamp, replacing the live `policy.yaml`. The pre-restore state
 * is itself backed up first (restoring never destroys what it replaces), and the backup's content
 * is validated before being swapped in — an invalid/corrupt backup is rejected with the live file
 * left untouched.
 *
 * @param {string} repoRoot - directory containing policy.yaml and its backups
 * @param {string} timestamp - the timestamp segment from a `listBackups` entry
 * @param {{ policyPath: string }} opts - `policyPath` is the live policy.yaml's full path (REQUIRED)
 * @returns {{ ok: boolean, error?: string, backupPath?: string }}
 */
export function restoreBackup(repoRoot, timestamp, { policyPath }) {
  const match = listBackups(repoRoot).find((b) => b.timestamp === timestamp);
  if (!match) {
    return { ok: false, error: `no backup found for timestamp '${timestamp}'` };
  }

  const backupFullPath = join(repoRoot, match.filename);
  const restoredText = readFileSync(backupFullPath, 'utf8');

  let parsed;
  try {
    parsed = parseYaml(restoredText);
  } catch (e) {
    return { ok: false, error: `backup '${match.filename}' is not valid YAML: ${e.message}` };
  }

  const v = validatePolicy(parsed);
  if (!v.ok) {
    return { ok: false, error: `backup '${match.filename}' fails policy validation: ${v.errors.join('; ')}` };
  }

  // Snapshot the pre-restore state before overwriting — restoring is itself a write.
  if (existsSync(policyPath)) {
    const base = basename(policyPath, '.yaml');
    const preRestoreTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
    let preRestoreBackupPath = join(repoRoot, `${base}.backup.${preRestoreTimestamp}.yaml`);
    let suffix = 1;
    while (existsSync(preRestoreBackupPath)) {
      preRestoreBackupPath = join(repoRoot, `${base}.backup.${preRestoreTimestamp}-${suffix}.yaml`);
      suffix++;
    }
    copyFileSync(policyPath, preRestoreBackupPath);
  }

  writeFileSync(policyPath, restoredText);
  return { ok: true, backupPath: backupFullPath };
}
