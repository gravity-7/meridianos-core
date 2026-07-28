# Feature Specification: Foundation Hardening

**Feature Branch**: `001-foundation-hardening`

**Created**: 2026-07-27

**Status**: Draft

**Input**: User description: "Implement Phase 0: Foundation Hardening from docs/MASTER-PLAN-CLOSE-GAPS.md — harden gateway as default metering path, OpenAI wire injection, unified config, traffic source classification, provider health monitoring, cross-platform scripts, and diagram fixes. Target: 14 stories."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - OpenAI Wire Injection for Agent Traffic Metering (Priority: P1)

As a developer running OpenCode agents, I need all OpenAI-compatible agent traffic to automatically route through the MeridianOS gateway so that every API call is metered, attributed, and budgeted without me configuring anything special for OpenAI-based agents.

**Why this priority**: Without OpenAI wire injection, OpenCode agents bypass the gateway entirely, creating an unmetered blind spot that undermines the entire cost-control premise of MeridianOS. This is the foundational enabler for universal metering coverage.

**Independent Test**: Spawn an OpenCode agent with the gateway running → query the gateway ledger and verify the agent's API calls appear with correct provider, model, and token counts.

**Acceptance Scenarios**:

1. **Given** the gateway is running and an OpenCode agent is configured to use OpenAI-compatible wire protocol, **When** the agent is spawned via the launcher, **Then** the agent's spawn plan is automatically rewritten to route all API calls through `http://127.0.0.1:8787` with the gateway's injected API key.
2. **Given** an OpenCode agent has completed a task through the gateway, **When** the operator queries the gateway ledger, **Then** token events exist with `source='agent'`, the correct provider name, model name, and accurate token counts.
3. **Given** an existing Anthropic-wire agent (e.g., Claude Code) is running through the gateway, **When** the OpenAI injection code is deployed, **Then** the Anthropic-wire injection output is byte-identical to the pre-deployment output — zero regression.

---

### User Story 2 - Gateway as Default Metering Path (Priority: P1)

As a MeridianOS operator, I need the gateway to start automatically with the daemon so that every agent run is metered by default without me remembering to enable a flag or manually start the gateway service.

**Why this priority**: The constitution mandates gateway as single source of truth for all AI traffic. Making it opt-in means most users will never enable it, defeating the core architectural guarantee.

**Independent Test**: Create a fresh AIOS instance and start it → verify `config.gateway.gatewayActive === true` without any manual gateway configuration.

**Acceptance Scenarios**:

1. **Given** a fresh MeridianOS installation with default configuration, **When** the daemon starts, **Then** the gateway process is automatically launched and begins listening on its configured port.
2. **Given** an operator explicitly sets `gateway.disabled: true` in policy.yaml, **When** the daemon starts, **Then** the gateway does not start and the system falls back to usage-reader-based metering.
3. **Given** the gateway is running as the default metering path, **When** the budget module queries current usage, **Then** it reads from the gateway ledger as the primary authoritative source, falling back to usage-reader transcript scraping only if the ledger is unavailable.

---

### User Story 3 - Unified Configuration Surface (Priority: P1)

As a MeridianOS operator, I need all system configuration in a single `policy.yaml` file so I don't have to hunt across multiple files (`tenant.yaml`, `policy.yaml`) to understand and modify how the system behaves.

**Why this priority**: The current split between `policy.yaml` and `tenant.yaml` causes confusion about where settings belong. A unified surface is a prerequisite for the browser-based setup wizard (P3) and reduces operator errors.

**Independent Test**: Boot MeridianOS with only a `policy.yaml` file (no `tenant.yaml`) → verify the agent roster loads correctly and the board is created.

**Acceptance Scenarios**:

1. **Given** an operator defines agent configurations under `agents:` in `policy.yaml`, **When** the system boots without any `tenant.yaml` file, **Then** the agent roster is populated from the policy file and the board is created.
2. **Given** an existing installation still has a `tenant.yaml` file, **When** the system boots, **Then** it emits a clear deprecation warning but continues to work, reading from `tenant.yaml` as a fallback.
3. **Given** an invalid configuration value in the unified `policy.yaml`, **When** the system boots, **Then** it produces a specific error message identifying the file, line number, field path, and the valid expected values.

