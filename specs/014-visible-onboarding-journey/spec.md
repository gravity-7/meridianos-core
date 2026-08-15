# Feature Specification: Visible Onboarding Journey

**Feature Branch**: `014-visible-onboarding-journey`

**Created**: 2026-08-14

**Status**: Draft

**Input**: User description: "Start the first visible, isolated solo-BYOK onboarding journey: use the real setup wizard in a browser, record the workflow and evidence, keep default runs synthetic, and prepare rather than automatically execute any real-key canary."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Watch a Safe First-Time Setup (Priority: P1)

As the founder, I can launch a disposable new MeridianOS installation locally and watch a first-time individual complete the existing browser setup flow with a simulated BYOK provider, so I can understand the real screens, clicks, review point, and completion result without spending money or exposing a credential.

**Why this priority**: A visible, repeatable human journey is the quickest trustworthy proof of the product's current onboarding experience.

**Independent Test**: From a clean local installation, start the documented visible journey and observe the setup flow reach its safe completion using only synthetic data and a simulated provider.

**Acceptance Scenarios**:

1. **Given** no existing installation configuration, **When** the founder launches the visible journey, **Then** the browser opens the current setup flow against an isolated local installation and identifies it as demonstration data.
2. **Given** the simulated provider is available, **When** the founder completes every mandatory setup decision and explicitly confirms the review, **Then** the setup reaches its expected completion state without contacting a real provider, payment, email, or production system.
3. **Given** an existing installation configuration is present, **When** the visible journey is launched, **Then** it uses a separate disposable installation and does not read, overwrite, or alter the existing configuration.

---

### User Story 2 - Reproduce the Journey Automatically (Priority: P1)

As a release owner, I can run the same first-time journey automatically through visible browser controls and receive a named, redacted evidence bundle, so a regression is detectable without relying on founder memory.

**Why this priority**: A one-off walkthrough is useful, but repeatable evidence is needed before the workflow can be trusted for demonstrations or releases.

**Independent Test**: Run the named onboarding check from a clean workspace and confirm it records each expected user-visible checkpoint, including the review-before-commit safeguard and the final outcome.

**Acceptance Scenarios**:

1. **Given** the standard fixture, **When** the automated journey runs, **Then** it uses user-facing browser interactions for the setup steps and verifies the expected outcome after each critical decision.
2. **Given** the setup review is visible, **When** no explicit confirmation has been made, **Then** the check proves that no setup configuration is committed.
3. **Given** the journey finishes or fails, **When** its evidence is stored, **Then** it is labelled with the journey and fixture revision, contains the relevant screenshots and outcome, and contains no provider secret, token, or real customer data.

---

### User Story 3 - Recover from a Provider Failure (Priority: P2)

As a first-time individual, I receive an understandable recovery path if provider validation fails, so I do not mistake a failed connection for successful onboarding or accidentally commit an unsafe setup.

**Why this priority**: Provider failure is a common first-run risk and is a prerequisite for later controlled live-provider checks.

**Independent Test**: Run the provider-failure fixture, observe the actionable failure and retry/back path, and prove that setup cannot be completed while the provider is invalid.

**Acceptance Scenarios**:

1. **Given** a simulated provider reports an authorization, timeout, or unavailable error, **When** validation occurs, **Then** the visible flow shows a non-secret recovery message and does not allow completion.
2. **Given** the user selects the offered recovery action, **When** the provider becomes available, **Then** the user can retry without restarting unrelated safe setup choices.

---

### User Story 4 - Prepare a Controlled Live Canary (Priority: P3)

As the founder, I can see exactly what must be approved before using a newly generated DeepSeek BYOK key in the same workflow, so a real-provider proof is deliberate, limited, and reversible. A provider that is not registered, such as Z.ai GLM today, remains outside this canary until its registry and routing support are separately implemented and verified.

**Why this priority**: Live validation is valuable only after the synthetic route is reliable and only with a clear stop and revocation plan.

**Independent Test**: A reviewer can complete the approval record for a named journey, key owner, provider, spend cap, duration, rollback action, and evidence classification; no live request is made by the standard automated journey.

**Acceptance Scenarios**:

1. **Given** the synthetic journey has not passed, **When** a user requests a live-provider run, **Then** the workflow identifies it as blocked rather than using a key.
2. **Given** a named approval is complete, **When** a live canary is later started manually, **Then** its scope, cost cap, stop condition, evidence label, and key-revocation action are visible before any request is made.

### Edge Cases

