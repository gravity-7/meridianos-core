# Feature Specification: AI Spend Observability

**Feature Branch**: `005-ai-spend-observability`

**Created**: 2026-07-30

**Status**: Draft

**Input**: User description: "Start P5 — Build Comprehensive AI Spend Observability with Real-Time Analytics Dashboards, Budget Forecasting, Model Cost Optimization Recommendations, and Multi-Channel Alerting. 6 features: Spend Analytics Dashboard (F1), Budget Intelligence & Forecasting (F2), Model Cost Optimization Engine (F3), Real-Time Alerts (F4), Per-Task Cost Attribution (F5), Cost Aggregation Engine (F6)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Spend Analytics Dashboard (Priority: P1)

As a MeridianOS operator, I want a real-time dashboard showing my AI spend at a glance — total cost, cost by provider, cost by model, cost by agent, and cost trends over time — so I can understand where my AI budget is going without running SQL queries or parsing log files.

**Why this priority**: The dashboard is the most visible deliverable and provides immediate value to every operator. Without it, cost data exists in the ledger but is inaccessible to non-technical users. This is the primary interface for all other observability features.

**Independent Test**: Open the dashboard, navigate to the Analytics tab, and verify that KPI cards show total spend, provider breakdown, and model breakdown matching raw ledger queries. Change the date range filter and confirm charts update. Export a CSV and verify data matches on-screen values.

**Acceptance Scenarios**:

1. **Given** AI traffic has flowed through the gateway for at least one day, **When** the operator opens the Analytics dashboard, **Then** KPI cards display: total spend (current period), spend change vs previous period (%), top provider by cost, and top model by cost — all within 2 seconds of page load.
2. **Given** the operator is viewing the Analytics dashboard, **When** they select a date range (today, 7 days, 30 days, custom), **Then** all charts and KPIs update to reflect only data within that range.
3. **Given** spend data exists across multiple providers, **When** the operator views the provider breakdown chart, **Then** each provider is shown as a proportion of total spend with its dollar amount and percentage.
4. **Given** spend data exists across multiple models and agents, **When** the operator views the model breakdown and agent breakdown, **Then** each entity is ranked by cost with drill-down capability to see which tasks contributed to that cost.
5. **Given** the operator wants to analyze spend offline, **When** they click the Export button, **Then** a CSV file downloads containing all visible data (date, provider, model, agent, tokens, cost) for the selected date range.

---

### User Story 2 - Per-Task Cost Attribution (Priority: P1)

As a MeridianOS operator or development team lead, I want to see exactly how much each task or feature cost in AI spend — "Implement user login cost $4.72 across 3 agent runs" — so I can track AI costs against specific work items and make informed build-vs-buy decisions.

**Why this priority**: Task-level attribution transforms AI spend from an opaque operational expense into a traceable development cost. Teams need to know which features are expensive to build with AI so they can optimize their development process. This also enables chargeback or cost-allocation workflows.

**Independent Test**: Trigger an agent run against a known task. After completion, query the task's cost via dashboard or CLI. Verify the returned cost matches the sum of all token events attributed to that task in the gateway ledger.

**Acceptance Scenarios**:

1. **Given** an agent completes a task that made 5 LLM API calls through the gateway, **When** the operator views the task's cost summary, **Then** the system displays total cost, token count (input + output), models used, duration, and number of API calls — all matching the gateway ledger records.
2. **Given** the same task was run 3 times (initial attempt + 2 retries), **When** the operator views cost attribution, **Then** the system shows cost per run and total aggregate cost, with each run linked to its runlog entry.
3. **Given** a project has multiple completed tasks, **When** the operator views the project cost summary, **Then** tasks are ranked by total cost with the ability to filter by date range, agent, and model.
4. **Given** the operator wants to attribute cost to a specific feature or epic, **When** they assign a cost label or tag to a task, **Then** the system aggregates costs by that label across all tasks bearing it.

---

### User Story 3 - Cost Aggregation & Historical Trends (Priority: P2)

As a MeridianOS operator, I want the system to automatically aggregate raw token events into hourly and daily summaries so that dashboards load instantly and I can analyze spend patterns over weeks and months without performance degradation.

**Why this priority**: The gateway ledger is append-only and grows unbounded. Without aggregation, querying multi-month trends requires scanning millions of raw events. Aggregation enables fast dashboards (US1), accurate forecasts (US4), and optimization recommendations (US6). It is the data foundation for all analytics features.

**Independent Test**: Generate token events for multiple hours, trigger aggregation, and verify summary tables contain correct hourly and daily rollups matching the raw event totals. Query a 90-day trend and confirm it returns in under 1 second.

**Acceptance Scenarios**:

