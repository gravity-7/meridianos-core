# Data Model: AI Spend Observability

**Feature**: P5 — AI Spend Observability | **Date**: 2026-07-30

## Overview

All new entities live in the existing gateway ledger SQLite database (`.ai/gateway/ledger.db`). This keeps all cost data in one place, enabling atomic queries across raw events, aggregates, and state tables. New tables are added via `ALTER TABLE` migrations following the pattern established in `gateway/ledger.mjs`.

---

## New SQLite Tables

### analytics_hourly

Materialized hourly aggregation of `token_events`. One row per (hour, provider, model, agent, task) combination. Idempotent upsert — re-running on the same hour window replaces existing rows.

| Column | Type | Description |
|--------|------|-------------|
| `window_key` | TEXT PRIMARY KEY | Composite: `{hour_utc}:{provider}:{model}:{agent}:{task}`. ISO-8601 hour truncated. |
| `hour_ts` | TEXT NOT NULL | ISO-8601 UTC hour boundary (e.g., `2026-07-30T14:00:00.000Z`). |
| `provider` | TEXT NOT NULL | Provider name. |
| `model` | TEXT NOT NULL | Model identifier. |
| `agent` | TEXT NOT NULL | Agent that made the calls. |
| `task` | TEXT | Task ID (nullable — unattributed traffic). |
| `input_tokens` | INTEGER NOT NULL | Sum of input tokens. |
| `output_tokens` | INTEGER NOT NULL | Sum of output tokens. |
| `cache_read_tokens` | INTEGER NOT NULL | Sum of cache read tokens. |
| `cache_write_tokens` | INTEGER NOT NULL | Sum of cache write tokens. |
| `total_tokens` | INTEGER NOT NULL | Sum of total tokens. |
| `cost_usd` | REAL NOT NULL | Sum of cost in USD. |
| `api_calls` | INTEGER NOT NULL | Count of API calls. |
| `aggregated_at` | TEXT NOT NULL | ISO-8601 timestamp when this row was last computed. |

**Indexes**:
- `idx_analytics_hourly_hour` on `(hour_ts)` — for date-range queries
- `idx_analytics_hourly_provider` on `(provider, hour_ts)` — for provider breakdowns
- `idx_analytics_hourly_task` on `(task, hour_ts)` — for per-task cost queries

**SQL**:
```sql
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
```

---

### analytics_daily

Materialized daily aggregation rolled up from `analytics_hourly`. Same structure, but `hour_ts` replaced with `day_ts` (date-only, ISO-8601).

| Column | Type | Description |
|--------|------|-------------|
| `window_key` | TEXT PRIMARY KEY | Composite: `{day}:{provider}:{model}:{agent}:{task}` |
| `day_ts` | TEXT NOT NULL | ISO-8601 date (e.g., `2026-07-30`). |
| `provider` | TEXT NOT NULL | Provider name. |
| `model` | TEXT NOT NULL | Model identifier. |
| `agent` | TEXT NOT NULL | Agent that made the calls. |
| `task` | TEXT | Task ID (nullable). |
| `input_tokens` | INTEGER NOT NULL | Sum of input tokens. |
| `output_tokens` | INTEGER NOT NULL | Sum of output tokens. |
| `cache_read_tokens` | INTEGER NOT NULL | Sum of cache read tokens. |
| `cache_write_tokens` | INTEGER NOT NULL | Sum of cache write tokens. |
| `total_tokens` | INTEGER NOT NULL | Sum of total tokens. |
| `cost_usd` | REAL NOT NULL | Sum of cost in USD. |
| `api_calls` | INTEGER NOT NULL | Count of API calls. |
| `aggregated_at` | TEXT NOT NULL | ISO-8601 timestamp when this row was last computed. |

**Indexes**:
- `idx_analytics_daily_day` on `(day_ts)`
- `idx_analytics_daily_provider` on `(provider, day_ts)`

---

### alert_state

Tracks alert firing state for cooldown enforcement. One row per alert rule instance.

| Column | Type | Description |
|--------|------|-------------|
| `rule_id` | TEXT PRIMARY KEY | Unique alert rule identifier (e.g., `budget_80pct`, `anomaly_spend`). |
| `last_fired_at` | TEXT | ISO-8601 timestamp of last alert dispatch. NULL if never fired. |
| `last_value` | REAL | The value that triggered the last alert. |
| `fire_count` | INTEGER NOT NULL DEFAULT 0 | Total times this rule has fired. |
| `updated_at` | TEXT NOT NULL | ISO-8601 timestamp of last state update. |

**SQL**:
```sql
CREATE TABLE IF NOT EXISTS alert_state (
  rule_id       TEXT PRIMARY KEY,
  last_fired_at TEXT,
  last_value    REAL,
  fire_count    INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL
);
```

---

### optimization_rules

