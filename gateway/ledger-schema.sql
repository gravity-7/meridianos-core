-- gateway token-event ledger — an append-only SQLite store the gateway sidecar OWNS, SEPARATE
-- from the daemon's board DB / schema.sql (see ledger.mjs doc comment). One row per token-event
-- (token-event.mjs); `raw` holds the full JSON.stringify(event) as the source of truth, with the
-- other columns denormalized for cheap SQL aggregation (queryWindow). NULL token/cost columns are
-- allowed and mean GENUINELY UNKNOWN — never fabricated as 0 (same contract as token-event.mjs).
--
-- All timestamps are ISO-8601 UTC strings (Date#toISOString) so they sort lexicographically,
-- which is what makes `ts >= since AND ts < until` a correct string-range window query.

CREATE TABLE IF NOT EXISTS token_events (
  id                 TEXT PRIMARY KEY,
  ts                 TEXT NOT NULL,
  tenant             TEXT NOT NULL,
  agent              TEXT NOT NULL,
  session            TEXT,
  task               TEXT,
  run_id             TEXT,
  request_id         TEXT,
  provider           TEXT NOT NULL,
  model              TEXT NOT NULL,
  wire               TEXT NOT NULL,
  source             TEXT NOT NULL DEFAULT 'agent',
  ide_name           TEXT,
  billing_type       TEXT NOT NULL DEFAULT 'api_key',
  upstream_status    INTEGER,
  latency_ms         INTEGER,
  input_tokens       INTEGER,
  output_tokens      INTEGER,
  cache_read_tokens  INTEGER,
  cache_write_tokens INTEGER,
  total_tokens       INTEGER,
  cost_usd           REAL,
  enforcement_decision TEXT NOT NULL,
  cap_window         TEXT,
  raw                TEXT NOT NULL,
  user_id            TEXT,
  project_id         TEXT
);

CREATE INDEX IF NOT EXISTS idx_token_events_ts ON token_events(ts);
CREATE INDEX IF NOT EXISTS idx_token_events_tenant_agent_ts ON token_events(tenant, agent, ts);
CREATE INDEX IF NOT EXISTS idx_token_events_provider ON token_events(provider);
CREATE INDEX IF NOT EXISTS idx_token_events_user_id ON token_events(user_id);
CREATE INDEX IF NOT EXISTS idx_token_events_project_id ON token_events(project_id);

-- audit_log — append-only audit trail for compliance and security.
-- Records all user actions, configuration changes, and critical operations.
CREATE TABLE IF NOT EXISTS audit_log (
  id                 TEXT PRIMARY KEY,
  ts                 TEXT NOT NULL,
  user_id            TEXT NOT NULL,
  project_id         TEXT,
  action             TEXT NOT NULL,
  resource_type      TEXT,
  resource_id        TEXT,
  details            TEXT,
  ip_address         TEXT,
  user_agent         TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_log_ts ON audit_log(ts);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_project_id ON audit_log(project_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);

-- request_logs — append-only request/response logging for debugging provider calls.
-- Auth headers are redacted BEFORE storage. Rows are never updated, only inserted
-- and (optionally) pruned per retention policy.
CREATE TABLE IF NOT EXISTS request_logs (
  id                 TEXT PRIMARY KEY,
  ts                 TEXT NOT NULL,
  provider           TEXT NOT NULL,
  model              TEXT NOT NULL,
  method             TEXT NOT NULL,
  url                TEXT NOT NULL,
  status_code        INTEGER NOT NULL,
  latency_ms         INTEGER NOT NULL,
  request_headers    TEXT NOT NULL,
  request_body       TEXT NOT NULL,
  response_headers   TEXT NOT NULL,
  response_body      TEXT NOT NULL,
  extracted_usage    TEXT
);

CREATE INDEX IF NOT EXISTS idx_request_logs_ts ON request_logs(ts);
CREATE INDEX IF NOT EXISTS idx_request_logs_provider ON request_logs(provider);

-- model_registry — auto-discovered AI models from configured providers (003 — Provider & Model Agnosticism).
-- Composite PK `provider:model_id` scopes model identity to provider. Models are upserted
-- on each discovery run; unseen models are marked deprecated. Tiers auto-assigned by heuristic.
CREATE TABLE IF NOT EXISTS model_registry (
    id              TEXT PRIMARY KEY,          -- "provider:model_id"
    provider        TEXT NOT NULL,             -- Provider name
    model_id        TEXT NOT NULL,             -- Provider-specific model ID
    display_name    TEXT,                      -- Human-readable name
    context_window  INTEGER,                   -- Max context tokens, NULL if unknown
    max_output_tokens INTEGER,                -- Max output tokens, NULL if unknown
    features        TEXT DEFAULT '{}',         -- JSON: capability flags
    pricing_input_per_m         REAL,          -- USD per million input tokens
    pricing_cached_input_per_m  REAL,          -- USD per million cached input tokens
    pricing_output_per_m        REAL,          -- USD per million output tokens
    pricing_source              TEXT,          -- provider-native, openrouter, models-dev, cache
    pricing_refreshed           TEXT,          -- ISO-8601 timestamp
    deprecated      INTEGER DEFAULT 0,         -- 0 = active, 1 = deprecated
    deprecated_successor TEXT,                 -- Recommended replacement model_id
    tier_assigned   TEXT,                      -- quick, medium, best, or custom
    last_seen       TEXT NOT NULL,             -- ISO-8601 timestamp
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_model_registry_provider ON model_registry(provider);
CREATE INDEX IF NOT EXISTS idx_model_registry_tier ON model_registry(tier_assigned);
CREATE INDEX IF NOT EXISTS idx_model_registry_deprecated ON model_registry(deprecated);

-- P5: AI Spend Observability — analytics tables (005)

-- analytics_hourly — materialized hourly aggregation of token_events.
-- One row per (hour, provider, model, agent, task) combination.
-- Idempotent upsert via INSERT OR REPLACE on window_key.
CREATE TABLE IF NOT EXISTS analytics_hourly (
  window_key        TEXT PRIMARY KEY,
  hour_ts           TEXT NOT NULL,
  provider          TEXT NOT NULL,
  model             TEXT NOT NULL,
  agent             TEXT NOT NULL,
  task              TEXT,
  input_tokens      INTEGER NOT NULL DEFAULT 0,
  output_tokens     INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens      INTEGER NOT NULL DEFAULT 0,
  cost_usd          REAL NOT NULL DEFAULT 0.0,
  api_calls         INTEGER NOT NULL DEFAULT 0,
  aggregated_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analytics_hourly_hour ON analytics_hourly(hour_ts);
CREATE INDEX IF NOT EXISTS idx_analytics_hourly_provider ON analytics_hourly(provider, hour_ts);
CREATE INDEX IF NOT EXISTS idx_analytics_hourly_task ON analytics_hourly(task, hour_ts);

-- analytics_daily — materialized daily aggregation rolled up from analytics_hourly.
-- Same structure but day_ts instead of hour_ts.
CREATE TABLE IF NOT EXISTS analytics_daily (
  window_key        TEXT PRIMARY KEY,
  day_ts            TEXT NOT NULL,
  provider          TEXT NOT NULL,
  model             TEXT NOT NULL,
  agent             TEXT NOT NULL,
  task              TEXT,
  input_tokens      INTEGER NOT NULL DEFAULT 0,
  output_tokens     INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens      INTEGER NOT NULL DEFAULT 0,
  cost_usd          REAL NOT NULL DEFAULT 0.0,
  api_calls         INTEGER NOT NULL DEFAULT 0,
  aggregated_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analytics_daily_day ON analytics_daily(day_ts);
CREATE INDEX IF NOT EXISTS idx_analytics_daily_provider ON analytics_daily(provider, day_ts);

-- alert_state — tracks alert firing state for cooldown enforcement.
CREATE TABLE IF NOT EXISTS alert_state (
  rule_id       TEXT PRIMARY KEY,
  last_fired_at TEXT,
  last_value    REAL,
  fire_count    INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL
);

-- optimization_rules — tracks applied and dismissed optimization recommendations.
CREATE TABLE IF NOT EXISTS optimization_rules (
  id                       TEXT PRIMARY KEY,
  current_model            TEXT NOT NULL,
  recommended_model        TEXT NOT NULL,
  task_type                TEXT NOT NULL,
  estimated_weekly_savings REAL NOT NULL,
  confidence               REAL NOT NULL DEFAULT 0.0,
  capability_check         TEXT NOT NULL DEFAULT '{}',
  status                   TEXT NOT NULL DEFAULT 'active',
  applied_at               TEXT,
  dismissed_at             TEXT,
  dismiss_reason           TEXT,
  actual_savings_usd       REAL,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL
);

-- spend_pause_state — single-row table for global spend pause toggle.
CREATE TABLE IF NOT EXISTS spend_pause_state (
  is_paused   INTEGER NOT NULL DEFAULT 0,
  paused_at   TEXT,
  paused_by   TEXT,
  reason      TEXT,
  resumed_at  TEXT
);
