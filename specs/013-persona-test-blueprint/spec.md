# Feature Specification: Persona Testing Blueprint

**Feature Branch**: `013-persona-test-blueprint`

**Created**: 2026-08-14

**Status**: Draft

**Input**: User description: "Create a persona journey catalog and safe test-fixture design that becomes the blueprint for AI agents, browser automation, visual checks, and continuous integration. Preserve the steps and outcomes of tested workflows so the founder can learn, demonstrate, and explain them to prospective clients."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Select a Release-Critical Journey (Priority: P1)

As the product founder, I can see a single catalog of the important ways individuals and organisations use MeridianOS, so I know what must be proven before I demonstrate or release the product.

**Why this priority**: A clear, risk-ranked inventory prevents scattered testing and is the prerequisite for every automated, exploratory, and client-facing workflow.

**Independent Test**: A reviewer can open the catalog, choose any persona, and identify its supported journeys, priority, prerequisites, expected outcome, risk level, and current verification status without reading source code.

**Acceptance Scenarios**:

1. **Given** the founder needs to validate a solo operator's first experience, **When** they select the first-time individual operator persona, **Then** they can find the complete setup-to-first-value journey and its expected result.
2. **Given** the founder needs to validate an organisation's access controls, **When** they select the administrator, operator, or viewer persona, **Then** they can find the permitted and denied actions that distinguish that role.
3. **Given** a journey changes or is newly discovered, **When** it is added or revised, **Then** it has a stable identifier, owner, priority, risk level, and review status.

---

### User Story 2 - Run Journeys Safely with Predictable Data (Priority: P1)

As a tester or AI testing agent, I can prepare a representative but isolated test environment for any catalogued journey, so I can validate product behaviour without exposing secrets, changing production data, spending money, or relying on live third-party systems.

**Why this priority**: Reliable and safe test data is what makes frequent, agent-assisted testing possible for a new product.

**Independent Test**: A tester can prepare the standard test environment without provider credentials, execute a P1 journey against synthetic users and data, and confirm that no real external account, payment, provider, or production record was used.

**Acceptance Scenarios**:

1. **Given** a P1 journey needs an administrator, operator, viewer, project, tasks, and usage history, **When** the test environment is prepared, **Then** those records exist with clearly synthetic values and known starting states.
2. **Given** a journey calls a provider, payment, email, webhook, or subscription dependency, **When** it runs in the standard test environment, **Then** a controlled simulation supplies the expected success, failure, and timeout responses.
3. **Given** an AI agent starts a test, **When** the journey requires a destructive or paid external action, **Then** the standard run is stopped or simulated and the action is reported as requiring explicit live-canary approval.

---

### User Story 3 - Preserve a Client-Ready Workflow Explanation (Priority: P1)

As the founder, I can open a saved workflow runbook for each confirmed journey, so I can understand the product end to end and explain or demonstrate it confidently to a prospective client.

**Why this priority**: Test evidence should also become clear product knowledge, rather than disappearing into a CI log or an agent conversation.

**Independent Test**: A non-technical reviewer can follow a saved runbook for a P1 workflow in under ten minutes, understand the user value and expected screens, and distinguish simulated setup from a live customer deployment.

**Acceptance Scenarios**:

1. **Given** a journey has passed review, **When** the founder opens its runbook, **Then** it states the target persona, customer value, prerequisites, numbered actions, expected visible outcomes, and recovery path in plain language.
2. **Given** the journey has browser-visible steps, **When** its runbook is viewed, **Then** it includes approved screenshots or equivalent visual evidence that correspond to those steps.
3. **Given** the journey depends on simulated data, **When** it is shared with a prospect, **Then** it clearly labels the demonstration data and never reveals credentials, tokens, personal data, or internal-only configuration.

---

### User Story 4 - Get Actionable Automated and Visual Evidence (Priority: P2)

As a release owner, I can see whether each important workflow behaves correctly across supported browser layouts, interaction states, and permission levels, with enough evidence to diagnose a failure quickly.

**Why this priority**: Automation and visual evidence make the catalog trustworthy between demonstrations and releases.

**Independent Test**: A reviewer can trigger the browser quality checks for a representative journey, receive a pass/fail result with relevant screenshots and diagnostics, and identify the failed journey from the evidence.

**Acceptance Scenarios**:

1. **Given** a browser-visible P1 journey, **When** quality checks run, **Then** they verify the workflow's expected interaction and visible outcome at desktop and narrow-screen sizes.
2. **Given** a page fails to load, has an unexpected client error, or shows the wrong permission state, **When** the check fails, **Then** the result identifies the journey and preserves diagnostic evidence.
3. **Given** a keyboard-only or reduced-motion user follows a P1 browser journey, **When** they perform its essential actions, **Then** they can reach the same safe completion or receive an understandable error/recovery state.

---

### User Story 5 - Delegate Structured Exploratory Testing to AI (Priority: P2)

As the founder, I can ask an AI agent to explore a specific journey as a named persona and receive a structured evidence-backed report, so exploratory testing does not depend on the founder remembering every step.

**Why this priority**: AI agents can explore combinations and edge cases quickly, but must work from bounded instructions and produce reusable evidence.

**Independent Test**: An AI agent receives one approved journey and safe-environment instructions, performs the allowed actions, and produces a report containing the result, evidence, observed defects, and suggested regression coverage without changing unapproved external state.

**Acceptance Scenarios**:

1. **Given** an approved journey and safe fixture, **When** an AI agent explores it, **Then** the agent follows the persona's goal and documents any deviation from the expected outcome.
2. **Given** the agent discovers a reproducible defect, **When** it reports the defect, **Then** the report includes the journey identifier, reproduction steps, expected and actual outcomes, severity, and evidence location.
3. **Given** the agent cannot safely complete a live-only step, **When** it reaches that step, **Then** it reports the approval required rather than attempting the action.

---

### User Story 6 - Decide Release Readiness from the Same Blueprint (Priority: P3)

As a release owner, I can use the catalog to see which critical journeys have current evidence and which are blocked, skipped, or require a manual canary, so release decisions are explicit.

**Why this priority**: The catalog should guide meaningful release confidence rather than become static documentation.

**Independent Test**: A release reviewer can inspect the quality summary and determine whether every P1 journey has passing current evidence or an approved exception.

**Acceptance Scenarios**:

1. **Given** automated checks have completed, **When** the release summary is generated, **Then** it reports the verification state and evidence date for every P1 journey.
2. **Given** a P1 journey is blocked, skipped, or has stale evidence, **When** the release summary is reviewed, **Then** it highlights the reason, owner, and next required action.

### Edge Cases

- A required third-party provider, payment system, subscription session, email service, or browser is unavailable during testing.
- An AI agent encounters a workflow step that could create a real charge, send a real invitation, alter a real project, expose a credential, or start an uncontrolled agent run.
- A role-specific journey is accidentally run with more privilege than the persona is meant to have.
- Dynamic timestamps, usage figures, charts, polling, or notification content would make visual evidence unstable.
- A browser-visible journey has no accessible label or stable way to identify a key control.
- A runbook is out of date after the user flow changes, or a screenshot contains sensitive/synthetic data that is unsuitable for a prospect.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The product quality blueprint MUST define at least seven persona profiles: first-time individual operator, experienced individual operator, organisation administrator, organisation operator, organisation viewer, platform/integration administrator, and desktop-app user.
- **FR-002**: The blueprint MUST catalogue at least fifteen release-relevant journeys spanning onboarding, project/task operation, access control, providers and models, budget/safety controls, integrations, billing/licensing, deployment, and desktop use.
- **FR-003**: Every catalogued journey MUST record a stable identifier, persona, user goal, business value, priority, risk level, preconditions, synthetic data needs, numbered actions, expected outcomes, recovery expectations, verification method, and evidence status.
- **FR-004**: Every P1 journey MUST be independently executable in a standard isolated test environment using only synthetic identities, data, credentials, and dependency responses.
- **FR-005**: The standard test environment MUST route any simulated AI traffic through the product's metering and enforcement boundary, and MUST prevent real provider requests, external payments, production-data access, live invitations, irreversible configuration changes, and uncontrolled agent work unless a human has explicitly approved a named live-canary run.
- **FR-006**: The fixture design MUST define reusable starting states for each persona, including their permissions, projects, tasks, provider configuration, budget state, subscription/billing state, alerts, and expected audit history as applicable to the journey.
- **FR-007**: The fixture design MUST specify controlled success, validation-error, authorisation-denied, timeout, and unavailable-dependency variants for each external dependency relevant to a P1 journey.
- **FR-008**: Every P1 journey MUST have a plain-language workflow runbook suitable for founder learning and client demonstrations, including the persona, customer value, prerequisites, numbered actions, expected visible outcome, recovery path, demonstration-data label, and evidence reference.
- **FR-009**: Client-ready workflow runbooks MUST be reviewed before presentation and MUST exclude secrets, session tokens, personal data, internal hostnames, unsupported claims, and unapproved screenshots.
- **FR-010**: Browser-visible P1 journeys MUST define the desktop, narrow-screen, keyboard, and error/recovery states that need verification, together with the evidence expected from a failed run.
- **FR-011**: AI-agent test instructions MUST define the allowed environment, starting persona, permitted actions, stop conditions, evidence to collect, defect-report format, and escalation rule for live-only steps.
- **FR-012**: A failed or blocked journey MUST produce a triage record containing the journey identifier, persona, reproduction steps, expected outcome, actual outcome, severity, evidence reference, and whether a regression check is required.
- **FR-013**: The release quality summary MUST report current pass, fail, blocked, skipped, or manual-canary status for every P1 journey and highlight evidence older than the agreed release window.
- **FR-014**: The blueprint MUST distinguish deterministic test evidence, controlled live-canary evidence, and manual demonstration evidence so stakeholders cannot mistake one for another.

