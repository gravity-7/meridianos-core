# Data Model: Operational Overview, Observability, Drill-Down, and Alerts

## ScopeValue (request value object)

| Field | Type | Rules |
|---|---|---|
| `tenantId` | string | Required; derived from authenticated context, never accepted from a query parameter |
| `projectId` | string or null | Optional; must be visible to the caller under existing project-role policy |
| `provider` | string or null | Optional allowlisted provider identifier; applied only inside the authorized tenant/project scope |
| `from` | UTC instant | Required after defaulting; inclusive |
| `to` | UTC instant | Required after defaulting; exclusive and greater than `from` |
| `timezone` | literal `UTC` | Canonical storage/query timezone; UI may format locally without changing URL values |

Default: `[now - 24 hours, now)`. The canonical URL contains ISO-8601 UTC values. Reversed, invalid, excessive, or unauthorized scope produces a typed `400`/`403`, never a broader fallback query.

## AlertOccurrence (state database)

One row represents the current lifecycle of a deduplicated operational condition.

| Field | Type | Rules |
|---|---|---|
| `id` | text UUID | Primary key; durable route identifier |
| `tenant_id` | text | Required scope partition |
| `project_id` | text nullable | Optional authorized project partition |
| `source` | text | Required producer (`gateway`, `scheduler`, `budget`, `task`, `run`, or future registered source) |
| `rule_id` | text | Required stable rule/type identifier |
| `fingerprint` | text | Required stable hash of tenant/project/source/rule/related identity |
| `severity` | enum | `info`, `warning`, `critical`; legacy `warn` normalizes to `warning` |
| `status` | enum | `open`, `acknowledged`, `resolved` |
| `title` | text | Required short, non-secret operator label |
| `summary` | text | Required allowlisted operator-safe summary; never a raw prompt/credential/provider payload |
| `task_id` | text nullable | Related task identifier when available |
| `run_id` | text nullable | Related run identifier when available |
| `gateway_event_id` | integer nullable | Related immutable ledger event when available |
| `related_entities_json` | JSON text | Versioned allowlist of additional typed provider/model/budget/usage targets |
| `previous_occurrence_id` | text UUID nullable | Resolved predecessor for a later recurrence with the same fingerprint |
| `first_seen_at` | UTC instant | Immutable first observation |
| `last_seen_at` | UTC instant | Latest occurrence; `>= first_seen_at` |
| `occurrence_count` | integer | Starts at 1; increments on same-fingerprint recurrence |
| `acknowledged_at` | UTC instant nullable | Present only when an acknowledgement has occurred and not cleared by reopen |
| `acknowledged_by` | text nullable | Authenticated actor identifier |
| `acknowledgement_reason` | text nullable | Trimmed, bounded operator note |
| `resolved_at` | UTC instant nullable | Present in `resolved` state |
| `resolved_by` | text nullable | Authenticated actor identifier |
| `resolution_reason` | text nullable | Trimmed, bounded evidence note |
| `notification_suppressed_until` | UTC instant nullable | Derived notification boundary, not visibility boundary |
| `notification_suppression_reason` | text nullable | Current cooldown/acknowledgement reason shown in alert detail |
| `latest_event_id` | text UUID | Most recent immutable audit/event link |
| `version` | positive integer | Incremented atomically on every lifecycle/content transition |
| `created_at` / `updated_at` | UTC instant | Audit timestamps |

A partial unique index permits at most one active `(tenant_id, null-safe project_id, fingerprint)` occurrence where status is `open` or `acknowledged`; resolved episodes remain immutable and a later recurrence receives a new ID with `previous_occurrence_id`. Query indexes cover `(tenant_id, project_id, status, severity, last_seen_at)` and related task/run IDs.

### Lifecycle transitions

| Current | Action/event | Next | Required evidence |
|---|---|---|---|
| absent | matching occurrence | `open` | `created` event |
| `open` | acknowledge | `acknowledged` | actor, role, reason, expected version |
| `acknowledged` | same/lower recurrence | `acknowledged` | occurrence count; duplicate notification suppressed |
| `acknowledged` | higher severity recurrence | `open` | `escalated` event; notification permitted |
| `open`/`acknowledged` | resolve | `resolved` | actor, role, resolution evidence, expected version |
| `resolved` | matching recurrence | new `open` occurrence | new immutable ID; same fingerprint; `previous_occurrence_id` links the resolved episode |
| `acknowledged` | explicit reopen | `open` | actor, role, reason, expected version |

Invalid transition returns `409 ALERT_STATE_CONFLICT` with the latest safe occurrence. A version mismatch returns `409 ALERT_VERSION_CONFLICT`. No transition deletes an occurrence or its events.

## AlertEvent (state database, append-only)

