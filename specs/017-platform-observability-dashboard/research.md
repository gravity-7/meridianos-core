# Research: Platform Observability Dashboard & Legacy-Parity Polish

## Decision 1: Compose the new board from canonical operational data

- **Decision**: The root board consumes the existing scoped overview, gateway, usage, cost, alert, task, and run read models. It does not query legacy DOM state or create a second metering path.
- **Rationale**: Existing Spec 013 contracts already define scope, freshness, chart/table parity, drill-downs, and gateway-ledger semantics. Reusing them avoids conflicting totals and preserves authorization.
- **Alternatives considered**: Rebuild the legacy dashboard wholesale; rejected because it would reproduce duplicate data paths and delay the new platform migration.

## Decision 2: Treat the supplied Grafana references as normative visual acceptance

- **Decision**: Match the supplied references’ dense dark panel grid, compact KPI/stat cards, graph/gauge/bar-gauge/table/heatmap/list families, muted secondary text, vivid semantic series, and persistent icon-first left navigation rail using MeridianOS-owned labels, colors, markup, and copy.
- **Rationale**: The Founder made the attached visual hierarchy and navigation model a hard acceptance requirement. This is a visual implementation target, not a request to copy Grafana identity or proprietary assets.
- **Alternatives considered**: Keep the current sparse card layout; rejected because it fails the requested visual bar. Add Grafana as a runtime service; rejected by loopback-only scope, zero-dependency policy, and unnecessary operational complexity.

## Decision 3: Mobile-first native responsive CSS by default

- **Decision**: Extend existing platform CSS with layout tokens and breakpoints that prioritize 320px touch/keyboard use, then enhance for wide screens. “Bootstrapped” means ready for mobile, not adding Bootstrap.
- **Rationale**: The project has a native CSS design system and no runtime component framework. Native CSS keeps the bundle understandable and preserves existing accessibility behavior. This is an architecture choice, not a performance-only decision.
- **Alternatives considered**: Add Bootstrap or a component library; rejected for now because it introduces a second styling/runtime model and is not required to meet the stated user outcomes. If implementation proves a concrete requirement cannot be met natively, the plan will be amended with a narrow dependency justification before adding one.

## Decision 4: Theme preference is presentation-only

- **Decision**: Support `system`, `light`, and `dark`; System follows the device preference, explicit modes persist locally, and all semantic states use text/icons/borders in addition to color.
- **Rationale**: Theme selection should be stable across navigation and reloads without entering policy or authorization configuration.
- **Alternatives considered**: Server-side theme account setting; rejected because this local product surface already has a browser presentation preference and no need to alter tenant data.

## Decision 5: Synthetic telemetry is fixture-only

- **Decision**: Add deterministic fictional ledger/alert/work samples only to explicit disposable onboarding/client-demo fixtures. A regular dashboard reads actual data and displays honest empty states.
- **Rationale**: Demo storytelling needs populated trends, but fabricated telemetry in a normal installation would be misleading and unsafe.
- **Alternatives considered**: Seed the application database on every startup; rejected because it would pollute real/local installations and violate data truthfulness.

## Decision 6: Legacy parity is an inventory and migration contract

- **Decision**: Maintain a checked-in parity inventory with disposition for every in-scope legacy operational/analytics capability; retain `/legacy` until the new counterpart is tested.
- **Rationale**: “Parity” must be auditable and cannot rely on visual memory or an unbounded rewrite.
- **Alternatives considered**: Delete legacy panels after the new overview appears; rejected because rollback and compatibility remain required.

## Decision 7: Use the circled meter for threshold metrics

- **Decision**: Cost, tokens, budget consumption, and comparable threshold metrics use the supplied circled/semicircular meter with a prominent central value, unit, label, threshold/status text, and accessible numeric equivalent. Green/amber/red segments communicate thresholds only as a supplement to text and numeric values.
- **Rationale**: The Founder identified this meter as a required visual primitive for the new dashboard rather than a decorative optional chart.
- **Alternatives considered**: Use plain KPI cards for cost and tokens; rejected because they fail the supplied visual reference and make threshold status less scannable.
