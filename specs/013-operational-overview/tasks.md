# Tasks: Operational Overview, Observability, Drill-Down, and Alerts

**Input**: Design documents from `specs/013-operational-overview/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/operational-api.md`, `quickstart.md`

**Tests**: Tests are mandatory and are written to fail before their implementation task. Cassette fixtures are used for any LLM interaction; this feature should require none.

**Organization**: Tasks are grouped by independently testable user story. P1 stories run in the spec order except US4 is completed before the P2 finance story because its canonical alert/audit services are part of the critical operations path.

## Global Constraints

- Node.js 24+; all new source and test files use `.mjs`, ESM imports, and `node:` prefixes for built-ins.
- No new dependency. Reuse the existing uPlot asset and browser/Node built-ins.
- Gateway remains the only LLM metering write path; operational analytics read the canonical ledger.
- Dashboard port and operational defaults come from validated `policy.yaml`, not new environment variables.
- Existing authorization, legacy routes, and public API responses remain compatible; new endpoints are additive under `/api/operations/*`.
- Tenant comes only from authenticated/local context; optional project/provider filters are authorized before lookup.
- Do not add provider/notification credential editing, user administration, role creation, or broad alert-rule administration.
- Do not expose raw prompts, provider bodies, authorization headers, credentials, stack traces, or unrestricted run output.

## Interface Contracts

Tasks that consume neighboring work use these exact interfaces:

```js
// dashboard/operational-scope.mjs
parseOperationalScope(url, authContext, policy) -> OperationalScope
// { tenantId, projectId, provider, from, to, timezone: "UTC" }

// dashboard/operational-alert-store.mjs
upsertAlertOccurrence(db, candidate, context) -> { occurrence, event }
transitionAlertOccurrence(db, alertId, action, context) -> { occurrence, event }
// action.type: "acknowledge" | "resolve" | "reopen"

// dashboard/runlog.mjs
queryRuns({ path, scope, filters, cursor, limit }) -> { items, nextCursor, snapshot }
queryRunEvidence({ path, runId, cursor, limit, scope }) -> { items, nextCursor, snapshot }

// dashboard/operational-events.mjs
createOperationalEventBroker(options) -> { publish(event), subscribe(scope, resumeId, sink), close() }

// dashboard/app/shared/operations-api.mjs
createOperationsApi({ fetchImpl, getScope, getMutationToken })
  -> { read(resource, options), mutate(resource, body, options), abortAll() }

// dashboard/app/shared/chart-adapter.mjs
renderOperationalChart({ host, tableHost, summaryHost, series, unit, label, maxPoints })
  -> { destroy(), metrics: { pointCount, interactiveMs, longestTaskMs } }
```

HTTP routes, response envelopes, errors, mutation bodies, browser routes, and SSE records must match `specs/013-operational-overview/contracts/operational-api.md`.

## Phase 1: Setup and compatibility baseline

**Purpose**: Freeze the approved main-branch behavior and create deterministic operational fixtures before additive work begins.

- [X] T001 Capture representative legacy dashboard route, authorization, status-code, and response-shape fixtures in `tests/fixtures/dashboard-api-compatibility.mjs`
- [X] T002 [P] Create deterministic scoped tasks, runs, alerts, ledger gaps, and exactly-2,000-point chart fixtures in `tests/fixtures/operational-overview.mjs`

**Checkpoint**: Baseline fixtures detect any accidental public API or authorization change.

---

## Phase 2: Foundational contracts (blocks all user stories)

**Purpose**: Establish shared scope, policy, persistence, pagination, routes, API client, and realtime primitives.

**⚠️ CRITICAL**: No user-story implementation begins until these contracts pass.

### Failing tests

- [X] T003 [P] Add UTC half-open defaults, project/provider authorization, canonical serialization, and rejected-scope tests for `parseOperationalScope()` in `tests/operational-scope.test.mjs`
- [X] T004 [P] Add default-50/max-200, fixed-snapshot, changed-filter, malformed/expired-cursor, chronological evidence, and `readRuns()` compatibility tests in `tests/runlog.test.mjs`
- [X] T005 [P] Add schema, dedupe fingerprint, `warn` normalization, recurrence, version-conflict, immutable-event, and tenant/project-isolation tests in `tests/operational-alert-store.test.mjs`
- [X] T006 [P] Add ordered publish, scoped subscription, bounded replay, unavailable-resume reset, heartbeat cleanup, and connection-cap tests in `tests/operational-realtime.test.mjs`
- [X] T007 [P] Add absent/default/invalid retention, pagination, polling, and SSE policy cases in `tests/policy-schema.test.mjs`
- [X] T008 [P] Add exact/pattern route matching, decoded parameter, canonical route, and traversal rejection tests in `tests/app-route-registry.test.mjs`

