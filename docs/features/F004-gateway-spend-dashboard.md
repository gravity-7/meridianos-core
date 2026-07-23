# F004 – Gateway Spend Dashboard v0.1

**Feature ID:** F004
**Area:** Gateway
**Wedge:** Governance Gateway (Wedge 1)
**Status:** Proposed
**Priority:** P1 — Core Product
**Estimated Effort:** 2 days
**Assigned To:** builder (DeepSeek V4 Pro via gateway)
**Dependencies:** F002 (gateway published), F006 (ADO pulls this feature)
**Blocks:** F009 (demo uses real dashboard data)

---

## Business Context

### Problem
The gateway ledger (`.ai/gateway/ledger.db`) contains rich, queryable data: every LLM call metered, cost per call, enforcement decisions, per-agent breakdowns. But accessing it requires running SQL queries. Prospects and users need a visual dashboard showing: what's being spent, by whom, on which models, and where caps are firing.

### Why This Matters
- **The demo:** When you show a prospect the dashboard, they see their OWN data, in real-time, with per-feature cost. This is the "wow" moment.
- **Self-serve:** Users who install `npx meridian-gateway` get a dashboard at `localhost:4317` showing their spend. No setup required.
- **Dogfood:** The dashboard runs against mos-dev's OWN ledger — showing real cost data from the features being built.

### Success Criteria
1. A web UI at `localhost:4317` shows: total spend, per-agent breakdown, per-model usage, deny events timeline
2. Data refreshes automatically (polling or WebSocket)
3. Works against any gateway ledger SQLite file
4. Zero configuration — boots alongside the gateway

---

## Functional Requirements

### FR1: Spend Overview
The dashboard SHALL display:
- **Total spend:** Sum of `cost_usd` across all events, formatted as USD
- **Total tokens:** Sum of `total_tokens` across all events
- **Call count:** Total number of metered calls
- **Deny count:** Number of enforced denials
- **Active agents:** Distinct agent names seen in the ledger

### FR2: Per-Agent Breakdown
A table or chart SHALL show per-agent:
- Agent name
- Call count
- Token usage (input/output)
- Cost in USD
- Deny count
- Last activity timestamp

### FR3: Per-Model Usage
A chart SHALL show token distribution by model/provider:
- Provider name + model name
- Token count per model
- Cost per model
- Percentage of total spend

### FR4: Deny Events Timeline
A list or timeline SHALL show recent deny events:
- Timestamp
- Agent name
- Cap window (5h/week)
- Request ID (for debugging)

### FR5: Auto-Refresh
The dashboard SHALL refresh data every 10 seconds (configurable) by re-querying the ledger.

### FR6: Zero-Config Boot
When the gateway boots (via `npx meridian-gateway` or the daemon), the dashboard SHALL be available at the configured port with no additional setup. It SHALL reuse the existing `dashboard/` directory pattern already in the repo.

---

## Technical Requirements

### TR1: Architecture
- **Backend:** Lightweight HTTP server serving dashboard HTML + JSON API endpoints. Already exists in `dashboard/server.mjs` — extend it.
- **Frontend:** Single HTML page with vanilla JS (no framework). Fetch API for data. Simple CSS grid for layout.
- **Data source:** Direct SQLite queries against the gateway ledger (`.ai/gateway/ledger.db`).

### TR2: API Endpoints
The dashboard server SHALL expose:
```
GET /api/summary          → { totalCost, totalTokens, totalCalls, denyCount, activeAgents }
GET /api/agents           → [{ agent, calls, inputTokens, outputTokens, costUsd, denyCount, lastSeen }]
GET /api/models           → [{ provider, model, calls, inputTokens, outputTokens, costUsd }]
GET /api/denials          → [{ ts, agent, capWindow, requestId }]
GET /api/events?limit=50  → [{ ts, agent, provider, model, costUsd, enforcementDecision, ... }]
```

### TR3: Ledger Queries
All data queries SHALL use the existing ledger API:
- `queryWindow()` for aggregated spend windows
- `listEvents()` for recent event lists
- Direct SQL for model/agent breakdowns (using `ledger.prepare().all()`)

### TR4: Existing Dashboard Integration
The `dashboard/` directory already contains:
- `server.mjs` — HTTP server for the control dashboard
- `index.html` — existing dashboard UI
- `actions.mjs` — action handlers

This feature SHALL extend the existing dashboard rather than creating a parallel one. Add new API endpoints and a new "Gateway" tab/section in the existing UI.

### TR5: Styling
- Clean, modern design using the existing dashboard aesthetic
- Responsive layout (works on desktop; tablet is nice-to-have)
- Dark mode support preferred (developer tooling)
- Color coding: green (under budget), yellow (warning), red (deny/capped)

---

## Database Changes

**None.** All data comes from the existing gateway ledger schema (`gateway/ledger-schema.sql`). Read-only queries.

---

## Security

- **Local-only by default:** Dashboard binds to `127.0.0.1` (not `0.0.0.0`) — accessible only from the local machine
- **No authentication (v0.1):** Local access only. Auth added in a future version for remote access
- **Read-only:** Dashboard only queries the ledger. Never writes, never modifies

---

## Testing

- Unit tests for each API endpoint with a test ledger (in-memory SQLite)
- Verify JSON response shapes match the API contract
- Verify dashboard HTML loads without errors
- Verify auto-refresh works (mock timers)

---

## Acceptance Criteria

1. ✅ `GET /api/summary` returns correct totals from a test ledger
2. ✅ Dashboard HTML renders at `localhost:4317` with spend overview
3. ✅ Per-agent breakdown table shows correct data
4. ✅ Deny events are listed in reverse chronological order
5. ✅ Auto-refresh updates data every 10 seconds
6. ✅ Dashboard boots automatically with `npx meridian-gateway`
7. ✅ Zero errors in browser console

---

## AI Implementation Guidance

### Files to Modify
- `dashboard/server.mjs` — add `/api/summary`, `/api/agents`, `/api/models`, `/api/denials` endpoints
- `dashboard/index.html` — add Gateway tab/section with charts and tables
- `gateway/index.mjs` — wire dashboard start into `assembleGateway` (or keep separate; boot alongside)

### Key Modules
- Use `gateway/ledger.mjs`'s `queryWindow` and `listEvents` for all data
- Use `pricing.mjs`'s `costFor` only if needed (cost_usd is already in the ledger)
- Existing `dashboard/server.mjs` pattern for HTTP endpoints

### Do NOT
- Add any new npm dependencies (vanilla JS only)
- Modify the ledger schema
- Expose the dashboard on `0.0.0.0` (security risk in v0.1)

---

*Feature spec version: 1.0 | Created: 2026-07-19 | Author: GitHub Copilot*