### Key Entities

- **Persona Profile**: A defined user type with goals, permissions, product context, and risk boundaries.
- **Journey**: A release-relevant end-to-end outcome a persona needs to achieve, including priority, actions, expectations, and verification state.
- **Fixture Profile**: A reusable synthetic starting state that provides the users, records, configurations, and dependency behaviours a journey needs.
- **Dependency Scenario**: A controlled external-service behaviour, such as success, invalid input, authorisation denial, timeout, or unavailable service.
- **Workflow Runbook**: A plain-language, reviewed explanation of a confirmed journey for founder learning and client demonstrations.
- **Evidence Bundle**: The results, diagnostics, visual evidence, and timestamps associated with a journey execution.
- **Live Canary Approval**: A time-bound human authorisation to run a named, cost- and impact-bounded test against a real external service.
- **Triage Record**: A structured defect or blocked-test report linked to the relevant journey and evidence.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The first published catalog contains at least seven persona profiles and fifteen journeys, with every P1 journey assigned an owner and verification status.
- **SC-002**: A tester can prepare the standard P1 test environment and begin a selected P1 journey in five minutes or less without obtaining a real provider key, payment credential, subscription token, or production-data access.
- **SC-003**: 100% of P1 journeys complete in the isolated environment without external charges, live invitations, production-data changes, or uncontrolled agent runs.
- **SC-004**: 100% of P1 browser-visible journeys have an approved desktop and narrow-screen evidence expectation, plus a keyboard and error/recovery expectation.
- **SC-005**: A non-technical founder can follow any approved P1 workflow runbook and explain its user value, main actions, expected outcome, and recovery path to a prospect in ten minutes or less.
- **SC-006**: Every failed P1 journey produces a triage record with reproducible steps and usable evidence, allowing a developer to begin diagnosis without an additional founder interview.
- **SC-007**: Release readiness can be determined from one summary showing a current status or approved exception for 100% of P1 journeys.

## Assumptions

- The existing dashboard, Electron desktop application, gateway, Docker deployment, project management, billing, and provider setup surfaces are in scope for journey definition; this feature does not change their product behaviour.
- Initial coverage focuses on the highest-risk supported outcomes, not every permutation of every external provider, model, operating system, or browser.
- Standard testing uses synthetic data and controlled dependency responses; real-provider and real-payment testing remains an explicitly approved, cost-bounded canary activity.
- Client-ready runbooks are maintained in version control alongside the journey catalog and are reviewed whenever the associated workflow changes.
- The existing automated browser checks and continuous-integration workflow will be extended in later delivery phases; this specification first establishes the authoritative catalog, safety design, evidence model, and acceptance standards.
- Accessibility review includes automated keyboard and visible-state checks, while assistive-technology testing remains a scheduled manual validation activity until a dedicated accessibility programme is established.

## Out of Scope

- Replacing the current dashboard architecture or redesigning product workflows.
- Enabling real payments, live subscription token extraction, or blanket live-provider testing in automated checks.
- Claiming that every catalogued provider or external integration is live-certified without recorded canary evidence.
- Publishing client runbooks externally without founder approval.