1. **Given** raw token events exist in the gateway ledger, **When** the aggregation engine runs (hourly), **Then** hourly summary records are created grouping cost by provider, model, agent, and task — matching raw event totals within 0.1% tolerance.
2. **Given** hourly summaries exist for a full day, **When** daily aggregation runs, **Then** daily summary records are created from the hourly data with correct totals.
3. **Given** 90 days of aggregated data, **When** the operator requests a spend trend chart, **Then** the data returns in under 1 second regardless of raw event volume.
4. **Given** new raw events arrive after a previous aggregation window, **When** the aggregation runs again, **Then** already-aggregated windows are not double-counted and late-arriving data is correctly incorporated.
5. **Given** the aggregation process is interrupted mid-run, **When** it restarts, **Then** it resumes from the last completed window without data loss or duplication.

---

### User Story 4 - Budget Intelligence & Forecasting (Priority: P2)

As a MeridianOS operator managing a monthly AI budget, I want the system to project whether I will stay within budget based on current spend velocity, alert me to unusual spending patterns, and let me pause all AI spend with a single action if costs escalate unexpectedly.

**Why this priority**: Budgets without forecasting are reactive. Operators discover they've exceeded their budget after the fact. Predictive intelligence turns the budget from a post-mortem metric into a proactive management tool. The "Pause All AI Spend" emergency control provides a critical safety net.

**Independent Test**: Set a monthly budget of $100. Simulate spend at a rate that would reach $150 by month-end. Verify the forecast shows "Projected: $150 — $50 over budget" with a warning. Trigger a spending anomaly (3x normal hourly rate) and verify an alert is raised. Activate "Pause All AI Spend" and verify all subsequent LLM requests are blocked.

**Acceptance Scenarios**:

1. **Given** a monthly budget is configured and at least 3 days of spend data exists, **When** the operator views the budget panel, **Then** the system displays: spend-to-date, projected month-end total, days remaining, and a status indicator (on-track / at-risk / over-budget) based on current burn rate.
2. **Given** the system has at least 7 days of historical spend data, **When** an hourly spend rate exceeds 3 standard deviations above the trailing average, **Then** an anomaly is detected and surfaced in the dashboard with the specific hour, provider, and cost delta that triggered it.
3. **Given** the operator activates "Pause All AI Spend," **When** any agent or IDE attempts an LLM call through the gateway, **Then** the request is rejected with a clear message indicating spend is paused, and the rejection is logged.
4. **Given** spend is paused, **When** the operator deactivates the pause, **Then** normal LLM traffic resumes immediately without requiring a restart.
5. **Given** a budget threshold is configured at 80%, **When** spend-to-date reaches 80% of the monthly budget, **Then** a warning is displayed in the dashboard and an optional alert is sent via configured channels.

---

### User Story 5 - Multi-Channel Alerts (Priority: P2)

As a MeridianOS operator, I want to receive notifications about budget thresholds, spending anomalies, and cost optimization opportunities through my preferred channels — Slack, email, or webhook — so I can stay informed without constantly watching the dashboard.

**Why this priority**: Operators cannot monitor a dashboard 24/7. Alerts push critical information to where operators already work. Combined with forecasting (US4), alerts create a proactive cost management system. This depends on the aggregation and forecasting infrastructure being in place.

**Independent Test**: Configure a Slack webhook. Set a budget threshold at 50%. Generate spend that crosses the threshold. Verify a Slack message is delivered with current spend, percentage, and projected total. Verify cooldown prevents duplicate alerts within the configured window.

**Acceptance Scenarios**:

1. **Given** a Slack webhook URL is configured in policy, **When** any alert condition is triggered (budget threshold, anomaly, optimization available), **Then** a formatted Slack message is delivered containing: alert type, current value, threshold, timestamp, and a link to the dashboard.
2. **Given** an email alert channel is configured, **When** an alert condition is triggered, **Then** an email is sent with the same information as the Slack alert, formatted for email clients.
3. **Given** a generic webhook URL is configured, **When** an alert condition is triggered, **Then** a JSON payload is POSTed to the webhook with structured alert data for integration with custom systems (PagerDuty, Discord, Teams).
4. **Given** a budget threshold alert has already fired within the cooldown period (default: 1 hour), **When** spend continues to cross the same threshold, **Then** no duplicate alert is sent until the cooldown expires.
5. **Given** the operator configures alert severity levels (info, warning, critical), **When** an alert fires, **Then** only channels subscribed to that severity level receive the notification.
6. **Given** the operator wants to test alert configuration, **When** they click "Send Test Alert" in the dashboard, **Then** a test message is delivered to all configured channels within 30 seconds, confirming end-to-end connectivity.

---

### User Story 6 - Model Cost Optimization Recommendations (Priority: P3)

