# F004 – Gateway Spend Dashboard v0.1 Specification & Design

**Feature ID:** F004  
**Area:** Gateway / Dashboard  
**Wedge:** Governance Gateway (Wedge 1)  
**Status:** Ready for Implementation  
**Priority:** P1 — Core Product  
**Assigned To:** builder (DeepSeek V4 Pro via gateway) / antigravity  

---

## 1. Executive Summary & Business Context

### 1.1 Problem Statement
The MeridianOS Gateway sidecar (`gateway/index.mjs`) meters every LLM provider request inline into `.ai/gateway/ledger.db`. The ledger stores granular usage, latency, cost estimates, and budget enforcement verdicts (`allow`, `warn`, `deny`). However, inspecting spend currently requires SQL queries. Fleet operators and users need a zero-configuration visual dashboard showing real-time spend, agent consumption, model distribution, and denial trip-wires.

### 1.2 Solution Overview
Extend the existing AIOS Control Dashboard (`dashboard/server.mjs` and `dashboard/index.html`) at `localhost:4317` with a dedicated **Gateway Spend Dashboard** section. The backend exposes REST API endpoints querying `ledger.db` directly, while the frontend provides a rich, responsive interface with auto-refresh every 10 seconds.

---

## 2. Architecture & Backend Data Specifications

### 2.1 Ledger Data Source
- **Database Path:** Defaults to `.ai/gateway/ledger.db` (configurable via `openLedger(path, { config })`).
- **Table:** `token_events` (schema in `gateway/ledger-schema.sql`).
- **Null Safety Contract:** Unknown usage or costs remain `null` in DB aggregations; missing costs are never fabricated as `$0.00`.

### 2.2 API Endpoint Contracts

#### 1. `GET /api/summary`
Returns high-level aggregate spend metrics.
```json
{
  "totalCost": 42.50,
  "totalTokens": 1250000,
  "totalCalls": 340,
  "denyCount": 3,
  "activeAgents": 2
}
```

#### 2. `GET /api/agents`
Returns spend and activity breakdown per agent name.
```json
[
  {
    "agent": "claude",
    "calls": 210,
    "inputTokens": 800000,
    "outputTokens": 200000,
    "costUsd": 31.20,
    "denyCount": 1,
    "lastSeen": "2026-07-21T01:15:00.000Z"
  }
]
```

#### 3. `GET /api/models`
Returns usage and cost breakdown grouped by provider and model.
```json
[
  {
    "provider": "deepseek",
    "model": "deepseek-chat",
    "calls": 180,
    "inputTokens": 600000,
    "outputTokens": 150000,
    "costUsd": 11.30,
    "percentage": 26.58
  }
]
```

#### 4. `GET /api/denials`
Returns the 50 most recent budget enforcement denial events (newest first).
```json
[
  {
    "id": "evt-12345",
    "ts": "2026-07-21T01:10:00.000Z",
    "agent": "antigravity",
    "provider": "anthropic",
    "model": "claude-sonnet-5",
    "capWindow": "5h",
    "requestId": "req-999"
  }
]
```

#### 5. `GET /api/events?limit=50`
Returns raw metered events list for detailed audit inspection.
```json
[
  {
    "id": "evt-12346",
    "ts": "2026-07-21T01:28:00.000Z",
    "agent": "builder",
    "provider": "deepseek",
    "model": "deepseek-chat",
    "inputTokens": 12000,
    "outputTokens": 450,
    "totalTokens": 12450,
    "costUsd": 0.045,
    "enforcementDecision": "allow",
    "latencyMs": 1420
  }
]
```

---

## 3. UI/UX & Frontend Design System

### 3.1 Design Tokens
Reuses the established dashboard CSS custom properties for dark/light mode compatibility:
- `--surface-0`, `--surface-1`, `--surface-2`: Background layers
- `--text-primary`, `--text-secondary`, `--text-muted`: Typography hierarchy
- `--border`, `--border-strong`: Subtle dividers
- `--bg-success`, `--text-success` (`#16a34a` / `#4ade80`): Normal / Under Budget
- `--bg-warning`, `--text-warning` (`#d97706` / `#fbbf24`): Cap Warnings
- `--bg-danger`, `--text-danger` (`#dc2626` / `#f87171`): Capped / Denied

### 3.2 Component Hierarchy
1. **`GatewaySpendCard` (Main Container)**
   - Header with Live Refresh Indicator (10s countdown) and Manual Refresh trigger.
   - **Summary Tiles Grid (`#gatewaySummaryGrid`)**: 5 metric cards.
   - **Split View (`grid-template-columns: 1fr 1fr`)**:
     - **Left Column: Per-Agent Spend (`#gatewayAgentTable`)**
     - **Right Column: Model Distribution (`#gatewayModelList`)**
   - **Denial Events Timeline (`#gatewayDenialList`)**: Policy trip-wires alert box.
   - **Recent Token Events Log (`#gatewayEventsTable`)**: Audit trail.

### 3.3 Responsive Behavior
- **Desktop (>= 1024px):** 2-column grid layout for charts/tables, 5-column metric row.
- **Tablet (768px - 1023px):** 2-column metric cards, stacked tables.
- **Mobile (< 768px):** Single-column vertical layout, overflow-x scroll for tables with touch scrolling.

---

## 4. Acceptance Criteria & Test Plan

1. **`GET /api/summary`**: Returns accurate total spend, tokens, calls, denials, and active agents.
2. **`GET /api/agents`**: Returns per-agent statistics sorted by spend.
3. **`GET /api/models`**: Returns provider/model usage with correct percentage distribution.
4. **`GET /api/denials`**: Returns recent denial events sorted newest first.
5. **Dashboard Rendering**: Section renders cleanly inside `index.html` at `localhost:4317`.
6. **Auto-Refresh**: Polls endpoints every 10 seconds without UI flicker.
7. **Zero-Config**: Boots automatically when running dashboard server against any valid `ledger.db`.
