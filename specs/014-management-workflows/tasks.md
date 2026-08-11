# Tasks: Management Workflows

**Input**: Design documents from `specs/014-management-workflows/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/management-workflows.md, quickstart.md

**Tests**: Required. Every failing-test task is written and confirmed red before its implementation task; authorization and secret-redaction tests complete before any UI mutation task.

## Phase 1: Setup

- [ ] T001 Document management threat model, contract inventory, and compatibility baseline in `specs/014-management-workflows/research.md` and `specs/014-management-workflows/contracts/management-workflows.md`
- [ ] T002 [P] Add tenant/project/admin/operator/viewer/foreign-tenant/reauth/safe-secret fixtures in `tests/management-fixtures.mjs`
- [ ] T003 [P] Freeze existing `/api/*`, `/api/v1/*`, gateway-metering, and legacy-panel contracts in `tests/dashboard-api-compatibility.test.mjs`

## Phase 2: Foundational safety boundary (BLOCKS all user stories)

- [ ] T004 [P] Add role-negative, cross-tenant, target-ownership, read/mutation, stale-state, and non-disclosing denial tests in `tests/management-authorization.test.mjs`
- [ ] T005 [P] Add secret sentinel tests for URL, history, DOM cleanup, logs, telemetry, audit payload, error, and response replay paths in `tests/management-secrets.test.mjs`
- [ ] T006 [P] Add allowed/denied/failed/cancelled/duplicate/conflict audit schema, correlation, retention, and disclosure tests in `tests/management-audit.test.mjs`
- [ ] T007 Implement auth-derived scope, role/capability/target/state decisions, and safe denials in `dashboard/management-authorization.mjs`
- [ ] T008 Implement append-only safe audit serialization, correlation, disclosure classification, and retention cleanup in `dashboard/management-audit.mjs`
- [ ] T009 Implement single-use disclosure, allowlisted serializers, DOM cleanup helpers, and safe error/log redaction in `dashboard/management-secrets.mjs`
- [ ] T010 Wire the shared authorization, audit, secret, and response boundaries additively in `dashboard/server.mjs` and `api/v1/router.mjs`

**Checkpoint**: T004–T006 are green and prove NFR-501–NFR-503 before any management UI mutation task begins.

## Phase 3: User Story 1 — Configure and diagnose an integration (P1) 🎯 MVP

**Goal**: An authorized administrator configures/tests a provider safely; other actors receive an audited non-disclosing denial.

**Independent Test**: Add/test/retry a provider for success, timeout, and safe failure categories; assert no secrets/foreign diagnostics and a durable audit link.

- [ ] T011 [P] [US1] Add provider list/detail/add/update/test/retry API, role-negative, cross-tenant, timeout, retry budget, and redacted diagnostic tests in `tests/management-integrations.test.mjs`
- [ ] T012 [P] [US1] Add provider-test secret-sentinel and audit intent/outcome/correlation tests in `tests/management-secrets.test.mjs`
- [ ] T013 [US1] Implement scoped integration read model, <=10-second test deadline, bounded retries, safe diagnostics, and correlation in `dashboard/management-integrations.mjs`
- [ ] T014 [US1] Connect additive integration routes without changing existing provider REST behavior in `dashboard/server.mjs` and `api/v1/router.mjs`
- [ ] T015 [P] [US1] Render integration list/status/empty/error states and durable detail links in `dashboard/app/routes/integrations/providers.mjs`
- [ ] T016 [P] [US1] Render provider configuration, protected test/retry feedback, authorized diagnostics, and audit link in `dashboard/app/routes/integrations/provider-detail.mjs`
- [ ] T017 [US1] Add provider add/test/failure/retry, denied/cross-tenant, keyboard/focus, and secret-absence browser evidence in `browser-tests/management-workflows.spec.mjs`

## Phase 4: User Story 2 — Rotate or revoke an API key safely (P1)

**Goal**: An administrator receives material once, rotates with overlap, and revokes with reauthentication and typed confirmation.

**Independent Test**: Create/close/rotate/revoke a key and prove no old-value recovery or durable disclosure.

- [ ] T018 [P] [US2] Add key create/list/one-time disclosure/rotation-overlap/revocation/lost-key/compatibility cases in `tests/management-secrets.test.mjs`
- [ ] T019 [P] [US2] Add reauth, typed phrase, stale/immediate revoke, role-negative, cross-tenant, and audit cases in `tests/management-authorization.test.mjs`
- [ ] T020 [US2] Extend non-secret key lifecycle, policy-derived overlap/reauth settings, replacement lineage, and emergency revoke in `auth/api-tokens.mjs`
- [ ] T021 [US2] Implement key orchestration, single-use response, typed confirmation, and safe audit events in `dashboard/management-secrets.mjs` and `dashboard/server.mjs`
- [ ] T022 [P] [US2] Render key list/detail, disclosure cleanup, reauth, typed revoke, and recovery feedback in `dashboard/app/routes/integrations/api-keys.mjs`
- [ ] T023 [US2] Preserve legacy API-key panel contracts through safe action helpers in `dashboard/static/api-keys-panel.mjs` and `dashboard/static/admin-bootstrap.mjs`
- [ ] T024 [US2] Add create/close/reload/Back/rotate/overlap/revoke/lost-key keyboard/focus/history secret-leak evidence in `browser-tests/management-workflows.spec.mjs`

## Phase 5: User Story 3 — Inspect and replay webhook deliveries (P1)

**Goal**: Authorized users diagnose retained attempts and replay one eligible failure without duplicate effects.

**Independent Test**: Page attempts, replay once, submit duplicate/concurrent requests, and assert one recovery delivery and audit correlation.

- [ ] T025 [P] [US3] Add cursor/retention/redaction, replay eligibility, duplicate/concurrent idempotency, zero-outbound denial, role-negative, and cross-tenant tests in `tests/management-webhooks.test.mjs`
- [ ] T026 [P] [US3] Add public webhook registration/delivery/signature/retry compatibility cases in `tests/api-webhooks.test.mjs`
- [ ] T027 [US3] Implement safe attempt projections, cursor validation, 30-day policy retention, terminal eligibility, replay transaction, and idempotent results in `dashboard/management-webhooks.mjs`
- [ ] T028 [US3] Connect additive history/replay routes while preserving `/api/v1/webhooks` in `dashboard/server.mjs`, `api/v1/router.mjs`, and `api/v1/webhooks.mjs`
- [ ] T029 [P] [US3] Render webhook attempt pagination, retention notice, safe details, and durable links in `dashboard/app/routes/integrations/webhooks.mjs`
- [ ] T030 [P] [US3] Render replay confirmation/reasons, ineligible/duplicate explanations, result, and audit link in `dashboard/app/routes/integrations/webhook-detail.mjs`
- [ ] T031 [US3] Add cursor/replay/idempotency/denial/retention and keyboard/focus browser evidence in `browser-tests/management-workflows.spec.mjs`

## Phase 6: User Story 4 — Manage members and effective permissions (P1)

**Goal**: Administrators manage scoped invitations/memberships and understand permissions without client-side authority.

**Independent Test**: Invite, resend, cancel, expire, accept, and change role; compare explanation to enforcement.

- [ ] T032 [P] [US4] Add invitation/membership lifecycle, expiry, resend/supersession, cancellation, acceptance identity, role-change version, and effective-permission tests in `tests/management-access.test.mjs`
- [ ] T033 [P] [US4] Add admin/operator/viewer, project/tenant boundary, non-disclosure, and attempted-change audit tests in `tests/management-authorization.test.mjs`
- [ ] T034 [US4] Extend invitation/membership versioning and policy-derived 24-hour expiry without raw tokens in `auth/user-store.mjs`
- [ ] T035 [US4] Implement effective-permission projection, scoped lifecycle operations, server enforcement, and audit evidence in `dashboard/management-access.mjs` and `dashboard/server.mjs`
- [ ] T036 [P] [US4] Render member/invitation lists, expiry/resend/cancel, and role-change feedback in `dashboard/app/routes/administration/members.mjs`
- [ ] T037 [P] [US4] Render role/scope/effective-permission explanation and audit detail in `dashboard/app/routes/administration/member-detail.mjs`
- [ ] T038 [US4] Add lifecycle, permission/explanation comparison, cross-tenant denial, and accessibility browser evidence in `browser-tests/management-workflows.spec.mjs`

## Phase 7: User Story 5 — Review billing, security, settings, and audit outcomes (P2)

**Goal**: Authorized users understand environment/mode, limits, security, policy impact, rollback boundaries, and audit outcomes.

**Independent Test**: Exercise local/cloud normal/read-only/degraded/unavailable billing plus preview/confirm/partial-failure/rollback cases.

- [ ] T039 [P] [US5] Add local/cloud billing/security/entitlement/limit/mode and role-negative/cross-tenant tests in `tests/management-billing.test.mjs`
- [ ] T040 [P] [US5] Add policy preview, confirmation, blast radius, partial outcome, rollback boundary, disclosure, and audit tests in `tests/management-audit.test.mjs`
- [ ] T041 [US5] Implement billing/security/settings model with explicit environment and availability mode in `dashboard/management-billing.mjs`
- [ ] T042 [US5] Implement scoped policy preview, typed confirmation/reauth, versioned rollback boundary, and per-target audit in `cloud/cloud-control-plane.mjs` and `cloud/cloud-server.mjs`
- [ ] T043 [US5] Connect additive billing/security/settings/audit reads/mutations without changing existing billing contracts in `dashboard/server.mjs`
- [ ] T044 [P] [US5] Render billing limits/entitlements/environment/mode and support path in `dashboard/app/routes/governance/billing.mjs`
- [ ] T045 [P] [US5] Render security posture, filtered audit list/detail, and immutable correlation in `dashboard/app/routes/governance/security.mjs` and `dashboard/app/routes/governance/audit.mjs`
- [ ] T046 [P] [US5] Render tenant settings, policy preview/confirmation, outcomes, and rollback boundary in `dashboard/app/routes/administration/tenant-settings.mjs`
- [ ] T047 [US5] Add billing mode, policy preview/rollback, audit disclosure, and keyboard/focus browser evidence in `browser-tests/management-workflows.spec.mjs`

## Phase 8: Cross-cutting validation, documentation, and convergence

- [ ] T048 [P] Add management navigation/detail Back/Forward/permission-aware labels and legacy route compatibility in `dashboard/app/route-registry.mjs` and `dashboard/static/app-platform.mjs`
- [ ] T049 [P] Add supported-browser performance, accessibility scan, keyboard/focus, zoom, reduced-motion, and narrow-viewport coverage in `browser-tests/management-workflows.spec.mjs`
- [ ] T050 [P] Document creation, overlap, immediate revoke, lost-key recovery, and evidence in `docs/key-rotation.md`
- [ ] T051 [P] Document delivery history, eligibility, idempotent replay, and recovery in `docs/webhook-recovery.md`
- [ ] T052 [P] Document invitation lifecycle, role changes, and permissions support in `docs/invitation-management.md`
- [ ] T053 [P] Document local/cloud billing modes, limits, degraded support, and entitlements in `docs/billing-support.md`
- [ ] T054 [P] Document policy preview, partial failures, rollback boundaries, and incident response in `docs/policy-rollback.md` and `docs/management-incident-response.md`
- [ ] T055 Run focused management, compatibility, full `npm test`, browser/accessibility/performance, and `git diff --check` validation; record counts/timings in `specs/014-management-workflows/quickstart.md`
- [ ] T056 Run `$speckit-converge`, add any unbuilt work to `specs/014-management-workflows/tasks.md`, complete it, and repeat until clean

## Dependencies and execution order

`Setup -> Foundational safety boundary -> US1 provider MVP -> US2 API keys / US3 webhooks / US4 access -> US5 billing/settings/audit -> cross-cutting gates`

US2, US3, and US4 may proceed in parallel only after T010. Within every story: prove tests fail, implement domain module, connect server contract, render route, then run browser evidence.

## Requirement and acceptance-evidence coverage

| Requirement | Implementation tasks | Acceptance evidence tasks |
|---|---|---|
| FR-501 | T013–T016 | T011–T012, T017 |
| FR-502 | T020–T023 | T018–T019, T024 |
| FR-503 | T027–T030 | T025–T026, T031 |
| FR-504 | T034–T037 | T032–T033, T038 |
| FR-505 | T041–T046 | T039–T040, T047 |
| FR-506/NFR-503 | T008, T010, T021, T027, T035, T042–T043 | T006, T012, T019, T025, T033, T040, T055 |
| NFR-501 | T007, T010, T014, T028, T035, T043 | T004, T011, T019, T025, T033, T039, T055 |
| NFR-502 | T009, T021–T023, T027 | T005, T012, T018, T024, T055 |
| NFR-504 | T010, T014, T023, T028, T043, T048 | T003, T026, T055 |
| NFR-505 | T015–T017, T022, T029–T031, T036–T038, T044–T048 | T017, T024, T031, T038, T047, T049, T055 |
| SC-501 | T013–T016 | T011–T012, T017, T055 |
| SC-502 | T020–T023 | T005, T018, T024, T055 |
| SC-503 | T027–T030 | T025–T026, T031, T055 |
| SC-504 | T034–T037 | T032–T033, T038, T055 |
| SC-505 | T008, T010, T021, T027, T035, T042–T043 | T006, T055 |
| SC-506 | T015–T017, T022, T029–T031, T036–T038, T044–T048 | T017, T024, T031, T038, T047, T049, T055 |
| SC-507 | T010, T014, T023, T028, T043, T048 | T003, T026, T055 |

## Implementation strategy

MVP is T001–T017: a fully authorized provider/integration workflow with safe tests and complete evidence. Subsequent P1 stories add isolated value on the same safety boundary. Implementation cannot proceed until all acceptance evidence and the final convergence task are complete.
