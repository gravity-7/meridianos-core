
## PR #69: [002-Universal-Gateway]: WireAdapter plugin system, zero-config bootstrap, multi-key rotation, request logging, and cross-wire translation

### PR Description
## Summary

Implements Universal Gateway (002) — transforms the MeridianOS gateway from an agent-only sidecar into a universal forward proxy.

### Completed Features

#### Phase 1: Setup ✅
- Created `gateway/wire-adapters/` directory for pluggable wire protocol adapters
- Added `request_logs` table to ledger schema for append-only request logging
- Expanded `VALID_WIRES` to include `generic-http`

#### Phase 2: WireAdapter Registry & Built-in Adapters ✅
- **WireAdapter interface**: 2 required methods (`detectRequest`, `extractUsage`), 4 optional (`injectAuth`, `extractUsageFromSSE`, `formatDenial`, `normalizeModel`)
- **Auto-discovery**: `discoverAdapters()` scans `gateway/wire-adapters/` at boot, validates each module, provides no-op defaults for omitted optional methods
- **Extracted adapters**: Anthropic (`anthropic.mjs`) and OpenAI (`openai.mjs`) wire logic extracted from `server.mjs`
- **`GET /api/wire-adapters`** management endpoint
- All 23 new wire-adapter-registry tests pass, 

### Spec Context (specs/001-foundation-hardening)
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

... (truncated 163 lines)

### Constitution Principles (abbreviated)
# MeridianOS Constitution

> **Version**: 1.0.0 | **Ratified**: 2026-07-27
> **Spec-Kit Aligned**: All `/speckit-*` workflows validate against these principles.

## Core Principles

### I. Provider & Model Agnosticism (NON-NEGOTIABLE)
Every LLM provider and model must be addable without source code changes.
- Providers registered declaratively via configuration, not hardcoded switches
- Wire protocol translation isolated in the gateway layer
- Model discovery from provider APIs, not static lists
- Fallback chains defined in policy, not in code

### II. Gateway as Single Source of Truth (NON-NEGOTIABLE)
All AI traffic — agent-spawned, IDE-driven, CLI-ad-hoc — MUST route through the gateway.
- Gateway is default-ON (opt-out via `gateway.disabled: true`)
- Budget enforcement reads from gateway ledger, not transcript scraping
- Cost attribution includes traffic source classification
- No silent bypass paths (e.g., Anthropic OAuth fallback)

### III. Zero-Dependency Philosophy
Only `better-sqlite3` as external runtime dependency. All else is Node.js built-ins.
- Before adding any dependency, prove it cannot be implemented with `node:*` modules
- Build tool dependencies (ESLint, pre-commit) are dev-only and version-pinned
- Spec-kit is a development orchestration tool — not a runtime dependency

### IV. Test-First Discipline
Tests written before or alongside implementation. 915 tests currently pass at 0 failures.
- Red-Green-Refactor: write failing test → implement → verify green
- No `.only()` in committed tests
- Cassette system for deterministic LLM response testing
- CI blocks merge on any test failure

### V. Configuration over Code
Behavior controlled by `policy.yaml`, not conditional branches in source.
- Single unified config surface (merge tenant.yaml into policy.yaml)
- Boot-time validation with actionable error messages including line numbers
- Sensitive values (API keys) via environment variables only
- Config profiles support inheritance and overrides



### Files Changed
.specify/feature.json
gateway/cli.mjs
gateway/index.mjs
gateway/ledger-schema.sql
gateway/logging.mjs
gateway/provider-registry.mjs
gateway/server.mjs
gateway/tests/wire-adapter-registry.test.mjs
gateway/token-event.mjs
gateway/translate.mjs
gateway/wire-adapter-registry.mjs
gateway/wire-adapters/.gitkeep
gateway/wire-adapters/anthropic.mjs
gateway/wire-adapters/generic-http.mjs
gateway/wire-adapters/openai.mjs
specs/002-universal-gateway/checklists/requirements.md
specs/002-universal-gateway/contracts/gateway-api.md
specs/002-universal-gateway/contracts/wire-adapter-interface.md
specs/002-universal-gateway/data-model.md
specs/002-universal-gateway/plan.md
specs/002-universal-gateway/quickstart.md
specs/002-universal-gateway/research.md
specs/002-universal-gateway/spec.md
specs/002-universal-gateway/tasks.md

