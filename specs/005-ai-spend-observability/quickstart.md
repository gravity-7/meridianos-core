# Quickstart Validation Guide: AI Spend Observability

**Feature**: P5 — AI Spend Observability | **Date**: 2026-07-30

## Prerequisites

- MeridianOS daemon running with gateway enabled (default since P0-F2)
- At least one LLM provider configured with a valid API key
- Node.js 24+ installed
- Dashboard accessible at `http://localhost:4317`

## Validation Scenarios

### VS1: Aggregation Engine — Verify hourly/daily rollups

**Purpose**: Prove that the aggregation engine correctly materializes hourly and daily summaries from raw token events.

**Setup**: Ensure the daemon has been running for at least 1 hour with active LLM traffic.

**Steps**:
1. Query raw event count for the last hour:
   ```powershell
   node -e "const { openLedger } = require('./gateway/ledger.mjs'); const db = openLedger(); const r = db.prepare('SELECT COUNT(*) as c FROM token_events WHERE ts >= ? AND ts < ?').get(new Date(Date.now()-3600000).toISOString(), new Date().toISOString()); console.log('Raw events:', r.c);"
   ```
2. Check aggregation status via API:
   ```
   GET http://localhost:4317/api/analytics/aggregation/status
   ```
3. Verify `hourlyWindowsPending` is 0 and `lastHourlyRun` is recent.
4. Query hourly summary for the same window:
   ```sql
   SELECT COUNT(*) as rows, SUM(cost_usd) as total_cost FROM analytics_hourly WHERE hour_ts >= datetime('now', '-1 hour');
   ```
5. **Assert**: Hourly summary cost total matches raw event cost total within 0.1% tolerance.

**Expected**: Aggregation runs automatically every hour. Hourly summaries exist for all completed hours. Late-arriving data is incorporated on next run.

---

### VS2: Dashboard KPIs — Verify load performance and data accuracy

**Purpose**: Prove the Analytics dashboard loads with correct KPIs within 2 seconds.

**Steps**:
1. Open `http://localhost:4317` in a browser.
2. Navigate to the **Analytics** tab.
3. Open browser DevTools (F12) → Network tab.
4. Observe the `/api/analytics/overview` request.
5. **Assert**: Response time < 2000ms.
6. Verify KPI cards display: Total Spend, Spend Change %, Top Provider, Top Model.
7. Cross-check Total Spend against a direct ledger query:
   ```sql
   SELECT SUM(cost_usd) FROM analytics_daily WHERE day_ts >= date('now', '-30 days');
   ```
8. **Assert**: Dashboard KPI value matches direct DB query.

**Expected**: KPI cards render in under 2 seconds with accurate data.

---

### VS3: Spend Pause — Verify gateway blocks traffic instantly

**Purpose**: Prove the "Pause All AI Spend" control blocks LLM traffic within 1 second and persists across restarts.

**Steps**:
1. Activate spend pause via dashboard or API:
   ```
   POST http://localhost:4317/api/analytics/spend-pause
   Content-Type: application/json
   X-AIOS-Token: <token>

   { "action": "pause", "reason": "Validation test" }
   ```
2. **Assert**: Response confirms `isPaused: true`.
3. Attempt an LLM API call through the gateway:
   ```powershell
   curl -X POST http://localhost:4317/v1/messages -H "Content-Type: application/json" -d '{"model":"claude-sonnet-4-20250514","max_tokens":1,"messages":[{"role":"user","content":"hi"}]}'
   ```
4. **Assert**: Response is HTTP 503 with `{ "error": "Spend is paused" }`.
5. Restart the daemon (kill and restart).
6. **Assert**: Spend pause is still active after restart (query `GET /api/analytics/spend-pause`).
7. Deactivate pause:
   ```
   POST http://localhost:4317/api/analytics/spend-pause
   { "action": "resume" }
   ```
8. **Assert**: LLM traffic resumes normally.

**Expected**: Pause blocks traffic in <1 second. Survives daemon restart. Resume restores normal operation.

---

### VS4: Task Cost Attribution — Verify per-task cost tracking

**Purpose**: Prove that LLM costs are correctly attributed to tasks.

**Steps**:
1. Trigger an agent run against a known task:
   ```powershell
   node scheduler.mjs --run task-validate-001
   ```
2. Wait for run completion.
3. Query task cost via dashboard API:
   ```
   GET http://localhost:4317/api/analytics/task-cost?taskId=task-validate-001&includeRuns=true
   ```
4. **Assert**: Response includes `totalCost`, `totalTokens`, `apiCalls`, and per-run breakdown.
5. Cross-check against raw ledger:
   ```sql
   SELECT SUM(cost_usd), SUM(total_tokens), COUNT(*) FROM token_events WHERE task = 'task-validate-001';
   ```
6. **Assert**: API response totals match raw ledger query.

**Expected**: Task cost matches ledger records. Per-run breakdown is accurate.

---

### VS5: Alert Delivery — Verify Slack/webhook/email dispatch

**Purpose**: Prove alerts are delivered through configured channels with cooldown enforcement.

**Prerequisites**: At least one alert channel configured (Slack webhook recommended for testing).

