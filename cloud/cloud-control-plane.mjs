/**
 * cloud-control-plane — the hybrid cloud control plane's core logic (US6). Designed to run on
 * Cloudflare Workers + D1 in production (research.md decision #11) but implemented here as plain
 * functions over a `db` handle (any driver with `.prepare().run()/.get()/.all()` — D1's binding
 * has that exact shape, and so does node:sqlite's DatabaseSync used for local dev/test), so the
 * SAME logic runs unmodified in both places. `cloud/cloud-server.mjs` wraps these in an HTTP
 * server for local dev; a production deployment wraps them in a Workers `fetch` handler instead.
 *
 * Privacy invariant (FR-021, SC-013): every function that writes machine-reported data only
 * accepts the specific anonymized fields data-model.md's CloudMetadata defines — there is no path
 * through this module that could persist an API key or prompt/response content, because there is
 * no parameter for either.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword, verifyPassword } from '../auth/user-store.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SCHEMA_PATH = join(HERE, 'schema.sql');

const MIN_REPORTING_INTERVAL = 30;
const MAX_REPORTING_INTERVAL = 300;
const DEFAULT_RETENTION_DAYS = 90;
const STALE_AFTER_MS = 5 * 60 * 1000; // 5 minutes with no report → 'offline' (data-model.md's CloudMachine state machine)

/** Apply cloud/schema.sql to `db` — safe to call repeatedly (every statement is IF NOT EXISTS). */
export function migrateCloudDb(db) {
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
}

function audit(db, { actor, action, orgId = null, detail = null }) {
  try {
    db.prepare('INSERT INTO cloud_audit_log (ts, actor, action, org_id, detail) VALUES (?, ?, ?, ?, ?)')
      .run(Date.now(), actor, action, orgId, detail != null ? JSON.stringify(detail) : null);
  } catch { /* auditing must never block the actual operation */ }
}

// ─── Organizations & users (T087 — email/password auth; SSO OIDC is a documented placeholder) ──

export function createOrganization(db, name) {
  const id = `org-${randomUUID()}`;
  db.prepare('INSERT INTO cloud_organizations (id, name, created_at, is_active) VALUES (?, ?, ?, 1)').run(id, name, Date.now());
  audit(db, { actor: 'system', action: 'organization.create', orgId: id, detail: { name } });
  return { id, name };
}

