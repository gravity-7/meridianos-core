# Feature Specification: UXF-006 Responsive, Accessible, and Release-Gated Migration Completion

**Feature Branch**: `015-uxf-006-completion`

**Created**: 2026-08-12

**Status**: Draft — implementation may complete autonomous work; release/removal approvals remain explicit gates.

**Input**: Complete the remaining UXF-006 work in `docs/UI-UX-Audit-Revamp-Master-Plan.md` after validating UXF-001 through UXF-005, while preserving the native dashboard ES-module platform, existing API contracts, authorization boundaries, tenant/project scoping, gateway-only metering, public API compatibility, and secret handling.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Operate every workflow responsively and accessibly (Priority: P1)

An operator, administrator, finance user, or support user can use the local and cloud dashboard on desktop, tablet, and narrow mobile viewports, using keyboard-only navigation or assistive technology, without losing context, focus, controls, or data.

**Why this priority**: Responsive and accessible behavior is a release prerequisite for every already-delivered UXF workflow and prevents the migration from creating a two-tier product.

**Independent Test**: Run the route/state matrix at 1440×900, 1280×800, 1024×768, 768×1024, 480×800, 390×844, and 320×568 in light/dark, reduced-motion, forced-colors, and 200% zoom modes; complete navigation, search, filters, tables, dialogs, drawers, actions, cloud login, machine review, and policy preview with keyboard and recorded manual AT checks.

**Acceptance Scenarios**:

1. **Given** a user opens any supported local or cloud destination at a target viewport, **when** the route loads, **then** the current route, primary action, status/error state, and all required controls remain visible and there is no horizontal overflow or overlapping content.
2. **Given** a keyboard or screen-reader user opens a palette, dialog, drawer, table action, or policy preview, **when** the user completes or cancels the interaction, **then** focus is visible, trapped only where appropriate, restored to the invoker, and the outcome is announced without relying on color or animation.
3. **Given** a user changes route, scope, theme, zoom, motion preference, or forced-colors mode, **when** the view re-renders, **then** tenant/project scope and unsaved local edits are not silently discarded and no secret enters URL, history, DOM, logs, or telemetry.

---

### User Story 2 - Find authorized records and observe live status safely (Priority: P1)

An authorized user can open a global search/command palette, find permitted tasks, runs, providers, machines, and routes, execute only safe permitted commands, and receive status/alert updates with reconnect and polling fallback.

**Why this priority**: Known-item access and trustworthy status are the shortest paths from an operational signal to a safe action.

**Independent Test**: Use `Ctrl/Cmd+K` to search in-scope and out-of-scope entities as admin, operator, viewer, and foreign-tenant fixtures; assert safe results, route navigation, empty/error states, command authorization, SSE reconnect/cursor behavior, and polling fallback after repeated failures.

**Acceptance Scenarios**:

1. **Given** an authenticated user searches for a known entity or route, **when** results are returned, **then** only authorized tenant/project-scoped results and commands appear, keyboard selection opens a durable route, and the result count/status is announced.
2. **Given** the search API receives a malformed, cross-tenant, unauthorized, or rate-limited request, **when** it responds, **then** it returns a safe stable error without disclosing resource existence or raw query content to telemetry.
3. **Given** realtime status/alert streaming is enabled, **when** the connection disconnects, resumes with a cursor, receives an out-of-order event, or exceeds the retry threshold, **then** the client deduplicates events, shows connection state, refreshes safely, and retains polling/manual refresh fallback.

---

### User Story 3 - Trust measurable performance and regression gates (Priority: P1)

Support, QA, and release users can run one documented validation workflow that proves browser, viewport, visual, accessibility, performance, API compatibility, security, and secret-safety expectations before a release candidate is accepted.

**Why this priority**: A migration is not complete when behavior is merely present; it must be enforceable against regressions.

**Independent Test**: Run the focused UXF-006 gate and full suite; inspect exact commands, counts, timings, and artifacts for local/cloud routes, supported browsers, visual baselines, accessibility, performance budgets, authorization-negative paths, secret scans, and SSE fallback.

**Acceptance Scenarios**:

1. **Given** a release candidate exceeds a visual, accessibility, or performance budget, **when** CI evaluates the artifact, **then** the required check fails with a reproducible artifact and does not silently accept the regression.
2. **Given** a release candidate passes all automated checks, **when** manual NVDA/VoiceOver, keyboard, zoom, and forced-colors evidence is recorded, **then** the evidence identifies the environment, route/state, result, and any unresolved approval rather than claiming unsupported coverage.
3. **Given** an existing `/api/*`, `/api/v1/*`, authorization, tenant-scope, or gateway-metering contract is exercised, **when** the migrated dashboard calls it, **then** the response and security boundary remain compatible and no LLM traffic bypasses the gateway.