**Steps**:
1. Configure a Slack webhook in `policy.yaml`:
   ```yaml
   analytics:
     alerts:
       channels:
         - type: slack
           url: "https://hooks.slack.com/services/T.../B.../xxx"
           enabled: true
           severities: [info, warning, critical]
       rules:
         - ruleId: budget_10pct
           type: budget_threshold
           thresholdPct: 10
           severity: info
           cooldownSecs: 60
   ```
2. Send a test alert:
   ```
   POST http://localhost:4317/api/analytics/alerts/test
   ```
3. **Assert**: Slack channel receives a test message within 30 seconds.
4. Configure a low budget threshold (10%) so it triggers quickly.
5. Generate enough spend to cross 10% of budget.
6. **Assert**: Slack alert fires with correct spend, percentage, and threshold info.
7. Immediately cross the threshold again (don't wait for cooldown).
8. **Assert**: No duplicate alert is sent (cooldown enforced).
9. Wait for cooldown to expire, cross threshold again.
10. **Assert**: New alert is sent after cooldown.

**Expected**: Test alerts verify channel connectivity. Threshold alerts fire with correct data. Cooldown prevents duplicates.

---

### VS6: Optimization Recommendations — Verify model-switch suggestions

**Purpose**: Prove the optimization engine identifies cost-saving model switches with accurate estimates.

**Prerequisites**: At least 7 days of usage data with multiple models used for similar task types.

**Steps**:
1. Trigger optimization analysis (or wait for scheduled run).
2. Query recommendations:
   ```
   GET http://localhost:4317/api/analytics/optimization/recommendations
   ```
3. **Assert**: If qualifying data exists, at least one recommendation is returned with `status: active`.
4. Verify recommendation structure: `currentModel`, `recommendedModel`, `estimatedWeeklySavings`, `confidence`, `capabilityCheck`.
5. Apply a recommendation:
   ```
   POST http://localhost:4317/api/analytics/optimization/apply
   { "id": "rec-001" }
   ```
6. **Assert**: Response confirms `status: applied`. The model routing config is updated.
7. Run a task of the affected type.
8. **Assert**: Task uses the recommended model, not the original.
9. Dismiss a different recommendation:
   ```
   POST http://localhost:4317/api/analytics/optimization/dismiss
   { "id": "rec-002", "reason": "Not applicable" }
   ```
10. **Assert**: Recommendation is hidden and won't appear in active list.

**Expected**: Recommendations are data-driven. Apply changes model routing. Dismiss hides recommendation for 30 days.

---

### VS7: CSV Export — Verify data export integrity

**Purpose**: Prove CSV export produces accurate, well-formed data.

**Steps**:
1. Request CSV export for last 7 days:
   ```
   GET http://localhost:4317/api/analytics/export?from=2026-07-23&to=2026-07-30
   ```
2. **Assert**: Response `Content-Type` is `text/csv`.
3. **Assert**: Response includes header row: `date,provider,model,agent,task,input_tokens,output_tokens,total_tokens,cost_usd,api_calls`.
4. Download and open in a spreadsheet application.
5. **Assert**: Row count matches DB query for the same date range.
6. **Assert**: Sum of `cost_usd` column matches total spend for period.

**Expected**: CSV is well-formed, complete, and matches raw data.

---

### VS8: Budget Forecasting — Verify projection accuracy

**Purpose**: Prove budget forecast provides reasonable projections.

**Steps**:
1. Set a monthly budget of $500 in `policy.yaml`.
2. Generate consistent daily spend (~$10/day) for 5 days.
3. Query budget forecast:
   ```
   GET http://localhost:4317/api/analytics/budget
   ```
4. **Assert**: `forecast.projectedTotal` is approximately `spendToDate + (dailyBurnRate × daysRemaining)`.
5. **Assert**: `forecast.status` is `on-track` when projected is under 90% of budget.
6. Rapidly increase spend for 2 hours (simulate a spike).
7. **Assert**: An anomaly appears in `anomalies` array with a z-score > 3.0.

**Expected**: Linear projection is reasonable. Status thresholds work correctly. Anomalies are detected for significant spikes.

---

### VS9: Regression Gate — Verify zero impact on existing tests

**Purpose**: Prove that all analytics changes pass the existing 915+ test suite.

**Steps**:
1. Run the full test suite:
   ```powershell
   npm test
   ```
2. **Assert**: All previously passing tests still pass. Zero regressions.
3. Run new analytics-specific tests:
   ```powershell
   node --test tests/analytics.test.mjs tests/aggregation.test.mjs tests/alerts.test.mjs tests/optimization.test.mjs tests/gateway/spend-pause.test.mjs tests/smtp-mailer.test.mjs
   ```
4. **Assert**: All new tests pass.

**Expected**: Zero regressions. New test modules pass independently.

---

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Dashboard shows "No data" | Verify gateway is running and ledger has events: `SELECT COUNT(*) FROM token_events;` |
| Aggregation never runs | Check daemon logs for "aggregation" errors. Verify scheduler timer is active. |
| Alerts not delivered | Run test alert first. Check SMTP relay connectivity. Verify webhook URLs. |
| Optimization shows no recommendations | Need 7+ days of data across multiple models. Check model_registry has capability data. |
| Spend pause not blocking | Verify gateway server reads `spend_pause_state` on each request. Check DB for correct row. |
