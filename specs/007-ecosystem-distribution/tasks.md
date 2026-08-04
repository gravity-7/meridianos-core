# Tasks: Ecosystem, Distribution & Marketplace

**Input**: Design documents from `/specs/007-ecosystem-distribution/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are included for critical components (REST API, plugin system, cloud agent) as specified in quickstart.md validation scenarios.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root
- **Web app**: `backend/src/`, `frontend/src/`
- **Mobile**: `api/src/`, `ios/src/` or `android/src/`
- Paths shown below assume single project - adjust based on plan.md structure

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Create Phase 7 directory structure per implementation plan (scripts/, desktop/, api/v1/, intake-adapters/, cloud/, dashboard/static/)
- [X] T002 Install build dependencies (bun, electron, electron-builder, electron-updater, keytar, systray) as devDependencies in package.json
- [X] T003 [P] Create GitHub Actions workflow for cross-platform binary builds (ubuntu-latest, windows-latest, macos-latest)
- [X] T004 [P] Create desktop/package.json with Electron app configuration and build settings

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T005 Create SQLite schema for API keys, webhooks, plugins in schema.sql (api_keys, webhooks, webhook_delivery_logs, plugins, plugin_configurations tables)
- [X] T006 [P] Implement API key generation and validation in auth/api-tokens.mjs (format mk-{random}, scope checking)
- [X] T007 [P] Implement in-memory rate limiter with sliding window in api/rate-limiter.mjs (100 req/min, retry-after header)
- [X] T008 [P] Implement webhook delivery queue with exponential backoff in api/webhooks.mjs (1s initial, 2x multiplier, 60s max, 3 retries)
- [X] T009 [P] Implement plugin contract validation in plugin-loader.mjs (duck typing for IntakeSource interface)
- [X] T010 [P] Implement basic static analysis for plugin security in plugin-loader.mjs (scan for eval, dangerous imports, file access)
- [X] T011 Create plugin metadata schema and registry structure in plugin-registry.mjs (JSON-based registry with ratings, install counts)
- [X] T012 Configure error handling and logging for Phase 7 components using daemon-logger.mjs

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Packaged Binary Installation (Priority: P1) 🎯 MVP

**Goal**: Non-technical users can install MeridianOS from a packaged binary with a console setup wizard, background service, and system tray icon.

**Independent Test**: Download binary, run installer, verify daemon starts as service, dashboard accessible at localhost:4317, system tray icon appears with menu.

### Tests for User Story 1

- [X] T013 [P] [US1] Integration test for binary installation in tests/integration/binary-install.test.mjs
- [X] T014 [P] [US1] Integration test for OS service registration in tests/integration/binary-install.test.mjs
- [X] T015 [P] [US1] Integration test for system tray icon and menu in tests/integration/binary-install.test.mjs

### Implementation for User Story 1

- [X] T016 [P] [US1] Implement bun compile build pipeline in scripts/build.mjs (Windows .exe, macOS .dmg, Linux binary with embedded Node.js)
- [X] T017 [P] [US1] Implement console-based setup wizard in scripts/setup-wizard-minimal.mjs (4 questions: API keys, budget, service installation)
- [X] T018 [US1] Implement Windows service registration in scripts/install-service.mjs (sc.exe create, start= auto)
- [X] T019 [US1] Implement macOS launchd service registration in scripts/install-service.mjs (~/Library/LaunchAgents/com.meridianos.daemon.plist)
- [X] T020 [US1] Implement Linux systemd service registration in scripts/install-service.mjs (~/.config/systemd/user/meridianos.service)
- [X] T021 [US1] Implement system tray icon with status indicators in daemon-entry.mjs using systray package (green/yellow/red, right-click menu)
- [X] T022 [US1] Add system tray menu actions (Open Dashboard, Pause All Spend, Status, Quit) in daemon-entry.mjs
- [X] T023 [US1] Implement daemon auto-start on boot verification in scripts/install-service.mjs
- [X] T024 [US1] Add logging for binary installation and service management in daemon-logger.mjs

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Electron Desktop Application (Priority: P1) 🎯 MVP

**Goal**: Users can install MeridianOS as a native desktop app with GUI setup wizard, OS keychain storage, and automatic background updates.

**Independent Test**: Install Electron app, run GUI wizard, enter API keys, verify keys stored in OS keychain, test auto-update notification.

### Tests for User Story 2

- [X] T025 [P] [US2] Integration test for Electron app installation in tests/integration/electron-app.test.mjs
- [X] T026 [P] [US2] Integration test for OS keychain storage in tests/integration/electron-app.test.mjs
- [X] T027 [P] [US2] Integration test for auto-update mechanism in tests/integration/electron-app.test.mjs

### Implementation for User Story 2

- [X] T028 [P] [US2] Implement Electron main process in desktop/main.js (daemon spawn, system tray, auto-updater)
- [X] T029 [P] [US2] Implement preload script with contextBridge in desktop/preload.js (secure IPC bridge)
- [X] T030 [US2] Implement GUI setup wizard in desktop/renderer/ (4-step wizard with API key inputs)
- [X] T031 [US2] Implement OS keychain integration in desktop/main.js using keytar (Windows Credential Manager, macOS Keychain, Linux libsecret)
- [X] T032 [US2] Implement daemon lifecycle management in desktop/main.js (start on app open, stop on app close, restart on reopen)
- [X] T033 [US2] Implement electron-updater configuration in desktop/main.js (GitHub Releases feed, update notification, restart prompt)
- [X] T034 [US2] Configure electron-builder for cross-platform installers in desktop/package.json (NSIS .exe, .dmg, .AppImage)
- [X] T035 [US2] Load existing dashboard in Electron BrowserWindow in desktop/main.js
- [X] T036 [US2] Add error handling for OS keychain access failures in desktop/main.js
- [X] T037 [US2] Add logging for Electron app operations in daemon-logger.mjs

**Checkpoint**: At this point, User Story 2 should be fully functional and testable independently

---

## Phase 5: User Story 3 - Public REST API Integration (Priority: P1) 🎯 MVP

**Goal**: Third-party developers can integrate with MeridianOS via documented REST API with scoped authentication, rate limiting, and webhook notifications.

**Independent Test**: Generate API key, make authenticated requests, test scope enforcement, trigger rate limit, register webhook, receive event notification.

### Tests for User Story 3

- [X] T038 [P] [US3] Contract test for REST API endpoints in tests/api-v1.test.mjs
- [X] T039 [P] [US3] Integration test for API key authentication and scopes in tests/api-v1.test.mjs
- [X] T040 [P] [US3] Integration test for rate limiting in tests/api-v1.test.mjs
- [X] T041 [P] [US3] Integration test for webhook delivery in tests/integration/webhook-delivery.test.mjs

### Implementation for User Story 3

- [X] T042 [P] [US3] Implement tasks CRUD endpoints in api/v1/tasks.mjs (GET /tasks, POST /tasks, GET /tasks/:id, PATCH /tasks/:id, DELETE /tasks/:id)
- [X] T043 [P] [US3] Implement costs query endpoints in api/v1/costs.mjs (GET /costs, GET /costs/summary)
- [X] T044 [P] [US3] Implement providers management endpoints in api/v1/providers.mjs (GET /providers, POST /providers, GET /providers/:id, DELETE /providers/:id, POST /providers/:id/test)
- [X] T045 [P] [US3] Implement models endpoints in api/v1/models.mjs (GET /models, POST /models/refresh, PUT /models/:id/tier)
- [X] T046 [P] [US3] Implement configuration endpoints in api/v1/config.mjs (GET /config, PUT /config)
- [X] T047 [P] [US3] Implement webhook registration endpoints in api/v1/webhooks.mjs (GET /webhooks, POST /webhooks, DELETE /webhooks/:id)
- [X] T048 [US3] Implement OpenAPI 3.0 specification in api/v1/openapi.yaml (all endpoints, schemas, authentication)
- [X] T049 [US3] Serve Swagger UI at /api/v1/docs in dashboard/server.mjs
- [X] T050 [US3] Integrate rate limiter middleware in dashboard/server.mjs (check before each API request)
- [X] T051 [US3] Integrate API key authentication middleware in dashboard/server.mjs (extract Bearer token, validate scopes)
- [X] T052 [US3] Implement webhook event triggers in event-store.mjs (task.created, task.completed, task.failed, budget.warning, budget.critical, provider.error, model.deprecated, cost.spike)
- [X] T053 [US3] Implement webhook delivery with retry logic in api/webhooks.mjs (exponential backoff, 3 retries)
- [X] T054 [US3] Add webhook delivery logging in webhook_delivery_logs table
- [X] T055 [US3] Add error responses for 401, 403, 429, 404, 500 in dashboard/server.mjs
- [X] T056 [US3] Add logging for REST API operations in daemon-logger.mjs

**Checkpoint**: At this point, User Story 3 should be fully functional and testable independently

---

## Phase 6: User Story 4 - Plugin Marketplace Installation (Priority: P2)

**Goal**: Users can browse plugin marketplace, install pre-built connectors (Jira, Linear, Notion, GitHub Issues, Microsoft Teams, Generic Webhook), configure them, and import tasks.

**Independent Test**: Open marketplace, install Jira plugin, configure with credentials, test connection, verify issues imported as tasks.

### Tests for User Story 4

- [X] T057 [P] [US4] Integration test for plugin installation in tests/plugin-loader.test.mjs
- [X] T058 [P] [US4] Integration test for Jira plugin in tests/plugin-loader.test.mjs

### Implementation for User Story 4

- [X] T059 [P] [US4] Implement plugin marketplace UI in dashboard/static/marketplace-panel.mjs (list plugins with metadata, install button)
- [X] T060 [P] [US4] Implement plugin configuration UI in dashboard/static/marketplace-panel.mjs (form per plugin, test connection button)
- [X] T061 [P] [US4] Implement Jira intake adapter in intake-adapters/jira-source.mjs (fetchTasks, createTask, updateTask, handleWebhook)
- [X] T062 [P] [US4] Implement Linear intake adapter in intake-adapters/linear-source.mjs (fetchTasks, createTask, updateTask, handleWebhook)
- [X] T063 [P] [US4] Implement Notion intake adapter in intake-adapters/notion-source.mjs (fetchTasks, createTask, updateTask, handleWebhook)
- [X] T064 [P] [US4] Implement GitHub Issues intake adapter in intake-adapters/github-issues-source.mjs (fetchTasks, createTask, updateTask, handleWebhook)
- [X] T065 [P] [US4] Implement Microsoft Teams intake adapter in intake-adapters/teams-source.mjs (fetchTasks, createTask, updateTask, handleWebhook)
- [X] T066 [P] [US4] Implement Generic Webhook intake adapter in intake-adapters/webhook-source.mjs (fetchTasks, createTask, updateTask, handleWebhook, configurable field mappings)
- [X] T067 [US4] Implement plugin auto-discovery in plugin-loader.mjs (scan node_modules/@meridian-plugins/intake-*/ and .ai/plugins/)
- [X] T068 [US4] Implement plugin installation in plugin-loader.mjs (npm install, validate contract, store configuration)
- [X] T069 [US4] Implement plugin configuration storage in plugin_configurations table
- [X] T070 [US4] Implement plugin status and health monitoring in plugin-loader.mjs
- [X] T071 [US4] Add logging for plugin operations in daemon-logger.mjs

**Checkpoint**: At this point, User Story 4 should be fully functional and testable independently

---

## Phase 7: User Story 5 - Community Plugin Development (Priority: P2)

**Goal**: Developers can create custom plugins using scaffolding CLI, implement IntakeSource contract, publish to registry, and other users can install them.

**Independent Test**: Run scaffolding CLI, implement simple plugin, run tests, publish to registry, install from another instance.

### Tests for User Story 5

- [X] T072 [P] [US5] Integration test for plugin scaffolding in tests/plugin-loader.test.mjs
- [X] T073 [P] [US5] Integration test for plugin contract validation in tests/plugin-loader.test.mjs

### Implementation for User Story 5

- [X] T074 [P] [US5] Implement plugin scaffolding CLI in plugin-scaffold.mjs (prompts for name, type, author, generates plugin.json, index.mjs, test.mjs, README.md)
- [X] T075 [P] [US5] Create plugin template files in templates/plugin/ (plugin.json template, index.mjs template with IntakeSource stub, test.mjs template, README.md template)
- [X] T076 [US5] Implement plugin registry in plugin-registry.mjs (JSON-based registry with metadata: name, type, description, author, version, rating, installs, repository)
- [X] T077 [US5] Implement community plugins UI in dashboard/static/community-plugins.mjs (list registry plugins, install button, ratings)
- [X] T078 [US5] Implement plugin publishing workflow in plugin-scaffold.mjs (npm publish to @meridian-plugins scope, update registry)
- [X] T079 [US5] Implement plugin rating and review system in plugin-registry.mjs (store ratings, calculate average)
- [X] T080 [US5] Create comprehensive plugin development documentation in docs/plugin-development.md (IntakeSource contract, WireAdapter contract, publishing guide, testing guide)
- [X] T081 [US5] Add logging for plugin scaffolding and publishing in daemon-logger.mjs

**Checkpoint**: At this point, User Story 5 should be fully functional and testable independently

---

## Phase 8: User Story 6 - Hybrid Cloud Control Plane (Priority: P2)

**Goal**: Enterprise operators can connect multiple MeridianOS instances to cloud control plane, view aggregate analytics, and push configuration changes.

**Independent Test**: Start local agent, connect to cloud, make API calls locally, verify cloud dashboard shows metadata within 60s, test policy push.

### Tests for User Story 6

- [X] T082 [P] [US6] Integration test for local cloud agent in tests/cloud-agent.test.mjs
- [X] T083 [P] [US6] Integration test for cloud metadata reporting in tests/cloud-agent.test.mjs

### Implementation for User Story 6

- [X] T084 [P] [US6] Implement local cloud agent in cloud/local-agent.mjs (collect anonymized metadata, report to cloud every 60s, receive policy updates)
- [X] T085 [P] [US6] Implement cloud control plane in cloud/cloud-control-plane.mjs (multi-tenant dashboard, analytics, configuration push)
- [X] T086 [P] [US6] Create D1 database schema for cloud in cloud/cloud-control-plane.mjs (machines, organizations, users, metadata tables with indexes)
- [X] T087 [P] [US6] Implement cloud authentication in cloud/cloud-control-plane.mjs (per-machine API keys, email/password, SSO OIDC placeholder)
- [X] T088 [P] [US6] Implement cloud dashboard UI in cloud/dashboard/ (machine list, aggregate analytics, policy management)
- [X] T089 [US6] Implement 90-day data retention in cloud/cloud-control-plane.mjs (D1 cron trigger, DELETE query with timestamp filter)
- [X] T090 [US6] Implement metadata collection in cloud/local-agent.mjs (token counts, costs, provider health, model usage, agent activity - NO API keys or content)
- [X] T091 [US6] Implement configurable reporting interval in cloud/local-agent.mjs (60s default, range 30-300s, validate bounds)
- [X] T092 [US6] Implement policy push mechanism in cloud/cloud-control-plane.mjs (operator updates policy, push to connected agents)
- [X] T093 [US6] Implement policy application in cloud/local-agent.mjs (receive policy, apply on next scheduler tick)
- [X] T094 [US6] Add connection status indicator in local dashboard (show "Connected to cloud control plane")
- [X] T095 [US6] Implement provider health monitoring in cloud/cloud-control-plane.mjs (aggregate health across all machines)
- [X] T096 [US6] Add security audit logging for cloud data access in cloud/cloud-control-plane.mjs
- [X] T097 [US6] Add logging for cloud operations in daemon-logger.mjs

**Checkpoint**: At this point, User Story 6 should be fully functional and testable independently

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Final polish, documentation, and cross-cutting improvements

- [X] T098 [P] Update AGENTS.md with Phase 7 context and new file paths
- [X] T099 [P] Update .github/copilot-instructions.md with Phase 7 artifacts reference
- [X] T100 [P] Create comprehensive README for Phase 7 in docs/phase-7-ecosystem-distribution.md (overview, installation, usage, troubleshooting)
- [X] T101 [P] Add code signing certificate configuration to electron-builder (placeholder for production)
- [X] T102 [P] Optimize binary size and startup time in scripts/build.mjs
- [X] T103 [P] Add comprehensive error messages for all failure scenarios in dashboard/server.mjs
- [X] T104 [P] Add telemetry for Phase 7 features in telemetry.mjs (binary installs, plugin installs, cloud connections)
- [X] T105 [P] Update CHANGELOG.md with Phase 7 features and breaking changes
- [X] T106 Run full test suite and ensure all tests pass (npm test)
- [X] T107 Validate all quickstart scenarios pass end-to-end
- [X] T108 Create GitHub release with binaries for all platforms (Windows .exe, macOS .dmg, Linux binary)

**Checkpoint**: Phase 7 complete and ready for production deployment

---

## Dependencies

### User Story Completion Order

```
Phase 1 (Setup) → Phase 2 (Foundational) → Phase 3 (US1) → Phase 4 (US2) → Phase 5 (US3) → Phase 6 (US4) → Phase 7 (US5) → Phase 8 (US6) → Phase 9 (Polish)
```

### Critical Path

**MVP (P1 Stories Only)**: Phase 1 → Phase 2 → Phase 3 (US1) → Phase 4 (US2) → Phase 5 (US3) → Phase 9

**Full Feature**: MVP + Phase 6 (US4) + Phase 7 (US5) + Phase 8 (US6) + Phase 9

### Parallel Execution Opportunities

**Within Phases**:
- Phase 1: T003, T004 can run in parallel
- Phase 2: T006-T011 can run in parallel
- Phase 3: T013-T015 can run in parallel; T016-T017 can run in parallel
- Phase 4: T025-T027 can run in parallel; T028-T029 can run in parallel
- Phase 5: T038-T041 can run in parallel; T042-T047 can run in parallel
- Phase 6: T057-T058 can run in parallel; T061-T066 can run in parallel
- Phase 7: T072-T073 can run in parallel; T074-T075 can run in parallel
- Phase 8: T082-T083 can run in parallel; T084-T087 can run in parallel
- Phase 9: T098-T105 can run in parallel

**Across Phases** (after Phase 2 completes):
- Phase 3 (US1), Phase 4 (US2), Phase 5 (US3) can run in parallel
- Phase 6 (US4), Phase 7 (US5), Phase 8 (US6) can run in parallel

---

## Implementation Strategy

### MVP First (P1 Stories Only)

**Scope**: User Stories 1, 2, 3 (Packaged Binary, Electron App, REST API)

**Timeline**: ~12 working days (based on plan.md estimates)

**Value Delivered**:
- Non-technical users can install MeridianOS
- Secure credential storage in OS keychain
- Third-party integrations via REST API
- Foundation for P2 features

**Next Steps After MVP**:
- Implement P2 features (Plugin Marketplace, Community Plugins, Cloud Control Plane)
- Gather user feedback on MVP
- Iterate based on feedback

### Incremental Delivery

**Each User Story** is independently testable and deliverable:
- US1: Packaged binary installation
- US2: Electron desktop app
- US3: REST API integration
- US4: Plugin marketplace
- US5: Community plugin development
- US6: Hybrid cloud control plane

**Parallel Development**:
- After Phase 2 (Foundational), P1 stories (US1, US2, US3) can be developed in parallel
- After P1 complete, P2 stories (US4, US5, US6) can be developed in parallel

---

## Task Summary

**Total Tasks**: 108

**Tasks by Phase**:
- Phase 1 (Setup): 4 tasks
- Phase 2 (Foundational): 8 tasks
- Phase 3 (US1 - Packaged Binary): 12 tasks
- Phase 4 (US2 - Electron App): 13 tasks
- Phase 5 (US3 - REST API): 19 tasks
- Phase 6 (US4 - Plugin Marketplace): 15 tasks
- Phase 7 (US5 - Community Plugins): 8 tasks
- Phase 8 (US6 - Cloud Control Plane): 16 tasks
- Phase 9 (Polish): 11 tasks

**Tasks by User Story**:
- US1 (Packaged Binary): 12 tasks (3 tests + 9 implementation)
- US2 (Electron App): 13 tasks (3 tests + 10 implementation)
- US3 (REST API): 19 tasks (4 tests + 15 implementation)
- US4 (Plugin Marketplace): 15 tasks (2 tests + 13 implementation)
- US5 (Community Plugins): 8 tasks (2 tests + 6 implementation)
- US6 (Cloud Control Plane): 16 tasks (2 tests + 14 implementation)

**Parallel Opportunities**: 35 tasks marked with [P] can run in parallel

**MVP Scope**: 48 tasks (Phases 1-5, excluding US4-US6)

**Format Validation**: ✅ All tasks follow the checklist format (checkbox, ID, labels, file paths)
