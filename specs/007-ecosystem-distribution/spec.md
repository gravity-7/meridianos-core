# Feature Specification: Ecosystem, Distribution & Marketplace

**Feature Branch**: `[007-ecosystem-distribution]`

**Created**: 2026-08-03

**Status**: Draft

**Input**: User description: "Phase 7: Ecosystem, Distribution & Marketplace from MASTER-PLAN-CLOSE-GAPS.md"

## Clarifications

### Session 2026-08-03

- Q: What are the target scalability limits for the system to ensure proper architecture and testing? → A: Small: 100 concurrent users, 500 API keys, 1000 webhooks, 50 connected machines
- Q: What security validation should be performed on plugins before they're allowed to run? → A: Standard: Validate contract interface + basic static analysis for common vulnerabilities
- Q: What is the retention policy for metadata stored in the cloud control plane? → A: Medium: 90 days retention, then automatic deletion
- Q: What are the specific timing parameters for webhook retry exponential backoff? → A: Standard: 1s initial, 2x multiplier, 60s max delay
- Q: What is the allowable range and default value for the cloud metadata reporting interval? → A: Configurable: 60s default, range 30-300 seconds

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Packaged Binary Installation (Priority: P1)

A non-technical user downloads MeridianOS as a standalone executable for their operating system, runs a simple setup wizard, and has a fully functional system running as a background service with system tray access.

**Why this priority**: This is the primary distribution mechanism for non-technical users who cannot use npm or command-line tools. It enables broad adoption beyond developers.

**Independent Test**: Can be fully tested by downloading the binary, running the installer, and verifying the daemon starts, dashboard is accessible, and system tray icon appears.

**Acceptance Scenarios**:

1. **Given** a user downloads the Windows `.exe` installer, **When** they double-click the file, **Then** a console-based setup wizard launches asking 4 questions (API keys, budget, service installation)
2. **Given** the user completes the setup wizard, **When** they press Enter, **Then** the daemon is installed as a Windows service and starts automatically
3. **Given** the daemon is running, **When** the user opens their browser to `localhost:4317`, **Then** the dashboard loads and shows the configured providers and budget
4. **Given** the daemon is installed as a service, **When** the user reboots their computer, **Then** the daemon starts automatically without manual intervention
5. **Given** the daemon is running, **When** the user checks their system tray, **Then** a MeridianOS icon appears with status indicator (green/yellow/red)
6. **Given** the system tray icon is visible, **When** the user right-clicks it, **Then** a menu appears with options: Open Dashboard, Pause All Spend, Status, Quit

---

### User Story 2 - Electron Desktop Application (Priority: P1)

A user installs MeridianOS as a native desktop application with a graphical setup wizard, secure API key storage in the OS keychain, and automatic background updates.

**Why this priority**: Provides the most user-friendly experience for non-technical users with familiar installation patterns, secure credential storage, and seamless updates.

**Independent Test**: Can be fully tested by installing the Electron app, running through the GUI wizard, entering API keys, and verifying they're stored in the OS keychain.

**Acceptance Scenarios**:

1. **Given** a user downloads the Electron installer for their OS, **When** they run the installer, **Then** a native GUI setup wizard opens in a window
2. **Given** the GUI wizard is open, **When** the user enters their Anthropic API key, **Then** the key is encrypted and stored in the OS keychain (Windows Credential Manager / macOS Keychain / Linux libsecret)
3. **Given** the user completes the wizard, **When** they click "Finish", **Then** the daemon starts and the dashboard opens within the Electron app window
4. **Given** the Electron app is running, **When** the user closes the app window, **Then** the daemon stops gracefully
5. **Given** the Electron app is closed, **When** the user reopens the app, **Then** the daemon restarts and API keys are retrieved from the OS keychain
6. **Given** a new version of MeridianOS is released, **When** the user opens the Electron app, **Then** an update notification appears with "Update available. Restart now?" prompt
7. **Given** the user clicks "Restart now", **When** the app restarts, **Then** it runs the new version without requiring manual reinstallation

---

### User Story 3 - Public REST API Integration (Priority: P1)

A third-party developer integrates MeridianOS into their custom tooling using the documented public REST API, authenticating with API keys and receiving webhook notifications for system events.

**Why this priority**: Enables ecosystem growth by allowing external tools to integrate with MeridianOS for automation, custom dashboards, and workflow integration.

**Independent Test**: Can be fully tested by generating an API key, making authenticated requests to endpoints, registering a webhook, and receiving event notifications.

**Acceptance Scenarios**:

1. **Given** a user has a MeridianOS instance running, **When** they generate an API key with `tasks:read` and `costs:read` scopes, **Then** the system returns a key starting with `mk-`
2. **Given** a developer has an API key, **When** they access `/api/v1/docs`, **Then** Swagger UI loads showing all available endpoints with documentation
3. **Given** a developer has an API key with `tasks:read` scope, **When** they send `GET /api/v1/tasks` with `Authorization: Bearer mk-{key}`, **Then** the system returns a list of tasks
4. **Given** a developer has an API key with only `tasks:read` scope, **When** they send `POST /api/v1/tasks` to create a task, **Then** the system returns `403 Forbidden`
5. **Given** a developer has an API key, **When** they send more than 100 requests in one minute, **Then** the system returns `429 Too Many Requests` with a `Retry-After` header
6. **Given** a developer registers a webhook URL, **When** a task is created in MeridianOS, **Then** the webhook receives a JSON payload with event type `task.created` and task details
7. **Given** a webhook delivery fails, **When** the system retries, **Then** it retries up to 3 times with exponential backoff

---

### User Story 4 - Plugin Marketplace Installation (Priority: P2)

A user browses the plugin marketplace in the dashboard, installs a Jira integration plugin, configures it with their Jira credentials, and sees Jira issues automatically imported as MeridianOS tasks.

**Why this priority**: Extends MeridianOS functionality through community plugins, enabling integration with popular tools without core development work.

**Independent Test**: Can be fully tested by opening the marketplace, installing the Jira plugin, configuring it, and verifying issues are imported.

**Acceptance Scenarios**:

1. **Given** a user opens the dashboard, **When** they navigate to the "Marketplace" tab, **Then** they see a list of available plugins with name, description, author, rating, and install count
2. **Given** the marketplace is open, **When** the user clicks "Install" on the Jira plugin, **Then** the plugin is downloaded and installed
3. **Given** the Jira plugin is installed, **When** the user clicks "Configure", **Then** a configuration form appears for Jira URL, API token, and project key
4. **Given** the user enters valid Jira credentials, **When** they click "Test Connection", **Then** the system confirms successful connection to Jira
5. **Given** the Jira plugin is configured, **When** the user saves the configuration, **Then** Jira issues are imported as MeridianOS tasks with mapped fields (summary→title, description→body, status→task status)
6. **Given** the Jira plugin is active, **When** an issue is updated in Jira, **Then** the corresponding MeridianOS task is updated via webhook
7. **Given** the user wants to use a custom integration, **When** they install the "Generic Webhook" plugin, **Then** they can configure field mappings to transform any JSON payload into MeridianOS tasks

---

### User Story 5 - Community Plugin Development (Priority: P2)

A developer creates a custom intake source plugin using the scaffolding CLI, implements the IntakeSource contract, publishes it to the registry, and other users can install and use it.

**Why this priority**: Enables community-driven ecosystem growth, allowing users to extend MeridianOS for their specific needs without waiting for core development.

**Independent Test**: Can be fully tested by running the scaffolding CLI, implementing a simple plugin, publishing it, and installing it from another instance.

**Acceptance Scenarios**:

1. **Given** a developer wants to create a plugin, **When** they run `node cli.mjs plugin create`, **Then** the CLI prompts for plugin name, type, and author
2. **Given** the developer answers the prompts, **When** the CLI completes, **Then** a plugin directory is generated with `plugin.json`, `index.mjs`, `test.mjs`, and `README.md`
3. **Given** the plugin scaffold is created, **When** the developer implements the `IntakeSource` contract in `index.mjs`, **Then** the plugin can fetch, create, update, and handle webhooks for tasks
4. **Given** the plugin is implemented, **When** the developer runs the tests, **Then** all contract validation tests pass
5. **Given** the plugin is tested, **When** the developer publishes it to the registry, **Then** it appears in the community plugins tab with metadata (name, type, description, author, version)
6. **Given** the plugin is in the registry, **When** another user installs it, **Then** it works like any pre-built plugin
7. **Given** a developer needs guidance, **When** they read `docs/plugin-development.md`, **Then** they find comprehensive documentation for all plugin contracts

---

### User Story 6 - Hybrid Cloud Control Plane (Priority: P2)

An enterprise operator connects multiple MeridianOS instances to a cloud control plane, views aggregate analytics across all machines, and pushes configuration changes from the cloud to all connected instances.

**Why this priority**: Enables enterprise-grade management with centralized visibility and control while maintaining local-only API key storage for security.

**Independent Test**: Can be fully tested by starting the local agent, connecting to the cloud, making API calls locally, and verifying the cloud dashboard shows updated metadata.

**Acceptance Scenarios**:

1. **Given** a user starts the local cloud agent, **When** it connects to the cloud control plane, **Then** the local dashboard shows "Connected to cloud control plane"
2. **Given** the local agent is connected, **When** the user makes an API call through the local gateway, **Then** within 60 seconds the cloud dashboard shows updated token counts and costs
3. **Given** multiple machines are connected to the cloud, **When** the operator opens the cloud dashboard, **Then** they see all connected machines with status, aggregate spend, and per-machine breakdown
4. **Given** the operator wants to change a policy, **When** they update the policy in the cloud dashboard, **Then** the change is pushed to all connected local agents
5. **Given** a policy change is pushed, **When** the local agent receives it, **Then** the policy is applied on the next scheduler tick
6. **Given** the cloud control plane is running, **When** an auditor reviews the cloud database, **Then** they find only anonymized metadata (token counts, costs, provider names) and NO API keys or prompt/response content
7. **Given** the cloud control plane is active, **When** a provider goes down, **Then** the cloud dashboard shows provider health status across all connected machines

---

### Edge Cases

- What happens when the packaged binary installation fails due to insufficient permissions?
- How does the system handle OS keychain access failures in the Electron app?
- What happens when an API key expires or is revoked while in use?
- How does the system handle webhook delivery timeouts or unreachable endpoints after all retry attempts are exhausted?
- What happens when a plugin fails to load or crashes during operation?
- How does the cloud control plane handle network partitions or offline local agents?
- What happens when the auto-update download is interrupted or corrupted?
- How does the system handle concurrent plugin installations or updates?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST produce standalone native binaries for Windows (.exe), macOS (.dmg), and Linux using `bun compile` with embedded Node.js runtime
- **FR-002**: System MUST install the daemon as an OS background service (Windows service, macOS launchd, Linux systemd) that auto-starts on boot
- **FR-003**: System MUST provide a console-based setup wizard that asks 4 questions: Anthropic API key, DeepSeek API key, monthly budget limit, and whether to install as background service
- **FR-004**: System MUST display a system tray icon with status indicators (green=healthy, yellow=degraded, red=gateway down) and a right-click menu with quick actions
- **FR-005**: System MUST provide an Electron desktop application with a GUI setup wizard that stores API keys in the OS keychain (Windows Credential Manager, macOS Keychain, Linux libsecret)
- **FR-006**: System MUST support automatic background updates in the Electron app via electron-updater with user prompt before restart
- **FR-007**: System MUST provide a public REST API at `/api/v1/` with endpoints for tasks, costs, providers, models, configuration, and webhooks
- **FR-008**: System MUST authenticate API requests using `Authorization: Bearer mk-{apiKey}` headers with scoped permissions (tasks:read, tasks:write, costs:read, providers:read, providers:write, config:read, config:write)
- **FR-009**: System MUST enforce rate limiting of 100 requests per minute per API key, returning `429 Too Many Requests` with `Retry-After` header when exceeded
- **FR-010**: System MUST provide an OpenAPI 3.0 specification served at `/api/v1/openapi.yaml` and viewable in Swagger UI at `/api/v1/docs`
- **FR-011**: System MUST deliver webhook notifications for events: task.created, task.completed, task.failed, budget.warning (80%), budget.critical (100%), provider.error, model.deprecated, cost.spike
- **FR-012**: System MUST retry failed webhook deliveries up to 3 times with exponential backoff (1s initial delay, 2x multiplier, 60s maximum delay)
- **FR-013**: System MUST provide a plugin marketplace with pre-built connectors for Jira, Linear, Notion, GitHub Issues, Microsoft Teams, and a generic webhook receiver
- **FR-014**: System MUST implement a standardized IntakeSource contract with methods: fetchTasks(), createTask(task), updateTask(externalId, updates), handleWebhook(payload)
- **FR-015**: System MUST auto-discover plugins from `node_modules/@meridian-plugins/intake-*/` and `.ai/plugins/` directories
- **FR-016**: System MUST provide a plugin scaffolding CLI (`node cli.mjs plugin create`) that generates plugin boilerplate with plugin.json, index.mjs, test.mjs, and README.md
- **FR-017**: System MUST provide a plugin registry where developers can publish plugins and users can rate and review them
- **FR-018**: System MUST provide comprehensive developer documentation for IntakeSource and WireAdapter plugin contracts
- **FR-019**: System MUST validate plugin contract interface compliance and perform basic static analysis for common security vulnerabilities before allowing plugins to run
- **FR-020**: System MUST implement a hybrid cloud control plane where local agents report anonymized metadata (token counts, costs, provider health) to a cloud dashboard at configurable intervals (60s default, range 30-300 seconds)
- **FR-021**: System MUST ensure API keys and prompt/response content NEVER leave the user's machine; only anonymized metadata is sent to the cloud
- **FR-022**: System MUST support multi-tenant cloud dashboard with user accounts, organization management, and SSO (OIDC)
- **FR-023**: System MUST allow operators to push configuration changes from the cloud dashboard to all connected local agents
- **FR-024**: System MUST automatically delete anonymized metadata from the cloud control plane after 90 days

