# Feature Specification: Management Workflows

**Feature Branch**: `spec/014-management-workflows`

**Created**: 2026-08-11

**Status**: Draft

**Input**: Deliver UXF-005 management workflows for providers, integrations, API keys, webhooks, billing, tenant settings, permissions, and durable privileged-action evidence while preserving existing REST contracts, authorization boundaries, gateway metering, and public API compatibility.

## Clarifications

### Session 2026-08-11

- Q: What is the canonical role matrix and source of truth? → A: The existing `admin`, `operator`, and `viewer` roles remain the initial matrix; a server-side policy/authorization decision is authoritative for every route and operation, and clients only explain that decision.
- Q: What scope governs management reads and changes? → A: A request is constrained to the authenticated tenant and any authorized project; a cross-tenant or out-of-scope request is denied without disclosing resource existence.
- Q: What are the safe defaults for credentials and delivery recovery? → A: New API-key material is disclosed once, rotations permit an explicit bounded overlap, revocation is irreversible after typed confirmation, and webhook replay is permitted only for retained eligible attempts with an idempotency key.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Configure and diagnose an integration (Priority: P1)

An administrator can find an authorized provider or integration, add or update its non-secret configuration, submit credentials through a protected handoff, test the connection, and understand a failed test without seeing secret values or unsafe technical detail.

**Why this priority**: A trustworthy provider connection is prerequisite to managed agent work, while mishandled test data can disclose credentials or create an unsafe recovery action.

**Independent Test**: An administrator adds a provider, performs a successful test, then diagnoses a timed-out or failed test and retries it; an unauthorized or cross-tenant actor sees neither the configuration nor sensitive diagnostics.

**Acceptance Scenarios**:

1. **Given** an administrator has tenant and provider authority, **When** the administrator saves valid provider settings and tests the connection, **Then** the result states success or failure, contains a correlation link, and records intent and outcome without including the submitted secret.
2. **Given** a provider test fails, times out, or is retried, **When** the administrator opens its detail view, **Then** the view identifies a safe failure category, retry eligibility, and support correlation while technical detail is redacted according to the actor's authorization.
3. **Given** a viewer, operator without provider authority, or cross-tenant actor opens a provider URL or submits a mutation, **When** the request reaches the service, **Then** it is denied server-side without resource-existence or secret disclosure.

---

### User Story 2 - Rotate or revoke an API key safely (Priority: P1)

An administrator can create a scoped API key, reveal its value exactly once, rotate it with a deliberate overlap period, or revoke it with a typed confirmation and recover safely when a value is lost.

**Why this priority**: API keys are a high-impact integration boundary; the workflow must avoid both secret disclosure and avoidable service interruption.

**Independent Test**: Create a key, copy it once, close the disclosure, rotate it, verify overlap and expiry behavior, revoke the replacement with its required phrase, and inspect evidence proving no secret reached the page, URL, audit record, telemetry, logs, error, or browser history.

**Acceptance Scenarios**:

1. **Given** an authorized administrator creates or rotates a key, **When** the server returns its material, **Then** it is available through a single-use disclosure, never re-fetchable, is cleared when the disclosure closes, and its value is excluded from durable diagnostic and navigation surfaces.
2. **Given** a rotation is confirmed, **When** the bounded overlap has not expired, **Then** the old key remains active only for the recorded overlap; when it expires or is revoked, future authentication with it fails predictably.
3. **Given** an administrator cannot recover a lost key value, **When** the administrator requests recovery, **Then** the system offers only a newly created or rotated replacement and never reveals the old material.
4. **Given** an administrator enters the exact destructive confirmation phrase for an active key, **When** revocation succeeds, **Then** the key becomes inactive, the result is clear, and actor, authority, intent, outcome, target, and correlation evidence are durable.

---

### User Story 3 - Inspect and replay webhook deliveries (Priority: P1)

An authorized user can inspect scoped webhook delivery attempts, understand their outcome and retention, and replay an eligible failed delivery once without creating duplicate side effects.

