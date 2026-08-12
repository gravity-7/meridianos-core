# UXF-006 Research and Decisions

## Native platform and dependency boundary

- **Decision**: Keep the existing native ES-module dashboard and cloud pages. Do not add React, TypeScript, Lucide, a component library, or a new browser runner.
- **Rationale**: The user request explicitly requires the established native platform and zero-dependency philosophy. UXF-001–005 already deliver working route modules, primitives, browser jobs, and Electron compatibility. A framework migration would expand scope and invalidate parity evidence.
- **Alternatives considered**: The master plan's earlier React + TypeScript proposal; rejected for this completion feature because it is not necessary to close the identified gaps and conflicts with the current project constraint.

## Search and authorization

- **Decision**: Add a bounded `/api/operations/search` projection backed by existing scoped operational data and a static route/command registry. Derive scope and actor capability on the server; never accept tenant, project, role, or command authority from the search client.
- **Rationale**: Existing operations routes already provide scope parsing, task/run projections, and safe 404 behavior. A small adapter keeps public `/api/v1/*` untouched and avoids a new index or dependency.
- **Alternatives considered**: Full-text indexing and a new search service; rejected because it would retain more content, create a new privacy boundary, and exceed UXF-006's hardening scope.

## Realtime behavior

- **Decision**: Retain the existing opt-in SSE broker/coordinator, cursor replay, heartbeat, event ordering, and three-failure polling fallback. Add browser evidence and documentation rather than replacing polling.
- **Rationale**: The server and unit tests already prove core behavior. The remaining gap is release evidence, privacy, and user-visible fallback assurance.
- **Alternatives considered**: Always-on SSE; rejected because policy-disabled/demo environments and browsers without `EventSource` require polling.

## Responsive and accessibility enforcement

- **Decision**: Extend existing CSS and browser fixtures with native media features (`prefers-reduced-motion`, `forced-colors`, zoom-safe sizing), semantic focus checks, and seven explicit viewport descriptors. Use source/runtime assertions where a full browser host is unavailable.
- **Rationale**: Native CSS is already the platform; deterministic checks can run in current CI without dependency growth.
- **Alternatives considered**: Manual-only review; rejected because it cannot enforce regressions. A new accessibility dependency; rejected because the existing browser tooling and source checks are sufficient for the autonomous portion, while manual AT remains an explicit gate.

## Visual and performance budgets

- **Decision**: Add a gate script that checks available artifacts and produces a fail-closed result for missing/over-budget evidence. CI uploads evidence and runs the gate; baseline changes require review.
- **Rationale**: Existing screenshot jobs upload artifacts but do not compare baselines or enforce the master-plan thresholds. A small native script is reviewable and dependency-free.
- **Alternatives considered**: Introducing a new visual service or benchmark library; rejected by the zero-dependency constraint and because CI-host differences need human baseline approval.

## Telemetry privacy

- **Decision**: Add a UXF-specific allowlist serializer. Only event name, route, pseudonymous scope, role, feature flag, duration, outcome, and timestamp may persist. Unknown keys and secret-shaped values are dropped, not merely redacted in display.
- **Rationale**: Existing telemetry is opt-in/local-only, but feature-specific callers can supply arbitrary details. An allowlist prevents accidental expansion at the boundary.
- **Alternatives considered**: Caller discipline and post-hoc log scrubbing; rejected because secrets can leak before scrubbing and raw queries/content are not needed for the required metrics.

## Legacy migration

- **Decision**: Documentation-first parity ledger and release checklist; no legacy deletion in UXF-006.
- **Rationale**: The master plan requires two release candidates, an approved usage threshold, regression tests, rollback assets, and human sign-off. Those external facts cannot be invented by an implementation agent.
- **Alternatives considered**: Automatic removal after code coverage; rejected because coverage does not prove usage parity, support readiness, or rollback capability.

## Cloud alignment

- **Decision**: Improve the cloud dashboard with shared semantic structure and safe policy preview/confirmation while retaining the current `/api/cloud/*` contracts and bearer token behavior.
- **Rationale**: Cloud is currently a minimal separate page. Additive markup/CSS can close accessibility and responsive gaps without changing control-plane authorization.
- **Alternatives considered**: Route cloud through the local dashboard; rejected because cloud and local auth/data contracts differ and the user requested alignment, not contract replacement.
