# Tasks: Visible Onboarding Journey

**Input**: Design documents from `/specs/014-visible-onboarding-journey/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/setup-onboarding-contract.md`, and `quickstart.md`

**Tests**: Focused tests are required by the feature. Do not run the full `npm test` suite for this user-requested implementation pass.

## Global Constraints

- Node.js 24+, ESM `.mjs` modules, and no new runtime dependency.
- Provider/model metadata is registry/configuration-derived; Z.ai GLM is not treated as registered.
- Any fixture LLM traffic remains behind the loopback gateway; the fixture rejects all non-loopback dependency egress and inherited real keys.
- A raw provider key may exist only in the one-time server-side validation handoff and the approved committed `.env`; it is absent from browser persistence, URLs, reviews, logs, screenshots, and evidence.
- Only the explicit setup commit writes configuration, and only inside the fixture/customer root selected by dashboard configuration.
- Run focused checks only; do not execute the full `npm test` suite.

## Phase 1: Setup

**Purpose**: Establish truthful journey metadata and focused test locations.

- [X] T001 Update `docs/quality-assurance/journey-catalog.yaml` and `docs/quality-assurance/runbooks/JRN-001-first-value-byok.md` to identify the current legacy setup baseline, the compatibility-bridge target, and DeepSeek-only canary boundary.
- [X] T002 [P] Create focused test scaffolds in `tests/setup-onboarding-contract.test.mjs`, `tests/onboarding-fixture.test.mjs`, and `browser-tests/legacy-setup-onboarding.spec.mjs` for the specified checkpoints and evidence contract.

---

## Phase 2: Foundational Safety and Setup Contracts

**Purpose**: Build the secret-safe provider choice, validation handoff, and redacted plan boundary that every journey uses.

**⚠️ CRITICAL**: Complete this phase before browser automation or a visible founder run.

### Interfaces

- `listSetupProviders(): Array<{ id: string, displayName: string, keyEnv: string, models: string[] }>` returns registered, non-secret BYOK metadata only.
- `createSetupValidation({ providerId: string, modelId: string, secret: string, sessionId: string }): Promise<{ id: string, status: 'valid' | 'invalid' | 'timeout' | 'unavailable', summary: string }>` retains `secret` only server-side on success and returns no raw endpoint/key data.
- `getValidatedSetupChoice({ validationId: string, sessionId: string }): { providerId: string, modelId: string, secret: string }` rejects missing, expired, mismatched, or already-consumed identifiers.
- `buildSetupReview({ tenantName: string, agents: string[], choice: { providerId: string, modelId: string }, monthlyBudgetUsd: number }): { budget: object, route: object, files: string[] }` is pure and contains no secret or `.env` content.
- `commitValidatedSetup({ review: object, reviewId: string, validationId: string, sessionId: string }): { filesWritten: string[] }` consumes a matching validation once and writes only to the configured root; a normal first-time setup cannot force an overwrite.

- [X] T003 Write failing redaction, provider/model route, validation-expiry, and commit-boundary tests in `tests/setup-onboarding-contract.test.mjs` and `tests/setup-wizard-core.test.mjs`.
- [X] T004 [P] Export safe registered-provider metadata access from `provider-wizard.mjs`, with focused coverage in `tests/provider-wizard.test.mjs` that exposes no key values and excludes unregistered Z.ai GLM.
- [X] T005 Create `setup-validation-session.mjs` as the server-memory setup validation-session helper, with opaque IDs, expiry, one-use commit semantics, and deterministic test seams.
- [X] T006 Make provider connection validation injectable and redacted in `provider-conformance.mjs`, including loopback-only fixture support and safe `AUTH_FAILED`, `TIMEOUT`, and `UNAVAILABLE` recovery results.
- [X] T007 Update `setup-wizard-core.mjs` to build a selected provider/model route and a redacted review summary, while retaining secret-bearing generated content only on the server-side commit path and refusing any pre-existing setup target (`.ai/policy.yaml`, `.ai/tenant.yaml`, or `.env`).
- [X] T008 Implement the setup status, provider-validation, redacted plan, and guarded commit contracts in `dashboard/server.mjs`; reject existing installations and missing/expired/mismatched validation identifiers without mutating process environment.
- [X] T009 Prove the HTTP contracts, no-write review, all-target existing-install protection, secret absence, and DeepSeek/Z.ai catalog boundary in `tests/server.test.mjs` and `tests/setup-onboarding-contract.test.mjs`.

