# Feature Specification: Unified Onboarding

**Feature Branch**: `spec/012-unified-onboarding`

**Created**: 2026-08-11

**Status**: Draft

**Input**: Implement UXF-003 unified first-run onboarding across browser and Electron: a resumable accessible flow that validates a provider, securely hands off secrets, sets a budget, confirms the final plan, and leads a first-time administrator to a first task and observable run while retaining legacy setup during compatibility rollout.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Complete a safe first-run setup (Priority: P1)

A first-time administrator can use one conceptual setup flow to name the installation, choose or accept an agent roster, connect and validate at least one provider, set a monthly dollar budget, review the intended changes, and complete setup without accidentally changing an existing installation.

**Why this priority**: A validated provider and an explicit budget are the minimum safe conditions for a useful first run.

**Independent Test**: Starting with no configuration, complete the browser flow with a valid provider and budget, confirm the review, and inspect the resulting non-secret configuration and completion state.

**Acceptance Scenarios**:

1. **Given** no existing configuration, **When** an administrator completes every required setup step and confirms the final review, **Then** the setup creates one coherent configuration using the selected provider, agent roster, and budget.
2. **Given** an existing configuration is detected, **When** an administrator opens the unified flow, **Then** the flow explains that setup is not a replacement path and offers a safe return to the existing dashboard or recovery guidance without modifying configuration.
3. **Given** a provider is selected, **When** its connection cannot be validated, **Then** setup does not permit completion, identifies the failed step without revealing the secret, and offers Retry and Back recovery actions.
4. **Given** a final review is displayed, **When** the administrator has not explicitly confirmed it, **Then** no configuration is committed.

---

### User Story 2 - Resume setup without retaining credentials (Priority: P1)

A first-time administrator who leaves setup, loses connectivity, or receives a recoverable validation error can resume at the appropriate step with non-secret decisions intact while provider credentials are never stored in browser storage, URLs, telemetry, logs, or review output.

**Why this priority**: Setup interruption is common, while credential exposure is unacceptable.

**Independent Test**: Enter non-secret setup choices and a provider secret, interrupt the flow before completion, reopen it, and verify the non-secret draft resumes while the secret is absent from all browser-persisted state and must be entered again.

**Acceptance Scenarios**:

1. **Given** an administrator has completed one or more non-secret steps but not committed setup, **When** they leave and later return on the same installation, **Then** the flow resumes their progress and non-secret choices at the last safe step.
2. **Given** provider validation fails, **When** Retry is selected, **Then** entered non-secret provider configuration remains available, the error explains a safe recovery action, and the secret is requested again if needed.
3. **Given** a provider secret is entered in the browser flow, **When** the step changes, setup is cancelled, validation fails, or the page is reopened, **Then** the secret is not present in browser-persisted storage, URLs, diagnostics, telemetry, logs, the plan, or the final review.
4. **Given** connectivity is unavailable during provider validation, **When** the administrator returns after connectivity is restored, **Then** they can retry validation without re-entering non-secret decisions.

---

### User Story 3 - Follow the same flow in Electron (Priority: P2)

An Electron user follows the same ordered steps, labels, required decisions, validation outcomes, review, and completion experience as a browser user, while Electron uses the operating system's secure credential storage rather than browser storage or renderer-owned secret persistence.

**Why this priority**: Electron is a first-class installation surface; divergent wizards create support burden and different security expectations.

**Independent Test**: On a first-run Electron installation, complete setup with a valid provider and compare the recorded provider, budget, first-value checklist, and recovery outcomes with the browser scenario.

**Acceptance Scenarios**:

1. **Given** a first-run Electron installation, **When** the administrator proceeds through setup, **Then** every browser step has an equivalent Electron step with the same requirement and recovery meaning.
2. **Given** an Electron user enters a provider secret, **When** setup validates or completes, **Then** the secret is handed to the trusted desktop process for secure storage and is not exposed through the renderer bridge, logs, review, or completion checklist.
3. **Given** Electron cannot access secure credential storage, **When** a secret handoff is attempted, **Then** setup blocks completion, states that credentials could not be stored securely, and provides a non-secret recovery path.

---

### User Story 4 - Reach first value after setup (Priority: P2)

After successful setup, an administrator receives a persistent, actionable first-value checklist that explains the remaining path to create or import a first task and observe its first run, with durable links to the relevant application destinations.

**Why this priority**: A completed configuration is not the user outcome; the user must be able to start and observe productive work.

**Independent Test**: Complete setup, open the dashboard, use the checklist to create or import a first task, and follow its run link to the corresponding observable run record.

**Acceptance Scenarios**:

1. **Given** setup completes successfully, **When** the dashboard opens, **Then** it displays a first-value checklist showing setup status, a link to create or import the first task, and a link that becomes available for its first run.
2. **Given** a first task has not yet been created, **When** the administrator returns to the dashboard, **Then** the checklist remains available and clearly indicates the next action.
3. **Given** a first task creates a run, **When** the administrator follows the checklist run link, **Then** the destination retains enough context to identify that first run and its current status.

### Edge Cases

