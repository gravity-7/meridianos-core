import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writePolicy } from '../policy-write.mjs';
import { parseYaml } from '../yaml-lite.mjs';
import { listBackups, restoreBackup } from '../policy-backups.mjs';

const SAMPLE = `version: 1
kill_switch: false
auto_merge: founder_only
`;

test('listBackups returns an empty array when no backups exist yet', () => {
  const dir = mkdtempSync(join(tmpdir(), 'policy-backups-'));
  writeFileSync(join(dir, 'policy.yaml'), SAMPLE);
  assert.deepEqual(listBackups(dir), []);
});

test('listBackups returns existing policy.backup.*.yaml files, newest first', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'policy-backups-'));
  const policyPath = join(dir, 'policy.yaml');
  writeFileSync(policyPath, SAMPLE);

  writePolicy({ kill_switch: true }, { path: policyPath });
  await new Promise((r) => setTimeout(r, 5));
  writePolicy({ auto_merge: 'peer_agent_review' }, { path: policyPath });

  const backups = listBackups(dir);
  assert.equal(backups.length, 2);
  assert.ok(backups[0].timestamp >= backups[1].timestamp, 'newest first');
  for (const b of backups) {
    assert.ok(b.filename.startsWith('policy.backup.'));
    assert.ok(existsSync(join(dir, b.filename)));
  }
});

test('restoreBackup replaces policy.yaml with the backup content and backs up the pre-restore state first', () => {
  const dir = mkdtempSync(join(tmpdir(), 'policy-backups-'));
  const policyPath = join(dir, 'policy.yaml');
  writeFileSync(policyPath, SAMPLE);

  writePolicy({ kill_switch: true }, { path: policyPath }); // creates a backup holding kill_switch: false
  const [backup] = listBackups(dir);

  const beforeRestoreBackupCount = listBackups(dir).length;
  const result = restoreBackup(dir, backup.timestamp, { policyPath });

  assert.equal(result.ok, true);
  assert.equal(parseYaml(readFileSync(policyPath, 'utf8')).kill_switch, false);
  // restoring itself must snapshot the pre-restore (kill_switch: true) state first
  assert.equal(listBackups(dir).length, beforeRestoreBackupCount + 1);
});

test('restoreBackup returns a clear error for an unknown timestamp rather than throwing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'policy-backups-'));
  writeFileSync(join(dir, 'policy.yaml'), SAMPLE);
  const result = restoreBackup(dir, 'not-a-real-timestamp', { policyPath: join(dir, 'policy.yaml') });
  assert.equal(result.ok, false);
  assert.match(result.error, /no backup found/i);
});

test('restoreBackup rejects a backup whose content fails policy validation, without touching the live file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'policy-backups-'));
  const policyPath = join(dir, 'policy.yaml');
  writeFileSync(policyPath, SAMPLE);

  // Hand-craft an invalid backup: kill_switch as a non-boolean-looking value that fails validatePolicy's enum/type checks
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(join(dir, `policy.backup.${timestamp}.yaml`), 'version: 1\nauto_merge: not_a_valid_enum_value\n');

  const before = readFileSync(policyPath, 'utf8');
  const result = restoreBackup(dir, timestamp, { policyPath });

  assert.equal(result.ok, false);
  assert.equal(readFileSync(policyPath, 'utf8'), before, 'live file must be untouched on a rejected restore');
});