**Why this priority**: Delivery histories make integrations supportable; unguarded replay can multiply external effects.

**Independent Test**: Page through retained attempts for a failed webhook, replay an eligible delivery, submit a duplicate replay, and verify one outbound recovery attempt, idempotent outcome, pagination stability, authorization denial, and audit correlation.

**Acceptance Scenarios**:

1. **Given** an authorized scoped user opens webhook history, **When** attempts are listed, **Then** they are cursor-paginated, ordered consistently, identify retained evidence and redacted response detail, and cannot leak payload secrets.
2. **Given** a retained failed attempt is replay-eligible, **When** an authorized actor requests replay with a reason, **Then** the server creates one correlated recovery operation with a deterministic idempotency key and prevents concurrent or repeated replay of the same eligibility window.
3. **Given** an attempt is successful, expired, non-replayable, already replayed, out of scope, or the actor lacks authority, **When** replay is requested, **Then** no outbound request is made and the outcome is safely explained and auditable.

---

### User Story 4 - Manage members and effective permissions (Priority: P1)

An administrator can invite a person to the correct tenant/project scope and role, track invitation lifecycle, change an authorized membership role, and understand the effective permissions before making a change.

**Why this priority**: Access changes must be comprehensible, scoped, and reversible enough to avoid accidental privilege escalation.

**Independent Test**: Invite a user, resend and cancel invitations, accept a valid invitation, change a project role, attempt an expired or cross-tenant acceptance, and compare the effective-permission explanation with server-side allow/deny decisions.

**Acceptance Scenarios**:

1. **Given** an administrator selects a tenant/project and role, **When** an invitation is sent, **Then** it has a visible pending, accepted, expired, cancelled, or superseded lifecycle, expiry time, resend and cancellation eligibility, and durable mutation evidence.
2. **Given** a user views a role assignment or invitation, **When** effective permissions are shown, **Then** the explanation names tenant/project scope, inherited/default role, explicit role, and the resulting allowed and denied management capabilities without treating the client explanation as authorization.
3. **Given** a role change, invitation acceptance, resend, or cancellation is unauthorized, expired, stale, or crosses a tenant boundary, **When** it is attempted, **Then** the server denies it safely and records the attempted privileged action without revealing another tenant's membership data.

---

### User Story 5 - Review billing, security, settings, and audit outcomes (Priority: P2)

Authorized users can review plan limits and entitlements, security state, scoped tenant settings and policy-push impact, and durable audit outcomes, including degraded/read-only conditions and safe rollback boundaries.

**Why this priority**: Administrators need a coherent record of what can be changed, what risk it carries, and what actually happened.

**Independent Test**: Review a normal, read-only, degraded, and unavailable billing response; inspect security and audit records; preview a policy push's affected scope; perform an authorized reversible update and request rollback, while unauthorized reads and mutations remain denied server-side.

**Acceptance Scenarios**:

1. **Given** a user is authorized to read billing, **When** limits, entitlements, or billing state are returned, **Then** the page distinguishes local versus cloud contract, current value versus unavailable value, and read-only/degraded behavior without offering an unavailable mutation.
2. **Given** an administrator changes tenant settings or pushes policy, **When** impact is previewed and confirmed, **Then** affected tenant/project/machine scope, non-reversible effects, rollback boundary, required confirmation, and final correlated outcome are visible before and after the action.
3. **Given** an authorized auditor opens audit evidence, **When** a management operation is viewed, **Then** actor, authorization decision, tenant/project scope, intent, outcome, target, correlation, timestamp, and disclosure authorization are visible while secrets and restricted technical detail remain absent.

### Edge Cases

