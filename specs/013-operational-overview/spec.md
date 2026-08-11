# Feature Specification: Operational Overview

**Feature Branch**: `spec/013-operational-overview`

**Created**: 2026-08-11

**Status**: Draft

**Input**: Implement UXF-004 operational overview, observability, drill-down, and alerts so operators can find attention quickly, investigate failed tasks and runs, take authorized recovery actions, understand cost drivers, and retain audit evidence without changing existing authorization or public API contracts.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Identify operational attention immediately (Priority: P1)

An operator opens the operational overview and can identify the most urgent unresolved condition, understand its affected scope, and choose a labelled next step within five seconds without scanning unrelated administration controls.

**Why this priority**: Rapid, trustworthy triage is the primary purpose of the overview and the entry point for every later investigation.

**Independent Test**: Present a scoped overview containing mixed critical, warning, informational, healthy, empty, stale, and acknowledged states; a representative operator identifies the highest-priority unacknowledged condition and its affected entity within five seconds.

**Acceptance Scenarios**:

1. **Given** critical and warning conditions exist in the selected scope, **When** an operator opens the overview, **Then** unacknowledged critical attention appears first with severity text, affected entity, occurrence time, and a labelled drill-down.
2. **Given** no condition requires intervention, **When** an operator opens the overview, **Then** the overview states that no current attention is required and still shows service health, active work, failures, and cost context without synthetic values.
3. **Given** the overview data is stale, unavailable, partially unavailable, or reconnecting, **When** it is presented, **Then** each affected region distinguishes its freshness and recovery state without replacing valid regions or representing stale data as live.
4. **Given** a supported shared filter or time scope is changed, **When** the overview updates, **Then** every compatible widget reflects the same URL-owned scope and states any deliberate fixed-period exception.

---

### User Story 2 - Investigate a failed alert and recover safely (Priority: P1)

An operator selects an alert, reaches the implicated task and run through durable URLs, inspects status, timeline, paginated logs, cost, related records, and retry history, and sees only recovery actions they are authorized and safe to perform.

**Why this priority**: An alert that cannot lead quickly to evidence and a safe next action creates noise rather than operational value.

**Independent Test**: From a failed-run alert in a shared URL, open alert detail, follow the related run and task, inspect a later log page, invoke an allowed retry or receive a non-retryable explanation, use Back, and verify scope, time, identity, and audit context remain intact.

**Acceptance Scenarios**:

1. **Given** an open failed-run alert with a related task and run, **When** it is selected, **Then** alert detail links to the exact task and run while preserving authorized tenant, project, provider, and time scope.
2. **Given** a run is retryable and the current actor is authorized, **When** the actor requests retry with a reason, **Then** duplicate submission is prevented, the related task is safely requeued through the existing action semantics, and the result links to audit evidence.
3. **Given** a failure is non-retryable, already active, outside the actor's scope, or the actor lacks mutation authority, **When** run detail is viewed, **Then** no unsafe retry is offered and a specific inspect, wait-until, or escalation path is shown.
4. **Given** a restart could be relevant, **When** run or alert detail is viewed, **Then** restart is never automatic or the default recovery; only an already-authorized administrator receives the existing restart action with impact preview and deliberate confirmation.
5. **Given** new runs arrive while an operator pages through run history or run logs, **When** the next opaque cursor is used, **Then** the existing browse snapshot remains stable and an expired cursor returns a recoverable restart instruction rather than duplicated or silently skipped records.

---

### User Story 3 - Identify and prove cost drivers (Priority: P2)

A finance or governance user can compare spend, budget trajectory, and gateway usage for an authorized scope, identify the largest provider, model, project, task, or run cost driver, and open the supporting usage records without losing filters or time scope.

**Why this priority**: Cost visibility is useful only when an aggregate can be traced to attributable records and budget impact.

**Independent Test**: Select a project/provider and exact time interval, identify the top cost dimension, switch between chart and table, drill to supporting usage and task/run records, reload the URL, and verify totals and scope remain consistent.

