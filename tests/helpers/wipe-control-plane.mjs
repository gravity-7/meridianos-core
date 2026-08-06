/**
 * wipe-control-plane — teardown for the SHARED, hardcoded `<repo root>/.ai/control-plane.db`.
 * Seven module-level singletons write to this one file, each resolving its path off its OWN
 * module location rather than any injected AiosConfig: control-plane.mjs's ProjectManager and
 * ReviewerAssigner, control-plane-telemetry.mjs's TelemetryCollector, compliance/audit-log.mjs's
 * ActivityLogger + AuditLogger, auth/user-store.mjs's UserStore, and auth/api-tokens.mjs's
 * APITokenManager. A test that exercises dashboard/server.mjs HTTP routes
 * touching any of these can't sandbox itself into a temp repoRoot the way config-derived paths
 * can — it uses the one real file and is responsible for leaving it exactly as it found it.
 *
 * Two entry points, NOT interchangeable:
 *   - `wipeControlPlaneDbFiles()` — pure best-effort unlink, touches no singleton. Safe to call
 *     from `before()` to clear a stale file left by a prior run, since nothing in this process has
 *     opened the db yet. Calling the close-first variant here instead would be a bug: each getter
 *     (getUserStore() etc.) lazily creates its instance on first call and never resets the
 *     module-level singleton var on `.close()`, so closing it before the test file's own `before()`
 *     logic goes on to create fixtures via that same singleton would hand back an already-closed
 *     connection and every query would throw.
 *   - `closeControlPlaneSingletonsAndWipeDb()` — closes every singleton this process may have
 *     touched, THEN deletes the file (+ WAL/SHM sidecars) with a short retry. Only safe once the
 *     test file is done using them — call from `after()`, after the HTTP server itself is closed.
 *     On Windows an open better-sqlite3 (WAL-mode) handle blocks delete outright (EBUSY), and even
 *     after `.close()` the OS can take a beat to release the mmap'd WAL/SHM handles, hence the
 *     retry loop rather than a single unlink attempt.
 */
import { existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getProjectManager, getReviewerAssigner } from '../../control-plane.mjs';
import { _resetTelemetryCollector } from '../../control-plane-telemetry.mjs';
import { getActivityLogger, getAuditLogger } from '../../compliance/audit-log.mjs';
import { getUserStore } from '../../auth/user-store.mjs';
import { getAPITokenManager } from '../../auth/api-tokens.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
export const CONTROL_PLANE_DB = join(REPO_ROOT, '.ai', 'control-plane.db');

async function unlinkWithRetry(filePath, attempts = 10, delayMs = 100) {
  for (let i = 0; i < attempts; i++) {
    try {
      unlinkSync(filePath);
      return;
    } catch (err) {
      if (err.code === 'ENOENT') return;
      // Best-effort past the last attempt — a leftover file here is a pre-existing repo-hygiene
      // gap (see module doc comment), not something worth failing a test suite over.
      if (i === attempts - 1 || (err.code !== 'EBUSY' && err.code !== 'EPERM')) return;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function unlinkAllSuffixes() {
  for (const suffix of ['', '-wal', '-shm']) {
    const full = CONTROL_PLANE_DB + suffix;
    if (existsSync(full)) await unlinkWithRetry(full);
  }
}

/** Best-effort delete only — see module doc comment for why this must never close a singleton. */
export async function wipeControlPlaneDbFiles() {
  await unlinkAllSuffixes();
}

function closeQuietly(getInstance) {
  try {
    const instance = getInstance();
    if (typeof instance.close === 'function') instance.close();
    else instance.db.close();
  } catch { /* singleton was never touched this process, or is already closed — fine either way */ }
}

/** Close every control-plane.db singleton this process touched, then delete the file. after()-only. */
export async function closeControlPlaneSingletonsAndWipeDb() {
  closeQuietly(getProjectManager);
  closeQuietly(getReviewerAssigner);
  closeQuietly(getActivityLogger);
  closeQuietly(getAuditLogger);
  closeQuietly(getUserStore);
  closeQuietly(getAPITokenManager);
  try { _resetTelemetryCollector(); } catch { /* never touched this process — fine */ }
  await unlinkAllSuffixes();
}
