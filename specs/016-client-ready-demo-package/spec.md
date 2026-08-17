# Feature Specification: Client-Ready Demo Package

**Feature Branch**: `spec/016-client-ready-demo-package`  
**Created**: 2026-08-16  
**Status**: Specification and planning in progress  
**Input**: A client/prospect-facing, headed local-browser demonstration package for the existing onboarding and supported cloud control-plane workflows.

## Purpose

Give a founder or presenter a repeatable, watchable local demonstration that explains MeridianOS through two bounded synthetic workflows: onboarding from the supported `/setup` route and the locally served cloud control-plane workflow. The package is a demonstration aid, not a production-readiness assertion or a customer environment.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Present Visible Onboarding (Priority: P1)

A presenter starts one headed local-browser session and walks a prospect through the existing onboarding journey from `/setup`, with pauses that make the review-before-commit and disposable-data boundaries understandable.

**Why this priority**: The current visible onboarding launcher already provides the strongest verified, safe baseline and shows the first-use experience without provider credentials or external services.

**Independent Test**: From a clean local checkout, a presenter runs `node scripts/run-visible-onboarding.mjs --port 4317`, sees a headed browser open at `/setup`, completes the documented synthetic journey, and observes cleanup after closing the session.

**Acceptance Scenarios**:

1. **Given** a clean local demonstration environment, **When** the presenter starts the visible onboarding launcher, **Then** a headed browser opens only to the locally served `/setup` route and visibly identifies the session as synthetic and disposable.
2. **Given** the onboarding steps are visible, **When** the presenter reaches the review stage, **Then** the package pauses and explains that no configuration has been written before the explicit final action.
3. **Given** a presenter ends the session normally or early, **When** cleanup completes, **Then** the package records only redacted evidence and removes the temporary installation.

---

### User Story 2 - Present Supported Client Operations (Priority: P1)

A presenter follows a second headed, synthetic local workflow that shows the existing cloud control-plane dashboard: sign-in, connected-machine and aggregate-health visibility, a policy preview, explicit confirmation, and the stated rollback boundary.

**Why this priority**: It gives the demo a client-operations narrative while remaining grounded in supported local control-plane behavior and avoiding unsupported provider or customer claims.

**Independent Test**: A clean, disposable local control-plane environment starts with deterministic synthetic organization, administrator, machine, health, and policy data. A headed browser opens at the local control-plane root route, completes the workflow, and leaves no persistent data or live external request.

**Acceptance Scenarios**:

1. **Given** the synthetic local control plane is running, **When** the presenter opens its printed local root URL and signs in with the documented synthetic account, **Then** connected machines and aggregate provider health render from the synthetic fixture.
2. **Given** the presenter enters the prescribed policy path and value, **When** they request a preview, **Then** the interface shows eligible targets and clearly states that no policy has been pushed.
3. **Given** a preview is visible, **When** the presenter reaches the confirmation boundary, **Then** the package pauses before any confirmation and explains the explicit acknowledgement and rollback-boundary semantics.
4. **Given** the session is stopped or a fixture fails, **When** recovery runs, **Then** the package removes the disposable control-plane data and tells the presenter how to restart from a clean session.

---

### User Story 3 - Deliver a Credible Presentation Package (Priority: P2)

A founder receives a concise narrative, presenter runbook, evidence index, visual-shot list, optional recording procedure, ownership map, approval criteria, and recovery guidance that distinguish the local synthetic demonstration from product and release readiness.

**Why this priority**: A reliable demo needs a consistent story and auditable boundaries; it must not turn inherited UXF-006 evidence into unsupported readiness claims.

**Independent Test**: A reviewer follows the presenter runbook without source-code interpretation, validates every listed checkpoint, locates each allowed evidence item, and can identify the package's owners, approval inputs, recovery action, and out-of-scope claims.

**Acceptance Scenarios**:

1. **Given** the package is complete, **When** a founder prepares a client meeting, **Then** they can select the onboarding-only or full two-workflow path, use the listed pause points, and deliver the founder-facing narrative within the documented timebox.
2. **Given** visual shots or a screen recording are requested later, **When** capture begins, **Then** the package supplies a deterministic shot order, viewport and redaction requirements, and a reviewable manifest without creating or approving those assets automatically.
3. **Given** a presenter is asked about maturity or release status, **When** they consult the package, **Then** it separates validated local synthetic behavior from the unresolved UXF-006 external gates and makes no unsupported production, accessibility, platform, performance, canary, or release claim.

### Edge Cases