---

### User Story 4 - Traffic Source Classification (Priority: P2)

As a MeridianOS operator, I need to see which traffic source (agent, IDE, CLI, or API) generated each cost so I can attribute spending accurately across different usage patterns and identify unexpected cost drivers.

**Why this priority**: Without source classification, operators cannot answer "where is my AI spend going?" — a fundamental observability requirement. However, the system functions without it; it enhances visibility rather than enabling core metering.

**Independent Test**: Run agents through different sources, query `token_events`, and verify each row has a `source` column with the correct classification.

**Acceptance Scenarios**:

1. **Given** the gateway ledger schema has been updated, **When** any API call is recorded, **Then** a `source` column is populated classifying the traffic as `agent`, `ide`, `cli`, or `api`.
2. **Given** an existing ledger with historical data, **When** the schema migration runs, **Then** all existing rows default to `source='agent'` without data loss.
3. **Given** the dashboard is running, **When** an operator views cost breakdown, **Then** costs are filterable and groupable by traffic source.

---

### User Story 5 - Provider Health Monitoring (Priority: P2)

As a MeridianOS operator, I need real-time visibility into which LLM providers are healthy and reachable so I can proactively detect downstream outages before dispatching agent tasks that will immediately fail.

**Why this priority**: Provider outages cause confusing agent failures. Proactive health monitoring prevents wasted task dispatches. It is independently valuable but not required for basic metering to work.

**Independent Test**: Open the dashboard → verify each configured provider shows a health status indicator (green/amber/red) with latency information. Kill network connectivity to a provider → verify status turns red within 60 seconds.

**Acceptance Scenarios**:

1. **Given** multiple providers are configured, **When** the gateway starts, **Then** a background health check loop probes each provider endpoint every 60 seconds and records `{ ok, latencyMs, error? }`.
2. **Given** a provider is healthy, **When** the dashboard renders the provider list, **Then** that provider shows a green indicator with its current latency.
3. **Given** a provider becomes unreachable, **When** the next health check runs (within 60 seconds), **Then** the provider status transitions to red and the dashboard reflects the degraded state.
4. **Given** the model router is about to dispatch a task, **When** it checks available models, **Then** it excludes models from providers currently in `down` health state.

---

### User Story 6 - Cross-Platform Operational Scripts (Priority: P2)

As a MeridianOS operator on macOS or Linux, I need the publish and conductor registration scripts to work natively on my platform without requiring PowerShell or Windows-specific dependencies.

**Why this priority**: The current PowerShell-only scripts lock out non-Windows users from essential operational tasks. Cross-platform support is required for the distribution strategy (P7) but the core system functions without it.

**Independent Test**: Run `node scripts/publish.mjs` and `node scripts/register-conductor.mjs` on Windows, macOS, and Linux → verify successful execution on all three platforms.

**Acceptance Scenarios**:

1. **Given** the operator is on any of Windows, macOS, or Linux, **When** they run `node scripts/publish.mjs`, **Then** the script authenticates using platform-agnostic `node:crypto` (not Windows DPAPI) and publishes the package.
2. **Given** the operator runs `node scripts/register-conductor.mjs`, **When** the script detects the operating system, **Then** it registers the conductor as a background service using the appropriate OS mechanism: Windows Task Scheduler, macOS launchd, or Linux systemd.
3. **Given** the dashboard restart endpoint is called, **When** the restart is triggered, **Then** it uses platform-agnostic `process.spawn` instead of PowerShell-specific commands.

---

### User Story 7 - Architecture Diagram Corrections (Priority: P3)

As a developer onboarding to MeridianOS, I need the architecture diagrams to accurately reflect the actual system so I can understand the data flow, components, and relationships without being misled by rendering artifacts or missing elements.

**Why this priority**: While important for developer experience and onboarding, diagram fixes don't affect system functionality. They improve documentation quality but are not blocking for any other work.

**Independent Test**: Open all five architecture diagram PNGs → visually inspect for rendering artifacts, verify all expected components are present, and confirm the diagrams match the actual codebase structure.

**Acceptance Scenarios**:

1. **Given** the high-level architecture diagram, **When** a developer views it, **Then** all text is legible with no floating or overlapping labels, and all major system components are represented.
2. **Given** the processing pipeline diagram, **When** a developer views it, **Then** the state machine flow is complete with all states including terminal states (Done, Complete) that were previously missing.
3. **Given** the data model diagram, **When** a developer views it, **Then** all entity boxes are correctly rendered with accurate attribute representations matching the actual SQL schema.

---

### User Story 8 - Zero-vs-Null Budget Sentinel Semantics (Priority: P2)

As a MeridianOS operator, I need the budget system to correctly interpret `0` as a hard block (deny all requests) and the absence of a cap as unlimited, so I can express precise budget policies without ambiguity.

**Why this priority**: The current sentinel value bug means operators who set `per_5h_tokens: 0` intending "no cap" get the opposite behavior. This is a correctness bug with security implications — fixing it prevents unexpected cost overruns.

**Independent Test**: Configure `per_5h_tokens: 0` → verify all requests are blocked with 403. Omit `per_5h_tokens` entirely → verify requests are allowed. Set `per_5h_tokens: 50000` → verify normal enforcement.

**Acceptance Scenarios**:

1. **Given** a budget window is configured with `per_5h_tokens: 0`, **When** an agent attempts an API call, **Then** the gateway returns a 403 denial with a clear message that the budget cap has been reached.
2. **Given** a budget window has no `per_5h_tokens` field (or it is `null`), **When** an agent attempts an API call, **Then** the request is allowed through without token-count restrictions.
3. **Given** a budget window is configured with `per_5h_tokens: 50000`, **When** accumulated usage reaches 50,000 tokens within the window, **Then** subsequent requests are denied until the window resets.

---

### User Story 9 - Per-Provider HTTP Header Configuration (Priority: P3)

As a developer integrating a new LLM provider with MeridianOS, I need provider-specific HTTP headers to be configured per-provider rather than hardcoded, so non-Anthropic providers don't receive inappropriate Anthropic-specific headers.

**Why this priority**: The hardcoded `anthropic-version` header sent to all providers is a correctness bug that could cause issues with strict API gateways. It's important for multi-provider support but doesn't block current Anthropic-only usage.

**Independent Test**: Route a request to DeepSeek through the gateway → verify the request does NOT include `anthropic-version` header. Route a request to Anthropic → verify it DOES include `anthropic-version`. Route to Google AI → verify it gets `x-goog-api-version`.

**Acceptance Scenarios**:

1. **Given** a provider is configured with `providerHeaders: { "anthropic-version": "2023-06-01" }`, **When** a request is forwarded to that provider, **Then** the `anthropic-version` header is included.
2. **Given** a provider has no `providerHeaders` configured, **When** a request is forwarded to that provider, **Then** no provider-specific headers are added beyond standard proxy headers.
3. **Given** a Google AI provider is configured with `providerHeaders: { "x-goog-api-version": "v1beta" }`, **When** a request is forwarded, **Then** the correct Google-specific header is included and no Anthropic headers are present.

---

### User Story 10 - Harness Adapter OAuth Security Audit (Priority: P2)

As a MeridianOS security auditor, I need confidence that no harness adapter silently falls back to direct API calls that bypass the gateway, creating an unmetered path that could lead to uncontrolled spending.

**Why this priority**: The silent Anthropic OAuth fallback discovered in the independent review is a security concern — it could allow unmetered traffic without the operator's knowledge. Fixing it protects the integrity of cost controls.

**Independent Test**: Run each harness adapter (Claude Code, OpenCode, Antigravity) through the gateway → compare gateway ledger totals against usage-reader totals → verify discrepancy is under 5%.

**Acceptance Scenarios**:

1. **Given** all harness adapters have been audited, **When** each adapter spawns an agent through the gateway, **Then** every adapter's `BASE_URL` override is correctly applied so all traffic routes through the gateway.
2. **Given** the gateway is running, **When** it periodically compares ledger usage totals against usage-reader totals, **Then** any discrepancy exceeding 10% triggers a warning log alerting the operator to potential unmetered traffic.
3. **Given** the Claude Code OAuth fallback behavior is a known limitation, **When** a developer consults the documentation, **Then** `docs/KNOWN-ISSUES.md` documents the fallback scenario and mitigation steps.

