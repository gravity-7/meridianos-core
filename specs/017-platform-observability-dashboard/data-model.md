# Data Model: Platform Observability Dashboard & Legacy-Parity Polish

## Operational Dashboard Board

The root board is a projection, not a new persistence table.

| Field | Type | Rules |
|---|---|---|
| `scope` | authorized query scope | URL-owned tenant/project/provider and half-open UTC interval; never broadened by client input |
| `freshAsOf` | timestamp | Source freshness; each partial widget may disclose its own state |
| `attention` | ordered widget data | Critical/open first, then warning/info; empty state is explicit |
| `health` | summary widget | Gateway/service state, requests, errors, error rate, freshness |
| `work` | summary widget | Active agents, queued tasks, failed runs, blocked tasks |
| `cost` | summary widget | Selected-scope spend, unknown cost, current-month budget and forecast |
| `trends` | series map | Requests, error rate, latency, tokens, and cost where source data exists |
| `drilldowns` | labelled targets | Durable route plus canonical entity/metric identifier and compatible scope |

## Dashboard Widget

Every widget has:

- stable `id` and human-readable `title`;
- `kind` (`kpi`, `status`, `trend`, `ranking`, `table`, or `attention`);
- `state` (`loading`, `ready`, `empty`, `partial`, `stale`, `unavailable`, or `error`);
- source freshness and exact scope label;
- accessible summary and, for visual series, equivalent table rows;
- optional labelled drill-down target;
- no secret, raw request, or customer content.

## Trend Series

| Field | Rules |
|---|---|
| `metric` | `requests`, `errors`, `errorRate`, `latencyP50`, `latencyP95`, `tokens`, or `cost` |
| `unit` | Explicit `requests`, `%`, `ms`, `tokens`, or `USD` |
| `points` | Ordered timestamp/value/sample-count rows, bounded to 2,000 rendered points |
| `aggregation` | Disclosed bucket/aggregation from the canonical read model |
| `scope` | Same exact scope as root board; fixed budget period is explicitly separate |
| `freshAsOf` | Source freshness or unavailable disclosure |
| `evidence` | Optional safe durable links per row/driver |

## Appearance Preference

| Field | Values | Rules |
|---|---|---|
| `preference` | `system`, `light`, `dark` | Only these values accepted; invalid/missing values fall back to `system` |
| `effectiveMode` | `light` or `dark` | Derived from preference and device setting |
| `source` | local presentation preference | Never sent as authorization, policy, or secret data |

## Parity Inventory Entry

| Field | Rules |
|---|---|
| `legacyId` | Stable legacy panel/control identifier |
| `purpose` | User-facing operational purpose |
| `newDestination` | Root widget or detailed route, or `retained-legacy` |
| `status` | `planned`, `implemented`, `verified`, `retained`, or `retired` |
| `evidence` | Tests/manual evidence references |
| `retirementReason` | Required only for `retired` |
| `scopeNotes` | Compatibility or fixed-period caveats |

## Synthetic Telemetry Fixture

The fixture consists of deterministic fictional records for machines/health, gateway requests, token/cost events, alerts, tasks/runs, and budget context. It is:

- created under a temporary isolated root;
- explicitly labelled synthetic/disposable in the UI;
- loopback-only and external-request rejecting;
- safe to restart and safe to close after partial startup;
- removed with its database and browser/session residue at teardown.