---

### User Story 4 - Migrate cloud and legacy surfaces with evidence (Priority: P1)

A release owner can compare local/cloud and legacy/new behavior, roll back a flagged route, and determine whether a legacy module is eligible for retirement from a durable parity record.

**Why this priority**: Cloud divergence and premature legacy deletion are the highest-risk remaining migration failures.

**Independent Test**: Walk the parity ledger from every legacy panel/module to target route, owner, acceptance evidence, flag, removal gate, and rollback asset; run the cloud login/machine/policy-preview journey; execute the rollback drill; verify no legacy code is removed while any gate is incomplete.

**Acceptance Scenarios**:

1. **Given** a cloud user logs in and reviews machines or previews a policy change, **when** the user narrows the viewport or encounters a partial/degraded result, **then** the shell, terminology, scope, safe confirmation, per-target outcome, and recovery behavior remain consistent with the local product.
2. **Given** a legacy module has a candidate target route, **when** parity evidence or usage telemetry is missing, **then** the ledger marks removal blocked and the legacy route/module remains available.
3. **Given** an approved canary experiences a regression, **when** the rollback drill runs, **then** the feature flag disables the migrated route, the versioned legacy asset is restorable, support instructions are available, and no API contract is removed.

---

### User Story 5 - Support rollout with privacy-safe evidence (Priority: P2)

Product, support, and release users can explain what shipped, how to validate it, how telemetry is limited, and how to recover without exposing prompts, credentials, API keys, webhook secrets, or raw request content.

**Why this priority**: Operational readiness and privacy evidence are required before broad enablement, even when implementation is complete.

**Independent Test**: Follow the UXF-006 quickstart and support runbook from a clean checkout, inspect the event allowlist and secret-negative tests, review the changelog/migration guide, and confirm unresolved human approvals are visible.

**Acceptance Scenarios**:

1. **Given** a route, action, search, or legacy-use event is recorded, **when** telemetry is inspected, **then** it contains only route, pseudonymous scope, role, feature flag, duration, and outcome.
2. **Given** an operator follows the migration or rollback guide, **when** a route is unavailable or a parity gate fails, **then** the guide names the safe fallback, owner, evidence location, and escalation path.
3. **Given** a release gate requires product, accessibility, security, or release approval, **when** the evidence is incomplete, **then** documentation marks it unresolved and does not represent it as complete.

### Edge Cases

- A user opens a deep route at 320 px and 200% zoom while a realtime reconnect or mutation is pending.
- Forced-colors removes chart/status colors, reduced motion is enabled, or a browser lacks `EventSource`.
- Search returns duplicate entities, stale results, malformed query input, a revoked scope, or a command whose authorization changed between display and execution.
- SSE resumes from an evicted cursor, receives a reset, hits capacity, loses the network, or reconnects after a tenant/project scope change.
- A cloud policy preview affects zero, one, or many machines, partially fails, or becomes unauthorized before confirmation.
- A visual baseline is intentionally changed, a performance budget lacks reference hardware, or an AT environment is unavailable.
- Legacy usage is below the proposed threshold for one release but not two consecutive release candidates, or rollback assets are missing or untested.
- Telemetry receives a secret-shaped value, raw query, prompt, request body, diagnostic stack, or webhook payload.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-601**: The system MUST provide responsive local and cloud behavior at 1440×900, 1280×800, 1024×768, 768×1024, 480×800, 390×844, and 320×568, including no horizontal overflow, usable touch targets, stable tables/charts, mobile navigation, and visible recovery states.
- **FR-602**: The system MUST support WCAG 2.2 AA-oriented semantic structure, keyboard-only operation, visible focus, focus restoration/trapping rules, reduced motion, forced colors, 200% zoom, accessible chart alternatives, and documented manual NVDA/VoiceOver evidence where feasible.
- **FR-603**: The system MUST enforce browser, visual-regression, accessibility, performance, API-contract, authorization-negative, cross-tenant, secret-leak, SSE reconnect, and compatibility gates in CI or clearly mark unavailable external/manual gates as unresolved.
- **FR-604**: The system MUST preserve existing `/api/*`, `/api/v1/*`, authorization boundaries, tenant/project scoping, gateway-only LLM metering, public API behavior, legacy route compatibility, and secret handling while UXF routes coexist.
- **FR-605**: The system MUST provide a permission-aware global search/command palette for authorized routes and entities, with a server-side authorization decision, safe errors, durable route navigation, keyboard interaction, and negative cross-tenant tests.
- **FR-606**: The system MUST retain the existing status/alert SSE pilot with scoped events, ordered cursor resume, reconnect state, capacity/error handling, polling fallback, manual refresh, and browser evidence; streaming MUST remain opt-in where policy or environment does not support it.
- **FR-607**: The system MUST align the cloud dashboard shell, terminology, responsive states, accessibility behavior, login/machine views, policy-impact preview, safe confirmation, partial outcomes, and recovery documentation without weakening cloud authorization.
- **FR-608**: The system MUST maintain a durable legacy-parity ledger mapping every legacy panel/module to target route, owner, evidence, feature flag, removal gate, and rollback asset, plus migration, support, changelog, canary, and rollback documentation.
- **FR-609**: The system MUST emit only privacy-safe UXF telemetry containing route, pseudonymous tenant/project scope, role, feature flag, duration, and outcome; it MUST reject or redact prompts, credentials, API keys, webhook secrets, raw request content, raw search queries, and diagnostic bodies.
- **FR-610**: The system MUST block legacy removal until parity evidence, regression coverage, legacy usage below the human-approved threshold for the required release window, retained/restorable rollback assets, and recorded human approval all exist. No implementation task may convert an absent approval into a pass.
- **FR-611**: The system MUST preserve the established native ES-module dashboard platform and zero-dependency philosophy for UXF-006. No React, TypeScript, component library, or additional runtime dependency may be introduced by this feature.

