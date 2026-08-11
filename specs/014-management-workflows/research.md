# Research: Management Workflows

## 1. Shared management authorization and audit boundary

**Decision**: Add one server-only authorization decision adapter that derives authenticated tenant/project scope, validates target ownership and operation eligibility, and records both the decision and final action outcome through a safe append-only audit adapter.

**Rationale**: Current capability checks are distributed among dashboard, API-v1, local, and cloud modules. A single reusable boundary prevents UI visibility or client scope from becoming authority and ensures denied/failed attempts are as traceable as successful changes.

**Alternatives considered**: Per-route authorization was rejected because it repeats cross-tenant/role/state checks and makes complete audit coverage unprovable. Client-only gating was rejected because it is bypassable.

## 2. Secret-handling protocol

**Decision**: Treat raw credential material as a non-persisted response-only value. It is never accepted by generic audit/log/error serializers; the browser disclosure owns it in memory, clears DOM/value/event handlers on close and navigation, and cannot request it again. Create and rotate use the same protocol.

**Rationale**: Existing API-key creation returns material only once, but current panels are string-rendered and lack the full DOM/history/telemetry cleanup guarantee. A single protocol creates a testable boundary.

**Alternatives considered**: Storing encrypted key material for later display, re-fetching a value, or placing it in a route/query parameter were rejected because they violate one-time disclosure and greatly widen exposure.

## 3. Provider test diagnostics

**Decision**: Reuse the existing 10-second abort deadline, return a safe category (`valid`, `authentication`, `network`, `timeout`, `unsupported`, `unknown`), and store a correlation/authorized redacted technical reason rather than upstream credential/request/response content. One user-requested retry is allowed after a terminal test; automated retries use a bounded policy value.

**Rationale**: The onboarding provider-test path already establishes a compatible deadline and safe result convention. Reusing it preserves expectations while separating management test evidence from onboarding draft state.

**Alternatives considered**: Exposing raw provider errors was rejected as a secret/log disclosure risk. Infinite retries were rejected because they obscure failure and consume quota.

## 4. Key rotation and destructive actions

**Decision**: Rotation creates a replacement with equivalent non-secret scope and a policy-bounded overlap; revocation is immediate after reauthentication and exact typed `REVOKE <key name>` confirmation. Defaults are 15-minute overlap and 15-minute reauthentication freshness, both validated policy values. A lost key can only be replaced.

**Rationale**: Existing `rotateApiKey` hard-revokes atomically. A bounded compatibility overlap fulfils UXF-005 without weakening a suspected-key emergency revoke path, which remains immediate.

**Alternatives considered**: Permanent dual validity, old-secret recovery, and native confirmation dialogs were rejected for security, recovery ambiguity, and accessibility/audit gaps.

## 5. Webhook history and replay

**Decision**: Preserve the delivery contract and 30-day default retention, add safe cursor-paged attempt reads, and allow replay only for a retained terminal failure. Persist replay generation/idempotency before outbound delivery; a duplicate returns the existing correlated result without an additional request.

**Rationale**: Existing delivery logs record attempts and already cap retry behavior. Offset pagination and client duplicate guards are insufficient during concurrent recovery.

**Alternatives considered**: Replaying successful or expired attempts, modifying the original log, and generating a new unsigned payload were rejected because they obscure evidence or alter delivery semantics.

## 6. Membership, billing, local/cloud, and policy push

**Decision**: Keep the existing `admin/operator/viewer` vocabulary and 24-hour invitation default. Resend supersedes a pending invitation. Billing/security routes publish source and availability mode. Policy push is previewed, versioned, and rollback-bounded per target.

**Rationale**: Existing invitation storage/validation and cloud policy-push primitives are compatible foundations. Explicit environment/mode prevents a local installation from displaying cloud-only purchasing actions or a cloud service from treating local policy state as authoritative.

**Alternatives considered**: New roles, external identity provider procurement, or a marketplace were rejected as explicit scope exclusions.

## Threat model

| Asset/action | Threat | Control and evidence |
|---|---|---|
| Provider secret/test | Secret in diagnostics, logs, browser state, or cross-tenant read | Allowlisted diagnostic serializer, secret scrubber, auth-derived scope, correlation-only audit |
| API key create/rotate/revoke | Re-display, DOM/history leak, accidental revoke, stale reauth | One-time memory disclosure, cleanup/focus tests, typed phrase, reauthentication window, audit intent/outcome |
| Webhook replay | Duplicate/external side effect, payload disclosure, replay of expired attempt | Retention and terminal-state eligibility, persisted idempotency, redacted evidence, reason/correlation audit |
| Invitation/role change | Privilege escalation, token reuse, cross-tenant acceptance | Server role/scope check, versioned lifecycle, expiry/supersession, identity match, denied-attempt audit |
| Billing/settings/policy | Misleading entitlement state, blast-radius surprise, unauthorized mutation | Explicit source/mode, preview/diff/confirmation, per-target outcomes, rollback boundary, audit |
| Audit surface | Audit itself leaks secrets or foreign resources | Disclosure classification, authorization-filtered read model, stable opaque IDs, retention policy |