---

### User Story 11 - Self-Healing Bootstrap (Priority: P2)

As a first-time MeridianOS user, I need the system to auto-create required directories and provide clear guidance when I run it, instead of crashing with cryptic stack traces that require me to read source code to understand what went wrong.

**Why this priority**: First-run experience directly impacts adoption. Crashes on fresh install create a terrible first impression. However, existing users who already have `.ai/` directories set up are unaffected.

**Independent Test**: Clone the repository to a fresh directory with no `.ai/` subdirectories → run the daemon → verify `.ai/` and all required subdirectories are auto-created with no crash.

**Acceptance Scenarios**:

1. **Given** a fresh installation with no `.ai/` directory, **When** the daemon starts, **Then** all required directory structures (`.ai/gateway/`, `.ai/state/`, etc.) are automatically created using recursive mkdir.
2. **Given** a required environment variable is missing, **When** the daemon starts, **Then** it prints a human-readable error: `"[MERIDIANOS] ${checkName}: ${problem}. Fix: ${action}."` — with no raw stack trace.
3. **Given** the `--init` flag is passed to the daemon, **When** it runs, **Then** it scaffolds a complete default configuration including a policy.yaml with inline documentation comments.

---

### User Story 12 - Configuration JSON Schema Validation (Priority: P2)

As a MeridianOS operator, I need boot-time validation of my configuration files with specific field-level error messages, so I can fix misconfigurations immediately rather than debugging mysterious runtime failures.

**Why this priority**: Invalid configuration is the most common operator error. Catching it at boot with clear messages dramatically reduces support burden. However, the system already has basic validation in `policy-validate.mjs`.

**Independent Test**: Boot with various invalid policy configurations (invalid `wire` value, broken model reference, unknown fields) → verify each produces a specific error message identifying the file, field path, and valid options.

**Acceptance Scenarios**:

1. **Given** a policy.yaml with an invalid `wire` value (e.g., `wire: "nonexistent"`), **When** the daemon boots, **Then** the validation error lists the valid wire protocol values.
2. **Given** a policy.yaml where `model_routing` references a provider not defined in the providers section, **When** the daemon boots, **Then** the validation error names the referenced provider and the file/line where the reference appears.
3. **Given** a valid policy.yaml with all required fields, **When** the daemon boots, **Then** validation passes silently and the system starts normally.

---

### User Story 13 - Comprehensive Test Coverage for New Functionality (Priority: P1)

As a MeridianOS developer, I need all Phase 0 changes to have comprehensive test coverage so that future changes don't accidentally break the hardened foundation.

**Why this priority**: Tests are the safety net for all subsequent phases. Without them, P1–P7 changes risk regressing P0 fixes. The constitution mandates test-first discipline.

**Independent Test**: Run `npm test` → verify all existing 915+ tests pass plus all new Phase 0 tests pass with zero failures.

**Acceptance Scenarios**:

1. **Given** OpenAI wire injection has been implemented, **When** the test suite runs, **Then** `tests/gateway/inject-openai.test.mjs` and `tests/gateway/server-openai.test.mjs` pass, and existing inject tests produce byte-identical output.
2. **Given** unified config has been implemented, **When** the test suite runs, **Then** tests covering policy-only boot, tenant.yaml backward compatibility, and validation error messages all pass.
3. **Given** all Phase 0 features are complete, **When** the full test suite runs, **Then** at least 915 tests pass with zero failures and zero new `.only()` markers.

---

### User Story 14 - Gateway Dashboard Endpoint for Provider Status (Priority: P2)

As a dashboard user, I need an API endpoint that returns the current health status of all configured providers so the dashboard can display real-time provider availability.

**Why this priority**: This is the dashboard-facing side of provider health monitoring (Story 5). It's independently valuable but lower priority than the health check loop itself since the dashboard could display static provider info without it.

**Independent Test**: `GET /api/providers` → verify response includes each provider with `health: { status, latencyMs }` fields.

**Acceptance Scenarios**:

