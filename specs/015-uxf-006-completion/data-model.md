# UXF-006 Data Model

## Search result

| Field | Type | Rules |
|---|---|---|
| `kind` | string | `route`, `task`, `run`, or `provider`; future kinds require a contract update. |
| `id` | string | Stable safe identifier; never a secret or raw content. |
| `label` | string | Bounded display label derived from safe metadata. |
| `description` | string | Optional bounded safe summary. |
| `href` | string | Same-origin durable app route carrying only approved scope. |
| `scope` | object | Server-derived tenant/project scope projection. |
| `command` | object/null | Safe command name and required capability; only returned when actor is eligible. |

Search results are filtered before serialization. A missing result and an unauthorized result have the same safe outcome.

## UXF telemetry event

| Field | Type | Rules |
|---|---|---|
| `event` | string | Allowlisted UXF event name. |
| `route` | string | Normalized pathname without query or fragment. |
| `scope` | string | Pseudonymous stable scope identifier; no tenant/project display names. |
| `role` | string | Server-derived role class, never client supplied. |
| `featureFlag` | string | Bounded flag identifier or `none`. |
| `durationMs` | integer/null | 0–3,600,000. |
| `outcome` | string | Bounded result class such as `success`, `failure`, `cancelled`, `fallback`. |
| `timestamp` | string | ISO-8601 event time. |

The serializer rejects prompts, credentials, API keys, webhook secrets, raw request content, raw search queries, stack traces, and unknown keys.

## Parity ledger entry

| Field | Type | Rules |
|---|---|---|
| `legacyId` | string | Unique legacy panel/module identifier. |
| `legacySurface` | string | Repository-relative source path or route. |
| `targetRoute` | string/null | Destination or `null` when no equivalent exists. |
| `owner` | string/null | Named discipline/person; null remains blocked. |
| `evidence` | string[] | Links to tests, screenshots, manual AT notes, and compatibility results. |
| `featureFlag` | string | Flag controlling coexistence. |
| `usageThreshold` | string | Human-approved threshold and release window. |
| `removalGate` | string[] | Parity, regression, usage, rollback, and approval conditions. |
| `rollbackAsset` | string/null | Versioned asset/tag/runbook reference. |
| `status` | string | `legacy`, `parity-candidate`, `blocked`, or `approved-for-removal`; code may only use the first three autonomously. |
| `approval` | object/null | Human approver, date, decision, and evidence; absent means blocked. |

## Release gate evidence

Each gate record contains command, commit, environment, route/state, result, count/timing, threshold, artifact, timestamp, and reviewer/approval status. A missing manual environment is recorded as `unavailable`, never as `pass`.