### Implementation

- [X] T009 Implement validated `dashboard.operations` retention, pagination, polling, and SSE defaults in `dashboard/policy-schema.mjs`
- [X] T010 Add idempotent `alert_occurrences` and append-only `alert_events` tables plus scoped indexes in `dashboard/schema.sql`
- [X] T011 Implement `upsertAlertOccurrence()` and versioned `transitionAlertOccurrence()` transactions with safe field allowlists in `dashboard/operational-alert-store.mjs`
- [X] T012 Implement auth-derived tenant, authorized project/provider, exact `[from,to)`, and canonical filter validation in `dashboard/operational-scope.mjs`
- [X] T013 Extend `readRuns()` compatibly with `queryRuns()` and `queryRunEvidence()` opaque snapshot cursors in `dashboard/runlog.mjs`
- [X] T014 Implement bounded, scoped, ordered replay subscriptions and cleanup in `dashboard/operational-events.mjs`
- [X] T015 Extend the exact route registry with canonical parameterized matching while retaining existing route IDs and unknown-route behavior in `dashboard/app/route-registry.mjs`
- [X] T016 Add traversal-safe `/static/app/*` assets and an additive `/api/operations/*` dispatcher without intercepting existing routes in `dashboard/server.mjs`
- [X] T017 [P] Implement URL scope parse/serialize, compatible-filter inheritance, and scope-key equality in `dashboard/app/shared/operational-scope.mjs`
- [X] T018 [P] Implement abortable `createOperationsApi()` reads/mutations, response validation, correlation IDs, and safe error normalization in `dashboard/app/shared/operations-api.mjs`

**Checkpoint**: Shared contracts are deterministic, scoped, and independently covered before pages consume them.

---

## Phase 3: User Story 1 — Identify operational attention immediately (Priority: P1) 🎯 MVP

**Goal**: Show the highest-priority current attention and truthful health/work/cost context within five seconds under one URL-owned scope.

**Independent Test**: Load mixed critical/warning/info/acknowledged/healthy/stale/partial fixtures; identify the top unacknowledged affected entity in five seconds, change scope, refresh, and confirm every compatible region shares it.

### Failing tests

- [X] T019 [P] [US1] Add overview metric definitions, attention ordering, empty/partial/stale states, fixed monthly budget labels, and tenant/project filters to `tests/operational-analytics.test.mjs`
- [X] T020 [P] [US1] Add `/api/operations/overview` envelope, scope, authorization, freshness, and safe-error contract cases to `tests/operational-api.test.mjs`
- [X] T021 [P] [US1] Add shared filter, canonical direct-load/refresh/Back/Forward, labelled drill-down, five-second attention, narrow viewport, and persistently labelled/time-stamped demo read-only scenarios to `browser-tests/operational-overview.spec.mjs`

### Implementation

- [X] T022 [US1] Implement tenant/project/provider-scoped attention, health, work, spend, and budget read models with documented empty/missing behavior in `dashboard/operational-analytics.mjs`
- [X] T023 [US1] Connect `GET /api/operations/overview` to `parseOperationalScope()` and the overview read model without changing legacy analytics endpoints in `dashboard/server.mjs`
- [X] T024 [P] [US1] Render the ordered attention queue, health strip, active/queued work, failed/blocked work, and cost/budget snapshot in `dashboard/app/routes/overview/index.mjs`
- [X] T025 [US1] Register overview/task/run/observability route patterns, lazy module loading, shared scope controls, freshness states, and focus restoration in `dashboard/static/app-platform.mjs`
- [X] T026 [US1] Add responsive attention hierarchy, non-color severity, partial/stale regions, scope controls, and 320 px/200%-zoom-safe layouts in `dashboard/static/app-platform.css`
- [X] T027 [US1] Preserve the legacy bootstrap fallback and share only pure status/refresh adapters with the new overview in `dashboard/static/dashboard-bootstrap.mjs`

**Checkpoint**: US1 is usable as a standalone operational landing page and satisfies FR-401 plus the default-widget portion of FR-404.

---

## Phase 4: User Story 2 — Investigate a failed alert and recover safely (Priority: P1)

**Goal**: Move from alert to exact task/run evidence and an authorized safe action or explicit non-retryable path through durable URLs.