1. **Given** the gateway health loop is running, **When** the dashboard calls `GET /api/providers`, **Then** the response includes every configured provider with its current health status (`ok`, `degraded`, or `down`) and last-measured latency in milliseconds.
2. **Given** a provider has never been checked (just after boot), **When** the dashboard calls the endpoint, **Then** the provider shows status `unknown` until the first health check completes.

---

### Edge Cases

- What happens when the gateway starts but no providers are configured? The gateway should start and listen, logging a warning that no routes are active. Agent spawns will fail with a clear "no provider configured" error.
- What happens when the gateway ledger database is corrupted or unreadable? The budget module falls back to usage-reader transcript scraping and logs a warning about ledger unavailability.
- What happens when a provider health check times out (e.g., network partition)? The provider is marked `degraded` on first timeout and `down` after consecutive failures. The timeout is 5 seconds per check.
- What happens when the unified policy.yaml contains both old `tenant.yaml` fields and new policy fields? The policy loader merges them with policy values taking precedence over tenant-derived values.
- What happens when a harness adapter's BASE_URL override conflicts with an explicit user configuration? The explicit user configuration wins; a warning is logged about the override.
- What happens when an existing ledger has millions of rows and the `source` column migration runs? SQLite `ALTER TABLE ADD COLUMN` is O(1) — it only updates the schema, not existing rows. All existing rows default to `'agent'`.
- What happens on first boot when no `.ai/` directory exists but the filesystem is read-only? The system prints a clear error: `"[MERIDIANOS] bootstrap: Cannot create .ai/ directory. Fix: Ensure the current directory is writable or set MERIDIANOS_HOME to a writable path."`
- What happens when budget `per_5h_tokens: 0` is set but the operator actually intended "no cap"? The system blocks all requests. The migration guide and documentation clearly explain the `null` vs `0` distinction.

## Requirements *(mandatory)*

### Functional Requirements

**OpenAI Wire Injection**
- **FR-001**: The gateway injection layer MUST rewrite OpenCode agent spawn plans to route OpenAI-compatible API calls through the gateway's `baseURL` with the gateway's injected `apiKey`.
- **FR-002**: The gateway server MUST construct proper `Bearer` authorization headers when forwarding OpenAI-wire requests to upstream providers.
- **FR-003**: The harness adapter for OpenCode MUST include `wire: 'openai'` in spawn plan metadata so the injection layer can correctly identify the wire protocol.
- **FR-004**: OpenAI wire injection MUST NOT alter the behavior or output of existing Anthropic-wire injection — the injection output for Anthropic agents must be byte-identical before and after the change.

**Gateway as Default Metering Path**
- **FR-005**: The scheduler MUST automatically start the gateway when the daemon starts, without requiring a `gateway.enabled: true` configuration flag.
- **FR-006**: The system MUST support `gateway.disabled: true` as an explicit opt-out mechanism that prevents gateway startup.
- **FR-007**: The budget module MUST query the gateway ledger as the primary data source for current usage, falling back to usage-reader transcript scraping only when the ledger is unavailable.
- **FR-008**: The launcher MUST check for gateway availability (via `config.gateway.url`) rather than a boolean `enabled` flag when deciding whether to inject gateway routing into spawn plans.

**Unified Configuration**
- **FR-009**: The configuration loader MUST accept agent definitions under `agents:` in `policy.yaml` as the primary configuration location.
- **FR-010**: The system MUST continue to support `tenant.yaml` as a fallback, logging a deprecation warning when it is used.
- **FR-011**: Configuration validation MUST report errors with file path, line number, field path, and actionable remediation guidance.
- **FR-012**: The system MUST boot successfully with only a `policy.yaml` file present — `tenant.yaml` must not be required.

**Traffic Source Classification**
- **FR-013**: The `token_events` database table MUST include a `source` column that classifies each API call by its origin: `agent`, `ide`, `cli`, or `api`.
- **FR-014**: All existing rows in the `token_events` table MUST default to `source='agent'` after schema migration.
- **FR-015**: The ledger query API MUST support filtering and grouping token events by the `source` column.