### Key Entities *(include if feature involves data)*

- **Packaged Binary**: Standalone executable for Windows/macOS/Linux containing embedded Node.js runtime, MeridianOS daemon, and setup wizard
- **Electron App**: Native desktop application with main process, preload script, and renderer process that bundles the daemon and dashboard
- **API Key**: Authentication token with format `mk-{random}` and scoped permissions for REST API access
- **Webhook**: HTTP endpoint URL registered to receive JSON event notifications from MeridianOS
- **Plugin**: Extensible module implementing IntakeSource or WireAdapter contract with metadata (name, type, description, author, version, rating)
- **Plugin Registry**: Central repository of published plugins with metadata and installation statistics
- **Local Cloud Agent**: Background process that collects and reports anonymized metadata to the cloud control plane
- **Cloud Control Plane**: Multi-tenant cloud service providing centralized dashboard, analytics, and configuration management for connected MeridianOS instances

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Non-technical users can install MeridianOS from a packaged binary and have a working system in under 5 minutes
- **SC-002**: Packaged binaries are available for Windows, macOS, and Linux with successful installation on all three platforms
- **SC-003**: Electron app successfully stores API keys in OS keychain and retrieves them on subsequent launches
- **SC-004**: Public REST API serves OpenAPI specification and all endpoints respond correctly within 200ms
- **SC-005**: API rate limiting correctly blocks requests exceeding 100/minute and returns appropriate 429 response
- **SC-006**: Webhook notifications are delivered within 5 seconds of event occurrence with 95% success rate
- **SC-007**: Plugin marketplace displays at least 6 pre-built plugins with accurate metadata
- **SC-008**: Users can install and configure a plugin from the marketplace in under 3 minutes
- **SC-009**: Developers can scaffold a new plugin using the CLI and have a working plugin in under 30 minutes
- **SC-010**: Cloud control plane receives metadata from local agents within 60 seconds of local API calls
- **SC-011**: Cloud dashboard accurately displays aggregate analytics across all connected machines
- **SC-012**: Configuration changes pushed from cloud are applied to local agents within 120 seconds
- **SC-013**: Security audit confirms no API keys or prompt/response content are stored in or transmitted to the cloud control plane
- **SC-014**: System supports up to 100 concurrent users, 500 API keys, 1000 webhooks, and 50 connected machines to the cloud control plane
- **SC-015**: Plugin security validation rejects plugins with contract violations or common security vulnerabilities before installation
- **SC-016**: Cloud control plane automatically deletes anonymized metadata after 90 days of retention
- **SC-017**: Local cloud agents report metadata at configurable intervals (60s default, range 30-300 seconds)

## Assumptions

- Users have administrator privileges on their machines for service installation (or can provide credentials when prompted)
- OS keychain APIs are available and accessible on the target platforms (Windows Credential Manager, macOS Keychain, Linux libsecret)
- Code signing certificates will be acquired before public release to avoid SmartScreen/Gatekeeper blocking
- Cloud control plane infrastructure will be deployed using serverless architecture (Cloudflare Workers + D1 or similar) to minimize operational burden
- Plugin registry will initially be a simple JSON file served from a static host or GitHub repository, evolving to a full database as needed
- Agent harnesses (Claude Code, OpenCode, Antigravity) cannot be bundled due to third-party licenses; first-run wizard will link to their installation pages
- Local agents will use a separate per-machine API key for cloud authentication, distinct from provider API keys
- Webhook endpoints will be publicly accessible HTTPS URLs (MeridianOS does not support internal network webhooks)
- Plugin developers will have basic JavaScript/Node.js knowledge and understand ES module syntax
- Cloud control plane will initially support email/password authentication, with SSO (OIDC) added as a follow-up feature

## Out of Scope *(optional)*

- Mobile applications (iOS/Android)
- Plugin marketplace payment system or monetization
- Cloud control plane hosting and infrastructure setup (this is deployment, not feature development)
- Code signing certificate acquisition and management
- Plugin security review and approval process (initially trust-based with contract validation + basic static analysis for common vulnerabilities)
- Real-time bidirectional communication between cloud and local agents (beyond 60-second polling)
- Advanced cloud features like anomaly detection, predictive analytics, or ML-based recommendations
- Plugin sandboxing or isolation beyond basic contract validation
- Multi-language plugin support (plugins must be JavaScript/Node.js modules)