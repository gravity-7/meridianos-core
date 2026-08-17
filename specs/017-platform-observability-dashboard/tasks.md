# Tasks: Platform Observability Dashboard & Legacy-Parity Polish

**Input**: Design documents from `specs/017-platform-observability-dashboard/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/dashboard-observability.md`, `quickstart.md`

## Global Constraints

- Node.js 24+ and native ES modules remain the project baseline.
- Gateway remains the single metering path; existing authorization and policy boundaries are unchanged.
- No real provider keys, customer data, external-provider/payment/email requests, or non-loopback service calls.
- Synthetic telemetry is disposable fixture-only; normal installations remain truthful.
- `/legacy`, `/index.html`, `/setup`, existing APIs, and safe mutation boundaries remain available.
- System, Light, and Dark themes and 320 CSS-pixel responsive operation are required.
- No new UI framework is added unless T026 proves the native stack cannot satisfy a concrete acceptance criterion and records the required constitution exception.
- No claim is made for unavailable Safari/macOS, NVDA/VoiceOver, Electron, independent accessibility, production performance, visual approval, canary, or release approval.

## Interfaces

- `buildDashboardBoard({ scope, overview, gateway, usage, cost, alerts, work })` returns a serializable `OperationalDashboardBoard` projection with `attention`, `health`, `work`, `cost`, `trends`, `freshAsOf`, and labelled `drilldowns`.
- `renderDashboardWidget(host, widget)` renders one widget state and returns `{ destroy() }`; chart widgets expose the same values through a table/text alternative.
- `parseThemePreference(value)` returns one of `system`, `light`, or `dark`; invalid values return `system`.
- `applyThemePreference(preference, { documentRef, storage })` sets the presentation mode without changing policy or authorization state.
- `createClientDemoFixture({ port, telemetry })` returns a disposable fixture whose `close()` reports cleanup results and whose telemetry is synthetic-labelled and loopback-only.
- `parity-inventory.md` is the source of truth for legacy capability disposition; each entry must have one status and evidence before convergence.

## Phase 1: Setup

- [X] T001 Create the checked-in legacy capability inventory with every in-scope operational/analytics widget, current legacy location, intended new destination, disposition, and evidence columns in `specs/017-platform-observability-dashboard/parity-inventory.md`.
- [X] T002 Add the Spec 017 test/fixture file map and safe synthetic-data boundary notes to `specs/017-platform-observability-dashboard/quickstart.md`.
- [X] T003 [P] Add source-quality assertions that the platform root remains the live route, `/legacy` and `/index.html` remain available, `/app/setup` remains redirect-only, and no live route uses `/cloud/dashboard/index.html` in `tests/dashboard-parity.test.mjs`.

## Phase 2: Foundational contracts and test seams

- [X] T004 [P] Add unit tests for dashboard widget states, trend metadata, bounded points, theme values, and scope-preserving drill-down contracts in `tests/operational-dashboard.test.mjs`.
- [X] T005 [P] Add tests for System/Light/Dark preference validation, persistence boundary, invalid-value fallback, and semantic-state labels in `tests/dashboard-theme.test.mjs`.
- [X] T006 [P] Add fixture tests proving deterministic telemetry is isolated, synthetic-labelled, loopback-only, external-request rejecting, redacted, and cleanup-safe in `tests/dashboard-fixture.test.mjs`.
- [X] T007 Extend the operational API/read-model contract tests for root trend summaries, freshness/state envelopes, scope propagation, and truthful empty/partial responses in `tests/operational-dashboard.test.mjs`.
- [X] T008 Define shared widget-state, trend, theme, and parity helpers in `dashboard/app/shared/dashboard-contracts.mjs` and `dashboard/app/shared/theme-preference.mjs` without changing authorization semantics.

## Phase 3: User Story 1 — Operational root board (Priority: P1)

**Goal**: Make `/` a complete operational board with summary widgets and compact trends.

**Independent Test**: A deterministic populated scope shows attention, health, work, budget, request/error/latency/token/cost trends, scope text, freshness, and labelled drill-downs at `/`; an empty scope shows truthful empty states.

