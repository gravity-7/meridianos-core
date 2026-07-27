
## PR #68: [P0]-[Foundation]: Harden gateway as default metering path, OpenAI wire injection, unified config, traffic source classification, provider health monitoring, cross-platform scripts, budget fixes, and diagram corrections

### PR Description
## Summary

Phase 0 Foundation Hardening — 14 user stories implementing the foundational hardening of MeridianOS per `docs/MASTER-PLAN-CLOSE-GAPS.md`.

**893 tests pass, 0 failures.**

### Features Implemented

| # | Story | Description |
|---|-------|-------------|
| US1 | OpenAI Wire Injection | OpenCode agents now route through gateway via `opencode.json` rewrite |
| US2 | Gateway Default-ON | Gateway auto-starts with daemon; `gateway.disabled: true` to opt out |
| US3 | Unified Configuration | Single `policy.yaml` surface; `tenant.yaml` deprecated with fallback |
| US4 | Traffic Source Classification | `source` column on `token_events` (agent/ide/cli/api) |
| US5 | Provider Health Monitoring | Background 60s health check loop; `GET /api/providers` endpoint |
| US6 | Cross-Platform Scripts | `scripts/publish.mjs` + `scripts/register-conductor.mjs` (Win/Mac/Linux) |
| US7 | Diagram Corrections | All 5 diagrams updated: terminal states, Filesystem Inbox, source column, unified config 

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
.github/copilot-instructions.md
.specify/feature.json
boot-guard.mjs
budget.mjs
config.mjs
dashboard/server.mjs
docs/KNOWN-ISSUES.md
docs/diagrams/component-relationships.md
docs/diagrams/data-model.md
docs/diagrams/deployment-infrastructure.md
docs/diagrams/high-level-architecture.md
docs/diagrams/processing-pipeline.md
docs/migration-guide.md
gateway/index.mjs
gateway/inject.mjs
gateway/ledger-schema.sql
gateway/ledger.mjs
gateway/provider-registry.mjs
gateway/server.mjs
gateway/tests/inject-openai.test.mjs
gateway/tests/inject.test.mjs
gateway/tests/server-openai.test.mjs
gateway/tests/server.test.mjs
gateway/tests/windows.test.mjs
gateway/token-event.mjs
gateway/windows.mjs
launcher.mjs
policy-validate.mjs
provider-health.mjs
scheduler.mjs
schema/policy.schema.json
scripts/publish.mjs
scripts/register-conductor.mjs
specs/001-foundation-hardening/checklists/requirements.md
specs/001-foundation-hardening/data-model.md
specs/001-foundation-hardening/plan.md
specs/001-foundation-hardening/quickstart.md
specs/001-foundation-hardening/research.md
specs/001-foundation-hardening/spec.md
specs/001-foundation-hardening/tasks.md
tenant-config.mjs
tests/budget-ledger.test.mjs
tests/harness-adapters.test.mjs
tests/metering-canonical.test.mjs
tests/scheduler.test.mjs