As a MeridianOS operator, I want the system to analyze my usage patterns and recommend cost-saving model switches — "Switch from Claude Opus to Claude Sonnet for code review tasks and save $23/week with equivalent quality" — with the ability to apply the recommendation with one click.

**Why this priority**: Cost optimization provides ongoing ROI but requires sufficient usage data to make reliable recommendations. It depends on the aggregation engine (US3), task attribution (US2), and forecasting (US4) being in place. It is the most advanced intelligence feature and appropriately prioritized last.

**Independent Test**: Simulate 2 weeks of usage where 80% of code review tasks use an expensive model. Run the optimization analysis. Verify it recommends switching to a cheaper equivalent model with a specific dollar savings estimate. Apply the recommendation and verify the model router now uses the recommended model for matching tasks.

**Acceptance Scenarios**:

1. **Given** at least 7 days of per-task cost attribution data exists, **When** the operator views the Optimization tab, **Then** the system displays ranked recommendations, each showing: current model, recommended model, tasks affected, estimated weekly savings, and a confidence score.
2. **Given** a recommendation to switch from Model A to Model B for a specific task type, **When** the operator clicks "Apply," **Then** the model routing rule is updated so that task type uses Model B, and future runs reflect the change.
3. **Given** a recommendation has been applied, **When** the operator views the savings tracker, **Then** the system shows actual savings achieved vs projected savings since the change was made.
4. **Given** a recommended model lacks a required capability (e.g., vision, tool use) that the task needs, **When** the analysis runs, **Then** that model is excluded from consideration for those tasks — recommendations respect capability requirements.
5. **Given** the operator disagrees with a recommendation, **When** they dismiss it, **Then** that specific recommendation is hidden for 30 days and the dismissal reason is recorded to improve future recommendations.

---

### Edge Cases

- What happens when the ledger has zero data (fresh install)? The dashboard shows empty states with helpful guidance — "Connect a provider and run your first task to see spend analytics."
- What happens when the aggregation engine encounters a corrupted token event (missing cost, negative tokens)? The event is flagged and skipped with a warning logged; aggregation continues for clean data.
- What happens when a budget threshold is configured as 0 or negative? Configuration validation rejects the value with a clear error message.
- What happens when an alert channel is misconfigured (invalid webhook URL, bad credentials)? A test-send fails with a specific error; the channel is marked as degraded but does not block other channels.
- What happens when the operator tries to export 5 years of raw data? The export is capped at the available data range; exports exceeding a reasonable size are streamed rather than loaded into memory.
- What happens when two operators apply conflicting optimization recommendations simultaneously? Last-write-wins with a conflict detection notice; the system logs both changes for audit.
- What happens when a provider changes its pricing mid-cycle? The optimization engine re-evaluates recommendations on the next pricing refresh; existing recommendations are flagged as "pricing may have changed."

## Requirements *(mandatory)*

### Functional Requirements

#### Dashboard & Visualization

- **FR-001**: System MUST display a real-time spend dashboard with KPI cards for total spend, spend change vs prior period, top provider, and top model — all computed from gateway ledger data.
- **FR-002**: System MUST provide interactive time-series charts for spend over time, filterable by provider, model, agent, and custom date range.
- **FR-003**: System MUST provide provider, model, and agent breakdown visualizations showing each entity's proportion of total spend.
- **FR-004**: System MUST support CSV export of spend data for the selected filters and date range.

#### Task Cost Attribution

- **FR-005**: System MUST attribute every LLM API call to a specific task when task context is available in the gateway request metadata.
- **FR-006**: System MUST display per-task cost summaries including: total cost, token count (input/output), models used, number of API calls, and run duration.
- **FR-007**: System MUST aggregate task costs by project, feature label, or custom tag for cost-allocation workflows.
- **FR-008**: System MUST retain task-attribution data for the lifetime of the task record; deleted tasks may have their costs re-attributed to a "deleted tasks" category.

#### Cost Aggregation

- **FR-009**: System MUST automatically aggregate raw token events into hourly summary records grouped by provider, model, agent, and task.
- **FR-010**: System MUST aggregate hourly summaries into daily summaries for long-term trend analysis.
- **FR-011**: Aggregation MUST be idempotent — re-running aggregation on an already-aggregated window does not double-count.
- **FR-012**: Aggregation MUST handle late-arriving data (events written after their window was aggregated) by re-aggregating affected windows.

#### Budget Intelligence