**Independent Test**: From a shared failed-run alert URL, open task and run details, page later evidence, retry once or read the ineligibility explanation, open audit evidence, and use browser Back without losing scope.

### Failing tests

- [X] T028 [P] [US2] Add scoped task/run detail, legacy gaps, missing/expired entity, stable cursor, retry eligibility, duplicate guard, and role-denial API cases to `tests/operational-api.test.mjs`
- [X] T029 [P] [US2] Add typed retryability, operator/admin retry, viewer/finance read-only, admin-only restart, and audit intent/outcome tests to `tests/operational-recovery.test.mjs`
- [X] T030 [US2] Extend the failed-alert browser journey with task/run direct loads, log pagination, retained-evidence gaps, Back/Forward scope, duplicate retry, and non-retryable explanations in `browser-tests/operational-overview.spec.mjs`

### Implementation

- [X] T031 [P] [US2] Implement scoped task detail, run summary, related entity, timeline, attribution, retry-history, and safe evidence read models in `dashboard/operational-runs.mjs`
- [X] T032 [US2] Implement typed retry/restart eligibility, duplicate-safe requeue orchestration, and a correlation/audit adapter for retry plus the existing confirmed restart action in `dashboard/operational-recovery.mjs`
- [X] T033 [US2] Connect task/run list/detail/log routes and `POST /api/operations/runs/:runId/retry`, and add restart intent/outcome evidence to the compatible existing restart handler in `dashboard/server.mjs`
- [X] T034 [P] [US2] Render scoped task/run lists, labelled empty/error states, and stable detail links in `dashboard/app/routes/operations/index.mjs`
- [X] T035 [P] [US2] Render task identity/state/history, related runs/alerts, cost, recovery eligibility, and audit links in `dashboard/app/routes/operations/task-detail.mjs`
- [X] T036 [P] [US2] Render run identity/outcome/timeline/attribution, cursor-paginated evidence, retry history, typed recovery, and restart explanation in `dashboard/app/routes/operations/run-detail.mjs`
- [X] T037 [US2] Preserve existing task mutations and export compatible pure task-state/action labels for new route consumers in `dashboard/static/task-workflow-panel.mjs`

**Checkpoint**: US2 independently proves FR-402 and FR-403 from durable alert/task/run URLs through safe recovery evidence.

---

## Phase 5: User Story 4 — Acknowledge and remediate with audit evidence (Priority: P1)

**Goal**: Provide concurrency-safe acknowledge/reopen/resolve semantics, notification suppression/escalation behavior, and independently readable audit evidence.

**Independent Test**: Acknowledge with a reason, recur at the same severity, escalate, resolve/reopen, race a stale version, perform remediation, and verify every attempt and outcome in alert and audit timelines.

### Failing tests

- [X] T038 [P] [US4] Add open/acknowledged/resolved/reopened/escalated transitions, same-severity suppression, version races, denied attempts, correlation, safe audit payload, and retention tests to `tests/operational-alert-store.test.mjs`
- [X] T039 [P] [US4] Add alert list/detail/audit reads and acknowledge/reopen/resolve method, body, role, conflict, not-found, and response-link contracts to `tests/operational-api.test.mjs`
- [X] T040 [P] [US4] Add legacy escalation/configured-rule normalization, cooldown interplay, severity escalation notification, and no-secret evidence tests to `tests/alerts.test.mjs`
- [X] T041 [US4] Extend the browser journey with keyboard lifecycle controls, reason validation, optimistic conflicts, suppression explanation, audit navigation, and focus/live-region behavior in `browser-tests/operational-overview.spec.mjs`

### Implementation

- [X] T042 [US4] Normalize legacy escalation, failed-run, gateway/cost anomaly, and configured analytics candidates into `upsertAlertOccurrence()` while retaining existing channel cooldown behavior in `dashboard/alerts.mjs`
- [X] T043 [US4] Implement scoped alert list/detail/audit reads, acknowledge/reopen/resolve transactions, mutation audit links, and lifecycle event publication in `dashboard/server.mjs`
- [X] T044 [P] [US4] Render severity/status filters, priority ordering, occurrence/freshness context, and durable alert links in `dashboard/app/routes/observability/alerts.mjs`
- [X] T045 [P] [US4] Render related evidence, lifecycle timeline, versioned controls, suppression/escalation explanation, retry destination, and conflict refresh in `dashboard/app/routes/observability/alert-detail.mjs`
- [X] T046 [P] [US4] Render immutable actor/scope/before-after/reason/result/correlation evidence with safe missing-record recovery in `dashboard/app/routes/observability/audit-detail.mjs`
- [X] T047 [US4] Implement 365-day policy cleanup for expired resolved occurrences/events without touching run-log or ledger retention in `dashboard/operational-alert-store.mjs`

