# Implementation Plan: Operational Overview, Observability, Drill-Down, and Alerts

**Branch**: `spec/013-operational-overview` | **Date**: 2026-08-11 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/013-operational-overview/spec.md`

## Summary

Deliver an operational dashboard in the dependency-free ES-module application shell introduced by UXF-002 and onboarding conventions established by UXF-003. The feature adds URL-addressable overview, operations, task/run detail, gateway, cost, usage, alert, and audit routes; tenant- and project-scoped additive APIs; a canonical persisted alert lifecycle; cursor-paginated run evidence; uPlot charts with always-available semantic tables; and an opt-in SSE channel backed by a consolidated polling fallback. Existing dashboard and public API routes remain compatible, existing authorization gates are reused, and every recovery or alert mutation emits durable audit evidence.

## Technical Context

**Language/Version**: Node.js 24+ and browser-native JavaScript ES modules (`.mjs`)
**Primary Dependencies**: Node.js built-ins, repository SQLite adapters (`node:sqlite` and existing `better-sqlite3` boundary), existing vendored uPlot asset; no new runtime or chart dependency
**Storage**: Existing MeridianOS state SQLite database for canonical alert occurrences/events; existing gateway ledger SQLite database for metering; append-only JSONL run log for run evidence
**Testing**: Node.js native test runner (`node --test` via `npm test`), existing browser test harness, existing accessibility test helpers, deterministic performance fixtures
**Target Platform**: Same-origin MeridianOS dashboard on current supported desktop/mobile browsers; Node.js dashboard server
**Project Type**: Existing web application with server-rendered shell and browser-native ES-module routes
**Performance Goals**: Chart plus accessible table becomes interactive at p95 <=500 ms for 2,000 points with no main-thread task >200 ms; median alert-to-related-run journey <=60 seconds with >=90% successful navigation in the browser scenario
**Constraints**: Gateway remains the single LLM metering path; dashboard port comes from config; configuration lives in `policy.yaml`; all API additions are backwards compatible; same-origin SSE is opt-in and degrades to polling; no credential or user administration; no new dependency without written proof
**Scale/Scope**: One authenticated tenant per request, optional authorized project scope, at most 2,000 rendered chart points per series, cursor pages of 50 records by default and 200 maximum, bounded SSE replay buffer and connection count

## Global Constraints

- Node.js 24+ is required and every source/test file added by this feature uses `.mjs` and ES-module imports; Node built-ins use the `node:` prefix.
- No runtime dependency is added. Existing uPlot is the chart renderer; semantic HTML tables remain the authoritative accessible fallback.
- Gateway ledger writes remain on the existing single metering path. Operational queries are read-only consumers of that ledger.
- Dashboard ports and retention limits come from validated `policy.yaml`; secrets remain the only environment-variable exception.
- Existing authorization, legacy dashboard URLs, response shapes, and public APIs remain compatible. New endpoints are additive under `/api/operations/*`.
- Tenant scope is derived from authenticated context. A caller can request only a project/provider scope that its existing role permits.
- Provider credential editing, notification-channel credential editing, user administration, role creation, and broad alert-rule administration are excluded.

## Constitution Check

*GATE: Passed before research and re-checked after design.*

| Principle | Plan evidence | Result |
|---|---|---|
| Gateway is the single metering path | New analytics queries read the existing gateway ledger and never create a second write path | PASS |
| Zero-dependency philosophy | Browser modules, Node built-ins, and existing uPlot satisfy all requirements | PASS |
| Configuration over environment variables | Alert retention, audit retention, polling, and SSE bounds are validated policy fields | PASS |
| Authorization and auditability | Project role gates wrap task/run/alert mutations and immutable alert events include actor/correlation evidence | PASS |
| Spec-first and testable delivery | Contract, data model, tasks, browser, accessibility, performance, and API compatibility evidence are defined before implementation | PASS |
| Public compatibility | Existing endpoints and legacy modules are retained; all new APIs are additive | PASS |

Post-design re-check: the state database is the established durable control-plane store, the gateway ledger remains unchanged as the metering authority, the JSONL run log stays append-only, and the browser shell remains dependency-free. No constitution exception is required.

## Architecture

### Request and interaction flow

1. `app-platform.mjs` parses a canonical `/app/...` route and shared URL scope (`from`, `to`, optional `project`, optional `provider`).
2. The route registry lazy-loads one route module from `/static/app/routes/{overview,operations,observability}/`; the server maps that static namespace to `dashboard/app/` using the existing traversal-safe asset responder.
3. The route requests an additive `/api/operations/*` read model. Server handlers derive tenant scope from the authenticated request, validate optional scope, and query the state store, run log, or gateway ledger.
4. Overview cards, tables, and uPlot charts consume the same normalized response. Every chart has a visible summary and semantic table generated before optional graphical enhancement.
5. Selecting an alert navigates first to its durable alert route and then to its related task/run route with scope preserved in history. Missing or expired evidence produces a retained contextual recovery state rather than a dead end.
6. Recovery and lifecycle mutations validate optimistic version, role, and current state, append an immutable alert/audit event, publish a scoped operational event, and return the correlated audit link.
7. Live updates are off by default. When enabled, `EventSource` resumes with ordered event IDs. Three consecutive failures close it and start one consolidated ten-second poll loop; visibility changes pause/resume work without duplicate timers.

### Backend boundaries

- `dashboard/operational-scope.mjs`: validate exact UTC half-open windows and authorized project/provider filters; serialize canonical scope for URLs and query keys.
- `dashboard/operational-analytics.mjs`: tenant-scoped ledger aggregations and <=2,000-point series; existing analytics exports remain unchanged.
- `dashboard/operational-alert-store.mjs`: canonical alert occurrence upsert, versioned lifecycle transitions, deduplication, retention, and immutable event reads in the state database.
- `dashboard/operational-runs.mjs`: scoped task/run detail and safe run-evidence read models over existing task/history/run stores.
- `dashboard/operational-recovery.mjs`: typed retry eligibility, duplicate-safe requeue orchestration, and correlated intent/outcome audit evidence.
- `dashboard/operational-events.mjs`: bounded per-process SSE broker, ordered IDs, replay/reset behavior, heartbeats, and connection limits.
- `dashboard/runlog.mjs`: additive opaque cursor API over a fixed snapshot while retaining `readRuns()` compatibility.
- `dashboard/server.mjs`: additive `/api/operations/*`, `/static/app/*`, and SSE dispatch; existing routes preserve order and response shapes.
- `dashboard/project-store.mjs` and `dashboard/db.mjs`: expose the existing request-scoped state database to operational services without creating a global database path.
- `dashboard/schema.sql`: idempotent alert occurrence/event tables and indexes.
- `dashboard/policy-schema.mjs`: validated operational retention, polling, SSE, and page-limit settings with safe defaults.

### Frontend boundaries

- `dashboard/app/shared/operational-scope.mjs`: canonical URL scope parse/serialize and scope-preserving links.
- `dashboard/app/shared/operations-api.mjs`: typed-by-JSDoc response parsing, abortable reads, mutation correlation IDs, and normalized error handling.
- `dashboard/app/shared/chart-adapter.mjs`: uPlot enhancement, 2,000-point guard, semantic table/summary rendering, resize/dispose, and performance marks.
- `dashboard/app/shared/realtime-coordinator.mjs`: one opt-in SSE connection or one polling timer per shell with reconnect/fallback state.
- `dashboard/app/routes/overview/index.mjs`: five-second attention view and default health/work/cost widgets.
- `dashboard/app/routes/operations/{index,task-detail,run-detail}.mjs`: task/run lists, details, paginated safe run evidence, and authorized recovery.
- `dashboard/app/routes/observability/{gateway,cost,usage,alerts,alert-detail,audit-detail}.mjs`: metric drill-downs, alert lifecycle controls, and audit evidence.
- `dashboard/static/dashboard-bootstrap.mjs`, `dashboard/static/task-workflow-panel.mjs`, and `dashboard/static/observability-panels.mjs`: preserved compatibility surfaces; shared pure transforms may be imported, but new routes do not depend on legacy globals.

## Interface Contracts

```js
// dashboard/operational-scope.mjs
parseOperationalScope(url, authContext, policy) -> OperationalScope
// OperationalScope = { tenantId, projectId, provider, from, to, timezone: "UTC" }

// dashboard/operational-alert-store.mjs
upsertAlertOccurrence(db, candidate, context) -> { occurrence, event }
transitionAlertOccurrence(db, alertId, action, context) -> { occurrence, event }
// action = { type: "acknowledge"|"resolve"|"reopen", expectedVersion, reason? }

// dashboard/runlog.mjs
queryRuns({ path, scope, filters, cursor, limit }) -> { items, nextCursor, snapshot }
queryRunEvidence({ path, runId, cursor, limit, scope }) -> { items, nextCursor, snapshot }

// dashboard/operational-events.mjs
createOperationalEventBroker(options) -> { publish(event), subscribe(scope, resumeId, sink), close() }

// dashboard/app/shared/chart-adapter.mjs
renderOperationalChart({ host, tableHost, summaryHost, series, unit, label, maxPoints })
  -> { destroy(), metrics: { pointCount, interactiveMs, longestTaskMs } }
```

The complete HTTP, route, error, and event schemas are in [contracts/operational-api.md](contracts/operational-api.md).

## Project Structure

### Documentation (this feature)

```text
specs/013-operational-overview/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── REVIEWERS.md
├── contracts/
│   └── operational-api.md
├── checklists/
│   ├── requirements.md
│   └── operational-readiness.md
└── tasks.md
```

### Source code (repository root)

```text
dashboard/
├── app/
│   ├── route-registry.mjs                     # pattern routes and canonical drill-down URLs
│   ├── shared/
│   │   ├── operational-scope.mjs              # URL filter/time-scope state
│   │   ├── operations-api.mjs                 # additive API client and response validation
│   │   ├── chart-adapter.mjs                  # uPlot plus semantic fallback
│   │   └── realtime-coordinator.mjs            # SSE/polling lifecycle
│   └── routes/
│       ├── overview/index.mjs                  # default attention dashboard
│       ├── operations/{index,task-detail,run-detail}.mjs
│       └── observability/{gateway,cost,usage,alerts,alert-detail,audit-detail}.mjs
├── static/
│   ├── app-platform.mjs                       # shell dispatch and scope integration
│   ├── dashboard-bootstrap.mjs                 # compatibility integration
│   ├── task-workflow-panel.mjs                 # compatibility/parity source
│   └── observability-panels.mjs                # compatibility/parity source
├── operational-scope.mjs                      # server-side auth-derived scope
├── operational-analytics.mjs                  # scoped gateway/cost/usage read models
├── operational-alert-store.mjs                # canonical lifecycle persistence
├── operational-runs.mjs                       # task/run/evidence read models
├── operational-recovery.mjs                   # authorized retry orchestration
├── operational-events.mjs                     # bounded SSE broker
├── runlog.mjs                                  # snapshot cursor pagination
├── policy-schema.mjs                          # validated operations policy
├── schema.sql                                  # alert occurrence/event tables
└── server.mjs                                  # additive routes and app asset mapping

tests/
├── operational-scope.test.mjs
├── operational-analytics.test.mjs
├── operational-alert-store.test.mjs
├── operational-api.test.mjs
├── operational-recovery.test.mjs
├── operational-realtime.test.mjs
├── operational-chart.test.mjs
├── realtime-coordinator.test.mjs
├── app-route-registry.test.mjs
├── runlog.test.mjs
└── dashboard-api-compatibility.test.mjs

browser-tests/
└── operational-overview.spec.mjs

docs/
├── observability-glossary.md
└── incident-response.md
```

**Structure Decision**: Extend the application shell and dashboard server in place. Browser route sources live under the requested `dashboard/app/routes/` hierarchy and are exposed through a traversal-safe `/static/app/*` mapping, avoiding a bundler or dependency. Durable control-plane alert state stays in the existing state database; usage facts stay in the gateway ledger; run evidence stays in the append-only run log.

## Implementation Phases

1. Freeze compatibility fixtures and establish shared scope, route, policy, persistence, pagination, and event interfaces with unit/contract tests.
2. Deliver the overview attention model and URL-addressable task/run investigation path.
3. Deliver versioned alert lifecycle mutations, safe recovery authorization, immutable audit evidence, and alert drill-down.
4. Deliver gateway/cost/usage charts with semantic table fallbacks and finance-oriented cost attribution.
5. Integrate opt-in SSE, consolidated polling fallback, browser/accessibility journeys, performance measurement, documentation, and complete regression validation.

Each phase leaves existing APIs operational and is independently testable. `tasks.md` records test-first dependencies and acceptance evidence.

## Complexity Tracking

No constitution violations require justification. The bounded SSE broker and new alert tables are the minimum mechanisms needed for resumable live updates and durable lifecycle/audit state; existing polling-only and notification-cooldown records cannot satisfy those contracts.