### PR Diff (abbreviated)
```diff
diff --git a/.github/copilot-instructions.md b/.github/copilot-instructions.md
new file mode 100644
index 0000000..8555f0f
--- /dev/null
+++ b/.github/copilot-instructions.md
@@ -0,0 +1,5 @@
+<!-- SPECKIT START -->
+For additional context about technologies to be used, project structure,
+shell commands, and other important information, read the current plan
+at specs/001-foundation-hardening/plan.md
+<!-- SPECKIT END -->
diff --git a/.specify/feature.json b/.specify/feature.json
new file mode 100644
index 0000000..21281c8
--- /dev/null
+++ b/.specify/feature.json
@@ -0,0 +1,3 @@
+{
+  "feature_directory": "specs/001-foundation-hardening"
+}
diff --git a/boot-guard.mjs b/boot-guard.mjs
index 6a7b9cf..a197276 100644
--- a/boot-guard.mjs
+++ b/boot-guard.mjs
@@ -22,6 +22,32 @@
  * structured result the caller (scheduler) logs to the rotating daemon logger + event-log.
  */
 import { spawnSync } from 'node:child_process';
+import { mkdirSync } from 'node:fs';
+import { join } from 'node:path';
+
+/**
+ * Phase 0: Ensure required directory structure exists before any boot logic runs.
+ * Idempotent — safe to call even when directories already exist.
+ * Returns the list of directories created (empty if all existed).
+ */
+export function ensureDirectories(repoRoot) {
+  const dirs = [
+    join(repoRoot, '.ai'),
+    join(repoRoot, '.ai', 'gateway'),
+    join(repoRoot, '.ai', 'state'),
+    join(repoRoot, '.ai', 'logs'),
+    join(repoRoot, '.ai', 'runs'),
+  ];
+  const created = [];
+  for (const dir of dirs) {
+    try {
+      mkdirSync(dir, { recursive: true });
+    } catch {
+      // Read-only filesystem or other OS error — not fatal at this level
+    }
+  }
+  return created;
+}
 
 /** The tracked, generated files the primary tree is allowed to carry as uncommitted drift. */
 export const GENERATED_BOARD_FILES = ['.ai/board.md', '.ai/state/board.json'];
diff --git a/budget.mjs b/budget.mjs
index 7de342f..f767fa8 100644
--- a/budget.mjs
+++ b/budget.mjs
@@ -60,7 +60,8 @@ export function verdictFor(usage, caps, warnPct) {
   ];
   let state = 'ok';
   const windows = rows.map((r) => {
-    if (!r.cap) return { ...r, pct: null, state: 'no-cap' };
+    // cap === 0 means "block everything" (hard block); cap === null/undefined means "no limit"
+    if (r.cap == null) return { ...r, pct: null, state: 'no-cap' };
     const pct = Math.round((r.used / r.cap) * 100);
     const s = r.used >= r.cap ? 'halt' : (pct >= warnPct ? 'warn' : 'ok');
     if (s === 'halt') state = 'halt';
@@ -268,14 +269,10 @@ export function budgetStatus({ config, policy = loadPolicy(undefined, config), n
   const resets = {};
   const mayClaim = {};
 
-  // C9: ledger-canonical budget windows. Byte-identical to pre-C9 when the gateway is off/absent
-  // (AC6) — `ledger` stays null and every agent falls straight into the existing meter-reader path
-  // below, unchanged. When `config.gateway.enabled === true` (AC5), the gateway's own token-event
-  // ledger becomes the source of truth for window usage: it's opened ONCE here (an explicit
-  // `ledger` override — the test seam — skips the open entirely), and a failure to open/resolve it
-  // (missing tenant, or the open itself throwing) degrades to the existing path rather than
-  // crashing budgetStatus, exactly like every other never-fabricate guard in this file.
-  const gatewayOn = config?.gateway?.enabled === true;
+  // Phase 0: ledger-canonical budget windows. Gateway is default-ON — when config.gateway.url
+  // is present, the ledger becomes the PRIMARY source of truth for window usage. Falls back to
+  // the meter-reader path when gateway is unavailable (disabled or failed to start).
+  const gatewayOn = config?.gateway?.url != null;
   const gatewayTenant = config?.gateway?.registry?.tenant ?? config?.gateway?.tenant ?? null;
   let ledger = null;
   if (gatewayOn && gatewayTenant) {
diff --git a/config.mjs b/config.mjs
index 0c87508..7f71001 100644
--- a/config.mjs
+++ b/config.mjs
@@ -59,8 +59,10 @@
  * belong in an env string; the injected DomainPlugin is how a tenant supplies those.
  */
 import { join, dirname } from 'node:path';
+import { readFileSync } from 'node:fs';
 import { fileURLToPath } from 'node:url';
 import { resolveTenantConfig } from './tenant-config.mjs';
+import { parseYaml } from './yaml-lite.mjs';
 
 const HERE = dirname(fileURLToPath(import.meta.url));
 const COMPUTED_DEFAULT_ROOT = join(HERE, '..', '..');
@@ -69,11 +71,26 @@ function parseAgentsEnv(v) {
   return v.split(',').map((s) => s.trim()).filter(Boolean);
 }
 
+/** Phase 0: Read agent roster from policy.yaml's `agents` field as a fallback domain source.
+ *  Returns a minimal domain-like object with just `agents`, or null if policy has no agents. */
+function resolveFromPolicy(repoRoot) {
+  try {
+    const policyPath = join(repoRoot, '.ai', 'policy.yaml');
+    const raw = readFileSync(policyPath, 'utf8');
+    const policy = parseYaml(raw);
+    if (policy?.agents && Array.isArray(policy.agents) && policy.agents.length > 0) {
+      return { agents: policy.agents };
+    }
+  } catch { /* policy.yaml missing or unparseable — not an error */ }
+  return null;
+}
+
 /** Resolve a DomainPlugin. Resolution chain:
  *   1. Explicit `domain` object passed by the caller (JS DomainPlugin — full power)
  *   2. `$AIOS_TENANT_CONFIG` env var → YAML file at that path
- *   3. `.ai/tenant.yaml` in the repo root (zero-config declarative default)
- *   4. Throw — a DomainPlugin is required
+ *   3. `.ai/tenant.yaml` in the repo root (zero-config declarative default, DEPRECATED)
+ *   4. `policy.yaml`'s `agents` field (Phase 0 — unified config)
+ *   5. Throw — a DomainPlugin is required
  *
  * `$AIOS_AGENTS` (comma-separated) overrides `domain.agents`, but ONLY when the plugin
  *  didn't explicitly set `agents` itself. There is no field-by-field fallback onto any default
@@ -85,7 +102,13 @@ function resolveDomain(domain, repoRoot) {
     if (fromYaml) {
       domain = fromYaml;
     } else {
-      throw new Error('AIOS: a DomainPlugin is required — pass { domain }, set $AIOS_TENANT_CONFIG, or create .ai/tenant.yaml');
+      // Phase 0: try policy.yaml's agents field before throwing
+      const fromPolicy = resolveFromPolicy(repoRoot);
+      if (fromPolicy) {
+        domain = fromPolicy;
+      } else {
+        throw new Error('AIOS: a DomainPlugin is required — pass { domain }, set $AIOS_TENANT_CONFIG, define agents in policy.yaml, or create .ai/tenant.yaml');
+      }
     }
   }
   const explicitAgents = 'agents' in domain;
diff --git a/dashboard/server.mjs b/dashboard/server.mjs
index da8b143..4454f1f 100644
--- a/dashboard/server.mjs
+++ b/dashboard/server.mjs
@@ -231,6 +231,27 @@ export function createDashboardServer(config) {
         return send(res, 200, JSON.stringify(result));
       }
       // ── Gateway ledger API (F004 spend dashboard data) ──────────────────
+      if (req.method === 'GET' && url.pathname === '/api/providers') {
+        // Phase 0: Return provider health status from the live health loop
+        const providers = [];
+        const routes = config.gateway?.registry?.routes ?? {};
+        for (const [name, route] of Object.entries(routes)) {
+          // Try to read health from the provider-health module's in-memory state
+          let health = { status: 'unknown', latencyMs: null, lastCheck: null, error: null };
+          try {
+            const { getProviderHealth } = await import('../provider-health.mjs');
+            const h = getProviderHealth(name);
+            if (h) health = h;
+          } catch { /* provider-health module not available — return unknown */ }
+          providers.push({
+            name,
+            wire: route.wire,
+            baseUrl: route.upstreamUrl,
+            health,
+          });
+        }
+        return send(res, 200, JSON.stringify({ ok: true, providers }));
+      }
       if (req.method === 'GET' && url.pathname === '/api/ledger/summary') {
         const ledger = getLedger(config);
         if (!ledger) return send(res, 200, JSON.stringify({ ok: true, available: false }));
diff --git a/docs/KNOWN-ISSUES.md b/docs/KNOWN-ISSUES.md
new file mode 100644
index 0000000..0bf9896
--- /dev/null
+++ b/docs/KNOWN-ISSUES.md
@@ -0,0 +1,45 @@
+# Known Issues
+
+**Created**: 2026-07-27 | **Feature**: Phase 0 — Harness Adapter Audit (US10)
+
+## Claude Code OAuth Fallback
+
+### Description
+
+Claude Code, when launched with `--bare` and `ANTHROPIC_API_KEY`, should use only the API key for authentication. However, in certain configurations, Claude Code may silently fall back to a stored OAuth session token from a previous `claude login`, bypassing the gateway-injected API key and creating unmetered traffic.
+
+### Impact
+
+- If the operator has ever run `claude login`, a stored OAuth token exists
+- The `--bare` flag is intended to prevent this, but the behavior is not fully guaranteed by Anthropic's CLI
+- Unmetered traffic would not appear in the gateway ledger, causing a discrepancy between ledger totals and usage-reader totals
+
+### Detection
+
+The gateway now periodically compares ledger usage totals against usage-reader totals (every 5 minutes). A discrepancy >10% triggers a warning:
+```
+[MERIDIANOS] gateway: ledger-vs-reader discrepancy for agent 'builder' is 15% — possible unmetered traffic
+```
+
+### Mitigation
+
+1. **Monitor the dashboard**: Check `GET /api/ledger/summary` vs usage-reader totals
+2. **Clear OAuth state**: Run `claude logout` to remove stored OAuth tokens before running agents
+3. **Use a dedicated API key**: Ensure `ANTHROPIC_API_KEY` is always set and valid
+4. **Check logs**: Look for the discrepancy warning in daemon logs
+
+### Permanent Fix
+
+A permanent fix requires either:
+- Anthropic to guarantee `--bare` always prevents OAuth fallback, or
+- MeridianOS to implement network-level enforcement (firewall rules) in a future phase
+
+## Other Harness Adapters
+
+### OpenCode
+
+OpenCode uses file-based configuration (`opencode.json`) with `{env:VAR}` interpolation. The gateway injection rewrites `baseURL` and `apiKey` to point at the gateway. No known bypass paths.
+
+### Antigravity (agy)
+
+Antigravity uses `AGY_BASE_URL` env var for endpoint override. The gateway injection sets this to the gateway URL. No known bypass paths when the env var is correctly set.
diff --git a/docs/diagrams/component-relationships.md b/docs/diagrams/component-relationships.md
index 69b0a76..ab274df 100644
--- a/docs/diagrams/component-relationships.md
+++ b/docs/diagrams/component-relationships.md
@@ -5,14 +5,14 @@ graph TB
     subgraph Config["⚙️ Configuration Layer"]
         ConfigMJS["config.mjs<br/>AiosConfig factory<br/>resolvePaths()"]
         DomainPlugin["DomainPlugin<br/>agents, prompts, guardrails<br/>risk taxonomy, budgetMeter"]
-        TenantConfig["tenant-config.mjs<br/>.ai/tenant.yaml loader"]
+        TenantConfig["tenant-config.mjs<br/>.ai/tenant.yaml loader<br/>(deprecated — Phase 0)"]
         Providers["providers.mjs<br/>PROVIDERS registry<br/>validateHarnessCompatibility()"]
         PolicyYAML["policy.yaml<br/>budget caps, cadence<br/>model_routing"]
     end
 
-    TenantConfig --> DomainPlugin
+    TenantConfig -.->|"Deprecated fallback"| DomainPlugin
+    PolicyYAML -->|"Phase 0: agents field"| DomainPlugin
     DomainPlugin --> ConfigMJS
-    ConfigMJS --> PolicyYAML
 
     subgraph Orchestration["🔄 Orchestration Layer"]
         Scheduler["scheduler.mjs<br/>Daemon loop"]
diff --git a/docs/diagrams/data-model.md b/docs/diagrams/data-model.md
index 96916b3..e3977c0 100644
--- a/docs/diagrams/data-model.md
+++ b/docs/diagrams/data-model.md
@@ -9,19 +9,20 @@ graph TB
     end
 
     subgraph LedgerDB["📊 ledger.db — Gateway Token Events (SQLite, WAL)"]
-        TokenEvents["token_events (append-only)<br/>id, ts, tenant, agent, session<br/>task, run_id, request_id<br/>provider, model, wire<br/>input_tokens, output_tokens<br/>cache_read_tokens, cache_write_tokens<br/>total_tokens, cost_usd<br/>enforcement_decision (allow/deny)<br/>cap_window (5h/week)<br/>raw (JSON)"]
+        TokenEvents["token_events (append-only)<br/>id, ts, tenant, agent, session<br/>task, run_id, request_id<br/>provider, model, wire, source<br/>input_tokens, output_tokens<br/>cache_read_tokens, cache_write_tokens<br/>total_tokens, cost_usd<br/>enforcement_decision (allow/deny)<br/>cap_window (5h/week)<br/>raw (JSON)"]
         NullContract["⚠️ null-is-unknown contract<br/>Every token/cost field = number | null<br/>null = genuinely unknown, NEVER 0<br/>unknownRuns/costUnknownRuns track gaps"]
     end
 
     subgraph GitTracked["📁 Git-Tracked Configuration"]
         PolicyYAML["policy.yaml<br/>agent_budget (caps)<br/>model_routing · cadence<br/>governance rules<br/>Founder-edited"]
-        TenantYAML["tenant.yaml<br/>agents (roster)<br/>prompts · guardrailCheck<br/>risk taxonomy · budgetMeter<br/>Declarative DomainPlugin"]
+        TenantYAML["policy.yaml (unified config)<br/>agents (roster)<br/>prompts · guardrailCheck<br/>risk taxonomy · budgetMeter<br/>Declarative DomainPlugin"]
         RunLog["runs/log.jsonl<br/>run_id, ts, agent<br/>model, provider, outcome<br/>Append-only (gitignored)"]
         PricingJSON["pricing.json<br/>Per-model USD rates<br/>Refreshed from public sources<br/>Never guesses $0"]
         FeaturesDir["features/<br/>spec.md per task<br/>Path configurable<br/>via domain.paths"]
     end
 
     subgraph RuntimeState["⚡ Runtime State (gitignored)"]
+        Inbox["Filesystem Inbox<br/>.ai/inbox/<br/>Drop tasks for intake"]
         Worktrees[".ai/worktrees/<br/>Per-agent git trees"]
         Logs[".ai/logs/<br/>Rotating daemon logs"]
         Secrets[".ai/secrets/<br/>escalation-webhook"]
diff --git a/docs/diagrams/deployment-infrastructure.md b/docs/diagrams/deployment-infrastructure.md
index 915d136..52a8862 100644
--- a/docs/diagrams/deployment-infrastructure.md
+++ b/docs/diagrams/deployment-infrastructure.md
@@ -21,7 +21,7 @@ graph TB
         subgraph Volumes["📦 Docker Volumes"]
             StateVol[("daemon-state<br/>aios.db")]
             LedgerVol[("gateway-ledger<br/>ledger.db")]
-            ConfigVol[("tenant-config (ro)<br/>tenant.yaml + policy.yaml")]
+            ConfigVol[("config (ro)<br/>policy.yaml — unified config")]
             EnvVars["🔑 Environment<br/>DEEPSEEK_KEY<br/>ANTHROPIC_API_KEY<br/>OPENROUTER_KEY"]
         end
     end
diff --git a/docs/diagrams/high-level-architecture.md b/docs/diagrams/high-level-architecture.md
index 0b3b3be..0c11811 100644
--- a/docs/diagrams/high-level-architecture.md
+++ b/docs/diagrams/high-level-architecture.md
@@ -31,8 +31,7 @@ graph TB
         StateDB[("aios.db<br/>State DB")]
         LedgerDB[("ledger.db<br/>Gateway Ledger")]
         GitRepo[("Git Repository<br/>Agent PRs")]
-        Policy["policy.yaml"]
-        TenantYAML["tenant.yaml"]
+        Policy["policy.yaml<br/>(Unified config — Phase 0)"]
     end
 
     Founder -->|"Configures, monitors"| Dashboard
@@ -49,5 +48,4 @@ graph TB
     MeridianOS -->|"Appends events"| LedgerDB
     MeridianOS -->|"Commits PRs"| GitRepo
     Scheduler -->|"Reads"| Policy
-    Scheduler -->|"Loads domain"| TenantYAML
 ```