### Key Entities

- **Search result**: A permission-filtered route or entity projection with type, stable identifier, display label, scope, destination, and safe command metadata.
- **UXF telemetry event**: An allowlisted event with name, route, pseudonymous scope, role, feature flag, duration, outcome, and timestamp; no content or secrets.
- **Parity ledger entry**: A legacy panel/module, target route, owner, evidence links, feature flag, usage metric, removal gate, rollback asset, status, and approval record.
- **Release gate evidence**: A command, environment, result, count/timing, artifact path, threshold, and reviewer/approval status.
- **Cloud policy preview**: A scoped, non-mutating summary of affected machines, changes, risks, confirmation requirements, and rollback boundary.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-601**: All seven target viewports complete the automated responsive and keyboard route matrix with zero horizontal-overflow failures and zero blocking accessibility violations on migrated local/cloud routes.
- **SC-602**: CI enforces initial shell/critical JS ≤220 KB gzip, local route LCP p75 ≤2.5 s, cloud route LCP p75 ≤3.5 s, interaction p95 ≤100 ms after data arrival, 1,000-row filter/sort ≤100 ms, 2,000-point chart render ≤500 ms, summary refresh-to-render p95 ≤1 s, and no initial interaction long task >200 ms, or records an approved exception.
- **SC-603**: 100% of tested search results and commands are filtered by server-side authorization and tenant/project scope; negative tests produce no cross-tenant disclosure.
- **SC-604**: 100% of realtime reconnect tests either resume safely from a cursor or visibly enter polling/manual-refresh fallback without silent stale-state claims.
- **SC-605**: 100% of parity-ledger entries have target, owner, evidence, flag, removal gate, and rollback-asset fields populated; entries with unresolved evidence remain blocked from removal.
- **SC-606**: Secret-negative tests find zero prompts, credentials, API keys, webhook secrets, raw request content, or raw search queries in UXF telemetry, URLs, browser history, DOM-after-close, audit records, logs, or error responses.
- **SC-607**: The UXF-006 quickstart records exact validation commands, counts, timings, browser/viewport/AT evidence, visual/performance artifacts, compatibility/security results, telemetry privacy results, parity status, rollback evidence, and unresolved approvals.
- **SC-608**: Two consecutive release-candidate records show all blocking automated gates green before any legacy removal approval is eligible; this criterion remains unresolved until those records exist.

## Assumptions and approval gates

- Existing route/API/auth contracts are authoritative; UXF-006 adds compatible surfaces and test/docs evidence rather than replacing contracts.
- The native browser ES-module platform is the approved implementation baseline for this feature; the earlier React recommendation in the master plan is superseded for UXF-006 unless a separately approved ADR changes it.
- Search indexing is bounded to safe projections of existing scoped records; raw prompts, content, credentials, and request bodies are never indexed.
- SSE remains opt-in and polling remains the compatibility fallback; cloud streaming is not assumed until its auth/scope contract is approved.
- Product/UX, accessibility, security, backend, frontend, QA, documentation, and release owners; final IA/terminology/scorecard research; legacy threshold; accessibility/performance exception authority; canary cohort; and two release-candidate approvals are external human gates and are not claimed complete by implementation.
- Legacy code and routes remain until FR-610 evidence is present. The feature can deliver all autonomous gates and documentation while explicitly leaving those external gates open.