**Acceptance Scenarios**:

1. **Given** a provider-spend chart and its data table, **When** a provider is selected, **Then** the filtered usage records retain the exact authorized scope and half-open time interval from the source view.
2. **Given** a finance user changes the cost dimension among provider, model, project, task, and run, **When** the ranking updates, **Then** cost, tokens, request count, share, and unattributed amounts use the same definitions and reconcile to the displayed total within currency rounding.
3. **Given** chart scripting is unavailable, reduced-motion or high-zoom settings are used, or a chart cannot be interpreted visually, **When** the cost or gateway view opens, **Then** an equivalent keyboard-accessible table and textual summary expose the same values and drill-downs.
4. **Given** budget data uses the current monthly budget period while another time interval is selected, **When** both appear together, **Then** the budget period is explicitly labelled and never implied to use the selected interval.

---

### User Story 4 - Acknowledge and remediate with audit evidence (Priority: P1)

An authorized operator can acknowledge, reopen, or resolve an alert with a reason, understand notification suppression, and prove who acted, what changed, when it changed, why it changed, and whether a related remediation succeeded.

**Why this priority**: Lifecycle controls without durable evidence undermine both team coordination and compliance.

**Independent Test**: Acknowledge an alert, trigger a duplicate and a severity escalation, reopen or resolve it, perform an authorized remediation, and verify the alert timeline and activity/audit record contain each transition, suppression reason, actor, correlation, and outcome.

**Acceptance Scenarios**:

1. **Given** an open alert, **When** an authorized operator acknowledges it with a reason, **Then** it becomes acknowledged without being resolved, remains visible in the acknowledged view, and records actor, time, reason, version, and audit identifier.
2. **Given** the same condition recurs while acknowledged, **When** its severity does not increase, **Then** the occurrence count and last-seen time update, duplicate outbound notification is suppressed, and the suppression reason is recorded.
3. **Given** an acknowledged condition escalates in severity, **When** it recurs, **Then** suppression is overridden, the escalation is visible and notified through existing configured channels, and the alert retains its prior acknowledgement history.
4. **Given** an acknowledged alert is reopened or resolved, **When** the authorized transition succeeds or fails, **Then** the lifecycle and audit timeline record the requested transition and definitive outcome without changing the underlying task or run silently.
5. **Given** two actors mutate the same alert version, **When** the later request is stale, **Then** it is rejected with the current lifecycle state and a safe refresh path; both attempts remain traceable.

### Edge Cases