**Provider Health Monitoring**
- **FR-016**: The system MUST run a periodic health check loop that probes every configured provider endpoint at 60-second intervals.
- **FR-017**: Each health check MUST use a lightweight request with a 5-second timeout and record `{ ok: boolean, latencyMs: number, error?: string }`.
- **FR-018**: Provider health state MUST transition through `ok` → `degraded` (first failure) → `down` (consecutive failures).
- **FR-019**: The dashboard MUST expose a `GET /api/providers` endpoint returning provider status including health information.
- **FR-020**: The model router MUST exclude models from providers in `down` health state when selecting candidates for task dispatch.

**Cross-Platform Scripts**
- **FR-021**: The publish script MUST use `node:crypto` for cryptographic operations instead of Windows-only DPAPI.
- **FR-022**: The conductor registration script MUST detect the host operating system and use the appropriate service manager: Windows Task Scheduler, macOS launchd, or Linux systemd.
- **FR-023**: The dashboard restart endpoint MUST use platform-agnostic process spawning instead of PowerShell-specific commands.

**Architecture Diagram Corrections**
- **FR-024**: All five architecture diagrams MUST be free of rendering artifacts including floating text, garbled labels, and overlapping elements.
- **FR-025**: The processing pipeline diagram MUST include all terminal states (Done, Complete) that were previously missing.
- **FR-026**: The data model diagram MUST accurately represent entity attributes as they exist in the actual SQL schema.
- **FR-027**: All five diagrams MUST be re-exported as PNG files with correct rendering.

**Budget Sentinel Values**
- **FR-028**: A budget cap of `0` MUST result in all requests being blocked (hard block semantics).
- **FR-029**: An absent or `null` budget cap MUST result in no token-count restriction (unlimited semantics).
- **FR-030**: A positive numeric budget cap MUST enforce the limit normally, denying requests when the window's accumulated usage exceeds the cap.

**Per-Provider Headers**
- **FR-031**: Provider-specific HTTP headers MUST be configured per-provider in the provider registry, not hardcoded in the gateway server.
- **FR-032**: The gateway MUST look up `route.providerHeaders` when forwarding requests and include only the headers configured for that specific provider.
- **FR-033**: Non-Anthropic providers MUST NOT receive the `anthropic-version` header unless explicitly configured for that provider.

**Harness Adapter Security**
- **FR-034**: Every harness adapter MUST be audited to verify that its `BASE_URL` override correctly routes traffic through the gateway.
- **FR-035**: The gateway MUST periodically compare ledger usage totals against usage-reader totals and log a warning when the discrepancy exceeds 10%.
- **FR-036**: Known limitations (such as Claude Code OAuth fallback) MUST be documented in `docs/KNOWN-ISSUES.md`.

**Self-Healing Bootstrap**
- **FR-037**: The boot guard MUST auto-create required directory structures using recursive `mkdir` instead of crashing when directories are missing.
- **FR-038**: All bootstrap error messages MUST follow the format `"[MERIDIANOS] ${checkName}: ${problem}. Fix: ${action}."` and MUST NOT emit raw stack traces.
- **FR-039**: The daemon MUST support a `--init` flag that scaffolds a complete default configuration including `policy.yaml`.
- **FR-040**: Missing environment variables MUST produce error messages that name the specific variable and describe how to set it.

**Configuration JSON Schema**
- **FR-041**: A JSON Schema (draft-07) MUST be created for `policy.yaml` covering all required fields, enum validation, and cross-reference validation.
- **FR-042**: The boot-time validation MUST check `policy.yaml` against the JSON Schema and report field-level errors with file path, line number, and valid options.
- **FR-043**: Unknown fields in configuration MUST produce warnings (not errors) to maintain forward compatibility.

**Testing**
- **FR-044**: Every new Phase 0 feature MUST have corresponding test coverage in dedicated test files.
- **FR-045**: All existing 915+ tests MUST continue to pass with zero regressions after Phase 0 changes.
- **FR-046**: New test files for OpenAI wire injection MUST verify both correct injection output and Anthropic regression (byte-identical output).

### Key Entities

