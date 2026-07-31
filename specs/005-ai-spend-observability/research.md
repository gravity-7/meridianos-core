# Research: AI Spend Observability

**Feature**: P5 — AI Spend Observability | **Date**: 2026-07-30

## Research Questions & Decisions

### R1: Aggregation Strategy — How to implement hourly/daily rollups efficiently?

**Decision**: SQLite `INSERT OR REPLACE` with composite window keys. Hourly aggregation runs as a background timer in `scheduler.mjs` (default: every 60 minutes). Daily aggregation runs immediately after hourly when a full day is complete. Both use the same idempotent upsert pattern.

**Rationale**:
- SQLite with WAL mode handles concurrent read/write well. The aggregation writes are small (a few hundred rows per hour for typical usage) — well within SQLite's capabilities.
- `INSERT OR REPLACE` provides natural idempotency: re-running on the same window is a no-op with identical results.
- Hourly aggregation at the daemon level reuses the existing scheduler loop pattern (already runs cadence checks, provider health, etc.). Adding one more timer is trivial.
- Single DB (`ledger.db`) means analytics queries can JOIN raw events and aggregated summaries in one query — no cross-DB complexity.

**Alternatives considered**:
- Separate analytics DB: Rejected. Adds deployment complexity (two DB files), prevents atomic cross-table queries.
- In-memory aggregation + periodic flush: Rejected. Risk of data loss on crash. Ledger is the durable source of truth.
- Real-time aggregation (per-event): Rejected. Adds latency to every API call. Hourly batching is sufficient for analytics use cases.

---

### R2: Dashboard Charting — How to render time-series and breakdown charts without framework dependencies?

**Decision**: HTML5 Canvas 2D API with vanilla JavaScript. Build three reusable chart types:
1. **LineChart** — for spend-over-time time series
2. **BarChart** — for provider/model/agent breakdowns
3. **DonutChart** — for proportional breakdowns (provider share of total)

Each chart is a self-contained ES module class that accepts a `<canvas>` element + data array and renders declaratively.

**Rationale**:
- Canvas 2D API is built into every modern browser — zero dependencies.
- The existing dashboard SPA is 87KB of vanilla JS. Adding ~5KB of chart rendering code is a negligible increase.
- Canvas handles thousands of data points efficiently (unlike SVG which creates DOM nodes per element).
- Tooltips and hover interactions can be implemented with Canvas mouse event listeners — no library needed.
- The chart types needed (line, bar, donut) are the simplest Canvas primitives.

**Alternatives considered**:
- Chart.js / D3.js / lightweight-charts: Rejected. All are npm dependencies, violating zero-dependency philosophy.
- SVG-based charts: Rejected for performance. Canvas is faster for large datasets.
- Server-side rendered charts (return PNG): Rejected. Adds server load; loses interactivity (hover, click drill-down).

---

### R3: SMTP Email Delivery — How to send emails without an npm SMTP library?

**Decision**: Implement a minimal SMTP client in `smtp-mailer.mjs` using `node:tls` for secure connections. Support AUTH LOGIN (most common SMTP auth) and PLAIN. Format emails as multipart MIME (text/plain + text/html).

**Rationale**:
- SMTP is a simple text-based protocol (RFC 5321). The conversation is: EHLO → AUTH → MAIL FROM → RCPT TO → DATA → QUIT. ~200 lines of code.
- `node:tls` provides `tls.connect()` which handles TLS handshake natively — no dependency needed.
- AUTH LOGIN is base64-encoded username/password — implementable with `Buffer.from(str).toString('base64')`.
- MIME multipart formatting is straightforward string templating with boundary separators.
- Most operators will use an SMTP relay (SendGrid, AWS SES, Gmail SMTP) — not a full mail server. The client only needs to connect, authenticate, and send.

**Alternatives considered**:
- nodemailer npm package: Rejected. Violates zero-dependency philosophy.
- Sendmail binary (`node:child_process`): Rejected. Not available on Windows; inconsistent across platforms.
- Third-party HTTP API (SendGrid REST): Rejected. Adds service dependency; operator must have their own email infra.

