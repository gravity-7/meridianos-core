# Tasks: Persona Testing Blueprint

**Input**: Design documents from `specs/013-persona-test-blueprint/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [journey-catalog contract](./contracts/journey-catalog-contract.md), and [quickstart.md](./quickstart.md)

**Tests**: A focused no-network blueprint validation is required by FR-004, FR-008, FR-010, and SC-001 through SC-004. Browser automation is designed and catalogued here, but implementation is deliberately deferred to its own journey-by-journey feature.

**Organization**: Tasks are grouped by user story so each quality asset is independently reviewable and usable.

## Interfaces and File Contract

- `docs/quality-assurance/journey-catalog.yaml` is the source of truth and conforms to `specs/013-persona-test-blueprint/contracts/journey-catalog-contract.md`.
- Every P1 catalog entry exposes `id`, `fixture_profile`, `expected_outcomes`, `verification_lanes`, `browser_expectations`, `evidence_status`, `owner`, and a `runbook` path relative to `docs/quality-assurance/`.
- Every runbook uses `docs/quality-assurance/templates/workflow-runbook.md` and declares the matching `journey_id`, synthetic-data label, review status, and last-verified date.
- `tests/quality-assurance-blueprint.test.mjs` reads the catalog without performing a network request and fails on duplicate IDs, missing P1 fields, broken runbook links, missing browser expectations, or secret-like sample values.
- Raw run evidence belongs under `artifacts/qa/<run-id>/`; only reviewed/redacted illustrative evidence may be linked from version-controlled runbooks.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish the durable quality-assurance documentation home and test entry point.

- [X] T001 Create `docs/quality-assurance/`, `docs/quality-assurance/runbooks/`, and `docs/quality-assurance/templates/` with the file layout defined in `specs/013-persona-test-blueprint/plan.md`.
- [X] T002 Create a failing no-network catalog/runbook validation in `tests/quality-assurance-blueprint.test.mjs` that loads `docs/quality-assurance/journey-catalog.yaml` and asserts the P1 inventory contract.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Define the common vocabulary and contract every catalog entry, runbook, AI agent, and later browser suite uses.

**⚠️ CRITICAL**: Complete this phase before any user-story asset is claimed complete.

- [X] T003 Create the quality-system orientation and evidence-class glossary in `docs/quality-assurance/README.md`.
- [X] T004 Create reusable documentation templates for a workflow runbook, evidence bundle, triage record, and live-canary approval in `docs/quality-assurance/templates/`.
- [X] T005 Update `docs/README.md` to link the quality-assurance home and distinguish reviewed runbooks from transient CI evidence.

**Checkpoint**: The quality home, terminology, templates, and validation entry point are ready.

---

## Phase 3: User Story 1 - Select a Release-Critical Journey (Priority: P1) 🎯 MVP

**Goal**: Give the founder and AI agents one authoritative inventory of personas and release-relevant journeys.

**Independent Test**: The catalog validation finds at least seven personas and fifteen unique journeys; every P1 entry has an owner, fixture profile, expected outcomes, status, and runbook link.

- [X] T006 [US1] Create the seven persona profiles and six reusable fixture-profile references in `docs/quality-assurance/journey-catalog.yaml`.
- [X] T007 [US1] Add controlled provider, payment, email, webhook, subscription, and browser/system dependency scenarios to `docs/quality-assurance/journey-catalog.yaml`.
- [X] T008 [US1] Add the first eight P1 journeys with browser, safety, evidence, and runbook fields to `docs/quality-assurance/journey-catalog.yaml`.
- [X] T009 [US1] Add seven P2/P3 journeys for account/role, project lifecycle, integrations, billing, compliance, subscription, and planned-unified-onboarding coverage to `docs/quality-assurance/journey-catalog.yaml`.
- [X] T010 [US1] Update `tests/quality-assurance-blueprint.test.mjs` so the catalog test validates IDs, P1 references, browser expectations, and no sensitive example values.

**Checkpoint**: A reviewer can select any persona and find a bounded, truthfully labelled test journey without reading source code.

---

## Phase 4: User Story 2 - Run Journeys Safely with Predictable Data (Priority: P1)

**Goal**: Make the standard fixture model safe, repeatable, and ready for later implementation.

**Independent Test**: A reviewer can choose a P1 fixture profile and identify its synthetic data, reset rule, dependency variants, gateway boundary, and prohibited actions.

- [X] T011 [US2] Document the temporary-root, neutral-domain, isolated-server, serialized-worker, and cleanup rules in `docs/quality-assurance/safe-fixture-design.md`.
- [X] T012 [US2] Document the six fixture profiles, synthetic users/roles, project/task/budget/ledger state, and reset manifests in `docs/quality-assurance/safe-fixture-design.md`.
- [X] T013 [US2] Document controlled success, validation-error, denied, timeout, and unavailable behaviours for provider, payment, email, webhook, and subscription dependencies in `docs/quality-assurance/safe-fixture-design.md`.
- [X] T014 [US2] Document test-gateway enforcement, secret/redaction scans, prohibited actions, and human-approved live-canary boundaries in `docs/quality-assurance/safe-fixture-design.md`.

**Checkpoint**: The standard fixture design cannot be mistaken for a production, paid, or live-provider environment.

---

## Phase 5: User Story 3 - Preserve a Client-Ready Workflow Explanation (Priority: P1)

**Goal**: Give the founder concise, accurate, synthetic-data runbooks for all P1 workflows.

**Independent Test**: Each P1 catalog link opens a runbook with user value, synthetic-data label, actions, expected visible result, recovery, review status, and truth boundaries.

- [X] T015 [P] [US3] Create the individual first-value and budget-safety runbooks in `docs/quality-assurance/runbooks/JRN-001-first-value-byok.md` and `docs/quality-assurance/runbooks/JRN-003-budget-safety.md`.
- [X] T016 [P] [US3] Create the organisation project/team, operator-recovery, and viewer-boundaries runbooks in `docs/quality-assurance/runbooks/JRN-005-project-team.md`, `docs/quality-assurance/runbooks/JRN-007-operator-recovery.md`, and `docs/quality-assurance/runbooks/JRN-008-viewer-boundaries.md`.
- [X] T017 [P] [US3] Create the provider-recovery, Docker-dashboard, and desktop-first-run runbooks in `docs/quality-assurance/runbooks/JRN-009-provider-recovery.md`, `docs/quality-assurance/runbooks/JRN-013-docker-dashboard.md`, and `docs/quality-assurance/runbooks/JRN-014-desktop-first-run.md`.
- [X] T018 [US3] Verify every P1 runbook against the sharing/redaction rules and update its review status in `docs/quality-assurance/runbooks/`.

**Checkpoint**: A non-technical founder can rehearse a P1 workflow and accurately say what is simulated, supported, planned, or live-canary-only.

---

## Phase 6: User Story 4 - Get Actionable Automated and Visual Evidence (Priority: P2)

**Goal**: Define a consistent evidence and visual-review model for future browser testing and CI.

**Independent Test**: A reviewer can tell which evidence is deterministic, exploratory, manual demonstration, or live canary and where a failing journey's diagnostic bundle belongs.

- [X] T019 [US4] Create evidence-bundle, visual-review, keyboard/recovery, artifact-retention, and screenshot-approval rules in `docs/quality-assurance/evidence-and-release-model.md`.
- [X] T020 [US4] Add a browser/viewport/interaction matrix for P1 journeys and the existing Chrome/Edge/Firefox CI path in `docs/quality-assurance/evidence-and-release-model.md`.

---

## Phase 7: User Story 5 - Delegate Structured Exploratory Testing to AI (Priority: P2)

**Goal**: Let an AI agent safely explore one named persona journey and produce reusable evidence.

**Independent Test**: A human can hand the playbook plus a journey ID to an agent and receive either an evidence bundle or an actionable triage record without unapproved external action.

- [X] T021 [US5] Create the bounded AI-agent setup, allowed-action, Playwright-MCP exploration, stop-condition, evidence, and defect-report procedure in `docs/quality-assurance/ai-test-agent-playbook.md`.

---

## Phase 8: User Story 6 - Decide Release Readiness from the Same Blueprint (Priority: P3)

**Goal**: Make P1 evidence status and exceptions visible in one release-oriented artifact.

**Independent Test**: A release reviewer can inspect the baseline scorecard and identify the owner and next action for every planned, blocked, skipped, or manual-canary P1 journey.

- [X] T022 [US6] Create the initial P1 release-scorecard baseline, freshness rule, exception process, and current-evidence labels in `docs/quality-assurance/release-scorecard.md`.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Verify consistency, discoverability, and safe client-facing language across the blueprint.

- [X] T023 Verify catalog/runbook links and complete `tests/quality-assurance-blueprint.test.mjs` without making a network call.
- [X] T024 Review `docs/quality-assurance/` against `specs/013-persona-test-blueprint/quickstart.md`, ensuring planned product flows and placeholder reports are never presented as current proven functionality.
- [X] T025 Run formatting/diff hygiene checks and update `specs/013-persona-test-blueprint/tasks.md` to mark completed tasks.

## Dependencies & Execution Order

```text
Setup (T001-T002)
  └─ Foundational vocabulary/templates/index (T003-T005)
      ├─ US1 catalog (T006-T010)
      │   ├─ US2 fixture design (T011-T014)
      │   ├─ US3 runbooks (T015-T018)
      │   ├─ US4 evidence model (T019-T020)
      │   ├─ US5 agent playbook (T021)
      │   └─ US6 scorecard (T022)
      └─ Final consistency validation (T023-T025)
```

## Parallel Opportunities

- After T006-T010 establish catalog IDs, T011-T014, T015-T018, T019-T020, and T021-T022 can proceed in parallel because they write separate files.
- T015, T016, and T017 can run in parallel because they write distinct P1 runbooks.
- The AI-agent playbook and evidence model can be reviewed in parallel once their linked catalog vocabulary is stable.

## Implementation Strategy

### MVP First

1. Complete T001-T010 to publish the catalog and enforce its contract.
2. Complete T011-T014 to make the fixture safety model explicit.
3. Complete T015-T018 to deliver the founder's P1 workflow explanations.
4. Validate the catalog and runbooks before adding additional agent/CI material.

### Incremental Delivery

1. Catalog and safe-fixture design establish a trustworthy testing vocabulary.
2. Runbooks turn that vocabulary into founder/client product knowledge.
3. Evidence, agent, and scorecard assets turn it into a repeatable operational process.
4. The next implementation feature builds P1 fixture helpers and browser tests in the catalog's order.