**Checkpoint**: US4 independently proves FR-405 and mutation evidence for success, failure, denial, suppression, and concurrency.

---

## Phase 6: User Story 3 — Identify and prove cost drivers (Priority: P2)

**Goal**: Reconcile gateway usage, spend, budget, and provider/model/project/task/run drivers to supporting ledger evidence with chart/table parity.

**Independent Test**: Select exact scope, identify the largest cost driver, switch visual/table representations, drill to evidence, reload the URL, and reconcile totals including unknown/unattributed values.

### Failing tests

- [X] T048 [P] [US3] Add request/error/latency/token/cost definitions, deterministic cost-driver ties, mixed/missing attribution, currency, 2,000-point aggregation, and ledger reconciliation tests to `tests/operational-analytics.test.mjs`
- [X] T049 [P] [US3] Add semantic table/summary parity, missing uPlot, empty/partial/extreme data, max-point guard, destroy/resize, and performance-mark unit tests to `tests/operational-chart.test.mjs`
- [X] T050 [P] [US3] Add gateway/usage/cost/usage-record/export API scope, freshness, aggregation, breakdown, drill-down, budget-period, escaping, and authorization contract cases to `tests/operational-api.test.mjs`
- [X] T051 [US3] Extend browser coverage with finance read-only scope, dimension switching, chart/table parity, keyboard drill-down, high contrast, reduced motion, zoom, and ledger reconciliation in `browser-tests/operational-overview.spec.mjs`

### Implementation

- [X] T052 [US3] Implement <=2,000-point gateway/usage/cost/budget series, provider/model/project/task/run breakdowns, cursor-paged supporting records, and scoped export rows over the canonical ledger in `dashboard/operational-analytics.mjs`
- [X] T053 [US3] Connect `GET /api/operations/gateway`, `/usage`, `/usage-records`, `/cost`, and `/export` to scoped read models without changing existing ledger/analytics endpoints in `dashboard/server.mjs`
- [X] T054 [US3] Implement table-first `renderOperationalChart()` with textual summary, units/scope/freshness, optional uPlot enhancement, resize/dispose, and performance measures in `dashboard/app/shared/chart-adapter.mjs`
- [X] T055 [P] [US3] Render gateway request/error/latency series, scoped export, and equivalent event tables/drill-downs in `dashboard/app/routes/observability/gateway.mjs`
- [X] T056 [P] [US3] Render spend/budget, dimension rankings, unknown/unattributed amounts, currency disclosure, scoped export, and equivalent evidence tables in `dashboard/app/routes/observability/cost.mjs`
- [X] T057 [P] [US3] Render token series, scoped export, provider/model/agent/task/run breakdowns, and cursor-paged supporting records with stable links in `dashboard/app/routes/observability/usage.mjs`
- [X] T058 [US3] Preserve legacy observability panel behavior and share only pure metric formatting/aggregation adapters with new routes in `dashboard/static/observability-panels.mjs`

**Checkpoint**: US3 independently proves FR-404 chart/table/cost evidence and finance-user attribution.

---

## Phase 7: Realtime, performance, accessibility, documentation, and regression gates

**Purpose**: Prove cross-story resilience and measurable outcomes across supported browsers without weakening compatibility.

