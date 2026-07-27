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
  raw                TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_token_events_ts ON token_events(ts);
CREATE INDEX IF NOT EXISTS idx_token_events_tenant_agent_ts ON token_events(tenant, agent, ts);
CREATE INDEX IF NOT EXISTS idx_token_events_provider ON token_events(provider);

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