- **Token Event**: A record of an API call made through the gateway, including provider, model, token counts, timestamp, and now traffic `source` classification (`agent`/`ide`/`cli`/`api`).
- **Provider Health Status**: The real-time availability state of a configured LLM provider, including whether it is reachable (`ok`/`degraded`/`down`/`unknown`), last-checked latency, and any error details.
- **Budget Window**: A time-bound token usage cap (e.g., per 5 hours) with clear sentinel semantics: `0` = hard block all requests, `null`/absent = unlimited, positive number = enforced cap.
- **Spawn Plan**: The configuration generated by the launcher that tells an agent harness how to connect to LLM providers — now automatically rewritten by the injection layer to route through the gateway.
- **Unified Policy**: The single `policy.yaml` configuration file that consolidates all system settings previously split across `policy.yaml` and `tenant.yaml`, including agent definitions, provider routes, model routing, and budget rules.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: OpenCode agents using OpenAI-compatible wire protocols have 100% of their API calls metered through the gateway, with zero unmetered traffic.
- **SC-002**: The gateway starts automatically on daemon boot with zero manual configuration steps required — operators get metering coverage by default.
- **SC-003**: Operators can configure the entire system from a single `policy.yaml` file; existing `tenant.yaml` users receive a clear deprecation path with no functionality loss.
- **SC-004**: All token events in the ledger include a correct `source` classification, enabling operators to attribute costs by traffic origin within the dashboard.
- **SC-005**: Provider outages are detected and surfaced in the dashboard within 60 seconds, preventing wasted agent task dispatches to unavailable providers.
- **SC-006**: The publish and conductor registration scripts execute successfully on Windows, macOS, and Linux without requiring platform-specific shell environments.
- **SC-007**: All five architecture diagrams render correctly with zero visual artifacts and accurately represent the current system architecture.
- **SC-008**: Budget cap semantics are unambiguous: `0` blocks all traffic, absent/null allows unlimited, and operators cannot accidentally set a "no cap" policy that actually blocks all requests.
- **SC-009**: Non-Anthropic providers never receive Anthropic-specific HTTP headers, eliminating a class of potential API compatibility issues.
- **SC-010**: The gateway detects unmetered traffic discrepancies exceeding 10% and alerts operators, closing the silent OAuth fallback blind spot.
- **SC-011**: A first-time user can clone the repository and start the daemon without encountering any cryptic stack traces — all error conditions produce actionable human-readable messages.
- **SC-012**: Invalid configuration is caught at boot time with field-level error messages identifying the exact file, line, and valid options — zero misconfigurations reach runtime.
- **SC-013**: The full test suite passes with at least 915 tests and zero failures after all Phase 0 changes are implemented.
- **SC-014**: Existing Anthropic-wire agent injection produces byte-identical output before and after OpenAI wire injection changes — zero regression in existing functionality.

## Assumptions

- **Gateway port**: The gateway listens on `http://127.0.0.1:8787` by default, consistent with the current implementation.
- **Dashboard port**: The dashboard runs on port 4317 as established in the project conventions.
- **Database migration**: SQLite's `ALTER TABLE ADD COLUMN` is O(1) and safe for production use with existing ledgers — no downtime required for the `source` column migration.
- **Health check method**: Provider health is checked via a lightweight GET request to a known endpoint rather than a full API call — this is sufficient to detect outages without consuming paid tokens.
- **Cross-platform service registration**: Windows Task Scheduler, macOS launchd, and Linux systemd are the standard service managers for their respective platforms and are available on typical installations.
- **Backward compatibility**: Existing `tenant.yaml` users will migrate to unified `policy.yaml` during the P0 phase. The deprecation warning period lasts through Phase 2, after which `tenant.yaml` support will be removed.
- **Diagram sources**: The diagram source files (Mermaid or Draw.io) in `docs/diagrams/` are editable and re-exportable. If source files are missing, diagrams will be recreated from codebase analysis.
- **Cassette test system**: The existing cassette-based test mocking system in `test/cassette.mjs` can be extended for OpenAI wire testing without architectural changes.
- **Node.js version**: Node.js 24+ is required as stated in AGENTS.md — all new code uses ES modules with `.mjs` extension and `node:` built-in imports.
- **Zero-dependency constraint**: New functionality uses Node.js built-ins exclusively. No new npm dependencies are added in Phase 0.