### PR Diff (abbreviated)
```diff
diff --git a/.specify/feature.json b/.specify/feature.json
index 21281c8..34484ac 100644
--- a/.specify/feature.json
+++ b/.specify/feature.json
@@ -1,3 +1,3 @@
 {
-  "feature_directory": "specs/001-foundation-hardening"
+  "feature_directory": "specs/002-universal-gateway"
 }
diff --git a/gateway/cli.mjs b/gateway/cli.mjs
index 95329da..215e498 100755
--- a/gateway/cli.mjs
+++ b/gateway/cli.mjs
@@ -25,9 +25,63 @@
  */
 import { fileURLToPath } from 'node:url';
 import { randomUUID } from 'node:crypto';
+import { writeFileSync, readFileSync, existsSync } from 'node:fs';
+import { join, dirname } from 'node:path';
 import { assembleGateway } from './index.mjs';
 import { loadPolicy } from '../budget.mjs';
 
+// ─── Zero-Config Auto-Detection ──────────────────────────────────────────────
+
+/**
+ * Strict whitelist of known AI provider API key environment variable names.
+ * Each entry maps an env var name to { provider, wire } metadata.
+ * No wildcard matching — avoids false positives on non-AI keys like AWS_ACCESS_KEY_ID.
+ */
+const KEY_PATTERNS = {
+  ANTHROPIC_API_KEY: { provider: 'anthropic', wire: 'anthropic' },
+  OPENAI_API_KEY: { provider: 'openai', wire: 'openai' },
+  DEEPSEEK_KEY: { provider: 'deepseek', wire: 'anthropic' },
+  GROQ_API_KEY: { provider: 'groq', wire: 'openai' },
+  GOOGLE_API_KEY: { provider: 'google', wire: 'generic-http' },
+  MISTRAL_API_KEY: { provider: 'mistral', wire: 'openai' },
+  COHERE_API_KEY: { provider: 'cohere', wire: 'generic-http' },
+  TOGETHER_API_KEY: { provider: 'together', wire: 'openai' },
+};
+
+/**
+ * Scan process.env for recognized AI provider API keys.
+ * Returns array of { provider, wire, keyEnv } for each detected key.
+ * Strict whitelist only — no wildcard matching.
+ */
+export function autoDetectProviders() {
+  const detected = [];
+  for (const [envName, meta] of Object.entries(KEY_PATTERNS)) {
+    if (process.env[envName]) {
+      detected.push({ provider: meta.provider, wire: meta.wire, keyEnv: envName });
+    }
+  }
+  return detected;
+}
+
+// ─── Package version (read from package.json at module load) ─────────────────
+
+let _version = null;
+function getVersion() {
+  if (_version !== null) return _version;
+  try {
+    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
+    if (existsSync(pkgPath)) {
+      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
+      _version = pkg.version || '0.0.0';
+    }
+  } catch {
+    _version = '0.0.0';
+  }
+  return _version;
+}
+
+const DASHBOARD_PORT = 4317;
+
 /**
  * Minimal inline flag parser (no dependency): `--flag value` pairs, plus bare `--flag` boolean
  * switches when the next token is missing or is itself another flag. That's the entire surface
@@ -63,14 +117,22 @@ export function parseArgs(argv) {
 export async function startCli(flags = {}) {
   const port = flags.port !== undefined ? Number(flags.port) : 0;
   const tenant = flags.tenant ?? 'pv';
-  // `assembleGateway`'s own default (`policy ?? loadPolicy(undefined, config)`) requires a
-  // `config` when `policy` is omitted (it reads `config.policyPath`) — this CLI deliberately never
-  // passes a `config` (standalone means no tenant AiosConfig), so an empty policy object is passed
-  // explicitly rather than `undefined` here, matching what an empty/missing policy.yaml would
-  // parse to anyway (`loadPolicy`'s own read-failure fallback is `{}`, per budget.mjs).
   const policy = flags.policy && typeof flags.policy === 'string' ? loadPolicy(flags.policy) : {};
   const ledgerPath = typeof flags.ledger === 'string' ? flags.ledger : undefined;
 
+  // Auto-detect providers from environment
+  const detectedProviders = autoDetectProviders();
+
+  // Handle --init flag: generate config and return early
+  if (flags.init) {
+    const configPath = generateInitConfig(detectedProviders, typeof flags.init === 'string' ? flags.init : undefined);
+    if (configPath) {
+      process.stdout.write(`Config written to: ${configPath}\n`);
+      process.stdout.write(`${detectedProviders.length} provider(s) detected.\n`);
+    }
+    return { detectedProviders, initConfigPath: configPath, token: null, registeredRun: null };
+  }
+
   const assembled = await assembleGateway({ policy, port, tenant, ledgerPath });
 
   let token = null;
@@ -90,16 +152,80 @@ export async function startCli(flags = {}) {
     assembled.runs.registerRun(token, registeredRun);
   }
 
-  return { ...assembled, tenant, ledgerPath, token, registeredRun };
+  return { ...assembled, tenant, ledgerPath, token, registeredRun, detectedProviders };
 }
 
-function printBanner({ url, tenant, ledgerPath, token, registeredRun }) {
-  process.stdout.write(`meridian-gateway listening at ${url}\n`);
+/**
+ * Print the rich startup message including version, port, detected providers, and dashboard URL.
+ */
+export function printStartupMessage({ version, port, detectedProviders, dashboardPort = DASHBOARD_PORT, loggingEnabled = false }) {
+  const ver = version ?? getVersion();
+  const count = detectedProviders?.length ?? 0;
+
+  if (count > 0) {
+    const providerList = detectedProviders.map((p) => p.provider).join(', ');
+    process.stdout.write(
+      `MeridianOS Gateway v${ver} | Listening on http://127.0.0.1:${port} | ` +
+      `${count} provider(s) auto-detected: ${providerList} | ` +
+      `Dashboard: http://127.0.0.1:${dashboardPort}\n`,
+    );
+  } else {
+    process.stdout.write(
+      `MeridianOS Gateway v${ver} | Listening on http://127.0.0.1:${port} | ` +
+      `No API keys detected. Set provider API keys in your environment or run with --init to generate a starter config. | ` +
+      `Dashboard: http://127.0.0.1:${dashboardPort}\n`,
+    );
+  }
+
+  // Privacy warning when logging is enabled
+  if (loggingEnabled) {
+    process.stdout.write(
+      '\u26A0 Logging is ENABLED. Request/response data will be stored for debugging. ' +
+      'Authorization headers are automatically redacted, but request bodies may contain sensitive information.\n',
+    );
+  }
+}
+
+/**
+ * Generate a default config file with auto-detected providers.
+ */
+export function generateInitConfig(detectedProviders, outputPath) {
+  const configPath = outputPath || '.ai/providers.yaml';
+  const lines = [
+    '# MeridianOS Gateway — auto-generated provider config',
+    `# Generated: ${new Date().toISOString()}`,
+    '',
+    'providers:',
+  ];
+  for (const p of detectedProviders) {
+    lines.push(`  ${p.provider}:`);
+    lines.push(`    wire: ${p.wire}`);
+    lines.push(`    keyEnv: ${p.keyEnv}`);
+  }
+  lines.push('');
+
+  try {
+    writeFileSync(configPath, lines.join('\n'), 'utf8');
+  } catch (err) {
+    process.stderr.write(`meridian-gateway: failed to write config to ${configPath}: ${err?.message ?? err}\n`);
+    return null;
+  }
+  return configPath;
+}
+
+function printBanner({ url, tenant, ledgerPath, token, registeredRun, detectedProviders }) {
+  const port = url ? Number(url.split(':').pop()) : 0;
+  printStartupMessage({
+    version: getVersion(),
+    port,
+    detectedProviders: detectedProviders ?? [],
+  });
+
   process.stdout.write(`tenant: ${tenant}\n`);
   process.stdout.write(`ledger: ${ledgerPath ?? '(default .ai/gateway/ledger.db)'}\n`);
   if (token) {
-    const modelPart = registeredRun.model ? ` model=${registeredRun.model}` : '';
-    process.stdout.write(`default run registered: agent=${registeredRun.agent} provider=${registeredRun.provider}${modelPart}\n`);
+    const modelPart = registeredRun?.model ? ` model=${registeredRun.model}` : '';
+    process.stdout.write(`default run registered: agent=${registeredRun?.agent ?? 'cli'} provider=${registeredRun?.provider ?? '?'}${modelPart}\n`);
     process.stdout.write(`gateway token (send as x-gateway-token, x-api-key, or Authorization: Bearer): ${token}\n`);
   } else {
     process.stdout.write('no --provider given: sidecar is up but no run is registered yet (every request will 401)\n');
@@ -108,6 +234,21 @@ function printBanner({ url, tenant, ledgerPath, token, registeredRun }) {
 
 async function main() {
   const flags = parseArgs(process.argv.slice(2));
+
+  // Handle --init before assembly
+  if (flags.init) {
+    const detected = autoDetectProviders();
+    const configPath = generateInitConfig(detected, typeof flags.init === 'string' ? flags.init : undefined);
+    if (configPath) {
+      process.stdout.write(`Config written to: ${configPath}\n`);
+      process.stdout.write(`${detected.length} provider(s) auto-detected.\n`);
+    }
+    if (detected.length === 0) {
+      process.stdout.write('No API keys detected. Set provider API keys in your environment and re-run.\n');
+    }
+    return;
+  }
+
   const cli = await startCli(flags);
   printBanner(cli);
 
@@ -115,7 +256,7 @@ async function main() {
   const shutdown = () => {
     if (shuttingDown) return;
     shuttingDown = true;
-    cli.close().finally(() => process.exit(0));
+    cli.close?.().finally(() => process.exit(0));
   };
   process.on('SIGINT', shutdown);
   process.on('SIGTERM', shutdown);
diff --git a/gateway/index.mjs b/gateway/index.mjs
index ed6bc3f..a293f64 100644
--- a/gateway/index.mjs
+++ b/gateway/index.mjs
@@ -19,6 +19,9 @@ import { createRegistryStore } from './registry-pull.mjs';
 import { makeCheckVerdict } from './windows.mjs';
 import { startGateway } from './server.mjs';
 import { startHealthLoop } from '../provider-health.mjs';
+import { discoverAdapters } from './wire-adapter-registry.mjs';
+import { fileURLToPath } from 'node:url';
+import { join, dirname } from 'node:path';
 
 /**
  * Assembles and starts one gateway sidecar instance.
@@ -60,6 +63,10 @@ export async function assembleGateway({ config, policy, port = 0, tenant = 'pv',
   const catalog = config ? loadPricing(config.pricingPath, config) : {};
   const costFn = (provider, model, usage) => costFor(provider, model, usage, { catalog })?.totalCost ?? null;
 
+  // Discover WireAdapters from the gateway/wire-adapters/ directory
+  const adaptersDir = join(dirname(fileURLToPath(import.meta.url)), 'wire-adapters');
+  const adapters = await discoverAdapters(adaptersDir);
+
   const gateway = await startGateway({
     port,
     registry: () => store.get(),
@@ -67,6 +74,7 @@ export async function assembleGateway({ config, policy, port = 0, tenant = 'pv',
     onTokenEvent: (evt) => appendEvent(ledger, evt),
     checkVerdict,
     costFn,
+    adapters,
   });
 
   // Phase 0: Start provider health monitoring loop (60s interval)
diff --git a/gateway/ledger-schema.sql b/gateway/ledger-schema.sql
index 323e933..191d207 100644
--- a/gateway/ledger-schema.sql
+++ b/gateway/ledger-schema.sql
@@ -36,3 +36,25 @@ CREATE TABLE IF NOT EXISTS token_events (
 CREATE INDEX IF NOT EXISTS idx_token_events_ts ON token_events(ts);
 CREATE INDEX IF NOT EXISTS idx_token_events_tenant_agent_ts ON token_events(tenant, agent, ts);
 CREATE INDEX IF NOT EXISTS idx_token_events_provider ON token_events(provider);
+
+-- request_logs — append-only request/response logging for debugging provider calls.
+-- Auth headers are redacted BEFORE storage. Rows are never updated, only inserted
+-- and (optionally) pruned per retention policy.
+CREATE TABLE IF NOT EXISTS request_logs (
+  id                 TEXT PRIMARY KEY,
+  ts                 TEXT NOT NULL,
+  provider           TEXT NOT NULL,
+  model              TEXT NOT NULL,
+  method             TEXT NOT NULL,
+  url                TEXT NOT NULL,
+  status_code        INTEGER NOT NULL,
+  latency_ms         INTEGER NOT NULL,
+  request_headers    TEXT NOT NULL,
+  request_body       TEXT NOT NULL,
+  response_headers   TEXT NOT NULL,
+  response_body      TEXT NOT NULL,
+  extracted_usage    TEXT
+);
+
+CREATE INDEX IF NOT EXISTS idx_request_logs_ts ON request_logs(ts);
+CREATE INDEX IF NOT EXISTS idx_request_logs_provider ON request_logs(provider);
diff --git a/gateway/logging.mjs b/gateway/logging.mjs
new file mode 100644
index 0000000..58c7682
--- /dev/null
+++ b/gateway/logging.mjs
@@ -0,0 +1,220 @@
+/**
+ * logging — append-only request/response logging with header redaction and replay.
+ * Stored in the request_logs table of the gateway ledger database.
+ *
+ * Privacy-first: disabled by default, auth headers redacted, privacy warning at startup.
+ * Append-only: rows are never updated, only inserted and pruned.
+ */
+
+import { randomUUID } from 'node:crypto';
+
+const SENSITIVE_HEADERS = new Set(['authorization', 'x-api-key', 'api-key']);
+
+/**
+ * Deep-clone headers object, replacing sensitive header values with [REDACTED].
+ * Case-insensitive header name matching. Never throws.
+ */
+export function redactHeaders(headers = {}) {
+  try {
+    const out = {};
+    for (const [key, value] of Object.entries(headers)) {
+      if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
+        out[key] = '[REDACTED]';
+      } else {
+        out[key] = typeof value === 'string' ? value : String(value ?? '');
+      }
+    }
+    return out;
+  } catch {
+    // Malformed headers fall through unredacted with a warning
+    return { ...headers };
+  }
+}
+
+/**
+ * Insert a request-response log entry into the request_logs table.
+ * Headers are redacted BEFORE storage.
+ *
+ * @param {object} db - better-sqlite3 database instance
+ * @param {object} entry - { provider, model, method, url, statusCode, latencyMs,
+ *   requestHeaders, requestBody, responseHeaders, responseBody, extractedUsage }
+ */
+export function logRequestResponse(db, entry) {
+  if (!db) return;
+  try {
+    const stmt = db.prepare(`
+      INSERT INTO request_logs (id, ts, provider, model, method, url, status_code, latency_ms,
+        request_headers, request_body, response_headers, response_body, extracted_usage)
+      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
+    `);
+    stmt.run(
+      randomUUID(),
+      new Date().toISOString(),
+      entry.provider ?? 'unknown',
+      entry.model ?? 'unknown',
+      entry.method ?? 'POST',
+      entry.url ?? '',
+      entry.statusCode ?? 0,
+      entry.latencyMs ?? 0,
+      JSON.stringify(redactHeaders(entry.requestHeaders ?? {})),
+      typeof entry.requestBody === 'string' ? entry.requestBody : JSON.stringify(entry.requestBody ?? ''),
+      JSON.stringify(entry.responseHeaders ?? {}),
+      typeof entry.responseBody === 'string' ? entry.responseBody : JSON.stringify(entry.responseBody ?? ''),
+      entry.extractedUsage ? JSON.stringify(entry.extractedUsage) : null,
+    );
+  } catch (err) {
+    console.warn(`[MERIDIANOS] logging: failed to write log entry: ${err?.message ?? err}`);
+  }
+}
+
+/**
+ * Delete log entries older than retentionDays.
+ */
+export function pruneOldLogs(db, retentionDays = 7) {
+  if (!db || retentionDays <= 0) return 0;
+  try {
+    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
+    const result = db.prepare('DELETE FROM request_logs WHERE ts < ?').run(cutoff);
+    return result.changes ?? 0;
+  } catch (err) {
+    console.warn(`[MERIDIANOS] logging: prune failed: ${err?.message ?? err}`);
+    return 0;
+  }
+}
+
+/**
+ * Get a single log entry by ID.
+ */
+export function getLogById(db, id) {
+  if (!db) return null;
+  try {
+    const row = db.prepare('SELECT * FROM request_logs WHERE id = ?').get(id);
+    if (!row) return null;
+    return rowToEntry(row);
+  } catch {
+    return null;
+  }
+}
+
+/**
+ * List log entries with pagination and optional filters.
+ */
+export function listLogs(db, { limit = 50, offset = 0, provider, since } = {}) {
+  if (!db) return [];
+  try {
+    let sql = 'SELECT * FROM request_logs WHERE 1=1';
+    const params = [];
+    if (provider) {
+      sql += ' AND provider = ?';
+      params.push(provider);
+    }
+    if (since) {
+      sql += ' AND ts >= ?';
+      params.push(since);
+    }
+    sql += ' ORDER BY ts DESC LIMIT ? OFFSET ?';
+    params.push(Math.min(limit, 500), offset);
+    const rows = db.prepare(sql).all(...params);
+    return rows.map(rowToEntry);
+  } catch {
+    return [];
+  }
+}
+
+function rowToEntry(row) {
+  return {
+    id: row.id,
+    ts: row.ts,
+    provider: row.provider,
+    model: row.model,
+    method: row.method,
+    url: row.url,
+    statusCode: row.status_code,
+    latencyMs: row.latency_ms,
+    requestHeaders: safeParse(row.request_headers),
+    requestBody: row.request_body,
+    responseHeaders: safeParse(row.response_headers),
+    responseBody: row.response_body,
+    extractedUsage: safeParse(row.extracted_usage),
+  };
+}
+
+function safeParse(text) {
+  try { return JSON.parse(text); } catch { return text; }
+}
+
+/**
+ * Replay a previously logged request against current provider configuration.
+ * Reads stored request, constructs new upstream HTTP call, returns new response.
+ * Original log entry is never modified (append-only).
+ *
+ * @param {object} db - Database instance
+ * @param {string} id - Log entry ID to replay
+ * @param {object} opts - { registry, resolveKey, now } for constructing the upstream request
+ */
+export async function replayRequest(db, id, { registry, resolveKey, now = () => Date.now() } = {}) {
+  const entry = getLogById(db, id);
+  if (!entry) return null;
+
+  const http = entry.url.startsWith('https') ? await import('node:https') : await import('node:http');
+  const transport = http.default ?? http;
+
+  const activeRegistry = typeof registry === 'function' ? registry() : registry;
+  const { resolveRoute } = await import('./provider-registry.mjs');
+  const route = resolveRoute(activeRegistry, entry.provider);
+  if (!route) return null;
+
+  const apiKey = resolveKey ? resolveKey(route.keyEnv) : undefined;
+  const headers = { ...entry.requestHeaders };
+  if (apiKey) {
+    if (route.wire === 'anthropic') headers['x-api-key'] = apiKey;
+    else headers['authorization'] = `Bearer ${apiKey}`;
+  }
+
+  const start = now();
+  try {
+    const url = new URL(entry.url);
+    const upstreamRes = await new Promise((resolvePromise, rejectPromise) => {
+      const req = transport.request(
+        url,
+        { method: entry.method, headers: { ...headers, 'content-type': 'application/json' } },
+        (r) => resolvePromise(r),
+      );
+      req.on('error', rejectPromise);
+      if (entry.requestBody) req.end(entry.requestBody);
+      else req.end();
+    });
+
+    const chunks = [];
+    for await (const chunk of upstreamRes) chunks.push(chunk);
+    const body = Buffer.concat(chunks).toString('utf8');
+
+    return {
+      originalRequestId: id,
+      statusCode: upstreamRes.statusCode,
+      latencyMs: now() - start,
+      body: safeParse(body),
+    };
+  } catch (err) {
+    return {
+      originalRequestId: id,
+      statusCode: null,
+      latencyMs: now() - start,
+      error: String(err?.message ?? err),
+    };
+  }
+}
+
+/**
+ * Check available disk space on the volume containing the given path.

... (truncated 3253 lines)
```


You are an independent code reviewer (Claude Code / Sonnet 5). You have NO knowledge of how this code was written or what conversation led to it. Judge purely on what you see in the diff.

## Your Task
Review PR #69 against:
1. The spec.md acceptance criteria (above)
2. The MeridianOS Constitution principles (above)
3. Code quality standards (ES modules, .mjs extension, no require(), node: prefix)

## Output Format
### Verdict: ✅ APPROVE / ⚠️ CHANGES REQUESTED / ❌ REJECT

### Spec Compliance
| User Story | Acceptance Scenario | Status | Evidence |
|------------|---------------------|--------|----------|

### Constitution Violations
| Principle | Violation | File:Line | Fix |
|-----------|-----------|-----------|-----|

### Code Quality Issues
- [file:line] specific issue → suggested fix

### Test Assessment
- Were new tests added for changed behavior? (yes/no/NA)
- Do existing tests cover the change paths?

Be specific. Reference exact file paths and line numbers from the diff.