- **FR-013**: System MUST compute a projected month-end spend based on current burn rate and days remaining in the budget period.
- **FR-014**: System MUST detect spending anomalies when an hourly spend rate exceeds 3 standard deviations above the trailing 7-day average.
- **FR-015**: System MUST provide a "Pause All AI Spend" control that immediately blocks all LLM requests through the gateway, with a clear "Spend is paused" message returned to callers.
- **FR-016**: Deactivating the pause MUST restore normal LLM traffic immediately without requiring a restart.
- **FR-017**: System MUST support configurable budget thresholds (e.g., 50%, 80%, 90%, 100%) that trigger warnings and alerts.

#### Alerts

- **FR-018**: System MUST support alert delivery via Slack webhook, email (SMTP), and generic webhook (JSON POST).
- **FR-019**: Alerts MUST include: alert type, current value, threshold, timestamp, and a dashboard link.
- **FR-020**: System MUST enforce a configurable cooldown period per alert type to prevent duplicate notifications.
- **FR-021**: System MUST support per-channel severity subscription (info, warning, critical) so operators control which alerts go where.
- **FR-022**: System MUST provide a "Send Test Alert" function to verify each channel's configuration.

#### Cost Optimization

- **FR-023**: System MUST analyze per-task usage patterns and identify opportunities to switch to lower-cost models with equivalent capabilities.
- **FR-024**: Each optimization recommendation MUST include: current model, recommended model, affected tasks, estimated savings, confidence score, and capability compatibility check.
- **FR-025**: System MUST support one-click application of a recommendation, updating the model routing configuration for the affected task type.
- **FR-026**: System MUST track actual savings vs projected savings after a recommendation is applied.
- **FR-027**: System MUST allow operators to dismiss recommendations, with a configurable hide period and optional reason recording.

### Key Entities

- **AggregatedCostRecord**: Hourly and daily summaries of spend — grouped by provider, model, agent, and task. Contains: time window, cost total, token count (input/output), API call count.
- **AlertRule**: A condition-action pair — defines a trigger (budget threshold %, anomaly detection, optimization available), severity level, and target channels.
- **AlertChannel**: A notification destination — Slack webhook URL, email address (SMTP config), or generic webhook URL — with enabled/disabled state and severity filter.
- **BudgetForecast**: A computed projection — current spend, projected total, days remaining, burn rate, status (on-track/at-risk/over-budget), and the budget configuration it derives from.
- **OptimizationRecommendation**: A suggested model switch — current model, recommended model, task type filter, estimated savings, confidence score, capability compatibility status, and apply/dismiss state.
- **SpendPauseState**: A global gateway state — when active, all LLM requests are rejected with a pause message. Contains: activated timestamp, activated by, reason.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Operators can view their current AI spend and 30-day trend in under 2 seconds from the dashboard.
- **SC-002**: 90-day spend trend queries return results in under 1 second regardless of raw event volume in the ledger.
- **SC-003**: Operators can identify which task or feature consumed the most AI spend within 30 seconds of opening the dashboard.
- **SC-004**: Budget threshold alerts are delivered to Slack within 60 seconds of the threshold being crossed.
- **SC-005**: Spending anomalies are detected and surfaced within 5 minutes of the anomalous hour completing.
- **SC-006**: The "Pause All AI Spend" control blocks new LLM requests within 1 second of activation.
- **SC-007**: Cost optimization recommendations achieve at least 80% accuracy in projected vs actual savings after 30 days of tracking.
- **SC-008**: Task cost attribution covers at least 95% of LLM API calls when task context is available in the request.
- **SC-009**: Export of a 30-day spend report (CSV) completes in under 10 seconds.
- **SC-010**: Operators can configure and verify an alert channel (Slack, email, or webhook) in under 5 minutes.

## Assumptions

- All spend data originates from the gateway ledger — the gateway remains the single source of truth for cost metering (Constitution Principle II).
- The existing dashboard (port 4317) is extended with new Analytics, Budget, Optimization, and Alerts tabs rather than building a separate analytics application.
- Alert delivery uses existing infrastructure: `escalation-push.mjs` already handles Slack webhooks and can be extended for email and generic webhooks.
- Model capability data (vision, tool use, context window) is available from the model discovery system built in P2 (003-provider-model-agnosticism).
- Budget configuration follows the existing policy.yaml pattern from P0-F3 (unified tenant + policy config).
- Default data retention: 90 days for hourly aggregation, 365 days for daily aggregation, indefinite for task-attributed costs.
- The "Pause All AI Spend" feature is a gateway-level control — it does not require agent cooperation and works for all traffic sources (agent, IDE, CLI).
- Optimization recommendations initially focus on model-switching within the same provider; cross-provider recommendations are deferred to a future enhancement.
- Export format is CSV; additional formats (PDF, JSON) are deferred.
- Alert severity levels default to: info (optimization available), warning (budget at 80%), critical (budget exceeded, anomaly detected, spend paused).
