# Analytics API Contracts

**Feature**: P5 — AI Spend Observability
**Base**: Dashboard HTTP server (port 4317), localhost-only

All endpoints below are added to the existing `dashboard/server.mjs`. Authentication uses the existing `X-AIOS-Token` header (bearer-style, per-boot UUID). All responses are JSON unless noted.

---

## 1. Spend Overview (KPIs)

### `GET /api/analytics/overview`

Returns aggregated KPIs for the Analytics dashboard.

**Query Parameters**:
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `from` | ISO-8601 | 30 days ago | Start of date range |
| `to` | ISO-8601 | now | End of date range |

**Response** (200):
```json
{
  "totalSpend": 142.37,
  "spendChangePct": 12.5,
  "totalTokens": 4850000,
  "totalApiCalls": 1250,
  "topProvider": { "name": "anthropic", "cost": 98.42, "pct": 69.1 },
  "topModel": { "name": "claude-sonnet-4-20250514", "cost": 67.30, "pct": 47.3 },
  "topAgent": { "name": "builder", "cost": 85.10, "pct": 59.8 },
  "period": { "from": "2026-07-01T00:00:00.000Z", "to": "2026-07-30T23:59:59.999Z" }
}
```

**Error** (503 if ledger unavailable):
```json
{ "error": "Analytics unavailable", "reason": "Ledger database not accessible" }
```

---

## 2. Time-Series Spend

### `GET /api/analytics/timeseries`

Returns spend data points for time-series charts. Resolution auto-selected based on date range.

**Query Parameters**:
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `from` | ISO-8601 | 30 days ago | Start of date range |
| `to` | ISO-8601 | now | End of date range |
| `groupBy` | string | `provider` | Dimension: `provider`, `model`, `agent`, `task` |

**Response** (200):
```json
{
  "resolution": "daily",
  "series": [
    {
      "label": "anthropic",
      "data": [
        { "ts": "2026-07-01T00:00:00.000Z", "cost": 4.52, "tokens": 145000 },
        { "ts": "2026-07-02T00:00:00.000Z", "cost": 3.87, "tokens": 128000 }
      ]
    },
    {
      "label": "deepseek",
      "data": [
        { "ts": "2026-07-01T00:00:00.000Z", "cost": 1.23, "tokens": 89000 }
      ]
    }
  ],
  "period": { "from": "2026-07-01T00:00:00.000Z", "to": "2026-07-30T23:59:59.999Z" }
}
```

---

## 3. Breakdown (Provider/Model/Agent)

### `GET /api/analytics/breakdown`

Returns ranked breakdown for a dimension.

**Query Parameters**:
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `dimension` | string | `provider` | `provider`, `model`, `agent`, `task` |
| `from` | ISO-8601 | 30 days ago | Start of date range |
| `to` | ISO-8601 | now | End of date range |
| `limit` | integer | 10 | Max items returned |

**Response** (200):
```json
{
  "dimension": "model",
  "items": [
    { "key": "claude-sonnet-4-20250514", "cost": 67.30, "tokens": 2100000, "apiCalls": 520, "pct": 47.3 },
    { "key": "claude-opus-4-20250514", "cost": 31.12, "tokens": 620000, "apiCalls": 98, "pct": 21.9 },
    { "key": "deepseek-chat", "cost": 18.45, "tokens": 1240000, "apiCalls": 340, "pct": 13.0 }
  ],
  "totalCost": 142.37,
  "period": { "from": "2026-07-01T00:00:00.000Z", "to": "2026-07-30T23:59:59.999Z" }
}
```

---

## 4. Per-Task Cost

### `GET /api/analytics/task-cost`

Returns cost attribution for a specific task or list of tasks.

**Query Parameters**:
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `taskId` | string | (required) | Task identifier |
| `includeRuns` | boolean | false | Include per-run breakdown |

**Response** (200):
```json
{
  "taskId": "task-abc-123",
  "totalCost": 4.72,
  "totalTokens": 156000,
  "apiCalls": 5,
  "models": ["claude-sonnet-4-20250514"],
  "firstRunAt": "2026-07-28T14:22:00.000Z",
  "lastRunAt": "2026-07-29T09:15:00.000Z",
  "runs": [
    { "runId": "run-001", "cost": 1.58, "tokens": 52000, "apiCalls": 2, "durationMs": 45000, "status": "completed" },
    { "runId": "run-002", "cost": 1.52, "tokens": 50000, "apiCalls": 1, "durationMs": 38000, "status": "completed" },
    { "runId": "run-003", "cost": 1.62, "tokens": 54000, "apiCalls": 2, "durationMs": 52000, "status": "completed" }
  ]
}
```

### `GET /api/analytics/project-costs`

Returns aggregated costs for all tasks in a project, ranked by cost.

**Query Parameters**:
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `project` | string | (required) | Project identifier |
| `orderBy` | string | `cost` | `cost` or `tokens` or `calls` |
| `limit` | integer | 20 | Max tasks returned |

---

## 5. Budget Forecast

### `GET /api/analytics/budget`

Returns current budget status and forecast.

**Response** (200):
```json
{
  "budget": {
    "amount": 500.00,
    "period": "monthly",
    "startDate": "2026-07-01T00:00:00.000Z",
    "endDate": "2026-07-31T23:59:59.999Z"
  },
  "current": {
    "spendToDate": 142.37,
    "pctUsed": 28.5,
    "daysElapsed": 30,
    "daysRemaining": 1
  },
  "forecast": {
    "projectedTotal": 147.20,
    "dailyBurnRate": 4.75,
    "status": "on-track",
    "pctProjected": 29.4
  },
  "anomalies": [
    {
      "hourTs": "2026-07-28T15:00:00.000Z",
      "provider": "anthropic",
      "cost": 12.34,
      "zScore": 4.2,
      "normalRange": [0.50, 6.80]
    }
  ]
}
```