- The selected tenant or project becomes unauthorized, deleted, or unavailable after a URL is shared or while a request or live update is in flight.
- A drill-down references a deleted, rotated, legacy, malformed, or no-longer-retained alert, task, run, provider, usage record, or audit event.
- A legacy escalation uses `warn`, omits a stable related entity, or contains a task without a run; normalization maps severity to `warning` and exposes only available safe destinations.
- An alert condition fires repeatedly across rule cooldown, acknowledgement, resolution, severity escalation, and a later recurrence after resolution.
- A run record has no provider, model, usage, session, task, cost attribution, detailed logs, or typed retry classification because it predates those fields.
- Run/log cursors are malformed, stale, expired, or used with a changed filter; the response does not leak file offsets or accept an incompatible cursor.
- Ledger totals contain null cost, unknown provider/model, unattributed task/run, late-arriving events, or rounding differences; unattributed amounts remain visible rather than being dropped.
- Server-sent events are unsupported, disconnected, duplicated, delivered out of order, or resume beyond the retained event cursor; polling and manual refresh remain usable without duplicate state transitions.
- A browser tab is hidden, returns after a long pause, goes offline, or receives an update after the user changed filters; the stale response cannot overwrite the current scope.
- Chart data is empty, partial, over 2,000 points, outside the retained window, or includes a single extreme value; the table, units, time scope, and empty/error explanation remain truthful.
- A retry, acknowledgement, reopen, resolve, or restart request is duplicated, races another actor, succeeds after the client disconnects, or fails after an audit intent is recorded.
- Demo or fixture data is enabled; it is persistently labelled, time-stamped as synthetic, and cannot expose mutation actions.
- A keyboard-only, screen-reader, reduced-motion, 320 px-wide, 200%-zoom, or high-contrast user filters, drills down, pages logs, reads chart data, and completes every permitted lifecycle action.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-401 — Shared filters and time scope**: The system MUST provide one URL-owned query scope across operational overview, task/run operations, gateway usage, cost, and alerts. The scope MUST contain an authorization-derived tenant, optional authorized project and provider filters, and an exact UTC half-open interval (`from` inclusive, `to` exclusive); presets resolve to exact timestamps before navigation. The default overview interval MUST be the previous 24 hours. All compatible widgets, tables, exports, drill-downs, Back/Forward navigation, refresh, and shared URLs MUST preserve this scope. A widget using a fixed business period, such as the current monthly budget period, MUST label that exception and MUST preserve all compatible entity filters.
- **FR-402 — Drill-down contract**: Every actionable KPI, attention item, chart series/point, chart table row, task/run row, alert, and audit reference MUST expose a labelled durable destination with a canonical entity type and stable identifier. Supported destinations MUST include overview, task list/detail, run list/detail, gateway events/usage, cost usage records, alert list/detail, and audit evidence. Navigating and returning MUST preserve compatible query scope, browser history, current selection, and a recoverable response for missing or no-longer-retained entities; route access MUST never grant broader data or mutation authority.
- **FR-403 — Task and run detail**: Task detail MUST present stable identity, current state, project/scope, owner/agent where available, related runs and alerts, cost summary, and action/audit history. Run detail MUST present stable identity, outcome and typed reason, timestamps, task, agent, provider/model, token/cost attribution, status timeline, checks, retry history, related alerts/audit evidence, and cursor-paginated log evidence where available. Run and log queries MUST be newest-first for lists and chronological within a selected run, use opaque snapshot-stable cursors, default to 50 records, accept at most 200 records per page, reject cursors used with a different scope, and disclose gaps caused by retention or legacy records. Recovery actions MUST be derived from typed retryability and existing authorization: authorized operators/admins may requeue a retryable failed task/run with a reason and duplicate guard; finance/viewer access remains read-only unless existing policy grants more; restart remains an administrator-only sensitive action with impact preview and explicit confirmation.
- **FR-404 — Gateway and cost evidence**: The system MUST provide gateway health/usage and cost/budget views using the canonical gateway ledger as the cost source. Metrics MUST use documented definitions: selected-scope cost is the sum of non-null ledger `cost_usd`; tokens and request count use the same filtered events; unattributed values remain a named category; failed runs count run outcomes of `failed`; active agents use the current policy-defined heartbeat/lease state; top cost driver is the largest displayed dimension by cost with deterministic tie-breaking; budget spend and forecast use the current configured monthly period and the existing trailing-seven-day forecast rule. Default overview widgets MUST be: unacknowledged attention queue, service/gateway health strip, active agents and queued work, failed/blocked task-run summary, and cost/budget snapshot. Each chart MUST state title, unit, data freshness, exact scope/time, and series meaning, and MUST provide an equivalent keyboard-accessible data table, textual summary, empty/error state, and identical drill-down contract.
- **FR-405 — Alert lifecycle**: The system MUST normalize operational escalations, failed-run signals, gateway/cost anomalies, and configured analytics rules into a canonical scoped Alert Occurrence with: immutable alert identifier; source/rule identifier; dedupe fingerprint; `info`, `warning`, or `critical` severity (`warn` normalizes to `warning`); `open`, `acknowledged`, or `resolved` state; tenant and optional project; typed related entities; title and safe evidence summary; first/last seen times; occurrence count; version; acknowledgement/resolution metadata; suppression reason; and audit identifiers. Open alerts MAY become acknowledged or resolved; acknowledged alerts MAY be reopened or resolved; resolved recurrence MUST create a new occurrence linked by fingerprint. Acknowledgement requires an authorized actor and reason, does not resolve the condition, and suppresses duplicate outbound notifications for the same occurrence while preserving in-app visibility. Existing rule cooldown also suppresses duplicate delivery before acknowledgement. Severity escalation MUST override suppression. Every lifecycle, suppression, retry, and restart intent/outcome MUST create append-only audit evidence with actor, authorized scope, entity, before/after state, reason, timestamp, correlation identifier, and result. Alert/audit evidence MUST default to 365-day policy-controlled retention; UXF-004 MUST NOT delete or shorten existing run-log or gateway-ledger retention and MUST disclose the earliest available source evidence.