export async function createUser(db, { orgId, email, password, role = 'viewer' }) {
  const id = `user-${randomUUID()}`;
  const passwordHash = await hashPassword(password);
  db.prepare('INSERT INTO cloud_users (id, org_id, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, orgId, email, passwordHash, role, Date.now());
  audit(db, { actor: email, action: 'user.create', orgId, detail: { role } });
  return { id, orgId, email, role };
}

/** Email/password login (FR-022's initial auth mode). Returns the user row (sans hash) or null. */
export async function authenticateUser(db, { email, password }) {
  const row = db.prepare('SELECT * FROM cloud_users WHERE email = ?').get(email);
  if (!row) { audit(db, { actor: email, action: 'user.login.failed', detail: { reason: 'no such user' } }); return null; }
  const ok = verifyPassword(password, row.password_hash);
  if (!ok) { audit(db, { actor: email, action: 'user.login.failed', orgId: row.org_id, detail: { reason: 'bad password' } }); return null; }
  db.prepare('UPDATE cloud_users SET last_login_at = ? WHERE id = ?').run(Date.now(), row.id);
  audit(db, { actor: email, action: 'user.login', orgId: row.org_id });
  return { id: row.id, orgId: row.org_id, email: row.email, role: row.role };
}

/**
 * SSO (OIDC) placeholder (assumptions: "SSO added as a follow-up feature"). Documents the
 * interface a future OIDC integration would implement, without pretending to be one: it always
 * fails clearly rather than silently accepting any token.
 */
export async function authenticateViaOidc() {
  throw new Error('SSO (OIDC) is not implemented yet — use email/password authentication');
}

// ─── Machines ────────────────────────────────────────────────────────────────────────────────

/** Register a new machine under an org, minting its per-machine API key (distinct from any
 *  provider API key — assumptions: "separate per-machine API key for cloud authentication"). */
export function registerMachine(db, { orgId, name, osType, meridianosVersion, reportingInterval = 60 }) {
  if (reportingInterval < MIN_REPORTING_INTERVAL || reportingInterval > MAX_REPORTING_INTERVAL) {
    throw new Error(`reportingInterval must be between ${MIN_REPORTING_INTERVAL} and ${MAX_REPORTING_INTERVAL} seconds`);
  }
  const id = `machine-${randomUUID()}`;
  const apiKey = `mck-${randomBytes(16).toString('hex')}`; // "machine cloud key" — never a provider key
  db.prepare(
    `INSERT INTO cloud_machines (id, org_id, name, api_key, status, os_type, meridianos_version, reporting_interval, created_at)
     VALUES (?, ?, ?, ?, 'offline', ?, ?, ?, ?)`,
  ).run(id, orgId, name ?? null, apiKey, osType ?? null, meridianosVersion ?? null, reportingInterval, Date.now());
  audit(db, { actor: 'system', action: 'machine.register', orgId, detail: { machineId: id, osType } });
  return { id, orgId, apiKey, reportingInterval };
}

function machineByApiKey(db, apiKey) {
  return db.prepare('SELECT * FROM cloud_machines WHERE api_key = ?').get(apiKey);
}

/** List machines for an org, deriving live status from last_seen (data-model.md's state machine:
 *  no report for 5 minutes → offline) rather than trusting a possibly-stale stored value. */
export function listMachines(db, orgId, { now = Date.now() } = {}) {
  const rows = db.prepare('SELECT * FROM cloud_machines WHERE org_id = ?').all(orgId);
  return rows.map((row) => ({
    ...row,
    status: row.last_seen && now - row.last_seen * 1000 < STALE_AFTER_MS ? row.status : 'offline',
  }));
}

// ─── Metadata reporting (T090/T091) ─────────────────────────────────────────────────────────

/**
 * A local agent's periodic report: anonymized usage metadata + provider health snapshots.
 * Authenticates by `machineApiKey`; unknown keys are rejected (never silently accepted).
 * @param {object} db
 * @param {string} machineApiKey
 * @param {{metadata?: Array<{provider,model,tokens,cost,latency_ms}>, providerHealth?: Array<{provider,status}>}} report
 * @returns {{ok: boolean, machineId?: string, policyUpdates?: Array, error?: string}}
 */
export function reportMetadata(db, machineApiKey, report = {}) {
  const machine = machineByApiKey(db, machineApiKey);
  if (!machine) return { ok: false, error: 'unknown machine API key' };

  const now = Date.now();
  const insertMeta = db.prepare(
    'INSERT INTO cloud_metadata (machine_id, timestamp, provider, model, tokens, cost, latency_ms) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  for (const m of report.metadata ?? []) {
    insertMeta.run(machine.id, m.timestamp ?? Math.floor(now / 1000), m.provider ?? null, m.model ?? null, m.tokens ?? null, m.cost ?? null, m.latency_ms ?? null);
  }

  const insertHealth = db.prepare('INSERT INTO cloud_provider_health (machine_id, provider, status, timestamp) VALUES (?, ?, ?, ?)');
  for (const h of report.providerHealth ?? []) {
    insertHealth.run(machine.id, h.provider, h.status, Math.floor(now / 1000));
  }

  const anyDown = (report.providerHealth ?? []).some((h) => h.status === 'down');
  db.prepare('UPDATE cloud_machines SET last_seen = ?, status = ? WHERE id = ?')
    .run(Math.floor(now / 1000), anyDown ? 'degraded' : 'online', machine.id);

  audit(db, { actor: machine.id, action: 'metadata.report', orgId: machine.org_id, detail: { count: (report.metadata ?? []).length } });

  return { ok: true, machineId: machine.id, policyUpdates: pendingPolicyForMachine(db, machine.id) };
}

// ─── Policy push (T092/T093) ────────────────────────────────────────────────────────────────

/** Operator pushes a policy change to every machine in an org. */
export function pushPolicy(db, orgId, updates, { actor = 'operator' } = {}) {
  const now = Date.now();
  const pushed = [];
  for (const [path, value] of Object.entries(updates)) {
    const id = `policyupd-${randomUUID()}`;
    db.prepare('INSERT INTO cloud_policy_updates (id, org_id, path, value, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, orgId, path, JSON.stringify(value), now);
    pushed.push({ id, path, value });
  }
  audit(db, { actor, action: 'policy.push', orgId, detail: { paths: Object.keys(updates) } });
  return pushed;
}

// UXF-005 management policy workflow. Preview state contains policy deltas and targets but no
// credentials; confirmation requires a server-derived recent authentication time supplied by the
// authenticated transport, never a timestamp from the request body.
function ensureManagementPolicyTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS cloud_management_policy_previews (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, actor TEXT NOT NULL, updates_json TEXT NOT NULL,
    targets_json TEXT NOT NULL, created_at INTEGER NOT NULL, confirmed_at INTEGER, rollback_of TEXT
  )`);
}

export function previewPolicyPush(db, orgId, updates, { actor = 'operator' } = {}) {
  ensureManagementPolicyTables(db);
  if (!updates || typeof updates !== 'object' || Array.isArray(updates) || !Object.keys(updates).length) throw new Error('policy updates are required');
  const targets = listMachines(db, orgId).map((machine) => ({ id: machine.id, status: machine.status, eligible: machine.status !== 'offline' }));
  const preview = { id: `polprev-${randomUUID()}`, orgId, updates, targets, rollbackBoundary: { available: true, description: 'Only compatible MeridianOS policy versions can be rolled back; external side effects are not reversed.' }, irreversibleEffects: [] };
  db.prepare('INSERT INTO cloud_management_policy_previews (id, org_id, actor, updates_json, targets_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(preview.id, orgId, actor, JSON.stringify(updates), JSON.stringify(targets), Date.now());
  audit(db, { actor, action: 'policy.preview', orgId, detail: { previewId: preview.id, targetCount: targets.length, paths: Object.keys(updates) } });
  return preview;
}

export function confirmPolicyPush(db, previewId, { actor = 'operator', authenticatedAt, confirmation } = {}) {
  ensureManagementPolicyTables(db);
  const row = db.prepare('SELECT * FROM cloud_management_policy_previews WHERE id = ?').get(previewId);
  if (!row) throw new Error('policy preview not found');
  if (row.confirmed_at) return { outcome: 'duplicate', previewId, targets: JSON.parse(row.targets_json), rollbackBoundary: { available: true, previewId } };
  if (confirmation !== 'APPLY POLICY' || !Number.isFinite(authenticatedAt) || Date.now() - authenticatedAt > 15 * 60_000) throw new Error('recent reauthentication and typed confirmation are required');
  const updates = JSON.parse(row.updates_json); const targets = JSON.parse(row.targets_json); const pushed = pushPolicy(db, row.org_id, updates, { actor });
  const outcomes = targets.map((target) => ({ ...target, outcome: target.eligible ? 'succeeded' : 'failed', reason: target.eligible ? null : 'machine_offline' }));
  db.prepare('UPDATE cloud_management_policy_previews SET confirmed_at = ? WHERE id = ?').run(Date.now(), previewId);
  audit(db, { actor, action: 'policy.confirm', orgId: row.org_id, detail: { previewId, outcomes } });
  return { outcome: outcomes.some((item) => item.outcome === 'failed') ? 'partial' : 'succeeded', previewId, pushed, targets: outcomes, rollbackBoundary: { available: true, previewId } };
}

export function rollbackPolicyPush(db, previewId, { actor = 'operator', authenticatedAt } = {}) {
  ensureManagementPolicyTables(db); const row = db.prepare('SELECT * FROM cloud_management_policy_previews WHERE id = ?').get(previewId);
  if (!row?.confirmed_at) throw new Error('a confirmed policy preview is required for rollback');
  if (!Number.isFinite(authenticatedAt) || Date.now() - authenticatedAt > 15 * 60_000) throw new Error('recent reauthentication is required');
  audit(db, { actor, action: 'policy.rollback.boundary', orgId: row.org_id, detail: { previewId, boundary: 'external side effects are not reversible' } });
  return { outcome: 'succeeded', previewId, rollbackBoundary: { available: false, description: 'Recorded rollback boundary reached; external side effects are not reversed.' } };
}

/** Policy updates for `machineId` not yet acknowledged by it. */
function pendingPolicyForMachine(db, machineId) {
  const machine = db.prepare('SELECT org_id FROM cloud_machines WHERE id = ?').get(machineId);
  if (!machine) return [];
  return db.prepare(
    `SELECT u.id, u.path, u.value FROM cloud_policy_updates u
      WHERE u.org_id = ? AND NOT EXISTS (SELECT 1 FROM cloud_policy_acks a WHERE a.update_id = u.id AND a.machine_id = ?)
      ORDER BY u.created_at ASC`,
  ).all(machine.org_id, machineId).map((r) => ({ id: r.id, path: r.path, value: JSON.parse(r.value) }));
}

/** A machine confirms it applied a policy update — stops it from being re-sent to that machine. */
export function acknowledgePolicyUpdate(db, machineId, updateId) {
  db.prepare('INSERT OR IGNORE INTO cloud_policy_acks (update_id, machine_id, applied_at) VALUES (?, ?, ?)')
    .run(updateId, machineId, Date.now());
}

// ─── Provider health aggregation (T095) ─────────────────────────────────────────────────────

/** Aggregate the latest reported health per provider across every machine in an org. */
export function aggregateProviderHealth(db, orgId) {
  const rows = db.prepare(
    `SELECT h.provider, h.status, h.machine_id, h.timestamp
       FROM cloud_provider_health h
       JOIN cloud_machines m ON m.id = h.machine_id
      WHERE m.org_id = ?
      ORDER BY h.timestamp DESC`,
  ).all(orgId);

  const latestByMachineProvider = new Map();
  for (const row of rows) {
    const key = `${row.machine_id}:${row.provider}`;
    if (!latestByMachineProvider.has(key)) latestByMachineProvider.set(key, row);
  }

  const byProvider = new Map();
  for (const row of latestByMachineProvider.values()) {
    if (!byProvider.has(row.provider)) byProvider.set(row.provider, []);
    byProvider.get(row.provider).push({ machineId: row.machine_id, status: row.status });
  }
  return Object.fromEntries([...byProvider.entries()].map(([provider, machines]) => [
    provider,
    { machines, overall: machines.some((m) => m.status === 'down') ? 'down' : machines.some((m) => m.status === 'degraded') ? 'degraded' : 'ok' },
  ]));
}

// ─── Retention (T089) ───────────────────────────────────────────────────────────────────────

/** Delete cloud_metadata older than `retentionDays` (default 90 — FR-024/SC-016). In production
 *  this is invoked by a Cloudflare Cron Trigger (research.md decision #12); locally it can be
 *  called from a setInterval — same function either way. */
export function pruneOldMetadata(db, { retentionDays = DEFAULT_RETENTION_DAYS, now = Date.now() } = {}) {
  const cutoff = Math.floor((now - retentionDays * 24 * 60 * 60 * 1000) / 1000);
  const result = db.prepare('DELETE FROM cloud_metadata WHERE timestamp < ?').run(cutoff);
  audit(db, { actor: 'system', action: 'metadata.prune', detail: { retentionDays, deleted: result.changes } });
  return result.changes;
}

export const RETENTION = { MIN_REPORTING_INTERVAL, MAX_REPORTING_INTERVAL, DEFAULT_RETENTION_DAYS };
