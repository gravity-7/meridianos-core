# Implementation Plan: AI Spend Observability

**Branch**: `005-ai-spend-observability` | **Date**: 2026-07-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-ai-spend-observability/spec.md`

## Summary

Build comprehensive AI spend observability across six features: a real-time Analytics Dashboard with KPIs and time-series charts (F1), per-task cost attribution linking every LLM call to its originating work item (F2), an automated cost aggregation engine producing hourly/daily materialized summaries (F3), budget intelligence with linear forecasting and anomaly detection plus an emergency "Pause All AI Spend" gateway control (F4), multi-channel alert delivery via Slack, email, and webhooks (F5), and a model cost optimization engine that recommends cheaper equivalent-model switches with one-click apply (F6).

Technical approach: extend the existing SQLite gateway ledger with aggregation summary tables (hourly + daily), add analytics API endpoints to the dashboard HTTP server, render charts in the existing vanilla-JS SPA using HTML5 Canvas, implement aggregation as a background timer in the daemon scheduler, extend `escalation-push.mjs` with email (SMTP over `node:tls`) and generic webhook channels, and implement the optimization engine as a heuristic cost-per-task-type comparator leveraging the model registry from P2.

## Technical Context

**Language/Version**: Node.js 24+ (ES modules, `.mjs` extension, `"type": "module"`)

**Primary Dependencies**: `better-sqlite3` (sole runtime dependency — zero-dependency philosophy); Node.js built-ins for all other functionality (`node:http`, `node:https`, `node:net`, `node:tls`, `node:crypto`, `node:fs`, `node:path`, `node:child_process`, `node:stream`)

**Storage**: SQLite via `better-sqlite3`. Extend the existing gateway ledger DB (`gateway/ledger-schema.sql` → `.ai/gateway/ledger.db`) with new analytics tables (`analytics_hourly`, `analytics_daily`, `alert_state`, `optimization_rules`, `spend_pause_state`). Single-DB approach keeps all cost data in one place, enabling atomic queries across raw events and aggregates.

**Testing**: Node.js native test runner (`node --test`), cassette system (`test/cassette.mjs`) for deterministic LLM response mocking. New test files: `tests/analytics.test.mjs`, `tests/aggregation.test.mjs`, `tests/alerts.test.mjs`, `tests/optimization.test.mjs`, `tests/gateway/spend-pause.test.mjs`. Maintain 915+ existing passing tests with zero regressions.

**Target Platform**: Windows, macOS, Linux — daemon process with embedded HTTP dashboard (port 4317) and gateway sidecar. Dashboard SPA is vanilla HTML/JS/CSS served by `node:http`.

**Project Type**: Multi-module feature extending the existing Node.js daemon/orchestrator. Touches gateway (aggregation tables, spend-pause gate), dashboard (analytics UI, new API endpoints), scheduler (aggregation timer, alert evaluation loop), and alerting (extended `escalation-push.mjs`). Flat project structure — all `.mjs` source files at repository root, gateway-specific modules in `gateway/`, dashboard in `dashboard/`, tests in `tests/`.

**Performance Goals**:
- Dashboard KPI cards and 30-day trend: render in <2 seconds (SC-001)
- 90-day aggregated trend queries: <1 second via materialized daily summaries (SC-002)
- Aggregation: sub-second per hourly window, O(n) where n = raw events in window
- Spend pause gate check: single boolean read, <1ms overhead per request (SC-006)
- Alert delivery: Slack/email/webhook POST dispatched within 60 seconds of trigger (SC-004)
- Anomaly detection: evaluated on hourly aggregation completion, <5 minutes (SC-005)
- CSV export: streamed, 30-day report <10 seconds (SC-009)

**Constraints**:
- Zero new npm dependencies. All analytics functionality uses Node.js built-ins + better-sqlite3.
- Existing 915+ tests must continue to pass with zero regressions.
- Dashboard SPA additions must remain vanilla JS/HTML/CSS — no framework imports.
- Aggregation must be idempotent (INSERT OR REPLACE), handle late-arriving data, and resume cleanly after interruption.
- SMTP email delivery uses `node:tls` to connect to user-configured SMTP relay — no external email service dependency.
- Spend pause state persists across daemon restarts (stored in DB row, not just in-memory).

**Scale/Scope**: Single-tenant MeridianOS deployment. Analytics for months of accumulated ledger data (typical: hundreds of thousands of token events). Aggregation runs hourly as a background timer in the scheduler loop. Dashboard adds ~5 new tabs/views to the existing ~87KB SPA. Alert evaluation runs inline after each aggregation window completes.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Assessment |
|---|-----------|--------|-----------|
| I | Provider & Model Agnosticism | ✅ PASS | Optimization engine (F3) analyzes costs independent of provider — recommendations are based on cost-per-task-type comparisons across the model registry (P2). Charts and aggregation group by provider generically. No hardcoded provider logic. |
| II | Gateway as Single Source of Truth | ✅ PASS | ALL analytics data is derived from the gateway ledger (`token_events` table). Budget forecasting, anomaly detection, task attribution, and optimization recommendations ALL query ledger data. Spend pause (F4) is enforced at the gateway request entry point — the single metering path. |
| III | Zero-Dependency Philosophy | ✅ PASS | Aggregation: pure SQL via better-sqlite3 (existing dependency). Charts: HTML5 Canvas API (built into browsers). SMTP email: `node:tls` (built-in). CSV export: string building via `node:stream`. Slack/webhook: extend existing `escalation-push.mjs` (already uses `node:https`). Zero new `npm install` required. |
| IV | Test-First Discipline | ✅ PASS | Every module gets a corresponding test file (`analytics.test.mjs`, `aggregation.test.mjs`, `alerts.test.mjs`, `optimization.test.mjs`, `spend-pause.test.mjs`). Tests written before/alongside implementation. Cassette system used where LLM interactions are involved. |
| V | Configuration over Code | ✅ PASS | Budget thresholds, alert channels (Slack URL, SMTP config, webhook URL), aggregation interval, cooldown periods, anomaly detection sensitivity — all configured in `policy.yaml`. Spend pause is a runtime state toggle, not a config change. Optimization recommendations are data-driven, not hardcoded. |
| VI | Observability & Auditability | ✅ PASS | **This is the direct implementation of Principle VI.** Every cost decision traced to a task. Anomalies surfaced with specific hour/provider/delta. Spend pause events logged. Alert delivery tracked. Optimization apply/dismiss recorded. All analytics are read-only views over the append-only ledger. |
| VII | Non-Technical Usability | ✅ PASS | Dashboard-first analytics with KPIs and charts (no CLI required to see spend). Dollar-based budgets and thresholds (not token-based). One-click "Pause All AI Spend" emergency button. Optimization recommendations with one-click apply. Alerts configurable from dashboard UI. |
| VIII | ES Modules & Modern JavaScript | ✅ PASS | All new and modified code uses `.mjs` extension, `import`/`export` syntax, `node:` prefix for built-ins. Dashboard JS remains vanilla ES modules (no bundler). |
| IX | PR Discipline & Code Review | ✅ PASS | All changes delivered via feature-branch pull requests. PR title format: `[P5]-[F{N}]: description`. Branches deleted after merge. |
| X | Spec-Driven Development | ✅ PASS | This plan follows the spec-kit workflow: Constitution → Specify → Plan → Tasks → Implement → Converge. |

**Gate Result: ALL 10 PRINCIPLES PASS — no violations, no justifications needed.**

## Project Structure

### Documentation (this feature)

```text
specs/005-ai-spend-observability/
├── plan.md              # This file
├── research.md          # Phase 0 output — technical decisions
├── data-model.md        # Phase 1 output — entity definitions
├── quickstart.md        # Phase 1 output — validation guide
├── contracts/           # Phase 1 output — API contracts
│   └── analytics-api.md # Dashboard analytics REST endpoints
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
# Existing files — MODIFIED
gateway/
├── server.mjs              # P5-F4: Spend-pause check at request entry
├── ledger.mjs              # P5-F1,F3: Add analytics query functions
├── ledger-schema.sql       # P5-F3: Add analytics_hourly, analytics_daily,
│                           #        alert_state, optimization_rules, spend_pause_state
└── token-event.mjs         # P5-F2: Ensure task field populated from request metadata