### Non-Functional Requirements

- **NFR-401 — Chart performance**: With 2,000 already-received points on reference desktop hardware in each supported browser, the p95 duration from scheduling a gateway or cost visual update until both chart and table are interactive MUST be at most 500 ms, with no single main-thread task above 200 ms. The same dataset MUST remain operable at 200% zoom and narrow viewports.
- **NFR-402 — Alert-to-run journey**: In representative operator validation with at least five participants, the median elapsed time from opening a failed alert to identifying its implicated run, evidence, and the recovery action or non-retryable explanation required by FR-403 MUST be at most 60 seconds, with at least 90% successful completion.
- **NFR-403 — Realtime resilience**: Realtime updates for scoped status, alerts, and run summaries MUST be opt-in and use same-origin server-sent events with ordered event identifiers and resume support. The default remains consolidated polling every 10 seconds with visibility pause and manual refresh. If streaming is unsupported, unauthorized, disconnected, cannot resume, or fails three consecutive reconnect attempts, the client MUST visibly fall back to polling without duplicate application, silent stale state, lost URL scope, or overwriting a pending local mutation. Streaming MUST be disabled for demo data and MUST preserve the same authorization and scope checks as equivalent reads.

### Product Decisions

- **Canonical alert model**: One persisted Alert Occurrence owns lifecycle and typed entity links; existing notification rules and legacy escalations are normalized sources, not separate user-facing alert types.
- **Severity policy**: `critical` means immediate service, spend, or integrity risk; `warning` means degradation or threshold risk requiring timely review; `info` means awareness with no immediate intervention. Text and icon accompany color in every state.
- **Acknowledgement and suppression**: Acknowledgement records ownership of triage, requires a reason, keeps the alert visible, and suppresses duplicate outbound notification for that occurrence. Severity escalation always re-notifies. Resolution requires a reason or linked successful remediation; later recurrence creates a new occurrence.
- **Authorization policy**: Existing authorization remains authoritative. Read access follows current tenant/project visibility. Alert lifecycle and retry require an existing operator/admin-equivalent mutation permission; restart requires existing administrator authority and sensitive-action confirmation. This feature creates no finance role and grants no permission through navigation.
- **Pagination policy**: Opaque, snapshot-stable cursor pagination uses 50 records by default and 200 maximum; cursors are bound to the complete authorized filter scope and recover explicitly when expired.
- **Retention and scope**: Tenant scope is derived from the authenticated or local installation context and cannot be expanded by URL input. Project filters require existing membership/role access. Alert lifecycle/audit evidence defaults to 365 days through policy; existing ledger/run retention is preserved and surfaced, not redefined or shortened.

### Key Entities