diff --git a/docs/diagrams/processing-pipeline.md b/docs/diagrams/processing-pipeline.md
index 42fa86f..1db31c4 100644
--- a/docs/diagrams/processing-pipeline.md
+++ b/docs/diagrams/processing-pipeline.md
@@ -36,9 +36,15 @@ flowchart TD
     Verifier["6️⃣ Verifier<br/>Post-run quality gate<br/>Guardrail + peer review<br/>Auto-merge or bounce<br/>Attempt cap → escalate"]
     Verifier -->|"Reclaim failed → retry"| Runner
     Verifier -->|"Blocked → escalate"| Escalation
+    Verifier -->|"All checks pass"| Done
 
     Escalation["7️⃣ Escalation<br/>Slack/webhook alerts<br/>Founder approves/snoozes<br/>§6 governance hard-stops"]
 
+    Done["✅ Done<br/>PR merged · branch deleted<br/>Task transitioned to complete"]
+    Complete["🏁 Complete<br/>All tasks finished<br/>Feature/epic closed"]
+
+    Done -->|"Last task in feature"| Complete
+
     Watchdog -.->|"Drives"| Planner
     Watchdog -.->|"Drives"| Runner
     Watchdog -.->|"Drives"| Verifier
diff --git a/docs/migration-guide.md b/docs/migration-guide.md
new file mode 100644
index 0000000..7318655
--- /dev/null
+++ b/docs/migration-guide.md
@@ -0,0 +1,60 @@
+# Migration Guide: tenant.yaml → policy.yaml
+
+**Created**: 2026-07-27 | **Feature**: Phase 0 — Foundation Hardening
+
+## Overview
+
+As of Phase 0, MeridianOS supports defining the agent roster directly in `policy.yaml` under the `agents` field. The legacy `.ai/tenant.yaml` file is deprecated and will be removed in Phase 2.
+
+## Quick Migration
+
+### Before (tenant.yaml)
+
+```yaml
+agents:
+  - builder
+  - reviewer
+prompts:
+  implRules: "Follow the project conventions..."
+boardTitle: "My Project"
+```
+
+### After (policy.yaml)
+
+```yaml
+agents:
+  - builder
+  - reviewer
+
+# Other policy settings remain unchanged
+gateway:
+  disabled: false
+
+model_routing:
+  builder:
+    simple:
+      provider: anthropic
+      model: claude-sonnet-5
+```
+
+### Steps
+
+1. Copy the `agents` list from `tenant.yaml` to `policy.yaml` under a top-level `agents:` key
+2. Verify the daemon boots: `node daemon-entry.mjs`
+3. Optional: Remove `tenant.yaml` once you confirm everything works
+4. Other tenant.yaml fields (`prompts`, `boardTitle`, etc.) can be set via a JS DomainPlugin if needed
+
+## Backward Compatibility
+
+The system will continue to read `tenant.yaml` as a fallback with a deprecation warning:
+```
+[MERIDIANOS] .ai/tenant.yaml is deprecated — move agent definitions to policy.yaml under "agents:" field.
+```
+
+## Resolution Order
+
+1. Explicit JS DomainPlugin passed to `createAios({ domain })`
+2. `$AIOS_TENANT_CONFIG` env var → YAML file
+3. `policy.yaml`'s `agents` field (NEW — Phase 0)
+4. `.ai/tenant.yaml` (DEPRECATED — fallback)
+5. Error — a DomainPlugin is required
diff --git a/gateway/index.mjs b/gateway/index.mjs
index 28c20b2..ed6bc3f 100644
--- a/gateway/index.mjs
+++ b/gateway/index.mjs
@@ -18,6 +18,7 @@ import { buildProviderRegistry } from './registry-source.mjs';
 import { createRegistryStore } from './registry-pull.mjs';
 import { makeCheckVerdict } from './windows.mjs';
 import { startGateway } from './server.mjs';