dashboard/
├── index.html              # P5-F1,F2,F4,F6: Add Analytics, Budget, Optimization, Alerts tabs
├── server.mjs              # P5-F1-F6: Add analytics API endpoints, spend-pause toggle
└── actions.mjs             # P5-F4: Wire spend-pause action

scheduler.mjs               # P5-F3,F4: Add hourly aggregation timer, alert evaluation step

escalation-push.mjs         # P5-F5: Extend with SMTP email + generic webhook channels

config.mjs                  # P5-F1-F6: Parse new analytics config sections from policy.yaml
policy-validate.mjs         # P5-F5: Validate alert channel configurations

budget.mjs                  # P5-F1,F4: Add ledger-based spend query for dashboard

# New files
analytics.mjs               # [NEW] P5-F1,F3: Analytics query engine — aggregate queries,
                            #        time-series builders, KPI computation, CSV export
aggregation.mjs             # [NEW] P5-F3: Hourly/daily aggregation engine — window
                            #        computation, idempotent upsert, resume-after-interrupt
alerts.mjs                  # [NEW] P5-F5: Alert evaluation engine — threshold checks,
                            #        anomaly detection, cooldown tracking, channel dispatch
optimization.mjs            # [NEW] P5-F6: Cost optimization engine — task-type grouping,
                            #        cost comparison, capability filtering, recommendation
                            #        generation, apply/dismiss tracking
smtp-mailer.mjs             # [NEW] P5-F5: SMTP client using node:tls — connect, AUTH LOGIN,
                            #        send formatted email, disconnect

# New test files
tests/
├── analytics.test.mjs      # [NEW] P5-F1: Dashboard analytics API tests
├── aggregation.test.mjs    # [NEW] P5-F3: Aggregation engine idempotency, resume, late-data
├── alerts.test.mjs         # [NEW] P5-F5: Alert trigger, cooldown, multi-channel dispatch
├── optimization.test.mjs   # [NEW] P5-F6: Recommendation generation, apply, dismiss
├── smtp-mailer.test.mjs    # [NEW] P5-F5: SMTP client with cassette-mocked TLS
└── gateway/
    └── spend-pause.test.mjs # [NEW] P5-F4: Spend pause gate at gateway level
```

**Structure Decision**: Single flat project extending the existing MeridianOS daemon architecture. New analytics modules live at repository root alongside existing modules (`scheduler.mjs`, `budget.mjs`, etc.). Gateway-specific changes stay in `gateway/`. Dashboard changes stay in `dashboard/`. This follows the established convention from P0, P1, P2, P3, and P4.

## Complexity Tracking

> No constitution violations — this section is intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