- [X] T009 [P] [US1] Add failing root-board API assertions for health, work, attention, budget, and trend projections in `tests/operational-dashboard.test.mjs`.
- [X] T010 [US1] Extend the scoped operations read model and server response for root trend summaries while preserving canonical gateway-ledger definitions in `dashboard/operations-api.mjs` and `dashboard/server.mjs`.
- [X] T011 [P] [US1] Render the root board’s attention, health, work, budget, trend, freshness, empty, and error regions with durable links in `dashboard/app/routes/overview/index.mjs`.
- [X] T012 [US1] Add a shared responsive board/widget layout and semantic status styling in `dashboard/static/app-platform.css`.
- [X] T013 [US1] Wire root-board refresh, scope changes, stale-response rejection, and realtime/polling status through `dashboard/static/app-platform.mjs` and `dashboard/app/shared/realtime-coordinator.mjs`.
- [X] T014 [US1] Add populated/empty root-board browser journeys, scope propagation, drill-down return navigation, and no-page-error assertions in `browser-tests/operational-overview.spec.mjs`.

## Phase 4: User Story 2 — Legacy capability parity and evidence (Priority: P1)

**Goal**: Migrate or explicitly disposition legacy operational and analytics capabilities while retaining a usable fallback.

**Independent Test**: The parity inventory has no unclassified in-scope capability; new Gateway, Cost, Usage, Alerts, Tasks, Runs, Administration, Governance, and Integrations paths preserve supported legacy value, scope, safeguards, and evidence links.

- [X] T015 [P] [US2] Add parity assertions for every inventory entry, including intentional retirement rationale and retained `/legacy` fallback, in `tests/dashboard-parity.test.mjs`.
- [X] T016 [US2] Normalize legacy widget metric names, summaries, and empty/error semantics into platform-safe adapters in `dashboard/app/shared/legacy-parity-adapters.mjs`.
- [X] T017 [P] [US2] Bring legacy spend, token, provider/model/agent breakdown, budget, and export affordances into the new Cost/Usage views and update `specs/017-platform-observability-dashboard/parity-inventory.md`.
- [X] T018 [P] [US2] Bring legacy gateway request/error/latency, alert, task/run, and activity affordances into the new operational routes with scope-preserving evidence links in `dashboard/app/routes/observability/{gateway,alerts}.mjs` and `dashboard/app/routes/operations/{index,task-detail,run-detail}.mjs`.
- [X] T019 [US2] Preserve existing legacy API/direct-route/auth compatibility and add regression assertions for `/legacy`, `/index.html`, `/api/*`, and `/api/v1/*` in `tests/dashboard-api-compatibility.test.mjs`.
- [X] T020 [US2] Add browser parity journeys for chart/table switching, dimensions, exports, alert/task/run drill-downs, Back/Forward scope, and intentional legacy fallback in `browser-tests/operational-overview.spec.mjs`.

## Phase 5: User Story 3 — Grafana-inspired visual system and themes (Priority: P2)

**Goal**: Deliver an appealing, coherent, mobile-first dashboard with System, Light, and Dark themes.

**Independent Test**: At desktop and 320px mobile viewports, an operator changes all three theme modes, navigates primary areas, uses scope controls and drill-downs, and sees readable cards/charts/tables with no horizontal page scrolling.

- [X] T021 [P] [US3] Add theme/token contract tests for colors, typography, spacing, chart palettes, focus states, severity states, forced colors, and reduced motion in `tests/dashboard-theme.test.mjs`.
- [X] T022 [US3] Implement named design tokens, System/Light/Dark semantic palettes, responsive layout primitives, mobile navigation, card hierarchy, and chart/table styling in `dashboard/static/app-platform.css`.
- [X] T023 [US3] Add the accessible System/Light/Dark control, persistence, device preference listener, and live announcement behavior in `dashboard/app.html` and `dashboard/static/app-platform.mjs`.
- [X] T024 [P] [US3] Polish chart visual enhancement, legends, axes, empty visuals, resize behavior, and accessible table presentation in `dashboard/app/shared/chart-adapter.mjs`.
- [X] T025 [US3] Add desktop, 320px mobile, keyboard, reduced-motion, forced-colors, and reload-persistence browser coverage in `browser-tests/dashboard-theme-responsive.spec.mjs`.
- [X] T026 [US3] Perform a native-stack sufficiency checkpoint against the visual acceptance criteria in `specs/017-platform-observability-dashboard/plan.md`; if a framework is genuinely necessary, document the narrow dependency, update the constitution check and plan, then add only the minimum justified integration.