- [X] T059 [P] Add opt-in connection, ordered duplicate rejection, resume/reset, three-failure fallback, visibility pause, manual refresh, pending-mutation protection, demo disablement, and single-timer browser tests to `tests/realtime-coordinator.test.mjs`
- [X] T060 Implement one-shell `EventSource`/ten-second-poll lifecycle with scoped stale-response rejection in `dashboard/app/shared/realtime-coordinator.mjs`
- [X] T061 Connect same-origin `GET /api/operations/events`, heartbeat, replay/reset, `503 Retry-After`, authorization, and broker publication to existing state changes in `dashboard/server.mjs`
- [X] T062 Add the supported-browser 2,000-point p95 <=500 ms and no-long-task >200 ms measurement with point/aggregation assertions to `browser-tests/operational-overview.spec.mjs`
- [X] T063 Add ten-run alert-to-evidence timing automation plus five-participant operator attention/alert-run and representative finance-driver timing evidence fields to `browser-tests/operational-overview.spec.mjs`
- [X] T064 Add automated WCAG checks and manual keyboard/screen-reader/320 px/200%-zoom/forced-colors/reduced-motion evidence fields to `browser-tests/operational-overview.spec.mjs`
- [X] T065 [P] Document metric definitions, units, sources, time semantics, freshness, missing data, and drill-down dimensions in `docs/observability-glossary.md`
- [X] T066 [P] Document alert severity, acknowledgement/suppression, escalation, retention, authorization, retry/restart, and audit-led incident response in `docs/incident-response.md`
- [X] T067 Assert frozen legacy `/api/*`, `/api/v1/*`, `/static/*`, direct dashboard, and auth fixtures against the additive dispatcher in `tests/dashboard-api-compatibility.test.mjs`
- [X] T068 Execute focused tests, full `npm test`, supported browser/accessibility/performance runs, `git diff --check`, and record commands/counts/timings/manual evidence in `specs/013-operational-overview/quickstart.md`
- [X] T069 Run `$speckit-converge`, append every discovered unbuilt requirement as a new checked-path task in `specs/013-operational-overview/tasks.md`, complete it, and repeat until convergence reports clean
- [X] T070 [P] Restore the exact approved internal helper contracts with dynamic `getMutationToken()`/`abortAll()` client compatibility and object-form chart rendering metrics in `dashboard/app/shared/{operations-api,chart-adapter}.mjs`, covered by `tests/{operational-client,operational-chart}.test.mjs`
- [X] T071 Close browser acceptance-evidence gaps for scope refresh/Back/Forward, task/run direct load and log pagination, retention and non-retryable explanations, lifecycle reason/conflict/suppression/focus behavior, and finance dimension/table-ledger reconciliation in `browser-tests/operational-overview.spec.mjs`
- [X] T072 Complete the approved HTTP contract for correlated freshness metadata, task/alert page envelopes, cursor validation, alert evidence availability/actions, and validated CSV/JSON scoped exports in `dashboard/{operations-api,operational-runs,operational-alert-store,operational-analytics}.mjs` with API/store tests
- [X] T073 Enforce the approved SSE event vocabulary and named `event:` frames while retaining payload refresh hints and client compatibility in `dashboard/{operational-events,server}.mjs` and `dashboard/app/shared/realtime-coordinator.mjs`, with broker/API/coordinator tests
- [X] T074 Record immutable denied alert events for authenticated in-scope role and missing-reason lifecycle attempts in `dashboard/operational-alert-store.mjs`, with authorization/audit assertions in `tests/operational-alert-store.test.mjs`
- [X] T075 Complete route-consumer recovery and pagination by forwarding list cursors/filters, paging alerts, and rendering contextual scope-preserving return links for missing or expired task/run/alert/audit detail in `dashboard/app/routes/{operations,observability}` and `dashboard/static/app-platform.mjs`, with browser coverage
- [X] T076 Reject empty retry reasons with correlated denial evidence and return scoped task plus pending-attempt run destinations instead of a null run URL in `dashboard/{operational-recovery,operations-api}.mjs`, with recovery/API tests
- [X] T077 Render the approved task recovery explanation plus run checks, retry history, related alerts, and durable retry-audit destinations in `dashboard/app/routes/operations/{task-detail,run-detail}.mjs`, enriching `dashboard/operational-runs.mjs` and browser/API evidence
- [X] T078 Render status-plus-severity alert filters, server-authorized lifecycle controls, and earliest retained alert/run/ledger evidence disclosures in `dashboard/app/routes/observability/{alerts,alert-detail}.mjs`, with browser evidence
- [X] T079 Render provider/model/project/agent/task/run usage-driver rankings and include agent cost switching with equivalent scoped evidence links in `dashboard/app/routes/observability/{usage,cost}.mjs`, with finance browser evidence

**Checkpoint**: All functional/non-functional requirements and success criteria have reproducible evidence and the complete regression suite is green.

---

## Dependencies and execution order

### Phase dependencies

- Phase 1 has no dependencies.
- Phase 2 depends on Phase 1 and blocks all user stories.
- US1, US2, and US4 are P1. Implement US1 first for the attention MVP, US2 next for the investigation/recovery path, then US4 for the complete alert lifecycle; their tests remain independently runnable.
- US3 depends only on Phase 2 contracts, but follows the P1 paths in the default sequence.
- Phase 7 depends on all selected user stories because it integrates their refresh, performance, accessibility, compatibility, and evidence.