- If port 4317 is unavailable, the onboarding launcher must use a presenter-selected free loopback port and the runbook must require use of its printed `/setup` URL.
- If the headed browser, local process, or optional recording session is interrupted, the runbook must treat the run as abandoned, invoke cleanup, and require a fresh run rather than resuming a retained profile or fixture.
- If the synthetic cloud sign-in, data load, preview, confirmation, or cleanup fails, the presenter must stop the workflow, display the safe recovery state, remove the failed disposable fixture, and restart; no manual data repair is part of a demo.
- If a visual capture contains customer data, a credential-like value, raw request content, or an unredacted local path, it must be discarded and not become evidence or a deliverable.
- If the host lacks a headed browser or recording capability, the package may document the unmet prerequisite but must not substitute a claim of browser, visual, platform, or release approval.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-016-001**: The package MUST define one visible, headed local-browser onboarding walkthrough that starts at `/setup`, includes the exact existing baseline command `node scripts/run-visible-onboarding.mjs --port 4317`, and never presents `/app/setup` as an implemented destination.
- **FR-016-002**: The onboarding walkthrough MUST identify the current synthetic/disposable session, include presenter pause points for welcome, agent choices, controlled provider-validation boundary, budget, review-before-commit, explicit final action, completion, and cleanup, and prohibit real provider credentials and external calls.
- **FR-016-003**: The package MUST define a second client workflow only from currently supported local cloud control-plane behavior: local root dashboard sign-in, connected machines, aggregate health, policy preview, explicit confirmation, and rollback boundary. It MUST NOT designate `/cloud/dashboard/index.html` as a live client route because current evidence serves that URL through the browser-test static server.
- **FR-016-004**: The client workflow MUST use a deterministic, disposable synthetic dataset with a documented identity, organization, machine/health, policy-preview, confirmation, teardown, and restart procedure; it MUST contain no customer data, real provider key, payment, email, or external-provider interaction.
- **FR-016-005**: The package MUST provide a founder-facing narrative, presenter steps, checkpoints, expected visible states, timing guidance, and safe answers for the local-demo versus production-readiness boundary.
- **FR-016-006**: The package MUST define a curated visual-shot plan for the two workflows and an optional screen-recording procedure. The plan MUST state required pre-capture checks, permitted synthetic content, redaction review, shot order, names, metadata, approval input, and discard/recovery procedure, while creating no images or recordings during this feature's specification, planning, or future default demo run.
- **FR-016-007**: The package MUST list evidence locations, evidence owner roles, approval criteria, deliverable formats, retention/disposition, and recovery procedures. Evidence must be limited to redacted local run manifests/results/triage and later human-approved visual or recording assets.
- **FR-016-008**: The package MUST state that local synthetic demo completion is not production/client readiness, release approval, visual-baseline approval, canary approval, runtime-performance evidence, Safari/macOS approval, Electron approval, or NVDA/VoiceOver approval.
- **FR-016-009**: The package MUST reference UXF-006 only as a dependency and evidence boundary. It MUST NOT modify, recreate, supersede, or claim closure of Spec 015 or Spec 014 artifacts.
- **FR-016-010**: The package MUST include failure, stop, reset, and cleanup procedures that preserve the root worktree and prevent retained browser profiles, temporary installations, cloud databases, raw captures, or synthetic session data from becoming presentation evidence.
- **FR-016-011**: The local dashboard MUST serve the platform shell at `/` by default, retain the previous dashboard at `/legacy` (and the compatibility `/index.html` path), and honor an explicit `ui_platform.enabled: false` policy as an immediate fallback to the retained dashboard. `/app/setup` remains redirect-only to `/setup`.

### Key Entities

