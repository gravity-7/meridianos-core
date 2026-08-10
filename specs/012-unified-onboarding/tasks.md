# Tasks: Unified Onboarding

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/setup-flow.md](contracts/setup-flow.md), and [quickstart.md](quickstart.md)

**Prerequisites**: The merged UXF-001 implementation (currently represented by `e753f80`) must be in the implementation base before any `/app/setup` task begins.

**Tests**: Test-first coverage is required by the specification and constitution. Each test task must fail before its related implementation task is completed.

## Phase 1: Setup and compatibility baseline

**Purpose**: Establish the prerequisite and record existing behavior before changing setup.

- [ ] T001 Verify the implementation branch contains merged UXF-001 platform files and document the exact base commit in `specs/012-unified-onboarding/plan.md`. [FR-301, FR-311]
- [ ] T002 [P] Capture legacy browser `/setup` and Electron first-run behavior in `tests/server.test.mjs` and `tests/integration/electron-app.test.mjs`. [FR-310, FR-311, SC-306]
- [ ] T003 [P] Add redaction-safe test fixtures and a reusable no-secret assertion helper in `tests/helpers/onboarding-security.mjs`. [FR-304, FR-305, FR-306, SC-302]

---

## Phase 2: Foundational setup contracts

**Purpose**: Add the common state model, policy-controlled route selection, and sanitized contracts that block all user stories.

**⚠️ CRITICAL**: Complete this phase before implementing any user-story UI.

- [ ] T004 Add failing state-transition and forbidden-field tests for `OnboardingDraft` in `tests/onboarding-draft.test.mjs`. [FR-301, FR-303, FR-304]
- [ ] T005 Implement versioned non-secret draft validation, persistence, clearing, and storage-unavailable recovery in `dashboard/static/onboarding-draft.mjs`. [FR-301, FR-303, FR-304]
- [ ] T006 Add failing route-registry and feature-flag/legacy-fallback tests in `tests/ui-platform.test.mjs`. [FR-301, FR-311, SC-306]
- [ ] T007 Register `/app/setup` and completion-state routes with UXF-001 route eligibility/recovery in `dashboard/ui-platform.mjs` and `dashboard/server.mjs`. [FR-301, FR-311, FR-312]
- [ ] T008 [P] Add API contract tests for status, validation, preview, commit, request authorization, stale validation, and existing-configuration rejection in `tests/server.test.mjs`. [FR-302, FR-309, FR-310, FR-312]
- [ ] T009 [P] Add raw-error/URL/credential redaction tests for provider validation in `tests/onboarding-security.test.mjs` and `tests/provider-conformance.test.mjs`. [FR-304, FR-305, FR-307, SC-302]
- [ ] T010 Implement normalized allow-listed provider-validation results and redaction boundary in `provider-conformance.mjs`. [FR-302, FR-307, FR-312]
- [ ] T011 Implement authenticated `/api/onboarding/status`, provider-validation, preview, and commit endpoints in `dashboard/server.mjs` per `contracts/setup-flow.md`. [FR-302, FR-305, FR-309, FR-310, FR-312]
- [ ] T012 Refactor preview/commit generation into sanitized review and staged/recoverable write operations in `setup-wizard-core.mjs`. [FR-305, FR-308, FR-309, FR-310]
- [ ] T013 Add non-secret setup lifecycle event schema and allow-listed event writer in `setup-wizard-core.mjs` and `daemon-logger.mjs`. [FR-315]

**Checkpoint**: The platform can safely identify setup state, retain only a valid non-secret draft, validate a provider without exposure, and reject unsafe commits.

---

## Phase 3: User Story 1 - Complete a safe first-run setup (Priority: P1) 🎯 MVP

**Goal**: A fresh browser administrator completes a validated-provider, budgeted, reviewed setup without overwriting an existing installation.

**Independent Test**: In a fresh test installation, complete `/app/setup` with a valid provider and positive budget, inspect the non-secret review and committed output, then prove an existing installation is rejected safely.

