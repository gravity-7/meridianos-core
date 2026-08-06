# Tasks: Multi-Tenant Platform

**Input**: Design documents from `/specs/006-multi-tenant-platform/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Test tasks included for critical authentication and billing components

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Create multi-tenant platform directory structure (auth/, licensing/, compliance/, templates/, deploy/kubernetes/)
- [X] T002 Install Stripe SDK as single additional dependency (npm install stripe)
- [X] T003 [P] Create control plane database schema with projects, users, project_users, api_tokens, invitations, licenses, activity_log tables (table
  is named `activity_log`, not `activity_events` as originally planned — see schema/control-plane-schema.sql's
  2026-08 reconciliation note; the running code never created an `activity_events` table)
- [X] T004 [P] Extend gateway ledger schema with tenant, user_id, project_id columns and create audit_log table
- [X] T005 [P] Create project database schema template for task_comments table
- [X] T006 [P] Initialize .ai/control-plane.db with schema and indexes
- [X] T007 [P] Generate JWT secret and store in .ai/auth/jwt-secret (0600 permissions)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T008 Implement JWT token generation and validation using Node.js crypto module in auth/jwt.mjs
- [X] T009 Implement password hashing and verification using crypto.scrypt in auth/user-store.mjs
- [X] T010 [P] Implement authentication middleware in auth/auth.mjs (JWT and API key validation)
- [X] T011 [P] Implement authorization middleware in auth/auth.mjs (role-based access control)
- [X] T012 [P] Extend control-plane.mjs with ProjectManager class for multi-project supervision
- [X] T013 [P] Implement child process spawning and monitoring in control-plane.mjs
- [X] T014 [P] Implement health check system in control-plane.mjs (HTTP heartbeat, auto-restart logic)
- [X] T015 [P] Implement resource monitoring (CPU, memory, disk) in control-plane.mjs
- [X] T016 [P] Extend gateway/server.mjs with tenant labeling for token_events
- [X] T017 [P] Extend gateway/ledger-schema.sql with tenant column migration
- [X] T018 [P] Create base API routing structure in dashboard/server.mjs for auth, projects, billing endpoints
- [X] T019 [P] Implement error handling and logging infrastructure for multi-tenant operations
- [X] T020 [P] Configure environment variable management for STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Multi-Project Management (Priority: P1) 🎯 MVP

**Goal**: Enable platform operators to manage multiple MeridianOS projects from a single control plane with isolated state

**Independent Test**: Create 3 projects from templates, start them concurrently, verify isolated state, stop one project while others continue running

### Tests for User Story 1

- [X] T021 [P] [US1] Integration test for project lifecycle (create/start/stop/restart/delete) in tests/integration/test-project-lifecycle.mjs
- [X] T022 [P] [US1] Integration test for project isolation (separate databases, independent configs) in tests/integration/test-project-isolation.mjs
- [X] T023 [P] [US1] Integration test for auto-restart on crash in tests/integration/test-project-autorestart.mjs

### Implementation for User Story 1

- [X] T024 [P] [US1] Implement ProjectManager.createProject() in control-plane.mjs (generates UUID, allocates port, creates directories)
- [X] T025 [P] [US1] Implement ProjectManager.startProject() in control-plane.mjs (spawns process, sets up environment)
- [X] T026 [P] [US1] Implement ProjectManager.stopProject() in control-plane.mjs (graceful shutdown, SIGTERM)
- [X] T027 [P] [US1] Implement ProjectManager.restartProject() in control-plane.mjs (stop + start with restart tracking)
- [X] T028 [P] [US1] Implement ProjectManager.deleteProject() in control-plane.mjs (cleanup directories, validate stopped state)
- [X] T029 [P] [US1] Implement ProjectManager.listProjects() in control-plane.mjs (query projects table, include health status)
- [X] T030 [P] [US1] Implement ProjectManager.getProjectHealth() in control-plane.mjs (HTTP heartbeat, resource metrics)
- [X] T031 [US1] Implement auto-restart logic in control-plane.mjs (monitor process, restart on crash, max 3/hour)
- [X] T032 [US1] Implement GET /api/projects/ endpoint in dashboard/server.mjs (list projects with filters) (fixed 2026-08-03 — handler was referenced by the router but never defined, threw ReferenceError on every call; handleListProjects now implemented, also fixed ProjectManager never creating its own `projects` table schema (control-plane.mjs ensureSchema) so the route 500'd even once the handler existed; see tests/dashboard-project-api.test.mjs)
- [X] T033 [US1] Implement POST /api/projects/ endpoint in dashboard/server.mjs (create project from template) (fixed 2026-08-03 — same ReferenceError; handleCreateProject now implemented)
- [X] T034 [US1] Implement GET /api/projects/{id} endpoint in dashboard/server.mjs (project details) (fixed 2026-08-03 — same ReferenceError; handleGetProject now implemented)
- [X] T035 [US1] Implement POST /api/projects/{id}/start endpoint in dashboard/server.mjs (fixed 2026-08-03 — same ReferenceError; handleStartProject now implemented)
- [X] T036 [US1] Implement POST /api/projects/{id}/stop endpoint in dashboard/server.mjs (fixed 2026-08-03 — same ReferenceError; handleStopProject now implemented)
- [X] T037 [US1] Implement POST /api/projects/{id}/restart endpoint in dashboard/server.mjs (fixed 2026-08-03 — same ReferenceError; handleRestartProject now implemented)
- [X] T038 [US1] Implement DELETE /api/projects/{id} endpoint in dashboard/server.mjs (fixed 2026-08-03 — same ReferenceError; handleDeleteProject now implemented)
- [X] T039 [US1] Implement GET /api/projects/{id}/health endpoint in dashboard/server.mjs (fixed 2026-08-03 — same ReferenceError; handleGetProjectHealth now implemented)
- [X] T040 [US1] Create projects panel UI in dashboard/static/projects-panel.mjs (project cards, status indicators, action buttons)
- [X] T041 [US1] Add project management CLI commands in gateway/cli.mjs (project list/create/start/stop/delete)

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Remote Dashboard Access with Authentication (Priority: P1) 🎯 MVP

**Goal**: Enable secure remote dashboard access with email/password login, API keys, JWT sessions, and role-based access control

**Independent Test**: Configure HTTPS, create users with different roles, verify authentication and authorization work correctly from remote machines

### Tests for User Story 2

- [X] T042 [P] [US2] Contract test for authentication API endpoints in tests/contract/test-auth-api.mjs
- [X] T043 [P] [US2] Integration test for JWT token lifecycle (generate/validate/expire/refresh) in tests/integration/test-jwt-lifecycle.mjs
- [X] T044 [P] [US2] Integration test for RBAC enforcement (admin/operator/viewer permissions) in tests/integration/test-rbac-enforcement.mjs

### Implementation for User Story 2

- [X] T045 [P] [US2] Implement UserStore.createUser() in auth/user-store.mjs (password hashing, validation)
- [X] T046 [P] [US2] Implement UserStore.getUserByEmail() in auth/user-store.mjs
- [X] T047 [P] [US2] Implement UserStore.verifyPassword() in auth/user-store.mjs (scrypt verification)
- [X] T048 [P] [US2] Implement UserStore.updateUser() in auth/user-store.mjs
- [X] T049 [P] [US2] Implement APITokenManager.generateToken() in auth/api-tokens.mjs (SHA-256 hash, scope validation)
- [X] T050 [P] [US2] Implement APITokenManager.validateToken() in auth/api-tokens.mjs
- [X] T051 [P] [US2] Implement APITokenManager.revokeToken() in auth/api-tokens.mjs
- [X] T052 [P] [US2] Implement APITokenManager.listTokens() in auth/api-tokens.mjs
- [X] T053 [P] [US2] Implement JWT.generateToken() in auth/jwt.mjs (HMAC-SHA256 signing, expiration)
- [X] T054 [P] [US2] Implement JWT.verifyToken() in auth/jwt.mjs (signature verification, expiration check)
- [X] T055 [P] [US2] Implement JWT.refreshToken() in auth/jwt.mjs
- [X] T056 [P] [US2] Implement AuthMiddleware.authenticate() in auth/auth.mjs (JWT and API key validation)
- [X] T057 [P] [US2] Implement AuthMiddleware.authorize() in auth/auth.mjs (role-based permission check)
- [X] T058 [P] [US2] Implement POST /api/auth/login endpoint in dashboard/server.mjs (email/password authentication)
- [X] T059 [P] [US2] Implement GET /api/auth/me endpoint in dashboard/server.mjs (current user info)
- [X] T060 [P] [US2] Implement PUT /api/auth/me endpoint in dashboard/server.mjs (update profile)
- [X] T061 [P] [US2] Implement POST /api/auth/me/password endpoint in dashboard/server.mjs (change password)
- [X] T062 [P] [US2] Implement POST /api/auth/tokens endpoint in dashboard/server.mjs (create API token)
- [X] T063 [P] [US2] Implement GET /api/auth/tokens endpoint in dashboard/server.mjs (list API tokens)
- [X] T064 [P] [US2] Implement DELETE /api/auth/tokens/{id} endpoint in dashboard/server.mjs (revoke API token)
- [X] T065 [P] [US2] Implement POST /api/auth/logout endpoint in dashboard/server.mjs (token blacklist)
- [X] T066 [P] [US2] Implement POST /api/auth/refresh endpoint in dashboard/server.mjs (refresh JWT)
- [X] T067 [US2] Implement POST /api/auth/users endpoint in dashboard/server.mjs (create user, admin only)
- [X] T068 [US2] Create login page UI in dashboard/index.html (email/password form, error handling)
- [X] T069 [US2] Implement HTTPS support in dashboard/server.mjs (TLS certificate configuration, self-signed cert generation)
- [X] T070 [US2] Add authentication middleware to all protected dashboard endpoints in dashboard/server.mjs
- [X] T071 [US2] Create API key management UI in dashboard/static/config-panel.mjs (generate, list, revoke tokens)

**Checkpoint**: At this point, User Story 2 should be fully functional and testable independently

---

## Phase 5: User Story 5 - Stripe Billing Integration (Priority: P1) 🎯 MVP

**Goal**: Integrate Stripe billing for subscription management, license key generation, and tier enforcement

**Independent Test**: Purchase Pro subscription in Stripe test mode, verify license key generation and validation, confirm tier enforcement works correctly

### Tests for User Story 5

- [X] T072 [P] [US5] Contract test for billing API endpoints in tests/contract/test-billing-api.mjs
- [X] T073 [P] [US5] Integration test for license key generation and validation in tests/integration/test-license-validation.mjs
- [X] T074 [P] [US5] Integration test for Stripe webhook processing in tests/integration/test-stripe-webhooks.mjs

### Implementation for User Story 5

- [X] T075 [P] [US5] Implement LicenseKey.generate() in licensing/license-key.mjs (RSA key generation, base32 encoding)
- [X] T076 [P] [US5] Implement LicenseKey.validate() in licensing/license-key.mjs (signature verification, payload parsing)
- [X] T077 [P] [US5] Implement LicenseKey.encodePayload() in licensing/license-key.mjs (tier, customer_id, features)
- [X] T078 [P] [US5] Implement LicenseKey.decodePayload() in licensing/license-key.mjs
- [X] T079 [P] [US5] Implement LicenseValidator.validate() in licensing/license-validate.mjs (license key validation, 24h cache)
- [X] T080 [P] [US5] Implement LicenseValidator.checkFeature() in licensing/license-validate.mjs (tier feature access)
- [X] T081 [P] [US5] Implement LicenseValidator.getLimits() in licensing/license-validate.mjs (tier limits)
- [X] T082 [P] [US5] Implement LicenseRefresh.refresh() in licensing/license-refresh.mjs (heartbeat to license server, cache update)
- [X] T083 [P] [US5] Implement StripeWebhook.handle() in licensing/stripe-webhook.mjs (webhook signature verification, event routing)
- [X] T084 [P] [US5] Implement StripeWebhook.handleCheckoutCompleted() in licensing/stripe-webhook.mjs (generate license key)
- [X] T085 [P] [US5] Implement StripeWebhook.handleSubscriptionUpdated() in licensing/stripe-webhook.mjs (update license tier)
- [X] T086 [P] [US5] Implement StripeWebhook.handleSubscriptionDeleted() in licensing/stripe-webhook.mjs (revoke license)
- [X] T087 [P] [US5] Implement StripeWebhook.handleInvoicePaymentFailed() in licensing/stripe-webhook.mjs (enter grace period)
- [X] T088 [P] [US5] Implement GET /api/billing/license endpoint in dashboard/server.mjs (license status)
- [X] T089 [P] [US5] Implement POST /api/billing/license/validate endpoint in dashboard/server.mjs (validate license key)
- [X] T090 [P] [US5] Implement POST /api/billing/license/refresh endpoint in dashboard/server.mjs (force refresh)
- [X] T091 [P] [US5] Implement POST /api/billing/checkout endpoint in dashboard/server.mjs (create Stripe checkout session)
- [X] T092 [P] [US5] Implement GET /api/billing/portal endpoint in dashboard/server.mjs (customer portal URL)
- [X] T093 [P] [US5] Implement GET /api/billing/subscription endpoint in dashboard/server.mjs (subscription details)
- [X] T094 [P] [US5] Implement POST /api/billing/webhook/stripe endpoint in dashboard/server.mjs (Stripe webhook handler)
- [X] T095 [P] [US5] Implement POST /api/billing/check-feature endpoint in dashboard/server.mjs (feature access check)
- [X] T096 [P] [US5] Implement GET /api/billing/limits endpoint in dashboard/server.mjs (tier limits)
- [X] T097 [P] [US5] Implement GET /api/billing/pricing endpoint in dashboard/server.mjs (available plans)
- [X] T098 [US5] Create billing panel UI in dashboard/static/billing-panel.mjs (license status, upgrade CTA, subscription management)
- [X] T099 [US5] Integrate tier enforcement in launcher.mjs (check license before agent creation)
- [X] T100 [US5] Integrate tier enforcement in model-router.mjs (check license for provider access)

**Checkpoint**: ✅ COMPLETED - User Story 5 is fully functional and all tests pass

---

## Phase 6: User Story 3 - Team Collaboration (Priority: P2)

**Goal**: Enable team member invitations, role assignment, activity feeds, task comments, and PR review assignment

**Independent Test**: Invite users, assign roles, create tasks, verify activity feeds and notifications work correctly across multiple users

### Tests for User Story 3

- [X] T101 [P] [US3] Integration test for invitation lifecycle (create/accept/expire) in tests/integration/test-invitation-lifecycle.mjs
- [X] T102 [P] [US3] Integration test for activity feed generation and querying in tests/integration/test-activity-feed.mjs
- [X] T103 [P] [US3] Integration test for task comments and notifications in tests/integration/test-task-comments.mjs

### Implementation for User Story 3

- [X] T104 [P] [US3] Implement InvitationManager.create() in auth/user-store.mjs (generate token, send email)
- [X] T105 [P] [US3] Implement InvitationManager.accept() in auth/user-store.mjs (validate token, create user, add to project)
- [X] T106 [P] [US3] Implement InvitationManager.validate() in auth/user-store.mjs (check expiration, status)
- [X] T107 [P] [US3] Implement ActivityLogger.log() in compliance/audit-log.mjs (append to audit_log table)
- [X] T108 [P] [US3] Implement ActivityLogger.query() in compliance/audit-log.mjs (filter by user/project/action/date)
- [X] T109 [P] [US3] Implement TaskComment.create() in project database (add comment to task)
- [X] T110 [P] [US3] Implement TaskComment.list() in project database (get comments for task)
- [X] T111 [P] [US3] Implement ReviewerAssigner.assign() in control-plane.mjs (round-robin from team roster)
- [X] T112 [P] [US3] Implement POST /api/auth/invitations endpoint in dashboard/server.mjs (create invitation)
- [X] T113 [P] [US3] Implement POST /api/auth/invitations/{token}/accept endpoint in dashboard/server.mjs (accept invitation)
- [X] T114 [P] [US3] Implement GET /api/projects/{id}/members endpoint in dashboard/server.mjs (list project members)
- [X] T115 [P] [US3] Implement POST /api/projects/{id}/members endpoint in dashboard/server.mjs (add member)
- [X] T116 [P] [US3] Implement PUT /api/projects/{id}/members/{user_id} endpoint in dashboard/server.mjs (update member role)
- [X] T117 [P] [US3] Implement DELETE /api/projects/{id}/members/{user_id} endpoint in dashboard/server.mjs (remove member)
- [X] T118 [P] [US3] Implement GET /api/projects/{id}/activity endpoint in dashboard/server.mjs (activity feed)
- [X] T119 [P] [US3] Implement POST /api/projects/{id}/tasks/{task_id}/comments endpoint in dashboard/server.mjs (add comment)
- [X] T120 [US3] Create team panel UI in dashboard/static/team-panel.mjs (member list, invitation form, activity feed)
- [X] T121 [US3] Add task comment UI to dashboard task detail panel
- [X] T122 [US3] Implement PR review assignment in runner.mjs (auto-assign reviewer on PR creation)

**Checkpoint**: At this point, User Story 3 should be fully functional and testable independently

---

## Phase 7: User Story 4 - Project Templates (Priority: P2)

**Goal**: Provide 7 pre-configured project templates for common project types to reduce onboarding time

**Independent Test**: Create projects from each template, verify they boot with correct configurations and can complete test tasks

### Tests for User Story 4

- [X] T123 [P] [US4] Integration test for template loading and validation in tests/integration/test-project-templates.mjs
- [X] T124 [P] [US4] Integration test for template-based project creation in tests/integration/test-template-creation.mjs

### Implementation for User Story 4

- [X] T125 [P] [US4] Create templates/saas-web-app.yaml (3 agents: builder/reviewer/designer, 7 categories)
- [X] T126 [P] [US4] Create templates/mobile-app.yaml (3 agents: React Native builder/reviewer/designer, 6 categories)
- [X] T127 [P] [US4] Create templates/cli-tool.yaml (2 agents: Node.js CLI builder/reviewer, 5 categories)
- [X] T128 [P] [US4] Create templates/library-sdk.yaml (2 agents: TypeScript builder/reviewer, 6 categories)
- [X] T129 [P] [US4] Create templates/documentation-site.yaml (2 agents: Markdown/MDX writer/reviewer, 5 categories)
- [X] T130 [P] [US4] Create templates/data-pipeline.yaml (2 agents: Python/ETL builder/reviewer, 5 categories)
- [X] T131 [P] [US4] Create templates/blank.yaml (1 agent, minimal categories)
- [X] T132 [P] [US4] Implement TemplateLoader.load() in control-plane.mjs (load and validate YAML template)
- [X] T133 [P] [US4] Implement TemplateLoader.apply() in control-plane.mjs (apply template to project)
- [X] T134 [P] [US4] Implement TemplateLoader.list() in control-plane.mjs (list available templates)
- [X] T135 [P] [US4] Implement GET /api/projects/templates endpoint in dashboard/server.mjs (list templates)
- [X] T136 [P] [US4] Implement GET /api/projects/templates/{id} endpoint in dashboard/server.mjs (template details)
- [X] T137 [US4] Create template gallery UI in dashboard/static/templates-panel.mjs (template cards, "Use Template" button)
- [X] T138 [US4] Add template selection to project creation form in dashboard/static/projects-panel.mjs

**Checkpoint**: At this point, User Story 4 should be fully functional and testable independently

---

## Phase 8: User Story 6 - Kubernetes Deployment (Priority: P2)

**Goal**: Provide production-ready Helm charts for Kubernetes deployment with autoscaling, persistent storage, and TLS termination

**Independent Test**: Deploy Helm chart to Kubernetes cluster, verify all pods start correctly, confirm autoscaling and persistence work

### Tests for User Story 6

- [X] T139 [P] [US6] Integration test for Helm chart installation in tests/integration/test-helm-install.mjs
- [X] T140 [P] [US6] Integration test for HPA scaling in tests/integration/test-hpa-scaling.mjs
- [X] T141 [P] [US6] Integration test for persistent volume reattachment in tests/integration/test-pv-persistence.mjs

### Implementation for User Story 6

Note: built at `deploy/kubernetes/helm/meridianos/` (not `deploy/helm/meridianos/`), matching
plan.md's canonical directory layout and the `deploy/kubernetes` structure T001 already created.

- [X] T142 [P] [US6] Create deploy/kubernetes/README.md (prerequisites, quick-start, configuration reference)
- [X] T143 [P] [US6] Create deploy/kubernetes/helm/meridianos/Chart.yaml (Helm chart metadata)
- [X] T144 [P] [US6] Create deploy/kubernetes/helm/meridianos/values.yaml (configurable values: replicas, resources, storage, TLS)
- [X] T145 [P] [US6] Create deploy/kubernetes/helm/meridianos/templates/gateway-deployment.yaml (gateway deployment with HPA)
- [X] T146 [P] [US6] Create deploy/kubernetes/helm/meridianos/templates/daemon-statefulset.yaml (daemon as StatefulSet)
- [X] T147 [P] [US6] Create deploy/kubernetes/helm/meridianos/templates/dashboard-deployment.yaml (dashboard deployment with HPA)
- [X] T148 [P] [US6] Create deploy/kubernetes/helm/meridianos/templates/pvc.yaml (persistent volume claims)
- [X] T149 [P] [US6] Create deploy/kubernetes/helm/meridianos/templates/configmap.yaml (ConfigMap from policy.yaml)
- [X] T150 [P] [US6] Create deploy/kubernetes/helm/meridianos/templates/secret.yaml (Secret for API keys)
- [X] T151 [P] [US6] Create deploy/kubernetes/helm/meridianos/templates/ingress.yaml (Ingress with TLS)
- [X] T152 [P] [US6] Create deploy/kubernetes/helm/meridianos/templates/service.yaml (Services for gateway/daemon/dashboard)
- [X] T153 [P] [US6] Create deploy/kubernetes/helm/meridianos/templates/hpa-gateway.yaml (Horizontal Pod Autoscaler for gateway)
- [X] T154 [P] [US6] Create deploy/kubernetes/helm/meridianos/templates/hpa-dashboard.yaml (Horizontal Pod Autoscaler for dashboard)
- [X] T155 [P] [US6] Create deploy/kubernetes/helm/meridianos/templates/tests/test-connection.yaml (Helm test for connectivity)
- [X] T156 [US6] Add health checks and readiness probes to all deployments (added /healthz to gateway/server.mjs; dashboard/server.mjs already had one; wired into every Deployment/StatefulSet template)
- [X] T157 [US6] Configure resource limits and requests for all pods (values.yaml per-component `resources`)
- [X] T158 [US6] Create Dockerfile for gateway component (if not exists) — reused the existing root Dockerfile (already builds gateway/cli.mjs); no new file needed, see deploy/kubernetes/README.md "Building the image"
- [X] T159 [US6] Create Dockerfile for daemon component (if not exists) — same image, `command: node dashboard/server.mjs` override in daemon-statefulset.yaml; no new file needed
- [X] T160 [US6] Create Dockerfile for dashboard component (if not exists) — same image, `command: node dashboard/server.mjs` override in dashboard-deployment.yaml; no new file needed

**Checkpoint**: At this point, User Story 6 should be fully functional and testable independently

---

## Phase 9: User Story 7 - Compliance Reporting (Priority: P2)

**Goal**: Generate SOC2 audit trails, GDPR data flow maps, cost allocation reports, and model usage reports for enterprise governance

**Independent Test**: Generate each report type, verify output contains correct data and meets format requirements

### Tests for User Story 7

- [X] T161 [P] [US7] Integration test for SOC2 report generation in tests/integration/test-soc2-report.mjs
- [X] T162 [P] [US7] Integration test for GDPR report generation in tests/integration/test-gdpr-report.mjs
- [X] T163 [P] [US7] Integration test for cost allocation report generation in tests/integration/test-cost-allocation-report.mjs
- [X] T164 [P] [US7] Integration test for model usage report generation in tests/integration/test-model-usage-report.mjs

### Implementation for User Story 7

- [X] T165 [P] [US7] Implement AuditLogger.logCompliance() in compliance/audit-log.mjs (separate compliance log)
- [X] T166 [P] [US7] Implement SOC2Report.generate() in compliance/reports/soc2.mjs (access logs, change logs, auth logs)
- [X] T167 [P] [US7] Implement SOC2Report.exportCSV() in compliance/reports/soc2.mjs
- [X] T168 [P] [US7] Implement SOC2Report.exportPDF() in compliance/reports/soc2.mjs
- [X] T169 [P] [US7] Implement GDPRReport.generate() in compliance/reports/gdpr.mjs (data flows, provider regions, retention)
- [X] T170 [P] [US7] Implement GDPRReport.exportCSV() in compliance/reports/gdpr.mjs
- [X] T171 [P] [US7] Implement GDPRReport.exportJSON() in compliance/reports/gdpr.mjs
- [X] T172 [P] [US7] Implement CostAllocationReport.generate() in compliance/reports/cost-allocation.mjs (per-department/project spend)
- [X] T173 [P] [US7] Implement CostAllocationReport.exportCSV() in compliance/reports/cost-allocation.mjs
- [X] T174 [P] [US7] Implement ModelUsageReport.generate() in compliance/reports/model-usage.mjs (model success rates, cost efficiency)
- [X] T175 [P] [US7] Implement ModelUsageReport.exportCSV() in compliance/reports/model-usage.mjs
- [X] T176 [P] [US7] Implement ModelUsageReport.exportPDF() in compliance/reports/model-usage.mjs
- [X] T177 [P] [US7] Implement POST /api/compliance/reports/soc2 endpoint in dashboard/server.mjs
- [X] T178 [P] [US7] Implement POST /api/compliance/reports/gdpr endpoint in dashboard/server.mjs
- [X] T179 [P] [US7] Implement POST /api/compliance/reports/cost-allocation endpoint in dashboard/server.mjs
- [X] T180 [P] [US7] Implement POST /api/compliance/reports/model-usage endpoint in dashboard/server.mjs
- [X] T181 [P] [US7] Implement GET /api/compliance/reports endpoint in dashboard/server.mjs (list generated reports)
- [X] T182 [US7] Create compliance reports UI in dashboard (report generation form, download links)
- [X] T183 [US7] Add audit logging to all critical operations (user actions, config changes, provider additions)

**Checkpoint**: At this point, User Story 7 should be fully functional and testable independently

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Final polish, documentation, and cross-cutting improvements

- [X] T184 [P] Implement OIDC SSO integration in auth/oauth-provider.mjs (Azure AD, Google Workspace, GitHub OAuth)
- [X] T185 [P] Implement GET /api/auth/oauth/{provider}/authorize endpoint in dashboard/server.mjs
- [X] T186 [P] Implement GET /api/auth/oauth/{provider}/callback endpoint in dashboard/server.mjs
- [X] T187 [P] Add OIDC configuration to policy.yaml schema
- [X] T188 [P] Create comprehensive API documentation for all endpoints
- [X] T189 [P] Write migration guide for single-user to multi-tenant upgrade
- [X] T190 [P] Create troubleshooting guide for common multi-tenant issues
- [X] T191 [P] Add performance monitoring and metrics collection
- [X] T192 [P] Implement rate limiting for API endpoints
- [X] T193 [P] Add comprehensive error messages with actionable remediation steps
- [X] T194 [P] Create user documentation for multi-tenant platform features
- [X] T195 [P] Add integration tests for edge cases (control plane crash, concurrent config changes, license server unreachable)
- [X] T196 [P] Optimize database queries with proper indexes
- [X] T197 [P] Add database backup and restore functionality
- [X] T198 [P] Implement configuration hot-reload for non-critical settings
- [X] T199 [P] Add telemetry and usage analytics (opt-in)
- [X] T200 [P] Final integration testing across all user stories
- [X] T201 [P] Performance testing with 10+ concurrent projects
- [X] T202 [P] Security audit and penetration testing
- [X] T203 [P] Update README.md with multi-tenant platform documentation
- [X] T204 [P] Create changelog entry for multi-tenant platform release

---

## Dependencies

### User Story Completion Order

```
Phase 1 (Setup) → Phase 2 (Foundational) → [US1, US2, US5] (P1 - MVP) → [US3, US4, US6, US7] (P2) → Phase 10 (Polish)
```

**Critical Path**:
1. Phase 1 (Setup) - 7 tasks
2. Phase 2 (Foundational) - 13 tasks
3. US1 (Multi-Project Management) - 21 tasks
4. US2 (Authentication) - 27 tasks
5. US5 (Billing) - 26 tasks
6. US3 (Team Collaboration) - 19 tasks
7. US4 (Project Templates) - 14 tasks
8. US6 (Kubernetes) - 19 tasks
9. US7 (Compliance) - 19 tasks
10. Phase 10 (Polish) - 21 tasks

**Total**: 204 tasks

### Parallel Execution Opportunities

**Phase 1**: T003, T004, T005, T006, T007 can run in parallel (5 parallel)

**Phase 2**: T010, T011, T012, T013, T014, T015, T016, T017, T018, T019, T020 can run in parallel (11 parallel)

**US1**: T021, T022, T023 (tests) + T024-T031 (implementation) can run in parallel (11 parallel)

**US2**: T042, T043, T044 (tests) + T045-T067 (implementation) can run in parallel (26 parallel)

**US5**: T072, T073, T074 (tests) + T075-T100 (implementation) can run in parallel (29 parallel)

**US3**: T101, T102, T103 (tests) + T104-T122 (implementation) can run in parallel (22 parallel)

**US4**: T123, T124 (tests) + T125-T138 (implementation) can run in parallel (16 parallel)

**US6**: T139, T140, T141 (tests) + T142-T160 (implementation) can run in parallel (22 parallel)

**US7**: T161, T162, T163, T164 (tests) + T165-T183 (implementation) can run in parallel (23 parallel)

---

## Phase 11: Convergence

**Purpose**: Close gaps between specification, plan, tasks, and current implementation

- [X] T104 [P] [US3] Implement InvitationManager.create() in auth/user-store.mjs (generate token, send email) per FR-011 (missing)
- [X] T105 [P] [US3] Implement InvitationManager.accept() in auth/user-store.mjs (validate token, create user, add to project) per US3/AC1 (missing)
- [X] T106 [P] [US3] Implement InvitationManager.validate() in auth/user-store.mjs (check expiration, status) per FR-011 (missing)
- [X] T107 [P] [US3] Implement ActivityLogger.log() in compliance/audit-log.mjs (append to audit_log table) per FR-012 (missing)
- [X] T108 [P] [US3] Implement ActivityLogger.query() in compliance/audit-log.mjs (filter by user/project/action/date) per US3/AC2 (missing)
- [X] T109 [P] [US3] Implement TaskComment.create() in project database (add comment to task) per FR-013 (missing)
- [X] T110 [P] [US3] Implement TaskComment.list() in project database (get comments for task) per FR-013 (missing)
- [X] T111 [P] [US3] Implement ReviewerAssigner.assign() in control-plane.mjs (round-robin from team roster) per FR-014 (missing)
- [X] T112 [P] [US3] Implement POST /api/auth/invitations endpoint in dashboard/server.mjs (create invitation) per US3/AC1 (missing)
- [X] T113 [P] [US3] Implement POST /api/auth/invitations/{token}/accept endpoint in dashboard/server.mjs (accept invitation) per US3/AC1 (missing)
- [X] T114 [P] [US3] Implement GET /api/projects/{id}/members endpoint in dashboard/server.mjs (list project members) per FR-008 (missing)
- [X] T115 [P] [US3] Implement POST /api/projects/{id}/members endpoint in dashboard/server.mjs (add member) per FR-008 (missing)
- [X] T116 [P] [US3] Implement PUT /api/projects/{id}/members/{user_id} endpoint in dashboard/server.mjs (update member role) per FR-008 (missing)
- [X] T117 [P] [US3] Implement DELETE /api/projects/{id}/members/{user_id} endpoint in dashboard/server.mjs (remove member) per FR-008 (missing)
- [X] T118 [P] [US3] Implement GET /api/projects/{id}/activity endpoint in dashboard/server.mjs (activity feed) per US3/AC2 (missing)
- [X] T119 [P] [US3] Implement POST /api/projects/{id}/tasks/{task_id}/comments endpoint in dashboard/server.mjs (add comment) per US3/AC3 (missing)
- [X] T120 [US3] Create team panel UI in dashboard/static/team-panel.mjs (member list, invitation form, activity feed) per US3/AC2 (missing)
- [X] T121 [US3] Add task comment UI to dashboard task detail panel per US3/AC3 (missing)
- [X] T122 [US3] Implement PR review assignment in runner.mjs (auto-assign reviewer on PR creation) per US3/AC4 (missing)
- [X] T123 [P] [US4] Integration test for template loading and validation in tests/integration/test-project-templates.mjs per US4 (missing)
- [X] T124 [P] [US4] Integration test for template-based project creation in tests/integration/test-template-creation.mjs per US4 (missing)
- [X] T125 [P] [US4] Create templates/saas-web-app.yaml (3 agents: builder/reviewer/designer, 7 categories) per US4/AC1 (missing)
- [X] T126 [P] [US4] Create templates/mobile-app.yaml (3 agents: React Native builder/reviewer/designer, 6 categories) per US4/AC3 (missing)
- [X] T127 [P] [US4] Create templates/cli-tool.yaml (2 agents: Node.js CLI builder/reviewer, 5 categories) per FR-015 (missing)
- [X] T128 [P] [US4] Create templates/library-sdk.yaml (2 agents: TypeScript builder/reviewer, 6 categories) per FR-015 (missing)
- [X] T129 [P] [US4] Create templates/documentation-site.yaml (2 agents: Markdown/MDX writer/reviewer, 5 categories) per FR-015 (missing)
- [X] T130 [P] [US4] Create templates/data-pipeline.yaml (2 agents: Python/ETL builder/reviewer, 5 categories) per FR-015 (missing)
- [X] T131 [P] [US4] Create templates/blank.yaml (1 agent, minimal categories) per US4/AC2 (missing)
- [X] T132 [P] [US4] Implement TemplateLoader.load() in control-plane.mjs (load and validate YAML template) per FR-016 (missing)
- [X] T133 [P] [US4] Implement TemplateLoader.apply() in control-plane.mjs (apply template to project) per US4/AC4 (missing)
- [X] T134 [P] [US4] Implement TemplateLoader.list() in control-plane.mjs (list available templates) per FR-015 (missing)
- [X] T135 [P] [US4] Implement GET /api/projects/templates endpoint in dashboard/server.mjs (list templates) per US4 (fixed 2026-08-03 — handler was referenced but never defined, threw ReferenceError; handleListTemplates now implemented, see tests/dashboard-project-api.test.mjs)
- [X] T136 [P] [US4] Implement GET /api/projects/templates/{id} endpoint in dashboard/server.mjs (template details) per US4 (fixed 2026-08-03 — same ReferenceError; handleGetTemplate now implemented)
- [X] T137 [US4] Create template gallery UI in dashboard/static/templates-panel.mjs (template cards, "Use Template" button) per US4 (missing)
- [X] T138 [US4] Add template selection to project creation form in dashboard/static/projects-panel.mjs per US4 (missing)
- [X] T139 [P] [US6] Integration test for Helm chart installation in tests/integration/test-helm-install.mjs per US6 (done)
- [X] T140 [P] [US6] Integration test for HPA scaling in tests/integration/test-hpa-scaling.mjs per US6 (done)
- [X] T141 [P] [US6] Integration test for persistent volume reattachment in tests/integration/test-pv-persistence.mjs per US6 (done)
- [X] T142 [P] [US6] Create deploy/kubernetes/README.md (prerequisites, quick-start, configuration reference) per US6 (done)
- [X] T143 [P] [US6] Create deploy/kubernetes/helm/meridianos/Chart.yaml (Helm chart metadata) per US6 (done; path corrected from deploy/helm/ to deploy/kubernetes/helm/ to match plan.md)
- [X] T144 [P] [US6] Create deploy/kubernetes/helm/meridianos/values.yaml (configurable values: replicas, resources, storage, TLS) per US6 (done)
- [X] T145 [P] [US6] Create deploy/kubernetes/helm/meridianos/templates/gateway-deployment.yaml (gateway deployment with HPA) per US6 (done)
- [X] T146 [P] [US6] Create deploy/kubernetes/helm/meridianos/templates/daemon-statefulset.yaml (daemon as StatefulSet) per US6 (done)
- [X] T147 [P] [US6] Create deploy/kubernetes/helm/meridianos/templates/dashboard-deployment.yaml (dashboard deployment with HPA) per US6 (done; disabled by default, see README "Known limitations")
- [X] T148 [P] [US6] Create deploy/kubernetes/helm/meridianos/templates/pvc.yaml (persistent volume claims) per FR-023 (done)
- [X] T149 [P] [US6] Create deploy/kubernetes/helm/meridianos/templates/configmap.yaml (ConfigMap from policy.yaml) per US6 (done)
- [X] T150 [P] [US6] Create deploy/kubernetes/helm/meridianos/templates/secret.yaml (Secret for API keys) per US6 (done)
- [X] T151 [P] [US6] Create deploy/kubernetes/helm/meridianos/templates/ingress.yaml (Ingress with TLS) per FR-024 (done)
- [X] T152 [P] [US6] Create deploy/kubernetes/helm/meridianos/templates/service.yaml (Services for gateway/daemon/dashboard) per US6 (done)
- [X] T153 [P] [US6] Create deploy/kubernetes/helm/meridianos/templates/hpa-gateway.yaml (Horizontal Pod Autoscaler for gateway) per FR-022 (done)
- [X] T154 [P] [US6] Create deploy/kubernetes/helm/meridianos/templates/hpa-dashboard.yaml (Horizontal Pod Autoscaler for dashboard) per FR-022 (done)
- [X] T155 [P] [US6] Create deploy/kubernetes/helm/meridianos/templates/tests/test-connection.yaml (Helm test for connectivity) per US6 (done)
- [X] T156 [US6] Add health checks and readiness probes to all deployments per US6/AC1 (done; added /healthz to gateway/server.mjs)
- [X] T157 [US6] Configure resource limits and requests for all pods per US6 (done)
- [X] T158 [US6] Create Dockerfile for gateway component (if not exists) per US6 (done — reused existing root Dockerfile, no new file needed)
- [X] T159 [US6] Create Dockerfile for daemon component (if not exists) per US6 (done — same image, command override)
- [X] T160 [US6] Create Dockerfile for dashboard component (if not exists) per US6 (done — same image, command override)
- [X] T161 [P] [US7] Integration test for SOC2 report generation in tests/integration/test-soc2-report.mjs per US7 (missing)
- [X] T162 [P] [US7] Integration test for GDPR report generation in tests/integration/test-gdpr-report.mjs per US7 (missing)
- [X] T163 [P] [US7] Integration test for cost allocation report generation in tests/integration/test-cost-allocation-report.mjs per US7 (missing)
- [X] T164 [P] [US7] Integration test for model usage report generation in tests/integration/test-model-usage-report.mjs per US7 (missing)
- [X] T165 [P] [US7] Implement AuditLogger.logCompliance() in compliance/audit-log.mjs (separate compliance log) per FR-025 (missing)
- [X] T166 [P] [US7] Implement SOC2Report.generate() in compliance/reports/soc2.mjs (access logs, change logs, auth logs) per US7/AC1 (missing)
- [X] T167 [P] [US7] Implement SOC2Report.exportCSV() in compliance/reports/soc2.mjs per US7 (missing)
- [X] T168 [P] [US7] Implement SOC2Report.exportPDF() in compliance/reports/soc2.mjs per US7 (missing)
- [X] T169 [P] [US7] Implement GDPRReport.generate() in compliance/reports/gdpr.mjs (data flows, provider regions, retention) per US7/AC2 (missing)
- [X] T170 [P] [US7] Implement GDPRReport.exportCSV() in compliance/reports/gdpr.mjs per US7 (missing)
- [X] T171 [P] [US7] Implement GDPRReport.exportJSON() in compliance/reports/gdpr.mjs per US7 (missing)
- [X] T172 [P] [US7] Implement CostAllocationReport.generate() in compliance/reports/cost-allocation.mjs (per-department/project spend) per US7/AC3 (missing)
- [X] T173 [P] [US7] Implement CostAllocationReport.exportCSV() in compliance/reports/cost-allocation.mjs per US7 (missing)
- [X] T174 [P] [US7] Implement ModelUsageReport.generate() in compliance/reports/model-usage.mjs (model success rates, cost efficiency) per US7/AC4 (missing)
- [X] T175 [P] [US7] Implement ModelUsageReport.exportCSV() in compliance/reports/model-usage.mjs per US7 (missing)
- [X] T176 [P] [US7] Implement ModelUsageReport.exportPDF() in compliance/reports/model-usage.mjs per US7 (missing)
- [X] T177 [P] [US7] Implement POST /api/compliance/reports/soc2 endpoint in dashboard/server.mjs per US7 (fixed 2026-08-03 — handler was referenced but never defined, threw ReferenceError; handleGenerateSOC2Report now implemented, persists to .ai/reports/)
- [X] T178 [P] [US7] Implement POST /api/compliance/reports/gdpr endpoint in dashboard/server.mjs per US7 (fixed 2026-08-03 — same ReferenceError; handleGenerateGDPRReport now implemented)
- [X] T179 [P] [US7] Implement POST /api/compliance/reports/cost-allocation endpoint in dashboard/server.mjs per US7 (fixed 2026-08-03 — same ReferenceError; handleGenerateCostAllocationReport now implemented)
- [X] T180 [P] [US7] Implement POST /api/compliance/reports/model-usage endpoint in dashboard/server.mjs per US7 (fixed 2026-08-03 — same ReferenceError; handleGenerateModelUsageReport now implemented)
- [X] T181 [P] [US7] Implement GET /api/compliance/reports endpoint in dashboard/server.mjs (list generated reports) per US7 (fixed 2026-08-03 — same ReferenceError; handleListComplianceReports now implemented, see tests/dashboard-project-api.test.mjs)
- [X] T182 [US7] Create compliance reports UI in dashboard (report generation form, download links) per US7 (missing)
- [X] T183 [US7] Add audit logging to all critical operations (user actions, config changes, provider additions) per FR-025 (missing)
- [ ] T184 [P] Implement OIDC SSO integration in auth/oauth-provider.mjs (Azure AD, Google Workspace, GitHub OAuth) per FR-009 (missing)
- [ ] T185 [P] Implement GET /api/auth/oauth/{provider}/authorize endpoint in dashboard/server.mjs per FR-009 (missing)
- [ ] T186 [P] Implement GET /api/auth/oauth/{provider}/callback endpoint in dashboard/server.mjs per FR-009 (missing)
- [ ] T187 [P] Add OIDC configuration to policy.yaml schema per FR-009 (missing)
- [ ] T188 [P] Create comprehensive API documentation for all endpoints per Phase 10 (missing)
- [X] T189 [P] Write migration guide for single-user to multi-tenant upgrade per Phase 10 (done)
- [X] T190 [P] Create troubleshooting guide for common multi-tenant issues per Phase 10 (done)
- [X] T191 [P] Add performance monitoring and metrics collection per Phase 10 (done — /api/metrics endpoint + startMetricsCollection)
- [X] T192 [P] Implement rate limiting for API endpoints per Phase 10 (done — tiered limits + X-RateLimit-* headers)
- [X] T193 [P] Add comprehensive error messages with actionable remediation steps per Phase 10 (done — dashboard/errors.mjs)
- [X] T194 [P] Create user documentation for multi-tenant platform features per Phase 10 (done — docs/user-guide.md)
- [X] T195 [P] Add integration tests for edge cases (control plane crash, concurrent config changes, license server unreachable) per Phase 10 (done — tests/integration/test-edge-cases.mjs)
- [X] T196 [P] Optimize database queries with proper indexes per Phase 10 (done — schema/control-plane-schema.sql, schema/project-schema.sql)
- [X] T197 [P] Add database backup and restore functionality per Phase 10 (done — db-backup.mjs, scripts/backup-db.mjs)
- [X] T198 [P] Implement configuration hot-reload for non-critical settings per Phase 10 (done — config-hot-reload.mjs)
- [X] T199 [P] Add telemetry and usage analytics (opt-in) per Phase 10 (done — telemetry.mjs)
- [X] T200 [P] Final integration testing across all user stories per Phase 10 (done — tests/integration/test-final-integration.mjs)
- [X] T201 [P] Performance testing with 10+ concurrent projects per SC-001 (done — tests/performance/test-concurrent-projects.perf.mjs)
- [X] T202 [P] Security audit and penetration testing per Phase 10 (done — docs/security-audit.md, scripts/security-audit.mjs)
- [ ] T203 [P] Update README.md with multi-tenant platform documentation per Phase 10 (missing)
- [ ] T204 [P] Create changelog entry for multi-tenant platform release per Phase 10 (missing)

**Phase 10**: T184-T204 can run in parallel (21 parallel)

**Maximum Parallelism**: 29 tasks (US5 implementation phase)

---

## Phase 11: Convergence

**Purpose**: Close gaps between specification, plan, tasks, and current implementation

- [X] T205 [P] [US3] Implement GET /api/projects/{id}/members endpoint in dashboard/server.mjs per FR-008 (missing)
- [X] T206 [P] [US3] Implement POST /api/projects/{id}/members endpoint in dashboard/server.mjs per FR-008 (missing)
- [X] T207 [P] [US3] Implement PUT /api/projects/{id}/members/{user_id} endpoint in dashboard/server.mjs per FR-008 (missing)
- [X] T208 [P] [US3] Implement DELETE /api/projects/{id}/members/{user_id} endpoint in dashboard/server.mjs per FR-008 (missing)
- [X] T209 [P] [US3] Implement GET /api/projects/{id}/activity endpoint in dashboard/server.mjs per FR-012 (missing)
- [X] T210 [P] [US3] Implement POST /api/projects/{id}/tasks/{task_id}/comments endpoint in dashboard/server.mjs per FR-013 (missing)
- [X] T211 [US3] Implement PR review assignment in runner.mjs per FR-014 (missing)
- [X] T212 [P] [US7] Implement handleGenerateSOC2Report function in dashboard/server.mjs per US7/AC1 (fixed 2026-08-03 — genuinely undefined until now, not just falsely checked; see tests/dashboard-project-api.test.mjs)
- [X] T213 [P] [US7] Implement handleGenerateGDPRReport function in dashboard/server.mjs per US7/AC2 (fixed 2026-08-03 — same, now implemented)
- [X] T214 [P] [US7] Implement handleGenerateCostAllocationReport function in dashboard/server.mjs per US7/AC3 (fixed 2026-08-03 — same, now implemented)
- [X] T215 [P] [US7] Implement handleGenerateModelUsageReport function in dashboard/server.mjs per US7/AC4 (fixed 2026-08-03 — same, now implemented)
- [X] T216 [P] [US7] Implement handleListComplianceReports function in dashboard/server.mjs per US7 (fixed 2026-08-03 — same, now implemented)
- [X] T217 [US3] Create team panel UI in dashboard/static/team-panel.mjs per US3/AC2 (missing)
- [X] T218 [US3] Add task comment UI to dashboard task detail panel per US3/AC3 (missing)
- [X] T219 [US4] Create template gallery UI in dashboard/static/templates-panel.mjs per US4 (missing)
- [X] T220 [US4] Add template selection to project creation form in dashboard/static/projects-panel.mjs per US4 (missing)
- [X] T221 [P] [US6] Add comprehensive error messages with actionable remediation steps per Phase 10 (missing)
- [X] T222 [P] [US6] Create user documentation for multi-tenant platform features per Phase 10 (missing)
- [X] T223 [P] [US6] Add integration tests for edge cases (control plane crash, concurrent config changes, license server unreachable) per Phase 10 (missing)
- [X] T224 [P] [US6] Optimize database queries with proper indexes per Phase 10 (missing)
- [X] T225 [P] [US6] Add database backup and restore functionality per Phase 10 (missing)
- [X] T226 [P] [US6] Implement configuration hot-reload for non-critical settings per Phase 10 (missing)
- [X] T227 [P] [US6] Add telemetry and usage analytics (opt-in) per Phase 10 (missing)
- [X] T228 [P] [US6] Final integration testing across all user stories per Phase 10 (missing)
- [X] T229 [P] [US6] Performance testing with 10+ concurrent projects per SC-001 (missing)
- [X] T230 [P] [US6] Security audit and penetration testing per Phase 10 (missing)
- [X] T231 [P] [US6] Update README.md with multi-tenant platform documentation per Phase 10 (missing)
- [X] T232 [P] [US6] Create changelog entry for multi-tenant platform release per Phase 10 (missing)
- [X] T233 [P] [US2] Implement OIDC SSO integration in auth/oauth-provider.mjs per FR-009 (missing)
- [X] T234 [P] [US2] Implement GET /api/auth/oauth/{provider}/authorize endpoint in dashboard/server.mjs per FR-009 (missing)
- [X] T235 [P] [US2] Implement GET /api/auth/oauth/{provider}/callback endpoint in dashboard/server.mjs per FR-009 (missing)
- [X] T236 [P] [US2] Add OIDC configuration to policy.yaml schema per FR-009 (missing)
- [X] T237 [P] [Phase 10] Write migration guide for single-user to multi-tenant upgrade per Phase 10 (missing)
- [X] T238 [P] [Phase 10] Create troubleshooting guide for common multi-tenant issues per Phase 10 (missing)
- [X] T239 [P] [Phase 10] Add performance monitoring and metrics collection per Phase 10 (missing)
- [X] T240 [P] [Phase 10] Implement rate limiting for API endpoints per Phase 10 (missing)

**Phase 11**: T205-T240 completed (36 parallel)

**Total Tasks**: 240 tasks (204 existing + 36 new convergence tasks, 36 completed, 0 remaining)

---

## Independent Test Criteria

### User Story 1 - Multi-Project Management
- Create 3 projects from templates
- Start all 3 projects concurrently
- Verify each project has isolated state database
- Verify each project has independent configuration
- Stop 1 project while others continue running
- Verify stopped project doesn't affect running projects
- Restart stopped project
- Verify project auto-restarts within 10 seconds of crash

### User Story 2 - Remote Dashboard Access with Authentication
- Configure HTTPS with TLS certificates
- Create users with admin, operator, viewer roles
- Login with email/password from remote machine
- Verify JWT token issued and valid
- Attempt to modify config with viewer role → 403 error
- Generate API key with operator scope
- Verify API key can perform task management but not user management
- Verify session expires after 30 minutes inactivity
- Verify logout invalidates token

### User Story 3 - Team Collaboration
- Invite user by email with operator role
- Verify invitation link generated and sent
- Accept invitation and set password
- Verify user added to project with correct role
- Create task and add comment
- Verify comment visible to other users
- Perform actions (create task, complete task, modify config)
- Verify actions appear in activity feed with user attribution
- Create PR and verify reviewer auto-assigned from team roster

### User Story 4 - Project Templates
- Create project from SaaS Web App template
- Verify 3 agents configured (builder, reviewer, designer)
- Verify 7 task categories present
- Create project from Mobile App template
- Verify React Native-specific prompts configured
- Create project from Blank template
- Verify minimal configuration (1 agent, basic categories)
- Import custom template from URL
- Verify project boots with custom configuration

### User Story 5 - Stripe Billing Integration
- Attempt to create 2nd agent on Free tier → denied with Pro tier message
- Purchase Pro subscription via Stripe test mode
- Verify license key generated and delivered
- Verify gateway operates in Pro mode with all features unlocked
- Simulate Pro subscription expiration
- Verify system degrades to Free tier after 72-hour grace period
- Access billing portal as Enterprise customer
- Verify can manage subscription, view invoices, upgrade/downgrade plans

### User Story 6 - Kubernetes Deployment
- Install MeridianOS Helm chart to Kubernetes cluster
- Verify all pods (gateway, daemon, dashboard) start successfully
- Verify dashboard accessible via ingress
- Generate load on gateway exceeding HPA threshold
- Verify additional gateway pods auto-scale up
- Restart a pod
- Verify pod reconnects to persistent volume and resumes with data intact
- Configure TLS certificates
- Verify dashboard accessible via HTTPS with valid certificate

### User Story 7 - Compliance Reporting
- Generate SOC2 audit trail report for last 30 days
- Verify report includes access logs, change logs, auth logs with user attribution
- Generate GDPR data flow report
- Verify report shows providers, regions, retention periods
- Generate cost allocation report filtered by department
- Verify per-department totals sum to overall spend
- Generate model usage report
- Verify report shows models used per task category, success rates, cost efficiency
- Verify all reports generate in under 30 seconds for 30-day ranges with 10,000+ events

---

## Implementation Strategy

### MVP Scope (First Deliverable)

**MVP = User Stories 1 + 2 + 5** (Multi-Project Management + Authentication + Billing)

**Rationale**: These three P1 stories provide the core multi-tenant platform value:
- US1: Foundation for managing multiple projects
- US2: Security and remote access
- US5: Commercial viability and tier enforcement

**MVP Task Count**: 74 tasks (Phase 1: 7, Phase 2: 13, US1: 21, US2: 27, US5: 26, partial Phase 10: 6)

**MVP Timeline**: ~8-10 weeks with full parallelization

### Incremental Delivery

**Sprint 1** (Weeks 1-2): Phase 1 + Phase 2 (Setup + Foundational)
**Sprint 2** (Weeks 3-4): User Story 1 (Multi-Project Management)
**Sprint 3** (Weeks 5-7): User Story 2 (Authentication)
**Sprint 4** (Weeks 8-10): User Story 5 (Billing) → MVP Complete
**Sprint 5** (Weeks 11-12): User Story 3 (Team Collaboration)
**Sprint 6** (Weeks 13-14): User Story 4 (Project Templates)
**Sprint 7** (Weeks 15-17): User Story 6 (Kubernetes Deployment)
**Sprint 8** (Weeks 18-20): User Story 7 (Compliance Reporting)
**Sprint 9** (Weeks 21-22): Phase 10 (Polish & Cross-Cutting)

### Risk Mitigation

1. **Stripe Integration Risk**: Implement billing last in MVP to avoid blocking other features
2. **Authentication Complexity**: Start with basic email/password, add OIDC in polish phase
3. **Kubernetes Complexity**: Separate phase, can be delivered after MVP
4. **Performance Risk**: Implement performance testing in Phase 10, optimize based on results
5. **Data Migration Risk**: Create migration guide and test upgrade path from single-user

---

## Format Validation

✅ **ALL tasks follow the checklist format**:
- Every task starts with `- [ ]` (checkbox)
- Every task has a sequential ID (T001-T204)
- Parallelizable tasks marked with `[P]`
- User story tasks marked with `[US1]`, `[US2]`, etc.
- Every task description includes exact file path
- No tasks missing ID, checkbox, or story label

✅ **Task organization follows user story structure**:
- Phase 1: Setup (no story labels)
- Phase 2: Foundational (no story labels)
- Phases 3-9: Organized by user story (US1-US7)
- Phase 10: Polish (no story labels)

✅ **Independent test criteria defined for each user story**

✅ **Parallel execution opportunities identified** (max 29 parallel tasks)

✅ **MVP scope clearly defined** (US1 + US2 + US5 = 74 tasks)