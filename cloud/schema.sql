-- Hybrid Cloud Control Plane (US6) schema. Designed to run identically on Cloudflare D1
-- (production — see research.md decision #11) and on local SQLite via node:sqlite (dev/test —
-- see cloud/cloud-control-plane.mjs's createLocalCloudDb) — plain ANSI-ish SQL, no D1-only or
-- SQLite-only syntax.
--
-- Privacy invariant (FR-021, SC-013): cloud_metadata NEVER carries API keys or prompt/response
-- content — only token counts, costs, provider/model names, and latency. Enforced by construction
-- (reportMetadata() in cloud-control-plane.mjs only accepts these specific columns), not by a
-- runtime filter, so there is no column here to accidentally populate with a secret.

CREATE TABLE IF NOT EXISTS cloud_organizations (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS cloud_users (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'viewer',  -- admin | operator | viewer
  created_at     INTEGER NOT NULL,
  last_login_at  INTEGER,
  FOREIGN KEY (org_id) REFERENCES cloud_organizations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_cloud_users_org_id ON cloud_users(org_id);
CREATE INDEX IF NOT EXISTS idx_cloud_users_email ON cloud_users(email);

CREATE TABLE IF NOT EXISTS cloud_machines (
  id                TEXT PRIMARY KEY,
  org_id            TEXT NOT NULL,
  name              TEXT,
  api_key           TEXT NOT NULL UNIQUE,   -- per-machine key, DISTINCT from any provider API key
  last_seen         INTEGER,
  status            TEXT NOT NULL DEFAULT 'offline',  -- online | offline | degraded
  os_type           TEXT,                    -- windows | macos | linux
  meridianos_version TEXT,
  reporting_interval INTEGER NOT NULL DEFAULT 60,  -- seconds, 30-300 (FR-020)
  created_at        INTEGER NOT NULL,
  FOREIGN KEY (org_id) REFERENCES cloud_organizations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_cloud_machines_org_id ON cloud_machines(org_id);
CREATE INDEX IF NOT EXISTS idx_cloud_machines_api_key ON cloud_machines(api_key);

CREATE TABLE IF NOT EXISTS cloud_metadata (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id TEXT NOT NULL,
  timestamp  INTEGER NOT NULL,
  provider   TEXT,
  model      TEXT,
  tokens     INTEGER,
  cost       REAL,
  latency_ms INTEGER,
  FOREIGN KEY (machine_id) REFERENCES cloud_machines(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_cloud_metadata_machine_id ON cloud_metadata(machine_id);
CREATE INDEX IF NOT EXISTS idx_cloud_metadata_timestamp ON cloud_metadata(timestamp);

-- Provider health snapshots, reported alongside token/cost metadata — same privacy invariant
-- (no keys, no content), used to aggregate health across all of an org's connected machines (T095).
CREATE TABLE IF NOT EXISTS cloud_provider_health (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id TEXT NOT NULL,
  provider   TEXT NOT NULL,
  status     TEXT NOT NULL,   -- ok | degraded | down | unknown
  timestamp  INTEGER NOT NULL,
  FOREIGN KEY (machine_id) REFERENCES cloud_machines(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_cloud_provider_health_machine_id ON cloud_provider_health(machine_id);

-- Operator-pushed policy changes (T092/T093): one row per {org, dotted-path, value}. A local
-- agent's report response includes any rows for its org newer than what it last acknowledged;
-- `applied_by` is filled in per-machine via cloud_policy_acks once that machine confirms.
CREATE TABLE IF NOT EXISTS cloud_policy_updates (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL,
  path       TEXT NOT NULL,     -- dotted policy.yaml path, e.g. 'agent_budget.warn_pct'
  value      TEXT NOT NULL,     -- JSON-encoded value
  created_at INTEGER NOT NULL,
  FOREIGN KEY (org_id) REFERENCES cloud_organizations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_cloud_policy_updates_org_id ON cloud_policy_updates(org_id);

CREATE TABLE IF NOT EXISTS cloud_policy_acks (
  update_id  TEXT NOT NULL,
  machine_id TEXT NOT NULL,
  applied_at INTEGER NOT NULL,
  PRIMARY KEY (update_id, machine_id)
);

-- Security audit log (T096) — every read/write of cloud data, for compliance review.
CREATE TABLE IF NOT EXISTS cloud_audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         INTEGER NOT NULL,
  actor      TEXT NOT NULL,    -- user email, machine id, or 'system'
  action     TEXT NOT NULL,    -- e.g. 'metadata.report', 'policy.push', 'user.login'
  org_id     TEXT,
  detail     TEXT              -- JSON string, action-specific
);
CREATE INDEX IF NOT EXISTS idx_cloud_audit_log_ts ON cloud_audit_log(ts);
CREATE INDEX IF NOT EXISTS idx_cloud_audit_log_org_id ON cloud_audit_log(org_id);
