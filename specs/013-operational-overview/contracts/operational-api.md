# Contract: Operational Overview API and Routes

This contract is additive. Existing dashboard pages, `/api/status`, `/api/run`, `/api/activity/*`, `/api/ledger/*`, and `/api/analytics/*` paths retain their current methods, authentication, and response shapes.

## Common request scope

All read endpoints accept these optional query values:

| Query | Meaning |
|---|---|
| `from` | Inclusive ISO-8601 UTC instant; defaults to 24 hours before request time |
| `to` | Exclusive ISO-8601 UTC instant; defaults to request time |
| `project` | Existing project ID visible to the caller |
| `provider` | Existing provider ID within the authorized tenant/project |

Tenant identity is never accepted from the URL. It is derived from the current authenticated context. Invalid windows return `400 INVALID_SCOPE`; unauthorized project/provider scope returns `403 FORBIDDEN_SCOPE` without confirming hidden resource existence.

Successful responses use:

```json
{
  "data": {},
  "scope": {
    "from": "2026-08-10T12:00:00.000Z",
    "to": "2026-08-11T12:00:00.000Z",
    "project": "project-a",
    "provider": null,
    "timezone": "UTC"
  },
  "meta": {
    "freshAsOf": "2026-08-11T12:00:01.000Z",
    "correlationId": "op_..."
  }
}
```

Errors use:

```json
{
  "error": {
    "code": "ALERT_VERSION_CONFLICT",
    "message": "The alert changed after this page was loaded.",
    "correlationId": "op_...",
    "details": {}
  }
}
```

Messages are operator-safe. Internal stack traces, credentials, prompts, headers, raw provider payloads, and hidden resource identifiers are never returned.

## Browser route grammar

| Route | Purpose |
|---|---|
| `/app` or `/app/overview` | Default attention overview |
| `/app/operations/tasks` | Scoped task list |
| `/app/operations/tasks/:taskId` | Task detail, history, related runs, recovery eligibility |
| `/app/operations/runs` | Scoped run list |
| `/app/operations/runs/:runId` | Run detail and cursor-paginated safe evidence |
| `/app/observability/gateway` | Request/error/latency drill-down |
| `/app/observability/cost` | Spend and cost-driver drill-down |
| `/app/observability/usage` | Token/usage drill-down |
| `/app/observability/alerts` | Scoped alert queue/history |
| `/app/observability/alerts/:alertId` | Alert detail, related entities, lifecycle controls |
| `/app/observability/audit/:auditId` | Immutable mutation evidence |

Every route accepts and preserves the common `from`, `to`, `project`, and `provider` query. Unknown IDs render a contextual not-found/expired state and links back to the scoped list. Browser history is used; navigation does not grant access.

## Read endpoints

### `GET /api/operations/overview`

Returns:

```json
{
  "data": {
    "attention": [{ "alertId": "...", "severity": "critical", "summary": "...", "runId": "...", "taskId": "...", "lastSeenAt": "..." }],
    "health": [{ "component": "gateway", "status": "healthy", "detail": "..." }],
    "work": { "activeAgents": 2, "queuedTasks": 3, "failedTasks": 1, "blockedTasks": 0, "failedRuns": 1 },
    "finance": { "currency": "USD", "spend": 12.34, "unknownCostEvents": 0, "budget": { "period": "2026-08", "utilization": 0.41, "forecast": 28.12 } }
  },
  "scope": {},
  "meta": {}
}
```

The attention array is ordered critical before warning, then newest first. Acknowledged alerts are not in the default attention array but remain available in the alert list.

### `GET /api/operations/tasks`

Additional queries: `status`, `cursor`, `limit`. Returns safe task summaries and `page: { nextCursor, snapshot, limit }`.

### `GET /api/operations/tasks/:taskId`

Returns task identity, current state, bounded history, related run links, current recovery eligibility, and denial/explanation. Existing authorization is applied before lookup disclosure.

### `GET /api/operations/runs`

Additional queries: `state`, `task`, `cursor`, `limit`. Returns safe run summaries and `page: { nextCursor, snapshot, limit }`.

### `GET /api/operations/runs/:runId`

Returns safe run summary, related task, metering summary, timestamps, attempt, safe failure reason/code, and recovery eligibility.

### `GET /api/operations/runs/:runId/logs`

Additional queries: `cursor`, `limit` (default 50, maximum 200). Returns allowlisted evidence rows and stable snapshot page metadata. Invalid or cross-filter cursors return `400 INVALID_CURSOR`.

### `GET /api/operations/gateway`

Returns `requests`, `error_rate`, `latency_p50`, and `latency_p95` `OperationalMetricSeries` objects. Latency series disclose sample count and missing samples.

### `GET /api/operations/usage`

Returns separate input/output/cached/total token series plus breakdown tables by provider/model/agent/task. Unknown identifiers are represented explicitly.

### `GET /api/operations/usage-records`