- A secret-bearing create, rotate, or provider-test request is retried, cancelled, races another request, succeeds after client disconnect, or returns an error with upstream sensitive data.
- A one-time disclosure is closed with keyboard, browser Back, reload, timeout, focus loss, or an error; the DOM, clipboard affordance, history, telemetry, and error state retain no secret.
- A key's overlap expires while a caller is in flight; its owner loses the old value; or a revoke is requested for an already inactive key.
- A provider test reaches timeout, its retry budget, an unsupported capability, an upstream authorization error, or a detail view whose diagnostics are no longer retained.
- Webhook attempts have malformed cursors, expired retention, a duplicate delivery, payload redaction requirements, an ineligible replay, or concurrent recovery requests.
- Invitations are delivered late, resent, superseded, cancelled, accepted after expiry, accepted by the wrong identity, or collide with an existing membership.
- Tenant/project access is revoked, a resource is deleted, or a shared URL crosses tenant scope during a read or mutation.
- Billing is local-only, cloud-backed, temporarily unknown, entitlement-limited, degraded, read-only, or contains a limit that changed while an action was pending.
- A policy push affects zero, one, or many machines; a subset fails; a rollback is unavailable after an irreversible boundary; or the actor loses authority mid-operation.
- A keyboard-only, screen-reader, high-zoom, narrow-viewport, reduced-motion, or supported-browser user opens a drawer/dialog, completes or cancels a privileged workflow, receives an error, and returns focus to the invoker.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-501 — Integration list and detail workflows**: The system MUST provide scoped provider and integration lists plus durable detail destinations. Authorized administrators MUST be able to add, update, test, retry, disable, and diagnose supported integrations; provider tests MUST have a documented timeout, bounded retry policy, safe result categories, authorization-aware technical-detail redaction, and intent/outcome audit evidence.
- **FR-502 — Secure secret disclosure, rotation, and revocation**: The system MUST manage scoped API keys with minimum required scopes, single-use secret disclosure, explicit bounded rotation overlap, typed destructive confirmation and reauthentication for revocation or equivalent high-risk change, inactive-key handling, and lost-key replacement rather than recovery. Secret material MUST be excluded from URLs, browser history, retained DOM, logs, telemetry, audit payloads, analytics, support text, and error details.
- **FR-503 — Webhook delivery history and idempotent replay**: The system MUST provide scoped, cursor-paginated webhook delivery history with documented retention, redacted safe evidence, replay eligibility, reason capture, idempotency, duplicate prevention, and correlated intent/outcome audit records. Replays MUST use the existing delivery contract and never change public webhook behavior for non-replay deliveries.
- **FR-504 — Roles, permissions, and invitations**: The system MUST use the canonical `admin`, `operator`, and `viewer` role matrix as policy-controlled input to a server-side authorization decision. It MUST expose an authorized effective-permission explanation and support scoped invitation creation, expiry, resend, cancellation, acceptance, and authorized role changes without cross-tenant disclosure or privilege escalation.
- **FR-505 — Billing, security, tenant settings, and audit pages**: The system MUST provide authorized, durable billing/limit/entitlement, security-state, tenant-settings, policy-impact, rollback-boundary, and audit-evidence views. It MUST distinguish local and cloud API behavior and normal, unavailable, degraded, and read-only states; privileged policy changes MUST preview scope and require appropriate confirmation before mutation.
- **FR-506 — Privileged mutation evidence**: Every privileged management mutation, including an allowed, denied, failed, cancelled, duplicate, or conflict outcome, MUST durably record actor identity, authentication/authorization decision, tenant/project scope, target, declared intent/reason, outcome, correlation identifier, timestamp, and disclosure classification. The evidence contract MUST omit secret values and unauthorized resource identifiers.

### Non-Functional Requirements

