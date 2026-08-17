# Tasks: Client-Ready Demo Package

**Input**: Design documents from `specs/016-client-ready-demo-package/`

**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/demo-package.md`, `quickstart.md`

**Tests**: Required. Write fixture, privacy, route-boundary, cleanup, and browser tests before the corresponding launcher behavior.

## Interfaces

- `createClientDemoFixture({ port })` in `tests/fixtures/client-demo-fixture.mjs` returns `{ dashboardUrl, credentials, policyExample, writeEvidence(result), close() }`; `close()` returns `{ rootRemoved, dbRemoved }` and must be safe to call once after a failed start.
- `runVisibleClientDemo({ port, launchBrowser })` in `scripts/run-visible-client-demo.mjs` starts the fixture, opens `dashboardUrl`, and returns a stoppable session object. It must reject non-integer or out-of-range ports and must not accept provider/remote endpoint inputs.
- `DEMO_CHECKPOINTS` in `tests/fixtures/client-demo-fixture.mjs` is an ordered array of `{ id, route, expected, pause, recovery }` aligned with `contracts/demo-package.md`.
- `writeDemoEvidence(result)` receives only safe `DemoSession` fields from `data-model.md`, writes redacted JSON/text under `artifacts/qa/client-demo/<run-id>/`, and rejects credential-like/raw content.

## Phase 1: Setup and boundaries

**Purpose**: Establish the documentation and test seams for a synthetic-only package without altering existing onboarding or UXF-006 behavior.

- [X] T001 Record the adopted onboarding baseline, supported routes, test-only cloud static route, and external-gate boundary in `docs/client-demo-presenter-runbook.md`.
- [X] T002 [P] Define the curated shot list, optional-recording requirements, owner roles, approval criteria, and discard procedure in `docs/client-demo-capture-brief.md`.
- [X] T003 [P] Add source/contract assertions that `/setup` is presented, `/app/setup` is redirect-only, and `/cloud/dashboard/index.html` is never a live demo route in `tests/client-demo-package.test.mjs`.

## Phase 2: Foundational deterministic fixture and safety tests

**Purpose**: Create the shared synthetic fixture boundary that blocks all client-demo workflow work until it is deterministic, loopback-only, redactable, and disposable.

- [X] T004 [P] Add failing fixture contract tests for deterministic synthetic organization, account, machines, health, and policy-preview data in `tests/client-demo-package.test.mjs`.
- [X] T005 [P] Add failing tests for rejected non-loopback/real-provider inputs, inherited credential values, raw-content evidence, and unsafe capture references in `tests/client-demo-package.test.mjs`.
- [X] T006 [P] Add failing cleanup and interruption tests that require removal of temporary database, fixture root, browser session evidence, and disallow fixture reuse in `tests/client-demo-package.test.mjs`.
- [X] T007 Implement `createClientDemoFixture`, `DEMO_CHECKPOINTS`, fixed fictional data, safe evidence writing, and idempotent teardown in `tests/fixtures/client-demo-fixture.mjs`.
- [X] T008 Implement fixture tests that start the existing cloud control plane on loopback, authenticate only with fixture credentials, seed supported machine/health/policy-preview state, and prove no external request in `tests/client-demo-package.test.mjs`.

**Checkpoint**: The disposable client-demo fixture is deterministic, hermetic, and safe to consume by a headed launcher.

## Phase 3: User Story 1 - Present Visible Onboarding (Priority: P1) 🎯 MVP

**Goal**: Let a presenter reliably use the existing headed `/setup` baseline with a concise narrative and visible pause/recovery checkpoints.

**Independent Test**: Run `node scripts/run-visible-onboarding.mjs --port 4317` in a headed-capable local environment and follow the runbook through synthetic setup, review-before-commit, completion, and cleanup without presenting `/app/setup`.

- [X] T009 [P] [US1] Add a baseline-preservation test that invokes the existing visible onboarding launcher help/argument contract without changing its behavior in `tests/client-demo-package.test.mjs`.
- [X] T010 [US1] Complete the onboarding section, required pauses, founder wording, recovery, safe evidence references, and ten-minute validation sequence in `docs/client-demo-presenter-runbook.md`.
- [X] T011 [US1] Add browser assertions for `/setup` entry, review-before-commit visibility, completion, and synthetic/disposable session labeling in `browser-tests/client-demo-package.spec.mjs`.
- [X] T012 [US1] Add the onboarding visual-shot and recording segments, required redaction review, and `not-created` default disposition in `docs/client-demo-capture-brief.md`.

**Checkpoint**: The onboarding MVP is usable with the existing launcher, and the presentation material cannot mistake the redirect for an implemented destination.

## Phase 4: User Story 2 - Present Supported Client Operations (Priority: P1)

**Goal**: Launch the supported local cloud-control-plane root dashboard with deterministic data and make the sign-in, health, preview, confirmation boundary, and cleanup watchable.

**Independent Test**: Start the new launcher on a free loopback port, open its printed root URL in a headed browser, sign in with fixture-only credentials, observe machines/health, preview the allowlisted policy example, stop at confirmation, and verify cleanup.

- [X] T013 [P] [US2] Add failing argument, root-route, headed-browser invocation, interruption, and no-static-test-route tests for `runVisibleClientDemo` in `tests/client-demo-package.test.mjs`.
- [X] T014 [P] [US2] Add Playwright coverage for fixture sign-in, connected machines, aggregate health, policy preview, explicit confirmation boundary, safe failure, and narrow/wide viewport states in `browser-tests/client-demo-package.spec.mjs`.
- [X] T015 [US2] Implement `runVisibleClientDemo`, loopback-port parsing, headed-browser launch, printed local root URL, safe stop handling, and fixture cleanup in `scripts/run-visible-client-demo.mjs`.
- [X] T016 [US2] Add client-operations presenter steps, eight-minute timing, checkpoint narration, default stop before confirmation, optional fixture-only confirmation labeling, and restart recovery in `docs/client-demo-presenter-runbook.md`.
- [X] T017 [US2] Add client sign-in, machines/health, preview, confirmation-boundary, and cleanup shot/recording instructions in `docs/client-demo-capture-brief.md`.

**Checkpoint**: The client workflow uses the real local control-plane root route and fixture-backed supported behavior, never the static test URL or a live service.

## Phase 5: User Story 3 - Deliver a Credible Presentation Package (Priority: P2)

**Goal**: Make the two-workflow package reviewable, recoverable, and honest about evidence, ownership, deliverables, and readiness limits.

**Independent Test**: An independent reviewer follows the runbook and capture brief, locates every evidence item, and maps every FR to a check without source-code interpretation.

- [X] T018 [P] [US3] Add tests that validate evidence manifests contain only allowlisted fields, required owner/approval metadata, and no readiness-overclaim language in `tests/client-demo-package.test.mjs`.
- [X] T019 [P] [US3] Add a requirements-to-runbook/checkpoint/evidence traceability table in `docs/client-demo-presenter-runbook.md`.
- [X] T020 [US3] Add evidence locations, owner roles, approval criteria, deliverable formats, retention/disposition, external-gate disclosure, and stop/recovery rules in `docs/client-demo-presenter-runbook.md`.
- [X] T021 [US3] Add capture-manifest fields, human approval workflow, and unsafe-capture discard rules in `docs/client-demo-capture-brief.md`.

**Checkpoint**: The package explicitly separates successful local synthetic demonstrations from production/client, accessibility, performance, visual, canary, and release approval.

## Phase 6: Polish and validation

**Purpose**: Verify the implemented package, record only safe local evidence, and preserve explicit external gates.

- [X] T022 [P] Run the focused fixture/launcher/route/privacy test suite and record command, result, duration, and safe artifact references in `specs/016-client-ready-demo-package/quickstart.md`.
- [X] T023 [P] Run the dedicated browser workflow tests and one manual headed smoke session; record only redacted synthetic evidence and unavailable prerequisites in `specs/016-client-ready-demo-package/quickstart.md`.
- [X] T024 Verify the runbook, capture brief, contracts, and implementation contain no real key, customer data, external-provider request, static test-route presentation, or unsupported readiness claim in `specs/016-client-ready-demo-package/quickstart.md`.
- [X] T025 Run Spec Kit convergence against `spec.md`, `plan.md`, and `tasks.md`, append only remaining implementation gaps, and preserve all Spec 014/015 boundaries in `specs/016-client-ready-demo-package/tasks.md`.

## Phase 7: Founder-approved platform default

**Purpose**: Make the platform shell the early-stage local default while preserving the former dashboard as an explicit, immediately usable fallback and recording the Founder as the sole current decision owner.

- [X] T026 Add default-root, explicit-disable, and `/legacy` fallback route tests in `tests/server.test.mjs` and update the UI-policy default assertion in `tests/policy-validate.test.mjs`.
- [X] T027 Serve `dashboard/app.html` from `/` by default, retain `dashboard/index.html` at `/legacy` and `/index.html`, and send disabled `/app` requests to `/legacy` in `dashboard/server.mjs` and `dashboard/ui-platform.mjs`.
- [X] T028 Record the Founder self-review decision, narrow route scope, and explicit evidence boundary in `specs/016-client-ready-demo-package/{spec.md,plan.md,quickstart.md,tasks.md}` and `docs/{client-demo-presenter-runbook.md,client-demo-capture-brief.md}`.
- [X] T029 Run focused platform/default-route, client-demo package, browser, and headed-smoke validation; record only actual evidence and leave unavailable environments explicitly unavailable in `specs/016-client-ready-demo-package/quickstart.md`.
- [X] T030 Normalize the platform client’s root-route alias, preserve root overview navigation, and add the post-onboarding root/CSS browser regression check in `dashboard/{app.html,static/app-platform.mjs}` and `browser-tests/ui-platform.spec.mjs`.
- [X] T031 Preserve selected time presets, make scope/refresh completion visible, and wait for Windows onboarding-fixture cleanup in `dashboard/static/app-platform.mjs`, `browser-tests/client-demo-package.spec.mjs`, and `tests/fixtures/onboarding-fixture.mjs`.

## Dependencies & Execution Order

`Phase 1 → Phase 2 → US1 and US2 → US3 → validation`.

- T007/T008 block all story implementation because every workflow consumes the safe fixture/evidence boundary.
- US1 depends only on the existing onboarding baseline and can proceed after the boundary/documentation setup.
- US2 consumes the T007 fixture interfaces and must wait for T013/T014 tests before T015.
- US3 can begin documentation traceability in parallel with US1/US2 but requires their final checkpoints before validation.

## Requirement Coverage

| Requirement | Tasks |
|---|---|
| FR-016-001 | T001, T003, T009–T012 |
| FR-016-002 | T009–T012, T022–T024 |
| FR-016-003 | T003–T008, T013–T017 |
| FR-016-004 | T004–T008, T013–T015, T022–T024 |
| FR-016-005 | T010, T016, T019–T020 |
| FR-016-006 | T002, T012, T017, T021 |
| FR-016-007 | T007–T008, T018–T021, T022–T024 |
| FR-016-008 | T001–T003, T018–T021, T024 |
| FR-016-009 | T001, T003, T010, T020, T025 |
| FR-016-010 | T006–T008, T013, T015–T016, T022–T024 |
| FR-016-011 | T026–T031 |

## Parallel Opportunities

- T002–T006 can be completed in parallel because each changes a separate document or test concern.
- After T007, T009/T010/T011/T012 can progress alongside T013/T014 because onboarding and client-demo files are distinct.
- T018/T019 can progress while the US1/US2 documentation tasks are underway; T020/T021 then consolidate their outputs.

## Implementation Strategy

1. Deliver the safe fixture and evidence boundary first.
2. Validate the existing onboarding narrative as the MVP without changing the launcher.
3. Add the local cloud client-demo launcher and browser tests.
4. Complete evidence/capture documentation and perform focused validation.

No implementation task is authorized or started by this specification/planning session.