- [ ] T014 [P] [US1] Add browser happy-path, existing-installation, invalid-budget, review-confirmation, and failed-validation tests in `browser-tests/onboarding.spec.mjs`. [FR-302, FR-308, FR-309, FR-310, SC-303]
- [ ] T015 [P] [US1] Add setup-core tests for positive dollar budgets, selected-provider routing, no-write preview, explicit confirmation, and staged-write recovery in `tests/setup-wizard-core.test.mjs`. [FR-302, FR-308, FR-309, FR-310]
- [ ] T016 [US1] Implement the shared semantic setup stepper, installation/roster/provider/budget/review states, and UXF-001 primitive composition in `dashboard/static/onboarding-flow.mjs`. [FR-301, FR-302, FR-308, FR-309, FR-313]
- [ ] T017 [US1] Extend `dashboard/static/app-platform.mjs` and `dashboard/static/app-platform.css` to render `/app/setup` and route-safe setup recovery views. [FR-301, FR-311, FR-313]
- [ ] T018 [US1] Implement browser credential single-use handoff and explicit commit without inserting a credential into the draft, preview, or review in `dashboard/static/onboarding-flow.mjs`. [FR-304, FR-305, FR-309]
- [ ] T019 [US1] Harden `.env` commit permissions and failure/recovery reporting in `setup-wizard-core.mjs` and `tests/setup-wizard-core.test.mjs`. [FR-305, FR-310]

**Checkpoint**: Browser first-run setup produces validated declarative configuration only after an explicit, secret-free review.

---

## Phase 4: User Story 2 - Resume setup without retaining credentials (Priority: P1)

**Goal**: An interrupted browser flow resumes only safe choices and presents safe recovery for validation/network/storage failures.

**Independent Test**: Interrupt a partially completed setup, reopen `/app/setup`, verify the non-secret draft resumes, then scan browser persistence, URL/history, server responses, logs, and telemetry for the submitted credential.

- [ ] T020 [P] [US2] Add browser interruption, reload, offline, retry, storage-unavailable, URL/history, and secret-leak negative tests in `browser-tests/onboarding.spec.mjs`. [FR-303, FR-304, FR-307, SC-302, SC-303]
- [ ] T021 [P] [US2] Add draft serialization, provider-change invalidation, expiry/clear, and validation-result binding tests in `tests/onboarding-draft.test.mjs`. [FR-301, FR-303, FR-307]
- [ ] T022 [US2] Implement resume-at-last-safe-step, provider-change invalidation, retry, offline, and storage-unavailable state transitions in `dashboard/static/onboarding-flow.mjs`. [FR-301, FR-303, FR-307]
- [ ] T023 [US2] Add response/log/telemetry redaction enforcement for every onboarding error and lifecycle result in `dashboard/server.mjs`, `setup-wizard-core.mjs`, and `tests/onboarding-security.test.mjs`. [FR-304, FR-305, FR-315, SC-302]

**Checkpoint**: Leaving or recovering setup preserves the intended decisions but never a credential.

---

## Phase 5: User Story 3 - Follow the same flow in Electron (Priority: P2)

**Goal**: Electron exposes the same ordered setup state and recovery semantics while keeping credentials in OS secure storage.

**Independent Test**: Complete the controlled browser and Electron scenarios with the same non-secret draft fixture and compare their normalized validation, review, commit, and checklist outcomes; simulate keychain failure.

- [ ] T024 [P] [US3] Add allow-listed preload, provider validation, keychain failure, no-`.env`-fallback, and parity tests in `tests/integration/electron-app.test.mjs` and `tests/keychain.test.mjs`. [FR-306, FR-307, FR-312, SC-304]
- [ ] T025 [P] [US3] Add main-process validation and keychain response-redaction tests in `tests/desktop-main.test.mjs`. [FR-304, FR-306, SC-302]
- [ ] T026 [US3] Add narrow onboarding-only preload capability methods and remove renderer access to generic credential handling in `desktop/preload.js`. [FR-306]
- [ ] T027 [US3] Implement allow-listed main-process validation, OS-keychain commit, normalized failures, and shared-flow loading in `desktop/main.js` and `desktop/keychain.mjs`. [FR-302, FR-306, FR-307, FR-312]
- [ ] T028 [US3] Replace the first-run Electron-specific wizard presentation with the shared `/app/setup` flow while retaining `desktop/renderer/wizard.{html,js}` as compatibility fallback. [FR-301, FR-311, FR-312]