- A browser refreshes, closes, changes viewport, loses network access, or returns after a recoverable provider-validation failure while a non-secret setup draft exists.
- The administrator supplies blank, malformed, duplicate, or unsupported non-secret provider data; no provider is selected; or a budget is zero, negative, or non-numeric.
- Provider validation times out, returns malformed data, reports an unauthorized credential, or succeeds just as the user changes the selected provider or leaves the step.
- Browser storage is unavailable, corrupt, or cleared; setup remains usable and reports that progress cannot be resumed rather than failing or retaining a secret.
- The application starts with existing configuration, a partially written legacy configuration, or an upgrade from the legacy setup flow.
- An Electron secure-storage call or its trusted bridge is unavailable, rejected, or interrupted.
- A keyboard-only, screen-reader, reduced-motion, 320 px-wide, or 200%-zoom user completes, retries, or exits every setup step.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-301**: The system MUST provide a routeable, ordered, resumable setup stepper shared conceptually by browser and Electron for installation identity, agent roster, provider connection, budget, review, and completion.
- **FR-302**: The system MUST require at least one selected provider to pass validation before an administrator can commit first-run setup.
- **FR-303**: The system MUST preserve completed non-secret choices and the last safe step for resumption until setup is committed, cancelled, or deliberately cleared.
- **FR-304**: The system MUST exclude provider secrets from browser-persisted storage, URLs, telemetry, logs, diagnostics, setup plans, review content, and completion content; browser secrets may be used only for a single in-memory handoff.
- **FR-305**: The system MUST hand browser-provider secrets to the server only for the requested setup operation and persist them only in the installation's approved environment-secret location; it MUST redact secret-bearing values from every response and failure.
- **FR-306**: The system MUST hand Electron-provider secrets from the isolated renderer through a narrow, allow-listed trusted bridge to operating-system secure credential storage; the renderer MUST not retain secrets after handoff.
- **FR-307**: The system MUST present provider-validation success, failure, pending, timeout, and retry states with non-secret, actionable recovery guidance.
- **FR-308**: The system MUST require a positive monthly dollar budget and show the user-facing resulting budget policy before commit.
- **FR-309**: The system MUST require an explicit final review confirmation before writing setup configuration and MUST list only non-secret changes, selected provider identity, budget, and agent roster.
- **FR-310**: The system MUST detect an existing installation configuration and prevent the unified first-run flow from overwriting it; the user MUST receive a safe return or recovery path.
- **FR-311**: The system MUST retain the legacy browser and Electron setup paths behind the existing compatibility release control until the unified flow has been enabled and validated for its intended audience.
- **FR-312**: The system MUST normalize the user-visible setup status, provider-validation result, plan, commit outcome, and recoverable failure semantics across browser and Electron without changing unrelated existing API contracts.
- **FR-313**: The system MUST present the setup flow at WCAG 2.2 AA, including a programmatically conveyed current step and step count, keyboard-operable controls, visible focus, labelled fields and errors, status announcements, and reduced-motion behavior.
- **FR-314**: The system MUST provide a persistent first-value checklist after successful commit with links to create or import a first task and, once available, observe its first run through stable application destinations.
- **FR-315**: The system MUST record non-secret setup lifecycle and provider-validation outcomes sufficient for support and audit without recording credentials or raw sensitive provider responses.
- **FR-316**: The system MUST document browser and Electron first-run, interruption, credential-recovery, existing-installation, and first-value recovery paths for administrators and support staff.

### Key Entities

- **Setup Draft**: A resumable, non-secret record of selected installation identity, agent roster, provider metadata, budget, completed steps, and last safe step.
- **Provider Validation Result**: A non-secret outcome for one selected provider, including status, timestamp, capability summary, recoverable reason, and retry availability.
- **Secret Handoff**: A single-use credential transfer whose browser and Electron owners, allowed destinations, redaction rules, and expiry are defined by the installation surface.
- **Setup Review**: A non-secret summary of the configuration that would be committed, including the explicit confirmation state.
- **First-Value Checklist**: The post-setup progress record that links configuration completion, first-task creation or import, and the first observable run.
- **Setup Lifecycle Event**: A non-secret auditable record of draft, validation, review, commit, completion, interruption, or recovery state.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-301**: At least 75% of representative first-time administrators complete a validated-provider, budgeted first-run setup in 10 minutes or less without support intervention.
- **SC-302**: 100% of browser and Electron interruption/recovery tests preserve only intended non-secret setup choices; zero test scans find a provider secret in browser storage, URL history, review data, logs, telemetry, diagnostics, or response fixtures.
- **SC-303**: 100% of supported provider-validation failures provide a visible non-secret reason and a Retry or Back recovery action, and no such failure allows configuration commit.
- **SC-304**: 100% of browser and Electron first-run scenarios produce equivalent selected-provider identity, budget, agent-roster, review-confirmation, and first-value checklist outcomes.
- **SC-305**: 100% of keyboard-only and automated accessibility checks for stepper progression, validation recovery, review confirmation, and checklist links meet WCAG 2.2 AA.
- **SC-306**: 100% of existing-configuration and compatibility-release scenarios leave legacy setup and existing configuration unchanged unless an explicitly authorized, separately documented migration is performed.
- **SC-307**: 100% of successful setup completions expose a durable first-task action, and every created first run can be reached from its checklist link without losing run identity or status context.

## Assumptions

- At least one successfully validated provider is mandatory for completing this first-value flow; a user who only wants to inspect an existing installation uses the safe return/recovery path.
- The existing default agent roster remains the starting suggestion, but an administrator may change it and must retain at least one agent.
- Browser setup retains non-secret drafts locally only; it stores provider credentials only through a single-operation server handoff to the approved environment-secret location and never returns them.
- Electron setup uses the existing context-isolated renderer and operating-system credential storage as the sole approved secret owner; an unavailable keychain is a blocking, recoverable error.
- The UI platform foundation supplies the `/app` route namespace, shared visual tokens, accessible primitives, feature-flagged legacy coexistence, and application data-boundary conventions before this feature is implemented.
- Plugin marketplace configuration, advanced tenant provisioning, new provider business models, and migration of unrelated dashboard workflows are out of scope.