Tracks applied and dismissed optimization recommendations.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PRIMARY KEY | UUID for the recommendation. |
| `current_model` | TEXT NOT NULL | The model currently in use. |
| `recommended_model` | TEXT NOT NULL | The recommended replacement model. |
| `task_type` | TEXT NOT NULL | The task type/label this applies to. |
| `estimated_weekly_savings` | REAL NOT NULL | Projected savings per week in USD. |
| `confidence` | REAL NOT NULL | Confidence score (0.0–1.0). |
| `capability_check` | TEXT NOT NULL | JSON: capability comparison result. |
| `status` | TEXT NOT NULL | One of: `active`, `applied`, `dismissed`. |
| `applied_at` | TEXT | ISO-8601 when applied (NULL if not applied). |
| `dismissed_at` | TEXT | ISO-8601 when dismissed (NULL if not dismissed). |
| `dismiss_reason` | TEXT | Operator-provided reason for dismissal. |
| `actual_savings_usd` | REAL | Actual savings since applied (updated periodically). |
| `created_at` | TEXT NOT NULL | ISO-8601 when recommendation was generated. |
| `updated_at` | TEXT NOT NULL | ISO-8601 last update. |

**SQL**:
```sql
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
```

---

### spend_pause_state

Single-row table for the global spend pause toggle. Only one row ever exists.

| Column | Type | Description |
|--------|------|-------------|
| `is_paused` | INTEGER NOT NULL DEFAULT 0 | 0 = normal, 1 = paused. |
| `paused_at` | TEXT | ISO-8601 when pause was activated. |
| `paused_by` | TEXT | Who/what activated the pause (operator name or "system"). |
| `reason` | TEXT | Operator-provided reason. |
| `resumed_at` | TEXT | ISO-8601 when pause was deactivated. |

**SQL**:
```sql
CREATE TABLE IF NOT EXISTS spend_pause_state (
  is_paused   INTEGER NOT NULL DEFAULT 0,
  paused_at   TEXT,
  paused_by   TEXT,
  reason      TEXT,
  resumed_at  TEXT
);

-- Insert the single row on table creation
INSERT INTO spend_pause_state (is_paused) VALUES (0);
```

---

## Existing Table Relationships

```
token_events (existing)          analytics_hourly (new)
├── ts ─────────────────────────▶ hour_ts (truncated)
├── provider ───────────────────▶ provider
├── model ──────────────────────▶ model
├── agent ──────────────────────▶ agent
├── task ───────────────────────▶ task
└── cost_usd, *tokens ──────────▶ SUM() → cost_usd, *tokens

analytics_hourly (new)           analytics_daily (new)
├── hour_ts ────────────────────▶ day_ts (truncated)
└── SUM() across hours ─────────▶ daily rollup

model_registry (existing, P2)    optimization_rules (new)
├── model_id, features ─────────▶ current_model, recommended_model, capability_check
└── pricing_* ──────────────────▶ estimated_weekly_savings calculation

token_events.task (existing)     task cost attribution (query)
└── task ───────────────────────▶ GROUP BY task → per-task cost
```

---

## Entity Definitions (from spec.md)

### AggregatedCostRecord
**Storage**: `analytics_hourly` and `analytics_daily` tables.
**Fields**: time_window, provider, model, agent, task, cost_total, token_count (input/output), api_call_count.
**Lifecycle**: Created by aggregation engine, never deleted (retention via configurable cleanup of old windows).

### AlertRule
**Storage**: Defined in `policy.yaml` config (not in DB). Runtime state tracked in `alert_state` table.
**Fields**: rule_id, trigger condition (budget threshold %, anomaly z-score), severity (info/warning/critical), target channels.
**Lifecycle**: Configured in policy. Cooldown state in `alert_state`. Fire history tracked via `fire_count`.

### AlertChannel
**Storage**: Defined in `policy.yaml` config.
**Fields**: type (slack/email/webhook), destination (URL/address), enabled flag, severity filter.
**Lifecycle**: Configured in policy. Validated at boot and on test-send.

### BudgetForecast
**Storage**: Computed at query time, not persisted (derived from `analytics_daily` + budget config).
**Fields**: current_spend, projected_total, days_remaining, burn_rate, status (on-track/at-risk/over-budget).
**Lifecycle**: Computed on each dashboard request. Not stored — always current.

### OptimizationRecommendation
**Storage**: `optimization_rules` table.
**Fields**: current_model, recommended_model, task_type, estimated_savings, confidence, capability_check, status (active/applied/dismissed).
**Lifecycle**: Generated by optimization engine analysis. Applied by operator (one-click). Dismissed with optional reason. Actual savings tracked post-apply.

### SpendPauseState
**Storage**: `spend_pause_state` single-row table.
**Fields**: is_paused, paused_at, paused_by, reason, resumed_at.
**Lifecycle**: Toggled by dashboard or scheduler. Checked on every gateway request. Survives restarts.

---

## Migration Notes

All new tables use `CREATE TABLE IF NOT EXISTS` — safe to run against existing ledger databases. The migration is added to the existing migration block in `gateway/ledger.mjs` that already handles schema evolution (the pattern used for `ide_name` and `billing_type` columns in P4).

No data migration needed — these are new tables, not modifications to existing ones. The `spend_pause_state` table gets a single default row inserted on creation.