**Checkpoint**: Electron and browser reach the same first-run outcome without an Electron credential escaping the secure-storage boundary.

---

## Phase 6: User Story 4 - Reach first value after setup (Priority: P2)

**Goal**: Completion provides a durable, truthful task/run handoff without migrating unrelated Operations workflows.

**Independent Test**: Complete setup, use the first-task target, then verify the checklist resolves the created run target only when it exists and preserves its identity/status context.

- [ ] T029 [P] [US4] Add completion checklist, unavailable-run, first-task handoff, and stable-run-identity tests in `browser-tests/onboarding.spec.mjs` and `tests/server.test.mjs`. [FR-314, SC-307]
- [ ] T030 [US4] Define stable documented task-create/import and run-observation compatibility targets in `dashboard/ui-platform.mjs` and `dashboard/static/app-platform.mjs`. [FR-314]
- [ ] T031 [US4] Implement persisted/derived completion checklist rendering and task/run availability states in `dashboard/static/onboarding-flow.mjs` and `dashboard/static/app-platform.mjs`. [FR-314, FR-315]

**Checkpoint**: Successful setup ends with a truthful next action and an identifiable first-run destination.

---

## Phase 7: Polish, accessibility, evidence, and rollout

**Purpose**: Complete cross-cutting accessibility, observability, compatibility, and support evidence.

- [ ] T032 [P] Add keyboard-only, screen-reader stepper, error-summary focus, status announcement, reduced-motion, 375 px, 200%-zoom, and wide-viewport tests in `browser-tests/onboarding.spec.mjs`. [FR-313, SC-305]
- [ ] T033 [P] Add privacy-safe completion-timing telemetry and p75 measurement coverage in `dashboard/static/onboarding-flow.mjs`, `daemon-logger.mjs`, and `tests/onboarding-security.test.mjs`. [FR-315, SC-301]
- [ ] T034 [P] Update installation, first-run recovery, existing-installation, offline, credential, and Electron-keychain support guidance in `docs/user-guide.md` and `docs/troubleshooting.md`. [FR-316]
- [ ] T035 Run the complete native, contract, Electron, browser, accessibility, responsive, compatibility, and quickstart evidence set; record results in `specs/012-unified-onboarding/quickstart.md`. [SC-301, SC-302, SC-303, SC-304, SC-305, SC-306, SC-307]

## Dependencies & Execution Order

- **UXF-001 prerequisite**: T001 blocks all platform-route work.
- **Foundation**: T004–T013 block every user story.
- **US1 and US2**: US2 builds on the shared stepper/draft from US1 but its negative tests can begin with T020–T021 after T005.
- **US3**: Depends on sanitized contracts and shared state, then can proceed independently of US4.
- **US4**: Depends on successful commit/checklist contract and may proceed after T011–T013 and US1.
- **Polish**: T032–T035 complete after all desired stories.

## Parallel Opportunities

- T002 and T003 can run in parallel.
- T006, T008, and T009 can run in parallel after the UXF-001 prerequisite.
- Within US1, T014 and T015 can run in parallel; within US2, T020 and T021 can run in parallel; within US3, T024 and T025 can run in parallel.
- US3 implementation and US4 target-contract work can proceed in parallel once the common server/core contracts are complete.
- T032–T034 can run in parallel after story implementation.

## Implementation Strategy

1. Rebase implementation onto the merged UXF-001 platform and establish redaction/route contracts.
2. Deliver the browser happy path with a failing-test-first safe core, then stop to validate secret-free preview/commit and existing-installation protection.
3. Add interruption recovery, then Electron parity through the narrow keychain bridge.
4. Add completion handoff targets without migrating Operations pages.
5. Finish only after all quickstart, browser/accessibility, compatibility, and secret-scanning evidence passes.
