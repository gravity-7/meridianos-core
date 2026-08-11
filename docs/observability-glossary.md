# Operational Observability Glossary

UXF-004 operational views use one authorized URL scope. Tenant identity comes from the authenticated or local installation context and is never accepted from a query parameter. `project` and `provider` are optional authorized filters. `from` is inclusive, `to` is exclusive, both are exact UTC timestamps, and the default window is the preceding 24 hours. Presets are resolved to exact timestamps before navigation.

## Metric definitions

| Metric | Unit and definition | Source and missing-data behavior | Drill-down dimensions |
|---|---|---|---|
| Attention now | Ordered alert occurrences | Canonical state-database alerts. Unacknowledged `critical`, then `warning`, then `info`; acknowledged/resolved episodes do not displace open attention. Every item exposes severity text, affected entity, occurrences, last-seen time, and an alert URL. | Alert, task, run |
| Gateway requests | Requests | Count of canonical gateway-ledger events in the exact scope. Zero means no matching events, not an estimate. | Usage record, provider, project, task, run |
| Gateway errors | Requests and percent | Events whose enforcement/outcome indicates failure or denial. Error rate is `errors / requests × 100`; it is `0%` only when request count is zero. | Usage record, provider, project, task, run |
| Gateway latency | Milliseconds | Median and p95 of events with a recorded duration. Events without latency are counted separately and are never treated as zero-duration samples. | Usage record and filtered event table |
| Token usage | Tokens | Sum of recorded token fields for filtered ledger events. Missing/unattributed entity dimensions remain named categories. | Provider, model, agent, task, run |
| Selected-scope spend | USD | Sum of non-null canonical ledger `cost_usd` in the selected `[from,to)` scope. Unknown-cost events are reported separately; no cost is inferred from prompts or provider consoles. | Provider, model, project, task, run, usage record |
| Top cost driver | USD, tokens, requests, share | Largest displayed cost dimension, with deterministic key ordering for ties. Dimension totals reconcile to selected-scope spend within currency rounding, including `Unattributed`. | Provider, model, project, task, run |
| Failed runs | Runs | Retained run records whose typed outcome is `failed` in scope. Run-log retention gaps are disclosed and do not become zero-cost or successful records. | Run, task, alert |
| Blocked tasks | Tasks | Current state-database tasks with status `blocked` in the authorized scope. | Task and related runs/alerts |
| Active agents | Agents | Policy-defined current lease/heartbeat state. Missing heartbeat evidence is not presented as active. | Scoped task list |
| Queued work | Tasks | Current claimable/queued task states under existing scheduler semantics. | Scoped task list |
| Monthly budget | USD | Current configured calendar-month spend and limit. Forecast uses the existing trailing-seven-day rule. This fixed current-period widget is explicitly labelled and does not adopt an arbitrary selected time window; compatible project/provider filters are retained. | Cost evidence |

## Charts and tables

Gateway, usage, and cost series are deterministically aggregated to at most 2,000 points. Each visual states its title, unit, exact scope, aggregation rule, and freshness timestamp. The semantic table is the authoritative accessible representation and is always placed in the DOM; uPlot is an optional visual enhancement over the same bounded rows. If uPlot is missing, the table opens automatically. Each evidence link inherits compatible scope parameters.

`Fresh as of` is the newest source read time, not a promise that every provider has reported. `Unknown`, `Unattributed`, empty, partial, and retained-evidence states are deliberate values and must not be converted to zero or hidden.

## Durable routes

- Overview: `/app` or `/app/overview`
- Tasks and runs: `/app/operations/tasks`, `/app/operations/tasks/:taskId`, `/app/operations/runs`, `/app/operations/runs/:runId`
- Alerts and audit: `/app/observability/alerts`, `/app/observability/alerts/:alertId`, `/app/observability/audit/:auditId`
- Gateway and finance: `/app/observability/gateway`, `/app/observability/cost`, `/app/observability/usage`

URLs preserve exact compatible scope through refresh, direct load, and Back/Forward. A durable URL never expands the reader's authorization.
