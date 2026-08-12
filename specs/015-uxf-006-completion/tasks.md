# Tasks: UXF-006 Responsive, Accessible, and Release-Gated Migration Completion

**Input**: Design documents from `specs/015-uxf-006-completion/`

**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/uxf-006.md`, `quickstart.md`

**Tests**: Required. New contract and privacy tests must be written before implementation; browser/manual gates must report unavailable environments explicitly.

## Phase 1: Setup and baseline

- [X] T001 Record the repository/UXF merge baseline, dirty-checkout preservation, and remaining-work inventory in `docs/UI-UX-Audit-Revamp-Remaining-Work.md`
- [X] T002 [P] Freeze existing local/cloud/API-v1/legacy compatibility expectations in `tests/uxf-006-quality.test.mjs`
- [X] T003 [P] Add the UXF-006 release-gate evidence schema and unresolved approval checklist in `specs/015-uxf-006-completion/quickstart.md`
- [X] T004 [P] Add every legacy dashboard panel/module, target route, owner, evidence, flag, removal gate, and rollback placeholder to `docs/legacy-parity-ledger.md`

## Phase 2: Foundational safety and contracts

- [X] T005 [P] Add failing search query, safe projection, role-negative, malformed-input, and cross-tenant contract tests in `tests/uxf-006-search.test.mjs`
- [X] T006 [P] Add failing UXF telemetry allowlist and prompt/credential/API-key/webhook/raw-query negative tests in `tests/uxf-006-telemetry.test.mjs`
- [X] T007 [P] Add failing source-quality assertions for native ES modules, responsive media features, no secret-bearing telemetry fields, and no legacy deletion in `tests/uxf-006-quality.test.mjs`
- [X] T008 [P] Add deterministic viewport and browser descriptors for the seven target viewports in `browser-tests/uxf-006.spec.mjs`
- [X] T009 Implement the privacy-safe UXF event allowlist and no-op/never-throw behavior in `dashboard/uxf-telemetry.mjs`
- [X] T010 Document human owner, IA/terminology, ADR, canary, exception, manual AT, and two-release approval gates as unresolved in `docs/uxf-006-rollout.md`

## Phase 3: User Story 1 — Responsive and accessible workflows (P1) 🎯 MVP

**Goal**: Make the existing native local and cloud surfaces responsive, keyboard-operable, focus-safe, reduced-motion/forced-colors aware, and zoom-safe without changing public behavior.

**Independent Test**: Run the browser route/state matrix at all seven viewports and accessibility modes; assert landmarks, one heading, no overflow, focus visibility/restoration, table/dialog/drawer operation, and cloud login/machine/policy-preview recovery.

- [X] T011 [P] [US1] Add responsive shell, navigation, table, dialog, chart, forced-colors, reduced-motion, and 200%-zoom assertions in `browser-tests/uxf-006.spec.mjs`
- [X] T012 [P] [US1] Add local app shell focus, landmark, route, and palette-invoker fixtures in `dashboard/app.html` and `dashboard/static/app-platform.css`
- [X] T013 [P] [US1] Add keyboard/focus/reduced-motion/forced-colors source checks in `tests/uxf-006-quality.test.mjs`
- [X] T014 [US1] Harden native app layout, mobile navigation, overflow containment, touch targets, and motion/focus styles in `dashboard/static/app-platform.css`
- [X] T015 [US1] Add accessible cloud shell landmarks, responsive machine/health tables, policy preview region, error/status states, and confirmation boundary in `cloud/dashboard/index.html`
- [X] T016 [US1] Implement cloud login/machine/health/policy preview rendering and safe failure/recovery states without changing `/api/cloud/*` paths in `cloud/dashboard/app.js`
- [X] T017 [US1] Add cloud login/machine/policy preview responsive and keyboard evidence in `browser-tests/uxf-006.spec.mjs`

## Phase 4: User Story 2 — Permission-aware search and realtime fallback (P1)

**Goal**: Let authorized users find safe route/entity projections and commands, then preserve trustworthy status updates with SSE reconnect and polling fallback.

**Independent Test**: Search as multiple role/scope fixtures, open a durable result, reject unsafe commands, and exercise open/event/duplicate/cursor/reset/disconnect/fallback paths.

- [X] T018 [P] [US2] Add a pure route/entity/command registry with server-side capability predicates in `dashboard/search.mjs`
- [X] T019 [P] [US2] Add search projection and query validation tests for tasks, runs, providers, routes, roles, scopes, and safe errors in `tests/uxf-006-search.test.mjs`
- [X] T020 [US2] Add `GET /api/operations/search` dispatch using existing scope, database, run, provider, and rate-limit boundaries in `dashboard/operations-api.mjs`
- [X] T021 [US2] Add search client and command-palette keyboard/focus/typeahead/Escape/announcement behavior in `dashboard/static/app-platform.mjs`
- [X] T022 [US2] Add palette overlay, result list, mobile, focus, reduced-motion, and forced-colors styles in `dashboard/static/app-platform.css`
- [X] T023 [US2] Add search result authorization-negative, no-content-leak, and durable-route browser evidence in `browser-tests/uxf-006.spec.mjs`
- [X] T024 [US2] Add browser SSE open/event/dedup/cursor/reset/disconnect/polling-fallback evidence while preserving polling/manual refresh in `browser-tests/uxf-006.spec.mjs`
- [X] T025 [US2] Add privacy-safe search, palette, drill-down, action, and legacy-use event call sites through `dashboard/uxf-telemetry.mjs` and existing local logging boundaries

## Phase 5: User Story 3 — Visual, accessibility, performance, and compatibility gates (P1)

**Goal**: Turn the master-plan quality targets into reproducible checks and CI evidence without adding dependencies or claiming unavailable manual evidence.

**Independent Test**: Run the gate script against the browser artifacts and source metrics; verify missing/over-budget data fails closed and passing evidence includes thresholds and artifact paths.

- [X] T026 [P] [US3] Add deterministic performance, bundle-size, visual-artifact, and accessibility-evidence gate checks in `scripts/uxf-006-gates.mjs`
- [X] T027 [P] [US3] Add gate unit tests for passing, missing, over-budget, malformed, and exception-unresolved states in `tests/uxf-006-quality.test.mjs`
- [X] T028 [P] [US3] Add visual baseline/state naming and artifact assertions for light/dark/loading/empty/error/dialog/chart views in `browser-tests/uxf-006.spec.mjs`
- [X] T029 [US3] Add CI job enforcement and artifact upload for UXF-006 browser, visual, accessibility, performance, and source gates in `.github/workflows/ui-platform-browser.yml` and `.github/workflows/pr-gates.yml`
- [X] T030 [US3] Extend Safari/Electron workflow evidence and explicit unavailable/manual status reporting in `.github/workflows/ui-platform-safari.yml` and `scripts/safari-ui-platform-evidence.mjs`
- [X] T031 [US3] Add focused compatibility, authorization-negative, secret-leak, SSE, and gateway-only metering assertions in `tests/uxf-006-quality.test.mjs`

## Phase 6: User Story 4 — Cloud and legacy migration evidence (P1)

**Goal**: Make the cloud surface and legacy migration process reviewable, reversible, and non-destructive.

**Independent Test**: Validate cloud/API compatibility, inspect every parity entry, run the flag/rollback checklist, and prove no removal path activates while evidence or approvals are absent.

- [X] T032 [P] [US4] Add cloud shell/API compatibility and safe policy-preview contract tests in `tests/uxf-006-quality.test.mjs`
- [X] T033 [P] [US4] Complete the parity ledger with current native legacy modules, migrated route evidence links, feature flags, removal conditions, and retained rollback asset references in `docs/legacy-parity-ledger.md`
- [X] T034 [P] [US4] Document feature-flag progression, canary cohort, rollback drill, support escalation, and approval ownership in `docs/uxf-006-rollout.md`
- [X] T035 [US4] Add migration, legacy-route retirement, rollback, and no-removal-before-approval guidance in `docs/uxf-006-migration.md`
- [X] T036 [US4] Add cloud/local terminology, route, scope, and recovery guidance in `docs/cloud-dashboard-guide.md`

## Phase 7: User Story 5 — Privacy-safe support and release handoff (P2)

**Goal**: Provide complete validation/support/changelog artifacts with exact evidence fields and explicit unresolved human gates.

**Independent Test**: Follow the quickstart from a clean checkout, inspect telemetry and parity docs, and confirm every unresolved approval remains visible.

- [X] T037 [P] [US5] Document search, palette, SSE fallback, responsive, accessibility, and cloud recovery behavior in `docs/uxf-006-user-guide.md`
- [X] T038 [P] [US5] Document support triage, browser/AT evidence collection, rollback response, and escalation in `docs/uxf-006-support-runbook.md`
- [X] T039 [P] [US5] Add UXF-006 release notes, migration impact, compatibility guarantees, and unresolved gate disclosure in `CHANGELOG.md`
- [X] T040 [US5] Update exact commands, counts, timings, artifact links, manual AT results, privacy results, parity status, and rollback evidence in `specs/015-uxf-006-completion/quickstart.md`

## Phase 8: Polish and convergence

- [X] T041 [P] Run focused UXF-006/search/telemetry/realtime/compatibility tests and record counts/timings in `specs/015-uxf-006-completion/quickstart.md`
- [X] T042 [P] Run browser, visual, accessibility, viewport, cloud, Safari/Electron, and performance evidence jobs and record environment/artifacts in `specs/015-uxf-006-completion/quickstart.md`
- [X] T043 Run full `npm test`, `npm run test:ci`, and `git diff --check`; distinguish environment failures from regressions in `specs/015-uxf-006-completion/quickstart.md`
- [X] T044 Run standard Spec Kit convergence against `spec.md`, `plan.md`, and `tasks.md`; append and complete only code-backed gaps in `specs/015-uxf-006-completion/tasks.md`
- [X] T045 Verify no legacy source/module/route was deleted and that every unresolved human approval remains visible in `docs/legacy-parity-ledger.md` and `docs/uxf-006-rollout.md`

## Dependencies and execution order

`Setup -> Foundational safety -> US1 responsive shell -> US2 search/realtime -> US3 gates -> US4 cloud/parity -> US5 handoff -> validation/convergence`.

US1 and the pure contract tests can start after the foundation. US2 depends on the shell invoker and existing scope API. US3 depends on browser fixtures. US4 and US5 depend on evidence shape but do not authorize removal. Human approvals remain external and block release/removal only.

## Requirement coverage

| Requirement | Tasks |
|---|---|
| FR-601 | T008, T011–T017, T041–T042 |
| FR-602 | T011–T014, T017, T030, T042 |
| FR-603 | T026–T031, T041–T043 |
| FR-604 | T002, T020, T031–T032, T043 |
| FR-605 | T005, T018–T023 |
| FR-606 | T024, T041–T042 |
| FR-607 | T015–T017, T032, T036 |
| FR-608 | T003–T004, T033–T035, T040, T045 |
| FR-609 | T006, T009, T025, T031, T040 |
| FR-610 | T004, T010, T033–T035, T045 |
| FR-611 | T002, T007, T018, T029, T043 |

## Implementation strategy

MVP is Phase 1–3: responsive/accessibility foundations and evidence on existing routes. Phase 4 adds the highest-value missing capability (search/palette) while retaining the already-implemented SSE fallback. Phases 5–7 make quality, cloud, parity, privacy, and support evidence enforceable. Phase 8 validates and converges. Legacy removal is explicitly out of scope until FR-610 gates are approved.