---

### R4: Spend Pause Mechanism — How to block all LLM traffic instantly and persist across restarts?

**Decision**: A `spend_pause_state` table in the gateway ledger with a single row (`is_paused BOOLEAN, paused_at TEXT, paused_by TEXT, reason TEXT`). Gateway `handleRequest()` checks this flag at the top of every request before any LLM call. Dashboard toggles it via a new `POST /api/spend-pause` endpoint. Scheduler sets/un-sets via direct DB write.

**Rationale**:
- Single-row table read is O(1) with SQLite — effectively free.
- Persisted across restarts: the flag survives daemon crashes/restarts.
- Check is at the gateway entry point, before any provider dispatch, wire translation, or budget check — minimal overhead.
- No inter-process communication needed: dashboard, scheduler, and gateway all share the same `ledger.db` file.
- The check returns a standard HTTP 503 with a clear JSON body `{ "error": "Spend is paused", "pausedAt": "..." }` — callers (agents, IDEs) can surface this to users.

**Alternatives considered**:
- In-memory flag: Rejected. Lost on restart — operator would need to re-pause after every daemon restart.
- File-based flag (`.ai/spend-paused`): Rejected. Not atomic; harder to read/write atomically than a SQLite row.
- Config-based flag (`policy.yaml`): Rejected. Too slow (requires config reload). Pause needs to be near-instant.

---

### R5: Budget Forecasting Algorithm — How to project month-end spend?

**Decision**: Linear projection based on trailing 7-day average daily burn rate.
```
dailyBurnRate = SUM(cost) over last 7 days / 7
projectedTotal = spendToDate + (dailyBurnRate * daysRemaining)
```
Status thresholds:
- **on-track**: projectedTotal < 90% of budget
- **at-risk**: projectedTotal between 90% and 100% of budget
- **over-budget**: projectedTotal > 100% of budget

**Rationale**:
- Linear projection is simple, explainable, and sufficient for a 30-day budget window. Operators understand "at this rate, you'll spend $X by month-end."
- 7-day trailing average balances recency (recent changes matter) with stability (not thrown off by a single spike).
- More complex models (exponential smoothing, ARIMA, seasonal decomposition) add significant complexity for marginal accuracy gains on a 30-day horizon.
- Anomaly detection (separate feature) catches sudden spikes — forecasting doesn't need to.

**Alternatives considered**:
- 3-day average: Rejected. Too noisy — a single heavy day skews the projection dramatically.
- 30-day average: Rejected. Too slow to react to recent changes (e.g., onboarding a new expensive model).
- ML-based forecasting: Rejected. Over-engineered for v1. Adds training data dependency and complexity.

---

### R6: Anomaly Detection — How to detect unusual spending patterns?

**Decision**: Z-score based anomaly detection on hourly spend. For each completed hour:
```
zScore = (hourlySpend - trailing7DayHourlyMean) / trailing7DayHourlyStdDev
if zScore > 3.0 → anomaly flagged
```
Anomalies are surfaced in the dashboard and optionally trigger alerts.

**Rationale**:
- 3 standard deviations is a well-established threshold (captures ~0.3% of normal distribution).
- Hourly granularity catches anomalies quickly (SC-005: within 5 minutes of hour completing).
- Computationally cheap: mean and stddev over 168 data points (7 days × 24 hours) — trivial for SQLite.
- No training data or model required. Purely statistical.
- Can be extended later with provider-specific baselines, day-of-week adjustments, etc.

**Alternatives considered**:
- Fixed threshold ($X/hour): Rejected. Not adaptive — a $5/hour spike is normal for some operators, anomalous for others.
- Moving average deviation: Rejected. Less statistically rigorous than z-score.
- ML anomaly detection (isolation forest, autoencoder): Rejected. Over-engineered for v1.

---