**Checkpoint**: A focused HTTP test can select a registered provider/model, validate with a synthetic dependency, see only redacted data in review, and explicitly commit only to an isolated root.

---

## Phase 3: User Story 1 - Watch a Safe First-Time Setup (Priority: P1) 🎯 MVP

**Goal**: A founder can complete the real legacy setup flow as a first-time individual with an explicit provider/model connection result and no real provider use.

**Independent Test**: Start a clean local fixture, complete all user-visible setup steps with a loopback provider, prove review does not write, then explicitly commit and observe completion.

- [X] T010 [P] [US1] Add failing accessible DOM/source expectations for setup labels, required controls, synthetic/disposable labelling, provider/model selection, and safe error presentation in `tests/setup-onboarding-contract.test.mjs`.
- [X] T011 [US1] Update `dashboard/setup.html` with a keyboard-operable provider/model selection and one-time key submission step; keep raw credentials out of `localStorage`, URLs, review, completion, and visible diagnostics.
- [X] T012 [US1] Update `dashboard/setup.html` review and commit handling to use the opaque validation identifier, show the selected redacted route/budget/file summary, and preserve the review-before-write action.
- [X] T013 [US1] Add a setup-mode synthetic/disposable indicator controlled only by the isolated fixture in `dashboard/setup.html` and `dashboard/server.mjs`, ensuring customer runs are never falsely labelled as synthetic.
- [X] T014 [US1] Update `docs/quality-assurance/runbooks/JRN-001-first-value-byok.md` and `docs/quality-assurance/journey-catalog.yaml` with the observed current workflow, customer-value wording, recovery boundary, and client-review restrictions.

**Checkpoint**: The legacy `/setup` experience is a truthful, usable first-time provider/model onboarding flow, independently verifiable through user-facing controls.

---

## Phase 4: User Story 2 - Reproduce the Journey Automatically (Priority: P1)

**Goal**: The same setup journey is repeatable with a fresh browser, temporary root, loopback dependencies, and redacted evidence.

**Independent Test**: Run the named browser journey from a clean process; verify all checkpoints and inspect its manifest/result without finding a sentinel or non-loopback attempt.

- [ ] T015 [P] [US2] Implement `tests/fixtures/onboarding-fixture.mjs` to create a temporary root, sanitized child environment, loopback mock provider/gateway, requested-or-ephemeral dashboard port, redaction scan, and cleanup lifecycle.
- [ ] T016 [P] [US2] Extend `tests/fixtures/persona-network-guard.mjs` and `tests/onboarding-fixture.test.mjs` with browser/origin allowlisting, redirect rejection, inherited-key isolation, and attempt-ledger assertions.
- [ ] T017 [US2] Implement desktop, narrow, keyboard, review-before-commit, explicit-commit, DOM-sentinel, and safe-evidence checks in `browser-tests/legacy-setup-onboarding.spec.mjs`; disable raw trace retention for this journey.
- [ ] T018 [US2] Implement the redacted manifest/result/diagnostic writer and non-pass triage generation in `tests/fixtures/onboarding-fixture.mjs`, validating it through `tests/onboarding-fixture.test.mjs` and `tests/fixtures/evidence-contract.mjs`.
- [ ] T019 [US2] Add `scripts/run-visible-onboarding.mjs` to start the same isolated fixture in a headed fresh browser on a user-selected free local port and print only synthetic-safe walkthrough information.