| Field | Type | Rules |
|---|---|---|
| `id` | text UUID | Primary key and audit route identifier |
| `alert_id` | text UUID | Required foreign key to `AlertOccurrence` |
| `tenant_id` / `project_id` | text / nullable text | Copied scope for efficient authorization and retention |
| `event_type` | enum | `created`, `observed`, `acknowledged`, `resolved`, `reopened`, `escalated`, `notification_suppressed`, `recovery_requested`, `recovery_succeeded`, `recovery_failed` |
| `actor_type` | enum | `user`, `system` |
| `actor_id` | text | Authenticated subject or registered system producer |
| `actor_role` | text nullable | Effective project role at mutation time |
| `from_status` / `to_status` | enum nullable | Lifecycle before/after |
| `from_severity` / `to_severity` | enum nullable | Severity before/after |
| `reason` | text nullable | Bounded human/system explanation |
| `target_type` / `target_id` | text nullable | Alert, task, run, or gateway target |
| `result` | enum | `recorded`, `succeeded`, `failed`, `denied` |
| `correlation_id` | text | Request-level id returned to the client |
| `metadata_json` | JSON text | Versioned allowlisted details; no credentials/raw prompts |
| `created_at` | UTC instant | Immutable ordering timestamp |

Rows are insert-only through the store API. Database code exposes reads and append operations, not arbitrary update/delete operations. Policy retention removes only resolved occurrences and their events after the configured evidence window; it emits an aggregate sanitized activity record without changing run-log or gateway-ledger retention.

## OperationalMetricSeries (response model)

| Field | Type | Rules |
|---|---|---|
| `metric` | enum | `requests`, `error_rate`, `latency_p50`, `latency_p95`, `input_tokens`, `output_tokens`, `cached_tokens`, `cost` |
| `unit` | string | Required display unit (`requests`, `%`, `ms`, `tokens`, currency code) |
| `scope` | ScopeValue without tenant exposure | Required canonical `from`, `to`, optional permitted filters |
| `freshAsOf` | UTC instant | Required |
| `aggregation` | string | Required bucket size/operation |
| `points` | array | Chronological `{ at, value, sampleCount?, drilldown: { entityType, href } }`, maximum 2,000 |
| `summary` | object | Metric-specific total/min/max/p50/p95 plus missing-sample disclosure |

Empty windows return an empty points array and an explicit zero/no-data summary. Unknown cost and missing latency are counted separately rather than coerced to zero.

## RunPage and RunEvidencePage (append-only run log view)

| Field | Type | Rules |
|---|---|---|
| `items` | array | Newest-first safe run summaries or evidence rows |
| `nextCursor` | opaque string or null | Versioned base64url cursor; absent at end |
| `snapshot` | opaque string | Fixed watermark shared by pages in one traversal |
| `limit` | integer | Default 50, maximum 200 |

Internal cursor payload: `{ v, snapshotWatermark, lastTimestamp, lastStableId, filterFingerprint }`. It is decoded as untrusted input, schema/range validated, and rejected with `400 INVALID_CURSOR` when mismatched. It is not a public storage-offset promise.

Run evidence is allowlisted: state transitions, timestamps, attempt, provider/model identifiers where already visible, token/cost facts, safe reason/error code, and correlation IDs. Raw prompts, credentials, headers, response bodies, and unrestricted filesystem output are excluded.

## UsageRecordPage (gateway-ledger read model)

Returns cursor-paginated, newest-first allowlisted ledger records for a selected chart point or cost/usage dimension. Each record contains time, request outcome, provider/model/agent/task/run attribution where present, token counts, non-null `cost_usd` or explicit unknown cost, currency, and typed drill-down links. Page cursors bind to the complete authorized scope and selected dimension; no mutation or second metering write path is introduced.

## OperationalEvent (ephemeral SSE model)

| Field | Type | Rules |
|---|---|---|
| `id` | monotonic decimal string | Process-local ordered identifier |
| `type` | enum | `overview.changed`, `task.changed`, `run.changed`, `alert.changed`, `cost.changed`, `reset` |
| `tenantId` / `projectId` | internal scope | Used for server-side subscription filtering; never broadens caller scope |
| `entityId` | string nullable | Target for selective refresh |
| `correlationId` | string nullable | Links mutation to audit/event evidence |
| `occurredAt` | UTC instant | Required |

The broker is not durable. If a requested ID is outside the bounded replay buffer or belongs to a previous process, the stream emits `reset`; the browser reloads the authoritative scoped snapshot.

## Policy additions

```yaml
dashboard:
  operations:
    alert_retention_days: 365
    audit_retention_days: 365
    run_page_default: 50
    run_page_max: 200
    polling_interval_ms: 10000
    sse:
      enabled: true
      max_connections: 32
      replay_events: 1000
      heartbeat_ms: 15000
      failure_threshold: 3
```

Validation rules enforce positive bounded values, `run_page_default <= run_page_max <= 200`, `polling_interval_ms >= 5,000`, and `alert_retention_days >= audit_retention_days` when alert events are the configured audit evidence. Defaults preserve behavior when the section is absent.