Additional queries: `dimension`, `value`, `cursor`, and `limit`. Returns newest-first allowlisted gateway-ledger records supporting a selected gateway/cost/usage aggregate. Cursor scope includes the exact authorized filters, time interval, dimension, and value. Each row includes a durable authorized task/run link when attribution exists and an explicit unattributed state otherwise.

### `GET /api/operations/cost`

Returns known spend series, unknown-cost count, currency, budget status, and cost-driver tables by provider/model/agent/task. Mixed currency is not summed into a false total.

### `GET /api/operations/export`

Additional queries: `view=gateway|usage|cost` and `format=csv|json`. Exports use the identical authorized exact scope and metric definitions as the visible route, include scope/freshness/units in metadata, preserve unknown/unattributed categories, and reuse the existing safe analytics export/escaping behavior. Existing `/api/analytics/export` remains unchanged.

### `GET /api/operations/alerts`

Additional queries: `status`, `severity`, `cursor`, `limit`. Returns canonical occurrences ordered by attention priority/newness.

### `GET /api/operations/alerts/:alertId`

Returns one safe occurrence, related task/run URLs when authorized and retained, lifecycle actions with eligibility/explanations, recent immutable event links, and `evidenceAvailability` containing earliest retained alert/run/ledger evidence timestamps or an explicit unavailable reason.

### `GET /api/operations/audit/:auditId`

Returns one immutable `AlertEvent` after tenant/project authorization. It includes actor type/id, effective role, before/after state, reason, target, result, correlation ID, and timestamp.

## Mutation endpoints

All mutations require JSON, an authenticated actor, the existing same-origin mutation protection, a correlation ID (generated server-side when absent), and an authorized project role. They return `403` for insufficient roles, `409` for state/version conflict, `422` for ineligible recovery, and always record denied or attempted recovery evidence when the caller is authenticated and the target is in scope.

### `POST /api/operations/alerts/:alertId/acknowledge`

Operator/admin body:

```json
{ "expectedVersion": 3, "reason": "Investigating provider timeout" }
```

Returns updated occurrence plus `audit: { id, url, correlationId }`. Repeat notifications for the same fingerprint/severity are suppressed while the alert remains visible.

### `POST /api/operations/alerts/:alertId/resolve`

Operator/admin body:

```json
{ "expectedVersion": 4, "reason": "Retry succeeded; gateway healthy" }
```

Resolution evidence is required. A later matching occurrence reopens the alert.

### `POST /api/operations/alerts/:alertId/reopen`

Operator/admin body:

```json
{ "expectedVersion": 5, "reason": "Symptoms returned" }
```

### `POST /api/operations/runs/:runId/retry`

Operator/admin body:

```json
{ "reason": "Transient provider timeout", "alertId": "optional-related-alert-id" }
```

The server revalidates current state, budget/policy eligibility, project role, and idempotency. It creates a new attempt; it never mutates prior run evidence. The response contains the new run URL and audit link. Viewer/finance callers remain read-only unless an existing policy already grants an equivalent role. Provider restart is not offered here; existing restart remains admin-only and explicitly confirmed.

The existing administrator restart endpoint and body remain compatible. Its handler additionally records sanitized restart intent and definitive outcome evidence with the same correlation/audit fields; UXF-004 does not introduce a second restart endpoint or grant restart through a drill-down URL.

## SSE endpoint

### `GET /api/operations/events`

The common scope applies. This endpoint is called only when the user enables live mode. It accepts browser `Last-Event-ID` and returns `text/event-stream` with `Cache-Control: no-cache` and same-origin authorization.

```text
id: 1042
event: alert.changed
data: {"entityId":"alert-123","correlationId":"op_123","occurredAt":"2026-08-11T12:00:00.000Z"}

```

Event types are `overview.changed`, `task.changed`, `run.changed`, `alert.changed`, `cost.changed`, and `reset`. Heartbeat comments are emitted every 15 seconds. Replay is bounded; unavailable resume IDs receive `reset`. Exceeding the connection cap returns `503` and `Retry-After`, causing the client to poll. Stream data contains refresh hints, not sensitive entity bodies.

## Accessibility contract for metrics

Each metric component exposes, in DOM order:

1. A heading.
2. Human-readable selected scope and `freshAsOf` text.
3. Unit and aggregation description.
4. Text summary, including missing/unknown samples.
5. A semantic `<table>` with caption, column headers, and all returned points/breakdowns.
6. An optional `aria-hidden="true"` uPlot visualization that does not replace the table.

Every actionable point or breakdown row includes a labelled `drilldown` with canonical entity type and scope-preserving `href`; visual point selection and its table row use the same destination.

Chart failure, reduced motion, script failure, or unavailable uPlot leaves the summary/table usable. All drill-down links and mutation controls are keyboard reachable with visible focus and status changes are announced without moving focus.

## Compatibility evidence

Contract fixtures capture representative existing responses before implementation. Tests assert that new dispatch order does not intercept legacy `/api/*`, `/static/*`, `/app` shell, or direct legacy dashboard paths and that existing auth status codes and field names remain unchanged.