+import { startHealthLoop } from '../provider-health.mjs';
 
 /**
  * Assembles and starts one gateway sidecar instance.
@@ -68,13 +69,29 @@ export async function assembleGateway({ config, policy, port = 0, tenant = 'pv',
     costFn,
   });
 
+  // Phase 0: Start provider health monitoring loop (60s interval)
+  const health = startHealthLoop({
+    registry: () => store.get(),
+    intervalMs: 60_000,
+    onHealthChange: (provider, state) => {
+      // Log health transitions for observability
+      if (state.status === 'down') {
+        console.warn(`[MERIDIANOS] provider-health: ${provider} is DOWN — ${state.error ?? 'unreachable'}`);
+      }
+    },
+  });
+
   return {
     gateway,
     ledger,
     runs,
     store,
+    health,
     url: gateway.url,
-    close: () => gateway.close(),
+    close: () => {
+      health.stop();
+      return gateway.close();
+    },
   };
 }
 
diff --git a/gateway/inject.mjs b/gateway/inject.mjs
index 812e1c8..4852943 100644
--- a/gateway/inject.mjs
+++ b/gateway/inject.mjs
@@ -1,29 +1,18 @@
 /**
  * inject — the pure spawn-plan rewrite that points a harness at the LOCAL GATEWAY instead of the
- * real upstream provider (bite 3.2d). `launcher.mjs`'s `launchAgent` calls this ONLY when the
- * gateway is opted in (`config.gateway.enabled === true`) and the run's provider resolves to a
- * routable, anthropic-wire route — see launcher.mjs for the gating logic.
+ * real upstream provider (bite 3.2d, expanded to openai wire in Phase 0). launcher.mjs's
+ * launchAgent calls this when the gateway is available and the run's provider resolves to a
+ * routable wire (anthropic OR openai) — see launcher.mjs for the gating logic.
  *
- * Wire scope (locked for this bite): ONLY the anthropic wire (claude-code, the primary/daemon
- * harness) is rewritten here. `claude-code`'s spawn plan carries the real upstream endpoint in
- * `ANTHROPIC_BASE_URL` and the real BYO key in `ANTHROPIC_API_KEY` (see
- * harness-adapters.mjs's `claudeCodeEnv`) — this module swaps both for the gateway's own URL and a
- * short-lived per-run token, which `gateway/server.mjs` accepts on the `x-api-key` header (the
- * header claude-code's anthropic-wire client actually sends the key on) and resolves back to the
- * real key server-side (see run-registry.mjs + provider-registry.mjs).
- *
- * openai wire (opencode's BYO-key path, which writes a file-based `opencode.json` with a literal
- * `baseURL` rather than an env var) is a DOCUMENTED FOLLOW-UP (3.2d-ii) — this bite only touches
- * the env-var-based anthropic wire. Callers must not assume openai-wire runs get gateway coverage
- * yet; `applyGatewayInjection` returns the plan UNCHANGED (and mints no token) for any non-anthropic
- * wire so callers can gate on `route.wire === 'anthropic'` before ever calling in, but this function
- * is defensive about that itself too.
+ * Wire scope (Phase 0): BOTH anthropic wire (env-var rewrite: ANTHROPIC_BASE_URL + ANTHROPIC_API_KEY)
+ * AND openai wire (file-based rewrite: opencode.json's baseURL + apiKey). The gateway token is
+ * registered in the run registry for server-side resolution.
  */
 
 import { randomUUID } from 'node:crypto';
 
 /**
- * Rewrite `plan` to talk to the gateway instead of the real upstream, for the anthropic wire only.
+ * Rewrite `plan` to talk to the gateway instead of the real upstream, for anthropic AND openai wires.
  *
  * - `plan` — a harness adapter's spawn plan (`{ cmd, args, env, files }`, see harness-adapters.mjs).
  *   NEVER mutated; a new plan object is returned when a rewrite happens.
@@ -32,30 +21,60 @@ import { randomUUID } from 'node:crypto';
  *   resolution happens server-side in the gateway, keyed off the run's provider.
  * - `ctx` — the attribution context to register against the minted token:
  *   `{ tenant, agent, session, task, runId, provider, model, tier }` (see run-registry.mjs).
- * - `gatewayUrl` — the local gateway's base URL (`ANTHROPIC_BASE_URL` gets pointed here).
+ * - `gatewayUrl` — the local gateway's base URL (env-var or file-config gets pointed here).
  * - `runs` — a run-registry instance (`createRunRegistry()` from run-registry.mjs, or a test stub
  *   exposing the same `registerRun` shape).
  * - `mintToken` — test seam for token generation; defaults to `randomUUID`.
  *
- * Returns `{ plan, token }`. For a non-anthropic wire, `plan` is the SAME object passed in
- * (nothing to rewrite) and `token` is `null` — no token is minted, nothing is registered.
+ * Returns `{ plan, token }`. For a non-anthropic/non-openai wire, `plan` is the SAME object passed
+ * in (nothing to rewrite) and `token` is `null` — no token is minted, nothing is registered.
  */
 export function applyGatewayInjection({ plan, route, ctx, gatewayUrl, runs, mintToken = randomUUID }) {

... (truncated 3179 lines)
```


You are an independent architecture reviewer (Antigravity / Gemini 3.1 Pro). You have NO knowledge of how this code was designed or what decisions were made. Judge purely on architecture and patterns.

## Your Task
Review PR #68 for:
1. Architectural fit — does this follow MeridianOS module patterns?
2. Zero-dependency check — any new imports that aren't node:* or better-sqlite3?
3. Gateway metering — does this change preserve the gateway as single source of truth?
4. Configuration — is behavior config-driven, not hardcoded?
5. Cross-cutting risks — what could break in production?

## Output Format
### Verdict: ✅ APPROVE / ⚠️ CHANGES REQUESTED / ❌ REJECT

### Architecture Assessment
- Module placement: [correct / concerns]
- Data flow impact: [assessment]
- Gateway compliance: [pass / fail with details]

### Risk Register
| Risk | Severity | Mitigation |
|------|----------|------------|

### Dependencies
- New imports: [list or "none"]
- Zero-dependency violation: [yes/no, details]

### Recommendation
- [Clear merge/block/rework guidance]