**Checkpoint**: A focused standard run produces safe evidence and a founder can watch the identical journey on a disposable local dashboard.

---

## Phase 5: User Story 3 - Recover from a Provider Failure (Priority: P2)

**Goal**: A first-time user sees a safe, actionable recovery path when provider validation cannot succeed.

**Independent Test**: Switch the loopback provider to authorization, timeout, or unavailable behavior, confirm completion is blocked, then retry a success state without losing non-secret decisions.

- [ ] T020 [P] [US3] Add failure/retry contract tests for authorization, timeout, unavailable, no-secret persistence, and completion blocking in `tests/setup-onboarding-contract.test.mjs`.
- [ ] T021 [US3] Implement visible non-secret recovery, retry/back handling, focus management, and validation-session replacement in `dashboard/setup.html` and `dashboard/server.mjs`.
- [ ] T022 [US3] Extend `browser-tests/legacy-setup-onboarding.spec.mjs` and `tests/onboarding-fixture.test.mjs` with controlled provider failure → retry → success evidence.

**Checkpoint**: Failed provider validation cannot commit configuration and has an understandable recovery path at both required viewport widths.

---

## Phase 6: User Story 4 - Prepare a Controlled Live Canary (Priority: P3)

**Goal**: A founder has a non-executable, bounded DeepSeek canary procedure without turning standard testing into paid traffic.

**Independent Test**: A reviewer can fill a complete DeepSeek approval record and see Z.ai GLM reported as unregistered; no focused command makes a live request.

- [ ] T023 [US4] Update `docs/quality-assurance/templates/live-canary-approval.md`, `docs/quality-assurance/evidence-and-release-model.md`, and `docs/quality-assurance/release-scorecard.md` with the DeepSeek-only readiness criteria, local-key ownership, spend/duration caps, stop/revocation action, and unregistered-provider block.
- [ ] T024 [US4] Add focused contract coverage in `tests/quality-assurance-blueprint.test.mjs` and `tests/setup-onboarding-contract.test.mjs` proving a standard run cannot be marked live-canary-ready without a complete approval and that Z.ai GLM is not presented as registered.

**Checkpoint**: The project has a truthful manual-canary preparation layer without automated or hidden use of any real key.

---

## Phase 7: Polish and Verification

**Purpose**: Verify the integrated slice, documentation, and evidence boundaries.

- [ ] T025 Update `specs/014-visible-onboarding-journey/quickstart.md` with the implemented focused commands, visible-run behavior, expected evidence locations, and cleanup steps.
- [ ] T026 Run focused Node and browser checks named by this feature, inspect generated safe evidence, and record results in `specs/014-visible-onboarding-journey/tasks.md` without running the full test suite.
- [ ] T027 Run `git diff --check`, confirm no test has `.only()`, verify that no real key/artifact is tracked, and update `specs/014-visible-onboarding-journey/tasks.md` with final status.

## Dependencies and Execution Order

1. Phase 1 establishes the source locations and test intent.
2. Phase 2 is a hard blocker: secret-safe provider/session and server contracts must exist before UI or fixture work.
3. US1 delivers a visible, independently usable setup path.
4. US2 automates and records that same path.
5. US3 extends US1/US2 with provider recovery.
6. US4 is documentation/contract-only and must not enable live traffic.
7. Polish runs the focused checks and hygiene review.

## Parallel Opportunities

- T002 may be created alongside T001.
- T004 can proceed while T003 is being written.
- T010 can be prepared while the foundational server contracts are completed.
- T015 and T016 can proceed in parallel after the server contract is stable.
- T020 can be written while the automated success path is being completed.

## Implementation Strategy

1. Deliver the safety boundary and route-aware server contract first.
2. Make the actual `/setup` flow usable and visible before building evidence automation.
3. Use the isolated fixture to exercise only user-facing controls; do not substitute direct database setup for the journey.
4. Add failure/retry proof after the happy path is reliable.
5. Keep a live provider run manual, approved, cost-bounded, and DeepSeek-only.