- The requested local port is already in use, the browser cannot be started, or the user closes the visible demonstration early.
- The fixture accidentally attempts to access a non-loopback URL, or a simulated service redirects to an external address.
- The setup flow changes its labels, controls, or completion screen after the journey is recorded.
- A screenshot, console record, browser storage value, URL, or generated report contains a synthetic sentinel credential or other sensitive-looking value.
- A real key is present in the developer's environment when the standard synthetic journey runs.
- A user asks to run against DeepSeek or Z.ai GLM before the standard journey and explicit canary approval are complete.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The product quality tooling MUST provide a named, documented first-time individual setup journey that uses the current browser setup experience and an isolated disposable installation.
- **FR-002**: The standard journey MUST use only synthetic identities, configuration, provider responses, and credential-shaped sentinel values; it MUST reject any non-loopback dependency endpoint and MUST not use a real provider key even if one is available locally.
- **FR-003**: A founder MUST be able to run the journey in a visible local browser session on a chosen local port when that port is available, with a clear indication that the data is synthetic and disposable.
- **FR-004**: The automated journey MUST exercise the setup flow through user-visible controls and verify the welcome, mandatory setup decisions, provider outcome, budget, review-before-commit safeguard, explicit commit, and completion state that the current product supports.
- **FR-005**: The standard journey MUST verify at desktop and narrow-screen widths, essential keyboard operation, and at least one provider-recovery state; a changed or missing expected control MUST fail with diagnostic evidence.
- **FR-006**: A provider-validation failure scenario MUST use controlled simulated authorization, timeout, or unavailable responses, show a non-secret recovery path, and prevent setup completion while invalid.
- **FR-007**: Every run MUST produce or update a redacted evidence record containing its journey identifier, fixture revision, start and finish time, result, expected/actual checkpoints, and references to allowed screenshots or diagnostics.
- **FR-008**: The saved founder runbook MUST describe the observed workflow in plain language, label it as a synthetic demonstration, distinguish present product behavior from planned unified onboarding, and include recovery guidance.
- **FR-009**: The standard journey MUST scan its browser-visible and generated evidence for the synthetic credential sentinel and fail if it is exposed outside the expressly allowed in-memory test handoff.
- **FR-010**: The feature MUST provide a live-canary preparation record for registered DeepSeek BYOK that requires a named human approver, a user-local key owner, a provider/model scope, a finite spend cap and duration, rollback/stop conditions, evidence classification, and post-run key revocation; this feature MUST NOT make a live-provider request automatically. An unregistered provider, including Z.ai GLM in the current registry, MUST be reported as unsupported rather than represented as canary-ready.
- **FR-011**: The implementation MUST not alter, read from, or delete a developer's existing dashboard configuration, data, credentials, or real external accounts.

### Key Entities

- **Visible Onboarding Fixture**: A disposable local installation and simulated dependencies for the named first-time setup journey.
- **Journey Checkpoint**: A user-visible setup state, action, or result that is verified and recorded during the journey.
- **Synthetic Credential Sentinel**: A non-functional credential-shaped value used solely to detect accidental disclosure in the test environment.
- **Evidence Record**: The redacted outcome and allowed diagnostics associated with one journey execution.
- **Live Canary Preparation**: A non-executable approval record defining the allowed scope and safeguards for a later real-provider run.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A founder can launch and observe the synthetic first-time onboarding journey on a clean local installation in five minutes or less.
- **SC-002**: 100% of standard journey runs make zero non-loopback dependency requests and zero requests to payment, email, or live-provider systems.
- **SC-003**: The automated journey verifies every required checkpoint in the current setup flow at desktop and narrow-screen widths, including the pre-commit safeguard, and produces a result that identifies a failure checkpoint.
- **SC-004**: 100% of checked evidence locations are free of the synthetic credential sentinel after a standard run.
- **SC-005**: A non-technical founder can follow the updated runbook and explain the first-time BYOK workflow, its simulation boundary, and its provider-failure recovery path in under ten minutes.
- **SC-006**: No standard or continuous-integration run makes a live DeepSeek or Z.ai GLM request; a live canary cannot be represented as ready without a complete, current approval record.

## Assumptions

- The current legacy browser setup route is the implementation target for this first slice; the planned unified `/app/setup` flow remains a separately tracked draft and must not be presented as implemented.
- The visible local session is a founder-operated demonstration aid, while continuous integration uses isolated non-interactive instances and records only approved evidence.
- The project may use a testability seam or controlled simulated dependency as needed, but it must preserve the product gateway as the normal metering boundary for any simulated AI traffic.
- The first delivery covers a solo administrator's browser flow and provider recovery; organization roles, billing, Docker, desktop, and live canaries remain catalogued future journeys.
- A future DeepSeek live canary is initiated manually by the key owner from their local environment after they complete the approval record; keys are never supplied through chat, committed configuration, test fixtures, screenshots, or logs. Z.ai GLM requires a separate provider-registration feature first.

## Out of Scope

- Implementing or redesigning the planned unified `/app/setup` onboarding flow.
- Automatically creating external provider accounts or app tenants, retrieving a key, or sending a real credential from the test suite.
- Making a live DeepSeek, Z.ai GLM, payment, subscription, email, or production-data request.
- Expanding the first slice to organization, billing, Docker, or Electron journeys.
