# Research: Operational Overview, Observability, Drill-Down, and Alerts

## 1. Frontend architecture and chart dependency

**Decision**: Continue the merged UXF-002 browser-native ES-module shell and reuse the existing uPlot asset through a small adapter. Serve `dashboard/app/` modules through a protected `/static/app/*` mapping.

**Rationale**: The current main branch already supplies navigation, route dispatch, session boundaries, polling coordination, responsive primitives, and uPlot. Extending that implementation preserves the zero-dependency principle and avoids introducing a bundler or a second UI runtime. A source mapping lets route files live in the requested `dashboard/app/routes/` hierarchy while remaining directly importable by browsers.

**Alternatives considered**:

- React/TypeScript migration from the revamp master plan: deferred because UXF-002 deliberately established the browser-native shell and this feature does not justify replacing it.
- A new chart library: rejected because uPlot supports the required time series and the accessibility contract is implemented outside the canvas.
- Hand-written SVG/canvas charts: rejected because it would duplicate rendering, scaling, cursor, and resize behavior already present in uPlot.

## 2. Canonical alert model and persistence

**Decision**: Persist canonical `AlertOccurrence` rows and append-only `AlertEvent` rows in the existing state SQLite database. Keep gateway `alert_state` as notification-rule cooldown state and keep gateway ledger events as metering facts. Normalize legacy `warn` to `warning` only at the canonical boundary.

**Rationale**: Acknowledgement, resolution, optimistic concurrency, entity linkage, and human audit evidence are control-plane state, not metering data. The state database already owns tasks, task history, and operational events. Separating occurrence lifecycle from notification cooldown prevents acknowledgement from mutating or obscuring billing records while allowing notification evaluation to upsert an occurrence.

**Alternatives considered**:

- Extend only gateway `alert_state`: rejected because it stores per-rule cooldown timestamps and lacks actor, lifecycle, entity, and immutable event history.
- Store lifecycle only in JSONL: rejected because atomic compare-and-transition and scoped indexes are required.
- Introduce an external incident service: rejected as unnecessary scope and a new dependency/system boundary.

## 3. Metric definitions, overview widgets, and query scope

**Decision**: The default overview contains, in order, (1) unacknowledged critical/warning attention queue, (2) gateway/scheduler/ledger health strip, (3) active-agent and queued-work summary, (4) failed/blocked task and run summary, and (5) spend/budget summary. Every query uses an auth-derived tenant, optional authorized project/provider, and an exact UTC half-open `[from,to)` window defaulting to the past 24 hours. Calendar budget projections are explicitly labeled exceptions.

**Rationale**: This ordering makes actionable failure visible before general health or finance data and matches the five-second outcome. One canonical scope prevents mismatched totals across cards, tables, and charts. Explicit fixed-period labels avoid implying that monthly budgets use the selected arbitrary time window.

**Metric definitions**:

- Request volume: count of ledger `token_events` in scope.
- Error rate: denied or failed gateway events divided by request volume; `0%` when the denominator is zero.
- Latency: p50/p95 request duration from events that contain latency; missing samples show `not available`, not zero.
- Token usage: sum of input, output, cached, and total tokens as separate labeled series/totals.
- Spend: sum of recorded event cost in the ledger currency; unknown price/currency is separated from known spend.
- Budget status: current configured period spend, remaining amount, utilization, and forecast; it is not silently recomputed for arbitrary windows.
- Work health: counts by current task/run state, with failed and blocked records linking to filtered lists.

**Alternatives considered**:

- Widget-local filters: rejected because cross-widget disagreement undermines incident triage.
- Local-time storage: rejected because DST and browser locale would make URLs and pagination unstable.
- Treat missing latency/cost as zero: rejected because it creates misleading health and financial conclusions.

## 4. Drill-down and cursor pagination

**Decision**: Use durable identifier routes with the shared scope in query parameters. Extend `runlog.mjs` with opaque base64url cursors containing a validated version, snapshot watermark, last sort key, and filter fingerprint. Default page size is 50 and the maximum is 200. Run evidence returns allowlisted timeline/log fields rather than raw prompts, credentials, or provider payloads.

**Rationale**: URLs must survive refresh, browser back, and sharing without creating authorization. A snapshot watermark prevents new appends from reordering an in-progress traversal. A filter fingerprint rejects accidental cursor reuse with different scope. The allowlist makes the detail route useful without broadening sensitive-data exposure.

**Alternatives considered**:

- Offset pagination: rejected because concurrent append changes cause duplicate/skipped results.
- Return the whole JSONL file: rejected for latency, memory, and disclosure reasons.
- Put raw file offsets in the public contract: rejected so storage can change without breaking clients.

## 5. Alert severity, acknowledgement, suppression, and remediation

**Decision**: Canonical severities are `info`, `warning`, and `critical`; lifecycle states are `open`, `acknowledged`, and `resolved`. Acknowledgement is versioned, records actor/time/reason, and suppresses repeat notifications for the same active occurrence while leaving it visible. A higher-severity recurrence reopens/escalates the acknowledged occurrence and may notify. Resolution records evidence; a subsequent recurrence creates a new occurrence linked to the resolved episode by fingerprint and predecessor ID. Retry is available to operator/admin when the underlying task/run policy allows it; restart remains admin-only and requires explicit confirmation. Read-only roles receive an explanation instead of a hidden control.

**Rationale**: A small severity set matches current notification concepts while eliminating the `warn`/`warning` mismatch. Acknowledgement should reduce noise, not erase operational state. Optimistic versions make concurrent decisions explicit. Existing project role checks remain the authority for recovery.

**Alternatives considered**:

- Acknowledgement closes the alert: rejected because ownership and remediation are different facts.
- Time-only suppression with no actor/reason: rejected because it cannot provide audit evidence.
- Any viewer can retry: rejected because retries can consume budget and change workload state.
- Expose provider restart broadly: rejected because it is more disruptive and already treated as admin-sensitive.

## 6. Realtime transport and fallback

**Decision**: Live mode is opt-in. A same-origin `EventSource` consumes ordered, scoped events from a bounded in-process broker. The server emits a heartbeat every 15 seconds, replays retained IDs when possible, and emits `reset` when a resume ID is unavailable. The client closes SSE and starts one consolidated ten-second poll after three consecutive failures; page visibility pauses background refresh and focus performs one immediate refresh. A per-process connection cap returns `503` plus `Retry-After`, which triggers polling.

**Rationale**: SSE uses browser and Node primitives and fits one-way state updates. A bounded broker avoids unbounded memory. The reset contract makes process restart honest: clients refetch authoritative snapshots rather than assuming a durable stream. One coordinator prevents the historic multiplier of widget-local timers.

**Alternatives considered**:

- SSE always on: rejected because the requirement makes it opt-in and local operators may prefer polling.
- WebSocket: rejected because no bidirectional protocol is required.
- Durable event-stream database: rejected because polling remains the correctness path and durable alert/audit history already exists.

## 7. Chart accessibility and performance

**Decision**: Render a heading, scope, freshness text, unit, textual summary, and semantic data table before enhancing with uPlot. Limit each returned/rendered series to 2,000 points using deterministic bucket aggregation. Measure from route-data-ready to table-and-chart interactive with `performance.mark`; observe long tasks and require p95 <=500 ms and no task >200 ms in the browser performance fixture.

**Rationale**: Canvas is not a semantic data representation. A table-first design works without JavaScript chart enhancement and gives screen-reader and keyboard users the same facts. Bounded points create a measurable rendering contract without hiding which aggregation was used.

**Alternatives considered**:

- ARIA-label the canvas only: rejected because it does not expose individual values or relationships.
- Virtualize the accessible table: rejected at 2,000 points because search/screen-reader behavior becomes harder to reason about; collapsed disclosure plus all rows in the DOM remains testable within the threshold.
- Client-only downsampling: rejected as the sole guard because it transfers excessive data and duplicates scope aggregation.

## 8. Retention, tenant/project scope, and audit evidence

**Decision**: Default canonical alert and alert-event retention is 365 days, configurable through validated policy but never allowed to undercut a separately configured longer audit minimum. Cleanup is tenant/project scoped and records a cleanup event. This feature does not shorten run-log or ledger retention. Every mutation returns a correlation ID and audit URL; alert events contain before/after state, actor identity/type, authorized project role, timestamp, reason, target, result, and request correlation.

**Rationale**: One year gives finance and operations a useful incident trail while remaining bounded. Retention configuration is an operational policy decision, not source-code behavior. A linked immutable record makes UI confirmation independently verifiable.

**Alternatives considered**:

- Unbounded retention: rejected because the repository already supports retention controls and local deployments need bounded storage.
- Ninety days for everything: rejected because it can be shorter than audit expectations and weakens longitudinal cost/incident review.
- Delete underlying run/ledger evidence with alert cleanup: rejected because those stores have independent policies and purposes.