## Phase 6: User Story 4 — Truthful synthetic demonstration telemetry (Priority: P2)

**Goal**: Make explicit local demos visually meaningful without seeding normal installations.

**Independent Test**: The onboarding/client-demo fixture shows deterministic labelled trend data and cleans every temporary resource after success, interruption, or failure; a normal local server remains unseeded.

- [X] T027 [P] [US4] Add deterministic synthetic gateway events, token/cost points, alerts, work records, and budget samples to `tests/fixtures/client-demo-fixture.mjs` with stable timestamps and fictional identities.
- [X] T028 [US4] Add an explicit fixture-only telemetry activation boundary and normal-installation isolation assertions in `tests/fixtures/client-demo-fixture.mjs`, `tests/fixtures/onboarding-fixture.mjs`, and `tests/dashboard-fixture.test.mjs`.
- [X] T029 [US4] Reject external/provider/payment/email endpoints and key-shaped inputs throughout the dashboard-demo fixture path, with redaction and attempt-ledger assertions in `tests/dashboard-fixture.test.mjs`.
- [X] T030 [US4] Extend the client-demo browser journey to show populated root widgets/trends, synthetic labels, scope changes, themes, and cleanup in `browser-tests/client-demo-package.spec.mjs`.
- [X] T031 [US4] Update presenter and capture documentation with the new root-board checkpoints, theme/mobile notes, and safe synthetic-data boundaries in `docs/client-demo-presenter-runbook.md` and `docs/client-demo-capture-brief.md`.

## Phase 7: Polish, convergence, and review gates

- [X] T032 [P] Add focused source-quality checks for no external URL, no real-key use, no secret-shaped fixture output, and no legacy route regression in `tests/dashboard-source-quality.test.mjs`.
- [X] T033 Run focused Node and Playwright tests, manual headed Chrome smoke checks where available, and record actual results and unavailable gates in `specs/017-platform-observability-dashboard/quickstart.md`.
- [X] T034 Run `npm test`, `git diff --check`, and the supported local browser checks; fix regressions without changing Spec 014/015 artifacts or root-worktree state.
- [X] T035 Run `$speckit-converge`, append any discovered unbuilt Spec 017 requirements to this file, and complete every appended task before proceeding.
- [X] T036 Prepare redacted review evidence and the parity disposition summary for Founder review in `specs/017-platform-observability-dashboard/quickstart.md` and `specs/017-platform-observability-dashboard/parity-inventory.md`.
- [ ] T037 Create or update the implementation PR branch and review evidence in `specs/017-platform-observability-dashboard/quickstart.md` only when all local validation is green, wait for required CI, dispatch Antigravity review, apply accepted blocking findings, rerun validation/convergence, and leave the PR unmerged for Founder review.

## Phase 8: Hard visual-reference acceptance

- [X] T038 [P] Add left-navigation contract tests for desktop rail, active route, expandable dashboard sections, accessible labels, mobile drawer behavior, focus return, and scope-preserving links in `tests/dashboard-navigation.test.mjs`.
- [X] T039 [US3] Implement the persistent icon-first left navigation rail, active-route state, expandable Dashboard/Observability sections, mobile drawer, keyboard focus management, and MeridianOS-owned icon treatment in `dashboard/app.html` and `dashboard/static/app-platform.mjs`.
- [X] T040 [US3] Implement the reference visual system in `dashboard/static/app-platform.css`: dark panel surfaces, dense grid, compact stat/KPI tiles, chart/gauge/bar-gauge/table/heatmap/list panel families, muted text, vivid semantic series, rail/drawer styling, and equivalent Light/System tokens.
- [X] T041 [US3] Add visual-family renderers and root-board panel composition for stat, graph, circled meter/gauge, bar gauge, table, heatmap, alert list, dashboard/list, log/activity, and integration-status states in `dashboard/app/shared/dashboard-panels.mjs` and `dashboard/app/routes/overview/index.mjs`; use the circled meter for cost, tokens, budget, and selected threshold metrics.
- [X] T042 [US3] Add desktop and mobile browser assertions for the supplied reference hierarchy, left rail/drawer, panel-family presence, active navigation, theme modes, and no horizontal scrolling in `browser-tests/dashboard-visual-reference.spec.mjs`.
- [ ] T043 [US3] Perform Founder visual review against the supplied references, correct material discrepancies, and record accepted deviations with evidence in `specs/017-platform-observability-dashboard/parity-inventory.md` and `quickstart.md`.

