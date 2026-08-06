-- Control Plane Database Schema
-- Multi-tenant platform core database (.ai/control-plane.db)
--
-- Reconciled 2026-08 against the ACTUAL runtime schema (008 — this file previously drifted from
-- what the code creates and was never itself executed by anything except the orphaned, unwired
-- scripts/init-control-plane.mjs). Every table here matches the CREATE TABLE IF NOT EXISTS a real
-- class issues on first use — see the file reference on each table. If you add a column to one of
-- those classes, update it here too; this file is the reference doc, not the source of truth
-- (control-plane.db is created lazily, table-by-table, by whichever singleton touches it first).

-- Projects table. auth/user-store.mjs's UserStore ALSO issues a narrower
-- `CREATE TABLE IF NOT EXISTS projects (id, name, description, status, created_at, updated_at)`
-- for its own project_users/invitations FKs. Whichever constructor runs first against a fresh db
-- wins the initial CREATE; control-plane.mjs's ProjectManager.ensureSchema() backfills any of the
-- columns below that a narrower create left out via ALTER TABLE (see its own doc comment) — so in
-- practice config_path/state_path/port/created_by are NOT NOT NULL/UNIQUE at the SQLite level
-- (ALTER TABLE ADD COLUMN can't add those constraints to an existing table), even though a
-- fresh-from-this-file projects table would enforce them. Source: control-plane.mjs ProjectManager.
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'stopped',
  template TEXT,
  config_path TEXT,
  state_path TEXT,
  port INTEGER,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  health_status TEXT NOT NULL DEFAULT 'unknown',
  last_health_check INTEGER,
  restart_count INTEGER NOT NULL DEFAULT 0,
  last_restart INTEGER
);

-- Users table. Source: auth/user-store.mjs UserStore.initializeTables().
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_login INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1
);

-- Project users table (many-to-many, project-scoped role). Source: UserStore.initializeTables().
CREATE TABLE IF NOT EXISTS project_users (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(project_id, user_id)
);

-- API tokens table. Source: auth/api-tokens.mjs APITokenManager (this table previously had NO
-- creator anywhere in the codebase at all — every method threw "no such table: api_tokens"
-- against a fresh control-plane.db until this was added directly to the class's constructor).
CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  last_used INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1
);

-- Invitations table. Source: auth/user-store.mjs InvitationManager (operates on
-- UserStore.db — no separate connection). Note: no `created_by` column exists in the real
-- implementation (InvitationManager.create() never writes one) despite an earlier version of
-- this doc claiming NOT NULL — tracking who sent an invitation is a real gap, not implemented.
CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  project_id TEXT NOT NULL,
  role TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Licenses table. Source: licensing/*.mjs (not touched by the 008 team-collaboration work —
-- left as previously documented; not independently re-verified against runtime code here).
CREATE TABLE IF NOT EXISTS licenses (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  tier TEXT NOT NULL,
  license_key TEXT NOT NULL UNIQUE,
  features TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER,
  grace_period_ends INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1
);

-- Activity log table. Source: compliance/audit-log.mjs ActivityLogger.initializeTables().
-- NOTE: this table is named `activity_log`, NOT `activity_events` as an earlier version of this
-- doc (and data-model.md) claimed — that name was never what the code actually created, so any
-- tooling querying `activity_events` against a real control-plane.db found nothing.
-- `resource_type`/`resource_id` (from the old doc) don't exist either — ActivityLogger.log() only
-- ever writes {user_id, project_id, action, details, timestamp, created_at}.
CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  project_id TEXT,
  action TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}',
  timestamp INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- compliance_log is a SEPARATE table (SOC2/GDPR compliance trail, not team-activity — distinct
-- from activity_log above), also owned by compliance/audit-log.mjs, via its AuditLogger class.
CREATE TABLE IF NOT EXISTS compliance_log (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL,
  category TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}',
  timestamp INTEGER NOT NULL,
  ip_address TEXT
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_created_by ON projects(created_by);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);
CREATE INDEX IF NOT EXISTS idx_project_users_project_id ON project_users(project_id);
CREATE INDEX IF NOT EXISTS idx_project_users_user_id ON project_users(user_id);
CREATE INDEX IF NOT EXISTS idx_api_tokens_user_id ON api_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email);
CREATE INDEX IF NOT EXISTS idx_invitations_project_id ON invitations(project_id);
CREATE INDEX IF NOT EXISTS idx_invitations_expires_at ON invitations(expires_at);
CREATE INDEX IF NOT EXISTS idx_licenses_customer_id ON licenses(customer_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_user_id ON activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_project_id ON activity_log(project_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_action ON activity_log(action);
CREATE INDEX IF NOT EXISTS idx_activity_log_timestamp ON activity_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_compliance_log_user_id ON compliance_log(user_id);
CREATE INDEX IF NOT EXISTS idx_compliance_log_action ON compliance_log(action);
CREATE INDEX IF NOT EXISTS idx_compliance_log_category ON compliance_log(category);
CREATE INDEX IF NOT EXISTS idx_compliance_log_timestamp ON compliance_log(timestamp);
