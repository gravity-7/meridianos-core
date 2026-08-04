-- AIOS v2 state core — the single runtime source of truth (SQLite, node:sqlite).
--
-- Design: the .db file is a LOCAL, gitignored materialized store. Durability + audit
-- live in git via .ai/state/board.json (the committed serialization) + .ai/state/board.md
-- (the human view), both GENERATED from this DB. A fresh checkout rebuilds the DB by
-- seeding from board.json. So: DB = runtime truth (atomic claims); board.json = durable
-- seed + audit. They never disagree because board.* is only ever rendered, never hand-edited.
--
-- All timestamps are ISO-8601 UTC strings (Date#toISOString) so they sort lexicographically
-- — that is what makes `lease_expires <= now` a correct string comparison.

CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS program_increments (
  id     TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planning'
);

CREATE TABLE IF NOT EXISTS sprints (
  id         TEXT PRIMARY KEY,
  pi_id      TEXT,
  name       TEXT NOT NULL,
  start_date TEXT,
  end_date   TEXT,
  goal       TEXT,
  status     TEXT NOT NULL DEFAULT 'planning',
  FOREIGN KEY (pi_id) REFERENCES program_increments(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tasks (
  id             TEXT PRIMARY KEY,                       -- e.g. F1-1.9-admin-ui
  type           TEXT NOT NULL DEFAULT 'feature',        -- epic | feature | story
  parent_id      TEXT,                                   -- link to parent task
  sprint_id      TEXT,                                   -- link to active sprint
  title          TEXT NOT NULL,
  acceptance_criteria TEXT,                              -- specific ACs for User Stories
  lane           TEXT NOT NULL DEFAULT 'standard',       -- standard | fast
  status         TEXT NOT NULL DEFAULT 'proposed',       -- enforced by machine.mjs
  owner          TEXT NOT NULL DEFAULT 'both',           -- claude | antigravity | both
  priority       INTEGER NOT NULL DEFAULT 100,           -- lower = sooner (REAL priority, not filename order)
  complexity     INTEGER NOT NULL DEFAULT 3,             -- 1..5, drives model routing (mapped to story_points in UI)
  risk_tags      TEXT NOT NULL DEFAULT '[]',             -- JSON array: money-math|schema|auth|payments|external
  task_type      TEXT,                                   -- design|copy|docs|a11y|tokens (nullable — not all tasks have a type)
  -- §6 governance + park state. DURABLE columns, not note substrings: a transition that rewrites
  -- `note` (e.g. a verify bounce) must NEVER clobber a founder approval or a snooze/skip park.
  -- All nullable; only the dashboard governance setter (state.setGovernanceFlags) writes them.
  approved_at    TEXT,                                   -- founder cleared this §6 hold at this ISO time (isFounderApproved)
  snoozed_until  TEXT,                                   -- founder snoozed the block until this ISO time (snoozedUntil)
  skipped_at     TEXT,                                   -- founder skipped (parked) the block at this ISO time (isSkipped)
  skip_reason    TEXT,                                   -- optional free-text reason attached to a skip
  resources      TEXT NOT NULL DEFAULT '[]',             -- JSON array of dirs/contracts this task locks (deadlock avoidance)
  depends_on     TEXT NOT NULL DEFAULT '[]',             -- JSON array of task ids that must be 'done' first
  spec           TEXT,                                   -- path to features/<id>/spec.md
  contracts      TEXT NOT NULL DEFAULT '[]',             -- JSON array of .ai/contracts/* paths
  pr             TEXT,                                   -- PR url/number once opened
  note           TEXT,                                   -- short human note (queue reason etc.)
  -- lease block (all NULL when unclaimed). Holding a live lease === mutual exclusion.
  lease_owner    TEXT,
  lease_session  TEXT,
  lease_acquired TEXT,
  lease_expires  TEXT,
  reap_count     INTEGER NOT NULL DEFAULT 0,             -- times a stale lease was reaped (SLA signal)
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_status   ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);

-- Explicit resource locks. A task acquires ALL of its resources in ONE claim transaction,
-- or none — there is no incremental acquisition, so hold-and-wait can never arise and the
-- system is deadlock-free by construction.
CREATE TABLE IF NOT EXISTS resource_locks (
  resource TEXT PRIMARY KEY,                             -- e.g. apps/api  or  .ai/contracts/tax-engine.schema.json
  task_id  TEXT NOT NULL,
  owner    TEXT NOT NULL,
  acquired TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

-- Append-only audit. Every claim / transition / heartbeat / reap / block lands here.
CREATE TABLE IF NOT EXISTS history (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT NOT NULL,
  task_id    TEXT NOT NULL,
  from_state TEXT,
  to_state   TEXT,
  actor      TEXT,                                       -- "<agent>:<session>" or "watchdog"
  op         TEXT NOT NULL,                              -- claim|transition|heartbeat|reap|block|complete|seed
  note       TEXT
);

CREATE INDEX IF NOT EXISTS idx_history_task ON history(task_id);

-- System event log. Every lifecycle event, error, and outcome lands here — the persistent
-- observability layer that replaces console-only logging. Pruned to ~5000 rows by the
-- scheduler's watchdog tick so it never grows unbounded.
CREATE TABLE IF NOT EXISTS events (
  seq    INTEGER PRIMARY KEY AUTOINCREMENT,
  ts     TEXT NOT NULL,
  level  TEXT NOT NULL,     -- info | warn | error | fatal
  source TEXT NOT NULL,     -- scheduler | planner | verifier | escalation | watchdog | policy
  event  TEXT NOT NULL,     -- start | shutdown | heartbeat | promote | merge | push-fail | ...
  detail TEXT              -- JSON string, event-specific payload
);
CREATE INDEX IF NOT EXISTS idx_events_ts    ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_level ON events(level);

-- Verification attempt counter, PERSISTED (postmortem A7). The verify loop bounces a failing task
-- for rework up to MAX_VERIFY_ATTEMPTS times, then blocks + escalates. Keeping that counter only in
-- process memory meant a daemon restart (frequent — 29 in the incident window) reset the 3-strike
-- count to zero, so a permanently-broken task could churn forever. This survives restarts. Cleared
-- when the task merges or leaves review.
CREATE TABLE IF NOT EXISTS verify_attempts (
  task_id    TEXT PRIMARY KEY,
  attempts   INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- Phase 7 (Ecosystem, Distribution & Marketplace) — public REST API auth, webhooks, and the
-- plugin marketplace. All timestamps here are INTEGER unix seconds (not the ISO strings used
-- above) to match data-model.md and the REST API contract's JSON payloads directly.

-- Scoped bearer tokens for the public REST API (`Authorization: Bearer mk-{id}`). Distinct from
-- auth/api-tokens.mjs's APITokenManager, which authenticates the cloud multi-tenant SaaS control
-- plane (control-plane.db, user-scoped); this table is the LOCAL, single-machine key store used
-- by api/v1/*.
CREATE TABLE IF NOT EXISTS api_keys (
  id            TEXT PRIMARY KEY,                  -- mk-{32 random chars}
  name          TEXT NOT NULL,
  scopes        TEXT NOT NULL,                      -- comma-separated: tasks:read,costs:read,...
  created_at    INTEGER NOT NULL,
  last_used_at  INTEGER,
  is_active     INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_api_keys_is_active ON api_keys(is_active);

CREATE TABLE IF NOT EXISTS webhooks (
  id                TEXT PRIMARY KEY,
  url               TEXT NOT NULL,
  events            TEXT NOT NULL,                  -- comma-separated event types
  secret            TEXT,                            -- optional HMAC secret
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_at        INTEGER NOT NULL,
  last_delivery_at  INTEGER,
  failure_count     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_webhooks_is_active ON webhooks(is_active);

CREATE TABLE IF NOT EXISTS webhook_delivery_logs (
  id              TEXT PRIMARY KEY,
  webhook_id      TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  payload         TEXT NOT NULL,                     -- JSON string
  status          TEXT NOT NULL,                      -- success | failed | retrying
  http_status     INTEGER,
  error_message   TEXT,
  attempt_number  INTEGER NOT NULL,
  delivered_at    INTEGER NOT NULL,
  FOREIGN KEY (webhook_id) REFERENCES webhooks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_webhook_delivery_logs_webhook_id ON webhook_delivery_logs(webhook_id);
CREATE INDEX IF NOT EXISTS idx_webhook_delivery_logs_delivered_at ON webhook_delivery_logs(delivered_at);

CREATE TABLE IF NOT EXISTS plugins (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  type           TEXT NOT NULL,                      -- intake-source | wire-adapter
  description    TEXT,
  author         TEXT,
  version        TEXT NOT NULL,
  rating         REAL NOT NULL DEFAULT 0,
  install_count  INTEGER NOT NULL DEFAULT 0,
  repository     TEXT,
  is_installed   INTEGER NOT NULL DEFAULT 0,
  is_enabled     INTEGER NOT NULL DEFAULT 0,
  installed_at   INTEGER,
  config         TEXT                                -- JSON string
);
CREATE INDEX IF NOT EXISTS idx_plugins_type ON plugins(type);
CREATE INDEX IF NOT EXISTS idx_plugins_is_installed ON plugins(is_installed);

CREATE TABLE IF NOT EXISTS plugin_configurations (
  id            TEXT PRIMARY KEY,
  plugin_id     TEXT NOT NULL,
  key           TEXT NOT NULL,
  value         TEXT NOT NULL,
  is_sensitive  INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (plugin_id) REFERENCES plugins(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_plugin_configurations_plugin_id ON plugin_configurations(plugin_id);