**Status values**: `on-track` (projected < 90%), `at-risk` (projected 90-100%), `over-budget` (projected > 100%).

---

## 6. Spend Pause Control

### `GET /api/analytics/spend-pause`

Returns current spend pause state.

**Response** (200):
```json
{
  "isPaused": false,
  "pausedAt": null,
  "pausedBy": null,
  "reason": null
}
```

### `POST /api/analytics/spend-pause`

Toggle spend pause. Requires `X-AIOS-Token` authentication.

**Request Body**:
```json
{
  "action": "pause",
  "reason": "Budget reached 80% - investigating spike"
}
```
`action`: `pause` or `resume`.

**Response** (200):
```json
{
  "ok": true,
  "isPaused": true,
  "pausedAt": "2026-07-30T15:00:00.000Z",
  "pausedBy": "operator",
  "reason": "Budget reached 80% - investigating spike"
}
```

**Response** (409 — already in requested state):
```json
{ "error": "Spend is already paused", "pausedAt": "2026-07-30T14:00:00.000Z" }
```

---

## 7. CSV Export

### `GET /api/analytics/export`

Returns spend data as CSV download.

**Query Parameters**:
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `from` | ISO-8601 | 30 days ago | Start of date range |
| `to` | ISO-8601 | now | End of date range |
| `dimension` | string | `all` | `provider`, `model`, `agent`, `task`, or `all` |

**Response** (200): `Content-Type: text/csv`, `Content-Disposition: attachment; filename="meridianos-spend-2026-07.csv"`

```csv
date,provider,model,agent,task,input_tokens,output_tokens,total_tokens,cost_usd,api_calls
2026-07-01,anthropic,claude-sonnet-4-20250514,builder,task-abc,45000,12000,57000,1.72,2
2026-07-01,deepseek,deepseek-chat,reviewer,task-def,23000,8000,31000,0.38,1
```

---

## 8. Alerts Configuration

### `GET /api/analytics/alerts/config`

Returns current alert configuration.

**Response** (200):
```json
{
  "channels": [
    { "type": "slack", "url": "https://hooks.slack.com/...", "enabled": true, "severities": ["warning", "critical"] },
    { "type": "email", "to": "ops@example.com", "enabled": false, "severities": ["critical"] },
    { "type": "webhook", "url": "https://example.com/alerts", "enabled": true, "severities": ["info", "warning", "critical"] }
  ],
  "rules": [
    { "ruleId": "budget_50pct", "type": "budget_threshold", "thresholdPct": 50, "severity": "info", "cooldownSecs": 3600 },
    { "ruleId": "budget_80pct", "type": "budget_threshold", "thresholdPct": 80, "severity": "warning", "cooldownSecs": 3600 },
    { "ruleId": "budget_100pct", "type": "budget_threshold", "thresholdPct": 100, "severity": "critical", "cooldownSecs": 1800 },
    { "ruleId": "anomaly_spend", "type": "anomaly", "zScoreThreshold": 3.0, "severity": "warning", "cooldownSecs": 3600 }
  ]
}
```

### `POST /api/analytics/alerts/test`

Send a test alert to all configured channels.

**Response** (200):
```json
{
  "ok": true,
  "results": [
    { "channel": "slack", "ok": true },
    { "channel": "email", "ok": false, "error": "SMTP connection refused" },
    { "channel": "webhook", "ok": true }
  ]
}
```

---

## 9. Optimization Recommendations

### `GET /api/analytics/optimization/recommendations`

Returns active optimization recommendations.

**Query Parameters**:
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `status` | string | `active` | `active`, `applied`, `dismissed`, or `all` |

**Response** (200):
```json
{
  "recommendations": [
    {
      "id": "rec-001",
      "currentModel": "claude-opus-4-20250514",
      "recommendedModel": "claude-sonnet-4-20250514",
      "taskType": "code-review",
      "estimatedWeeklySavings": 23.40,
      "confidence": 0.87,
      "capabilityCheck": { "tools": true, "vision": true, "streaming": true },
      "tasksAffected": 12,
      "status": "active",
      "createdAt": "2026-07-28T10:00:00.000Z"
    }
  ]
}
```

### `POST /api/analytics/optimization/apply`

Apply a recommendation.

**Request Body**:
```json
{ "id": "rec-001" }
```

**Response** (200):
```json
{ "ok": true, "id": "rec-001", "status": "applied", "appliedAt": "2026-07-30T15:00:00.000Z" }
```

### `POST /api/analytics/optimization/dismiss`

Dismiss a recommendation.

**Request Body**:
```json
{ "id": "rec-001", "reason": "Prefer Opus for code review quality" }
```

**Response** (200):
```json
{ "ok": true, "id": "rec-001", "status": "dismissed", "dismissedAt": "2026-07-30T15:00:00.000Z" }
```

---

## 10. Aggregation Status

### `GET /api/analytics/aggregation/status`

Returns aggregation engine status for debugging.

**Response** (200):
```json
{
  "lastHourlyRun": "2026-07-30T14:05:00.000Z",
  "lastDailyRun": "2026-07-30T00:05:00.000Z",
  "hourlyWindowsPending": 0,
  "hourlyWindowsCompleted": 720,
  "dailyWindowsCompleted": 30,
  "nextScheduledRun": "2026-07-30T15:00:00.000Z"
}
```