- **Demo Session**: A named, time-bounded local walkthrough with one selected workflow, launch details, checkpoints, safe status, and cleanup result.
- **Synthetic Demo Dataset**: The fixed fictional organization, presenter identity, client operations records, policy example, and safe labels used only for a disposable session.
- **Presenter Checkpoint**: A visible screen or decision boundary with a spoken purpose, expected state, permitted action, and recovery instruction.
- **Evidence Record**: A redacted manifest, result, triage record, or later human-approved capture reference associated with a demo session and owner role.
- **Capture Brief**: A non-asset instruction set that specifies a shot, viewport, visible synthetic state, required redaction review, output naming, reviewer, and disposition.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-016-001**: A presenter can start the supported onboarding baseline and reach the completion screen in a headed local browser using only synthetic data in 10 minutes or less, including all mandatory pause points.
- **SC-016-002**: A presenter can complete the synthetic local client-operations workflow in 8 minutes or less, with every sign-in, machine/health, preview, confirmation-boundary, and cleanup checkpoint visibly accounted for.
- **SC-016-003**: One independent reviewer can follow the runbook and identify the route, expected state, recovery instruction, evidence location, owner role, and approval criterion for 100% of listed checkpoints without consulting source code.
- **SC-016-004**: Every generated local evidence record passes the package's redaction scan and contains zero real provider keys, customer records, external-provider responses, payment data, email data, or raw request content.
- **SC-016-005**: The curated capture brief names 100% of planned shots and recording segments, and every captured asset remains uncreated until a named human owner performs the optional capture and approval process.
- **SC-016-006**: The package lists all inherited UXF-006 external gates as unresolved unless separately evidenced and approved, with no readiness claim that exceeds the available evidence.
- **SC-016-007**: Focused route tests prove that `/` serves the platform shell by default, `/legacy` serves the retained dashboard, and an explicit disabled policy returns the local root to the retained dashboard without a restart.

## Assumptions

- The presenter has Node.js 24+, installed repository dependencies, a headed Chrome-capable browser, and permission to use loopback ports; the package does not install dependencies or invoke a cloud service during a presentation.
- `/setup` is the supported onboarding route. `/app/setup` remains a redirect to `/setup` and is excluded from presenter language and capture briefs.
- The existing visible onboarding launcher is retained as the onboarding baseline; its loopback-simulated provider validation is sufficient for a local synthetic demonstration and is not a live provider test.
- The current cloud control-plane server is a supported local development/control-plane exercise at its root route. The source asset at `/cloud/dashboard/index.html` is verified for browser testing through a test static server and is not a live demo route.
- The future implementation may add only local, deterministic fixture and presenter tooling necessary to run these workflows; it must preserve existing UXF-006 and Spec 014 behavior, use Node.js built-ins and existing dependencies, and make no live network request.
- The Founder is the single, named decision owner for product, UX/design, testing, demo, security/privacy, and release choices at this pre-customer stage. Reviews are recorded as founder self-reviews, not independent approvals. Unavailable environment evidence remains unavailable and must not be claimed as completed.

## Dependencies and Evidence Boundaries

- **UXF-006 / Spec 015**: Supplies the post-PR-100 responsive, cloud-shell, and release-gate evidence index. Safari/macOS, NVDA/VoiceOver, Electron host smoke, runtime performance, visual-baseline, canary, and release-signoff evidence remain unavailable or unresolved unless separately supplied; founder ownership is now explicit for this early-stage rollout decision.
- **Spec 014 visible onboarding journey**: Supplies the existing `/setup` launcher, synthetic fixture, cleanup/redaction behavior, and explicit `/app/setup` redirect boundary.
- **Cloud control plane**: Supplies the locally served root dashboard and API behavior for the synthetic client workflow. The browser-test URL `/cloud/dashboard/index.html` is evidence of static UI testing only.

## Out of Scope

- Reimplementing or reopening UXF-006, Spec 015, Spec 014 Phase 3, their browser evidence, release gates, or cloud accessibility hardening. This feature may make the bounded local-dashboard default/fallback route change in FR-016-011 without altering their specification or release-gate artifacts.
- Production deployment, customer onboarding, customer data, real accounts, real provider keys, payment/email delivery, DeepSeek, Z.ai GLM, or any external-provider request.
- Creating screenshots, recordings, image assets, capture manifests from real sessions, commits, pushes, pull requests, or release artifacts during this specification/planning session.
- Claims or approval of Safari/macOS, NVDA/VoiceOver, Electron, runtime performance, visual baselines, canaries, production/client readiness, or release readiness without separately supplied evidence and named approval.
- New product capabilities beyond the bounded default/fallback route behavior in FR-016-011, live telemetry, provider routing, or changes to the gateway metering path.

## Founder-approved evolution — 2026-08-17

The Founder approved the platform shell as the early-stage default and the retained dashboard as the `/legacy` fallback. The Founder is the sole current owner for product, UX/design, testing, demo, security/privacy, and release decisions. This is an intentional local product-direction decision; it does not create independent approval or evidence for unavailable environments.

## Deferred Follow-Up Candidate

**Potential Spec 017 — Guided Playwright Learning Walkthrough**: After the client-ready demo package is implemented and validated, consider a separate specification for a headed, paced Playwright learning mode. It would visibly guide or replay synthetic interactions, pause at onboarding and client-workflow checkpoints, and allow a learner to continue manually. This is deferred work only: it creates no current requirement, implementation task, browser asset, or approval claim for Spec 016.