- **Operational Query Scope**: Authorized tenant, optional project/provider, exact UTC time interval, additional entity filters, freshness, and stable URL encoding shared across operational routes.
- **Drill-Down Target**: Labelled route, canonical entity type, stable identifier, compatible inherited scope, and recovery destination.
- **Task Detail**: Current task identity/state and its related runs, alerts, cost, actions, and audit evidence.
- **Run Detail**: One run's identity, outcome/reason, timeline, bounded log evidence, attribution, retryability, retry history, and related entities.
- **Usage Record**: Gateway-ledger evidence with time, tenant, provider/model, task/run attribution, tokens, cost, request outcome, and an explicit unattributed state.
- **Metric Definition**: Name, unit, source, numerator/denominator or aggregation rule, filter compatibility, time semantics, freshness, empty behavior, and drill-down dimension.
- **Alert Occurrence**: One scoped alert episode with immutable identity, dedupe fingerprint, severity, lifecycle, evidence, typed links, occurrence history, suppression, version, and audit references.
- **Alert Lifecycle Event**: Append-only transition or notification-suppression evidence tied to an alert version, actor, reason, outcome, and correlation identifier.
- **Realtime Cursor**: Opaque scoped event position used to resume ordered live summaries without changing the underlying read contracts.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-401**: At least 90% of representative operators correctly identify the highest-priority unacknowledged condition and its affected entity within five seconds on first view.
- **SC-402**: 100% of actionable default overview widgets, alert/entity links, chart table rows, and cost dimensions have automated durable-URL tests proving exact compatible filter/time preservation through direct load, refresh, Back, and Forward.
- **SC-403**: The failed-alert-to-run journey completes in at most 60 seconds median with at least 90% success, and every tested run shows a safe authorized recovery action or a specific non-retryable explanation.
- **SC-404**: 100% of tested acknowledgement, reopen, resolution, retry, and restart attempts—successful, rejected, stale, or failed—produce correlated audit evidence without secrets or broader tenant/project data.
- **SC-405**: 100% of gateway and cost charts expose a semantically equivalent table and textual summary; automated accessibility plus keyboard and screen-reader smoke tests report zero critical or serious WCAG 2.2 AA violations on migrated routes.
- **SC-406**: The chart performance test renders 2,000 points at p95 no slower than 500 ms in the supported browser matrix, and records reference hardware, browser version, chart duration, table duration, and long-task evidence.
- **SC-407**: A representative finance user identifies the largest selected-scope cost driver and reaches supporting usage/task/run records within two minutes; chart/table totals reconcile with ledger fixtures, including unattributed cost.
- **SC-408**: Realtime tests prove ordered resume, duplicate rejection, visible disconnect, three-failure polling fallback, visibility pause, manual refresh, and authorization/scope enforcement without changing existing public API responses.
- **SC-409**: 100% of direct, narrow/wide, 200%-zoom, reduced-motion, keyboard, and supported-browser scenarios retain operable filters, tables, detail routes, dialogs, log pagination, and non-color status meaning without horizontal page overflow at 320 px.
- **SC-410**: Existing `/api/*` and `/api/v1/*` compatibility fixtures retain endpoint URLs, authentication/authorization behavior, request and response shapes, and status codes; all UXF-004 interfaces are additive or internal.

## Assumptions

- The merged UXF-002 platform foundation and UXF-003 onboarding implementation on `main` provide the `/app` route namespace, shared themes/primitives, compatibility flag, sanitized boundaries, and first-run handoff that this feature extends.
- The existing gateway ledger remains the sole cost/metering source; operational views do not infer cost from transcripts or provider dashboards.
- Existing local single-operator same-origin protection and authenticated tenant/project role checks remain the authority for their current surfaces. UXF-004 may add checks where an additive scoped endpoint requires them but cannot weaken or bypass an existing check.
- Current legacy dashboard panels remain available as a per-route compatibility fallback during rollout; this feature does not remove legacy modules or their public contracts.
- The existing vendored chart capability is sufficient for required visuals. A new chart dependency is out of scope unless a later reviewed plan proves the current capability and browser built-ins cannot satisfy a requirement.
- Provider credential editing, provider secret display, notification-channel credential editing, user administration, role creation, and broad alert-rule administration are out of scope.
- User-facing raw prompts, request bodies, credentials, authorization headers, stack traces, and unrestricted run output are never alert, telemetry, audit, SSE, or chart payload fields.