### User-story dependency graph

```text
Setup -> Foundation -> US1 (attention MVP)
                    -> US2 (task/run investigation)
                    -> US4 (alert lifecycle/audit)
                    -> US3 (gateway/cost evidence)
US1 + US2 + US4 + US3 -> Cross-cutting gates
```

US2 consumes canonical alert links but can use the alert fixture/store contract from Phase 2. US4 consumes the task/run recovery audit interface but is independently testable with fixture targets. US3 consumes only scope/API/chart primitives from Phase 2.

### Within every story

1. Write named tests and confirm they fail for the intended missing behavior.
2. Implement read models/services before server routes.
3. Implement server routes before browser modules consume them.
4. Run that story's focused tests and its independent browser scenario before crossing its checkpoint.

## Requirement and acceptance-evidence coverage

| Requirement/outcome | Implementation tasks | Acceptance evidence tasks |
|---|---|---|
| FR-401 shared filters/time | T012, T017, T023, T025 | T003, T020, T021, T068 |
| FR-402 drill-down contract | T015, T025, T033–T036, T043–T046, T055–T057 | T008, T021, T028, T030, T039, T041, T050, T051, T067 |
| FR-403 task/run detail | T013, T031–T037 | T004, T028–T030, T063, T068 |
| FR-404 gateway/cost charts | T022–T024, T052–T058 | T002, T019–T021, T048–T051, T062, T064, T068 |
| FR-405 alert lifecycle | T010–T011, T032, T042–T047 | T005, T029, T038–T041, T068 |
| NFR-401 chart performance | T052, T054–T057 | T002, T049, T062, T068 |
| NFR-402 alert-to-run <=60 s | T024–T025, T033–T036, T044–T046 | T021, T030, T063, T068 |
| NFR-403 SSE/poll fallback | T014, T060–T061 | T006, T059, T068 |
| Preserve authorization/API | T012, T016, T023, T033, T043, T053, T061 | T001, T003, T020, T028–T029, T039, T050, T067–T068 |
| Mutation audit evidence | T011, T032–T033, T042–T047 | T005, T029–T030, T038–T041, T068 |
| Browser/accessibility | T024–T027, T034–T037, T044–T046, T054–T058, T060 | T021, T030, T041, T051, T059, T062–T064, T068 |
| Excluded administration | Global Constraints | T029, T040, T050, T067 |

All SC-401–SC-410 are measured by T021, T030, T038–T041, T048–T051, T059, T062–T064, T067, and T068. The quickstart records test counts, browser versions, accessibility results, chart p95/long tasks, alert-to-run median/success, and compatibility evidence.

## Parallel opportunities

- T001 and T002 can run concurrently.
- T003–T008 operate in distinct test files and can be authored concurrently before T009–T018.
- After Phase 2, each story's first failing-test tasks can run concurrently; implementation follows the dependency order within its story.
- Route modules with `[P]` use different files after their shared endpoint/client contract is complete.
- Documentation T065–T066 can run concurrently after product behavior stabilizes.

## Parallel examples

### User Story 1

```text
T019: operational overview read-model tests
T020: overview HTTP contract tests
T021: overview/browser URL and five-second-attention tests
```

### User Story 2

```text
T028: task/run/log HTTP contracts
T029: recovery authorization/audit service tests
```

### User Story 4

```text
T038: canonical lifecycle store tests
T039: alert/audit HTTP contracts
T040: notification normalization and suppression tests
```

### User Story 3

```text
T048: scoped analytics and reconciliation tests
T049: accessible chart adapter unit/performance tests
T050: gateway/usage/cost HTTP contracts
```

## Implementation strategy

### MVP first

1. Complete Phases 1–2.
2. Complete US1 (T019–T027).
3. Validate the five-second attention outcome, shared scope, partial states, and legacy fallback before adding detail routes.

### Incremental delivery

1. US1 establishes the truthful attention overview.
2. US2 connects attention to safe task/run evidence and recovery.
3. US4 completes canonical lifecycle, suppression, and audit proof.
4. US3 adds finance-grade gateway/cost attribution and accessible visual evidence.
5. Phase 7 proves realtime resilience and cross-browser/accessibility/performance/API compatibility, then convergence closes any missed work.

## Notes

- `[P]` means distinct files with no incomplete-file dependency at that point.
- Every task includes an exact repository path and an objective test/deliverable.
- Tests precede implementation and must fail for the intended behavior before code changes.
- Commit logical groups with the repository's conventional commit format; do not merge the implementation PR.