- **NFR-501 — Server-side authorization**: The server MUST enforce authentication, role/permission, tenant, project, resource ownership, and state/eligibility checks for every management read and privileged mutation. UI visibility, route state, and client-supplied scope MUST never authorize an operation.
- **NFR-502 — Secret containment**: Secret values MUST never remain in the DOM after a disclosure closes and MUST never enter logs, telemetry, audit payloads, URLs, browser history, error details, client diagnostics, or server responses after the one-time disclosure contract is consumed.
- **NFR-503 — Audit completeness**: One hundred percent of privileged management changes and attempted privileged changes MUST produce durable, queryable audit evidence containing the FR-506 fields.
- **NFR-504 — Compatibility and gateway integrity**: Existing REST/v1 contracts, authorization boundaries, gateway-only LLM metering, and public API behavior MUST remain compatible; new management capabilities are additive or use documented compatible evolution.
- **NFR-505 — Usability and accessibility**: Privileged dialogs/drawers MUST support keyboard operation, labelled controls, focus trap and restoration, escape/cancel behavior where safe, persistent action feedback, and equivalent supported-browser behavior. No primary management workflow may rely on color alone.

### Key Entities

- **Authorization Decision**: Immutable outcome for an actor, requested capability, tenant/project scope, target, policy version, and allow/deny reason.
- **Integration and Provider Test**: Scoped connection configuration and its test attempt, safe status, timing, redacted diagnostic class, retry state, and correlation.
- **API Key Credential**: Named scoped credential with non-secret identity, state, creation/rotation/revocation timestamps, overlap boundary, and one-time material disclosure state.
- **Webhook Delivery Attempt**: Scoped immutable delivery evidence with event, endpoint identity, redacted result, attempt order, retention boundary, replay eligibility, and replay correlation/idempotency state.
- **Invitation and Membership**: Scoped person/access change with role, lifecycle, expiry, issuer, acceptance identity, and effective permission calculation.
- **Billing/Security/Tenant State**: Authorized representation of plan limits, entitlements, environment source, availability mode, security posture, settings version, policy impact, and rollback boundary.
- **Management Audit Event**: Append-only evidence for a privileged action and its authorization, intent, outcome, scope, target, correlation, disclosure classification, and retention policy.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-501**: In representative administrator validation, at least 90% complete a provider add-and-test flow within five minutes without support, and every failed test presents a safe next step.
- **SC-502**: One hundred percent of evaluated key disclosures are unavailable after close/reload and no evaluated secret appears in URLs, history, logs, telemetry, audit evidence, errors, or page markup after close.
- **SC-503**: One hundred percent of evaluated replay attempts are server-authorized, correlated, auditable, and duplicate-safe; no ineligible replay makes an outbound delivery.
- **SC-504**: At least 90% of representative administrators invite a user, identify the resulting effective permissions, and verify invitation state within three minutes.
- **SC-505**: One hundred percent of privileged management operations evaluated across allowed, denied, failed, duplicate, conflict, and cancelled outcomes have a durable audit record with required non-secret evidence.
- **SC-506**: All designated management workflows complete with keyboard-only navigation and restore focus after closing a dialog or drawer in supported browsers.
- **SC-507**: Existing public REST/v1 compatibility and gateway metering regression suites remain fully passing after the feature is delivered.

## Assumptions

- The existing three roles (`admin`, `operator`, `viewer`) are the starting canonical matrix. A policy/authorization layer owns the exact capability mapping, and any future role expansion is out of scope unless it preserves this contract.
- The authenticated tenant is the default management scope; an optional project narrows but never broadens access. Cross-tenant responses are non-disclosing denials.
- A provider test has a bounded server-side timeout and retry budget; error messages expose a category and correlation rather than raw upstream request/response data unless an authorized diagnostic policy permits redacted detail.
- Key rotation overlap, webhook-attempt retention, invitation expiry, audit retention, destructive phrase text, and reauthentication freshness are configurable policy values with secure defaults, documented in the delivery plan before implementation. Expired values cannot be silently extended by clients.
- Webhook replay is a new recovery operation over retained recorded payload semantics only; it does not introduce a marketplace business model, alter standard delivery subscription behavior, or guarantee delivery by an external endpoint.
- Billing pages consume existing local/cloud billing contracts and may be read-only or degraded; obtaining a new payment processor, marketplace business model, or external identity-provider procurement is out of scope.
- Policy pushes require a scoped impact preview and explicit rollback boundary; a rollback can restore only a documented prior compatible policy version and cannot undo irreversible external effects.