### R7: Optimization Engine — How to identify cost-saving model switches?

**Decision**: Heuristic-based comparator. For each task type (grouped by task label/tag), compute:
1. Average cost per task run for each model used
2. Identify models with matching capabilities (from model registry) that have lower per-token pricing
3. Estimate savings: `(currentCostPerTask - candidateCostPerTask) × tasksPerWeek`
4. Rank by estimated weekly savings, filter confidence > 0.5

Capability matching uses the `features` JSON from `model_registry` (vision, tools, streaming, json_mode). A model is a valid replacement only if its features are a superset of the current model's features.

**Rationale**:
- No ML needed. Simple cost comparison with capability filtering.
- Leverages existing model registry from P2 (003-provider-model-agnosticism).
- Confidence score = based on sample size (more task runs = higher confidence) and pricing freshness.
- One-week minimum data requirement prevents recommendations from insufficient data.

**Alternatives considered**:
- Quality-weighted optimization (attempt to measure output quality): Rejected. Requires running eval benchmarks on each model — complex and provider-API-costly.
- Cross-provider recommendations: Deferred to future enhancement. v1 stays within same provider for simplicity.
- Automated model switching (no user approval): Rejected. Too risky — operator should approve cost changes.

---

### R8: CSV Export — How to generate downloadable CSV without dependencies?

**Decision**: Build CSV strings using template literals with proper escaping (quote fields containing commas, quotes, or newlines). Stream large exports via `Readable.from()` to avoid memory pressure.

**Rationale**:
- CSV is a trivial format: comma-separated values with optional quoting. ~30 lines of code.
- Streaming is important for large date ranges (months of data could be thousands of rows).
- The dashboard API endpoint sets `Content-Type: text/csv` and `Content-Disposition: attachment` headers.
- No zip/compression needed — CSV compresses well with HTTP gzip (Node.js built-in).

**Alternatives considered**:
- JSON export: Rejected. Larger file size; less useful for spreadsheet import.
- Excel (.xlsx): Rejected. Would require a library — violates zero-dependency philosophy.
- pdfkit or similar: Rejected. Violates zero-dependency philosophy.

---

### R9: Alert Cooldown — How to prevent alert spam?

**Decision**: Track last-fire timestamps per alert rule in the `alert_state` table. Before dispatching, check if `now - lastFired < cooldownSeconds`. Default cooldown: 1 hour for budget thresholds, 4 hours for optimization recommendations, 1 hour for anomalies. Cooldown is configurable per alert type.

**Rationale**:
- Simple, effective, and understandable. Operators know "I'll get at most one budget alert per hour."
- Persisted in DB so cooldown survives daemon restarts.
- Per-rule granularity means a budget-80% alert doesn't suppress a budget-100% alert.

**Alternatives considered**:
- In-memory Map: Rejected. Lost on restart — could cause alert flood after crash recovery.
- Exponential backoff: Rejected. Unnecessarily complex for v1; fixed cooldown is sufficient.
- Rate limiting at channel level: Rejected. Less granular than per-rule cooldown.

---

### R10: Chart Data Resolution — How much data to send to the dashboard?

**Decision**: Server-side aggregation into bucketed data points. For time-series:
- **Last 24h**: Hourly resolution (~24 points)
- **Last 7 days**: 4-hour resolution (~42 points)
- **Last 30 days**: Daily resolution (~30 points)
- **Last 90 days**: Weekly resolution (~13 points)

The API endpoint auto-selects resolution based on the requested date range to keep response payloads small (<50KB) and rendering fast.

**Rationale**:
- Ensures consistent dashboard performance regardless of ledger size.
- Canvas rendering of >200 points causes visible slowdown on lower-end devices.
- Resolution tiers provide enough detail for each timescale without overwhelming the browser.

**Alternatives considered**:
- Send all raw data and let client downsample: Rejected. Wastes bandwidth and client CPU.
- Fixed 100-point resolution: Rejected. Loses detail at short ranges, wastes points at long ranges.
