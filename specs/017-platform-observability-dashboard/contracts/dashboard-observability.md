# Contract: Dashboard Observability Board

## Root board

The platform root (`/`) presents one scoped operational board. It must not expose `/cloud/dashboard/index.html` as a live route. `/legacy` and `/index.html` remain available as the retained dashboard fallback.

The root board must include these labelled regions when their source data is available:

1. Scope controls and refresh/realtime status.
2. Attention queue.
3. Gateway/service health.
4. Active/queued and failed/blocked work.
5. Spend/budget snapshot.
6. Request/error/latency/token/cost trend panels.
7. Top drivers/recent operational evidence where supported.

## Widget state contract

Every region renders one of: loading, ready, empty, partial, stale, unavailable, or error. A state includes plain-language status, source freshness when known, the current scope, and a recovery action or explanation when recovery is possible.

## Chart contract

Each chart exposes:

- title and metric meaning;
- unit and aggregation;
- exact half-open UTC interval and compatible filters;
- freshness;
- a visual enhancement when data exists;
- an equivalent accessible table/text summary with identical visible values and drill-down links;
- a bounded-point or empty-data explanation.

## Theme contract

The theme control exposes exactly `System`, `Light`, and `Dark`. System follows the device preference; explicit modes persist across route changes and reloads. Focus, selected, warning, critical, disabled, loading, empty, and error states remain distinguishable without color alone.

## Scope and navigation contract

Changing scope updates the URL and every compatible widget. Drill-down, export, refresh, browser Back, and browser Forward preserve compatible scope. Late responses cannot overwrite a newer scope.

## Synthetic-demo contract

Only explicit isolated fixtures may return the deterministic demo telemetry set. Fixture responses carry a synthetic/disposable label. Normal installations never receive fixture records. Any attempted non-loopback, provider, payment, email, or key-shaped input is rejected and redacted from visible output/evidence.

## Parity contract

`docs/` or `specs/017-platform-observability-dashboard/` must contain the parity inventory. Each in-scope legacy capability has exactly one disposition and supporting evidence before the feature is considered converged. `/legacy` is the fallback while any required disposition remains unverified.