## Requirement Coverage

| Requirement | Tasks |
|---|---|
| FR-017-001 root board/widgets/trends | T009–T014 |
| FR-017-002 shared scope and fixed-period disclosure | T007, T010, T013, T014, T020 |
| FR-017-003 labelled drill-downs | T011, T014, T017–T020 |
| FR-017-004 loading/empty/partial/stale/unavailable/error | T004, T007, T011, T014, T024 |
| FR-017-005 legacy parity and fallback | T001, T003, T015–T020 |
| FR-017-006 chart/table accessibility parity | T004, T020, T024–T025 |
| FR-017-007 Grafana-inspired visual language | T012, T022, T024–T025 |
| FR-017-008 mobile-first responsive behavior | T012, T022, T025 |
| FR-017-009 System/Light/Dark modes | T005, T021–T025 |
| FR-017-010 semantic non-color states | T005, T021–T024 |
| FR-017-011 existing routes/auth/mutations | T003, T019–T020, T034 |
| FR-017-012 fixture-only populated demos | T006, T027–T031 |
| FR-017-013 synthetic-only/external rejection | T006, T028–T029, T032 |
| FR-017-014 automated coverage | T004–T007, T014, T020, T025, T030, T032–T034 |
| SC-017-001 root triage speed | T009–T014, T033 |
| SC-017-002 complete parity disposition | T001, T015, T017–T020, T036 |
| SC-017-003 desktop/mobile journeys | T014, T020, T025, T033 |
| SC-017-004 chart evidence measurement | T004, T024, T033–T034 |
| SC-017-005 keyboard/accessibility | T005, T021, T024–T025, T033 |
| SC-017-006 theme persistence/contrast | T005, T021–T025, T033 |
| SC-017-007 fixture safety/cleanup | T006, T027–T030, T033 |
| FR-017-015 left navigation rail/drawer | T038–T040, T042 |
| FR-017-016 reference panel families | T004, T011–T012, T024, T040–T042 |
| SC-017-008 Founder visual reference acceptance | T040–T043 |
| SC-017-009 navigation journeys | T038–T039, T042 |
| FR-017-017 circled cost/token/budget meters | T004, T021, T040–T043 |
| SC-017-010 meter visual acceptance | T041–T043 |

## Dependencies & Execution Order

```text
T001–T008 -> T009–T014 (US1)
T001–T008 -> T015–T020 (US2)
T008 + T012 -> T021–T026 (US3)
T008 + T010 -> T027–T031 (US4)
US1 + US2 + US3 + US4 -> T032–T037
```

US1 is the MVP. US2 depends on the root scope and evidence contracts but can be tested independently once the foundation is complete. US3 and US4 can proceed in parallel after shared contracts, with T026 acting as the explicit dependency checkpoint.

## Parallel Opportunities

- T003–T006 are independent contract/source-quality concerns.
- T009 and T011 can proceed in parallel after T008; T012 and T013 touch separate concerns after their shared DOM contract is stable.
- T015, T017, and T018 can proceed in parallel once the parity inventory and adapters exist.
- T021, T024, and T027 can proceed in parallel after the shared contract layer.

## Implementation Strategy

1. Deliver the root board (US1) with truthful data states and existing empty-state behavior.
2. Close the parity inventory (US2) without removing `/legacy`.
3. Apply visual/theme/mobile polish (US3) and keep framework introduction gated by evidence.
4. Add populated synthetic fixture telemetry (US4) only to explicit demos.
5. Run convergence, full validation, external review, and leave the implementation unmerged for Founder review.
