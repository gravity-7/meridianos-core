# MeridianOS — Full System Audit & Transformation Plan

> **Audit Date:** 2026-07-27  
> **Scope:** Complete system audit for provider/model agnosticism, end-user configurability, universal gateway monitoring, and IDE traffic observability  
> **Goal:** Transform MeridianOS into a truly provider-agnostic, model-agnostic, universally-monitored autonomous agent orchestration platform

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Diagram Critical Analysis](#2-diagram-critical-analysis)
3. [System Gap Analysis](#3-system-gap-analysis)
4. [Friction Point Analysis](#4-friction-point-analysis)
5. [Phased Transformation Plan](#5-phased-transformation-plan)
   - [Phase 0: Foundation Hardening](#phase-0-foundation-hardening)
   - [Phase 1: Universal Gateway](#phase-1-universal-gateway)
   - [Phase 2: Provider & Model Agnosticism](#phase-2-provider--model-agnosticism)
   - [Phase 3: End-User Configurability](#phase-3-end-user-configurability)
   - [Phase 4: IDE & Platform Traffic Integration](#phase-4-ide--platform-traffic-integration)
   - [Phase 5: Observability & Intelligence](#phase-5-observability--intelligence)
   - [Phase 6: Multi-Tenant Platform](#phase-6-multi-tenant-platform)
6. [Phase Dependency Map](#6-phase-dependency-map)
7. [Risk Register](#7-risk-register)

---

## 1. Executive Summary

MeridianOS has a solid architectural foundation: a provider registry with policy overlay, swappable harness adapters, a gateway sidecar for inline metering/enforcement, and DomainPlugin-based multi-tenancy. However, the system remains **operator-code-bound** — adding a provider requires editing `providers.mjs` in source; new model support requires a code change; the gateway only meters agent-spawned traffic, leaving IDE-based usage invisible; and end-user configuration requires writing JavaScript or YAML by hand.

**The transformation requires 6 phases across ~16 weeks**, sequenced to build on each other. Each phase produces a independently shippable, dogfoodable increment. The plan targets these five strategic outcomes:

1. **Any provider, added in minutes** — wizard-based with auto-discovery, zero code changes
2. **Any model, auto-discovered** — models pulled from provider APIs, refreshed on schedule
3. **Everything configurable by end users** — declarative YAML, interactive CLI wizard, dashboard UI
4. **All traffic monitored through gateway** — agent-spawned AND IDE-driven (VS Code, Claude Cowork/Code, etc.)
5. **Full cost & token observability** — per-provider, per-model, per-agent, per-IDE-session

---

## 2. Diagram Critical Analysis

### 2.1 High-Level Architecture (C4 Context)

**File:** `docs/diagrams/high-level-architecture.md`

| Aspect | Finding | Severity |
|--------|---------|----------|
| **Provider count** | Shows only 4 hardcoded providers (Anthropic, DeepSeek, OpenRouter, Ollama). No Google Gemini native, no AWS Bedrock, no Azure OpenAI, no Together AI, no Groq, no Fireworks. The diagram structurally implies a closed set. | HIGH |
| **Missing: IDE traffic path** | No path from VS Code / Claude Cowork / GitHub Copilot through the gateway. The diagram only shows MeridianOS orchestrating its own agents. A founder using Copilot alongside MeridianOS has zero visibility into that spend. | CRITICAL |
| **Missing: Provider auto-discovery** | No component for discovering providers or models dynamically. The provider box is a static list. | HIGH |
| **Missing: Subscription plan integration** | No path for paid subscription plan users (Claude Pro, GitHub Copilot, Anti-Gravity) to route their plan traffic through the gateway for monitoring. | HIGH |
| **Missing: Model registry** | Models are embedded in provider nodes, not shown as a separate discoverable/refreshable registry. | MEDIUM |
| **Gateway placement** | Gateway is shown inside MeridianOS box — correct for agent traffic but doesn't show it as a universal entry point for ALL LLM traffic. | MEDIUM |
| **Storage: Single ledger** | Shows `ledger.db` but doesn't show how IDE traffic would write to it. | MEDIUM |

**`Why`**: The diagram was drawn when MeridianOS was exclusively an agent orchestrator. The product vision has expanded to "cost governance for ALL AI usage," but the architecture diagram hasn't evolved with it.

**`What`**: The gateway must be repositioned as a **universal forward proxy** that ALL LLM-bound traffic passes through — agent-spawned, IDE-driven, and CLI-ad-hoc alike. The provider set must be shown as extensible, not closed.

**`How`**: Redraw with the gateway as a standalone boundary component. Add "IDE / Editor" as a traffic source alongside the orchestrator. Add a "Provider & Model Registry" component that shows auto-discovery. Add a "Configuration Plane" showing the wizard and dashboard config surfaces.

---

### 2.2 Core Component Relationships (C4 Component)

**File:** `docs/diagrams/component-relationships.md`

| Aspect | Finding | Severity |
|--------|---------|----------|
| **Usage readers still primary** | `usage-readers.mjs` is shown as a cross-cutting concern when the architecture direction (GATEWAY.md) says it should be deprecated in favor of the gateway ledger. This is architecturally misleading. | HIGH |
| **Gateway only in Execution layer** | Gateway is shown only under Execution, implying it only meters agent-spawned traffic. Should be cross-cutting or its own layer. | HIGH |
| **Missing: Provider config layer** | No component for user-defined provider configuration. `providers.mjs` is in Config layer but is a code module, not a user-facing config surface. | HIGH |
| **Missing: Model discovery component** | No component for model auto-discovery or model registry refresh. | HIGH |
| **Missing: Config wizard** | No component for guided setup (F012 exists but isn't reflected). | MEDIUM |
| **Missing: IDE proxy config** | No component for IDE/platform proxy configuration injection. | CRITICAL |
| **Scheduler → Planner → Verifier → Runner → Launcher** | Linear flow is correct but doesn't show the feedback loop through gateway enforcement clearly. | LOW |
| **Data layer: Budget depends on Ledger** | Shows `Budget → Ledger` (correct for gateway path) but also depends on `Usage` readers (legacy path). The dual-path dependency is a friction point. | MEDIUM |

**`Why`**: The component diagram was drawn before the gateway became the strategic core. It reflects the transitional state where both usage readers and gateway ledger coexist.

**`What`**: Remove usage-readers from the primary architecture (demote to legacy/compat). Elevate gateway to a cross-cutting concern. Add provider-auto-discovery, model-registry, and config-wizard components.

**`How`**: Restructure with layers: Configuration Plane (wizard, policy, provider-registry, model-registry), Traffic Plane (gateway as universal proxy), Orchestration Plane (scheduler, planner, launcher — unchanged), Data Plane (ledger as primary, state DB, doc store).

---

### 2.3 Data Model & Storage Architecture

**File:** `docs/diagrams/data-model.md`

| Aspect | Finding | Severity |
|--------|---------|----------|
| **Missing: User-defined providers table** | No schema for storing user-added provider configurations. Currently only code-defined providers exist. | CRITICAL |
| **Missing: Model registry table** | No schema for discovered/configured models per provider. Models are hardcoded in `providers.mjs`. | CRITICAL |
| **Missing: License/entitlement table** | F005 defines a license system but the data model diagram doesn't include it. | HIGH |
| **Missing: IDE session tracking** | No schema for tracking IDE-originated sessions (VS Code, Claude Cowork) separately from agent-spawned runs. | HIGH |
| **Missing: End-user config table** | No schema for user-level configuration (preferences, defaults, saved provider setups). | MEDIUM |
| **Null-is-unknown contract** | Excellent design. Must be preserved and extended to all new tables. | POSITIVE |
| **token_events schema** | Well-designed with tenant labeling. Missing: `source` field (agent vs ide vs cli) to distinguish traffic origin. | MEDIUM |
| **Relationships section** | Only covers task→spend and run→cost. Missing: provider→models, user→config, license→entitlement. | MEDIUM |

**`Why`**: The data model was designed for a single-tenant agent orchestrator. Provider/model/user-config data lived in code and files, not in the database.

**`What`**: Add tables for: `provider_configs` (user-defined providers), `model_registry` (discovered models), `licenses` (license keys and entitlements), `user_config` (end-user preferences). Add `source` field to `token_events`.

**`How`**: Extend `schema.sql` with new tables. Use the same null-is-unknown contract. Add migration support to `db.mjs`. Each new table should have a clear relationship to existing ones documented in the relationships section.

---

### 2.4 Processing Pipeline (C4 Container)

**File:** `docs/diagrams/processing-pipeline.md`

| Aspect | Finding | Severity |
|--------|---------|----------|
| **Hardcoded agent boxes** | Shows Claude, Antigravity, OpenCode as the only agent types. No dynamic agent/harness registration. | HIGH |
| **Gateway is step 5 in linear flow** | Gateway should be a transparent passthrough that agents don't know about, not a numbered step. The diagram implies agents are aware of the gateway. | MEDIUM |
| **Missing: Pre-flight model resolution** | No step showing model auto-discovery or provider capability checking before routing. | MEDIUM |
| **Missing: IDE traffic path** | No pipeline for IDE-originated traffic (VS Code → Gateway → Provider). | CRITICAL |
| **Verifier placement** | Verifier at step 6 is correct for agent loop but doesn't show the gateway enforcement verdict (which happens inline, before the call). Two different "verification" concepts. | LOW |
| **Intake sources** | Only shows ADO, Inbox, Slack, Manual. Missing: Jira, GitHub Issues, Linear, email, generic webhook. | MEDIUM |

**`Why`**: The pipeline diagram is agent-loop-centric. It accurately describes today's flow but doesn't accommodate non-agent traffic.

**`What`**: Add a parallel "IDE/Interactive Traffic" pipeline: IDE → Gateway (transparent proxy) → Provider → Gateway meter → Ledger. Keep the agent pipeline but make gateway a transparent layer underneath rather than a numbered step.

**`How`**: Split into two swimlanes: "Autonomous Agent Pipeline" (existing, refined) and "Interactive/IDE Pipeline" (new). Both converge at the gateway, which writes to the same ledger.

---

### 2.5 Deployment & Infrastructure

**File:** `docs/diagrams/deployment-infrastructure.md`

| Aspect | Finding | Severity |
|--------|---------|----------|
| **Single daemon container** | Shows one daemon for one tenant. Multi-tenant control plane (ADR D3) not reflected. | HIGH |
| **Gateway as separate container** | Gateway is a separate container — correct for L2. But no IDE proxy configuration shown. | MEDIUM |
| **Missing: IDE proxy config** | No mechanism to configure IDEs to route through the gateway container. | CRITICAL |
| **Missing: Control plane** | No supervisor/control-plane container for managing multiple projects. | HIGH |
| **Environment variables flat** | All keys as env vars — correct for BYO-key but doesn't show how subscription-plan users (Claude Pro, Copilot) would integrate. | MEDIUM |
| **Volumes: Only SQLite** | State and ledger as SQLite volumes. Multi-tenant Postgres (ADR D3) not shown as future path. | LOW |

**`Why`**: The deployment diagram matches the current L1/L2 implementation. It doesn't represent the ADR-defined future state.

**`What`**: Add control plane container. Add IDE proxy configuration sidecar or documentation. Add multi-tenant Postgres as future option.

**`How`**: Evolve in Phase 5/6. Not critical for early phases but must be designed before multi-tenant launch.

---

## 3. System Gap Analysis

### 3.1 Provider Agnosticism Gaps

| ID | Gap | Current State | Target State | Impact |
|----|-----|---------------|--------------|--------|
| P1 | **Provider addition requires code** | Adding a provider means editing `providers.mjs` and re-deploying | Wizard-based: provide name, base URL, wire type, API key env var name — saved to config, validated live | Blocks self-service adoption |
| P2 | **Only 2 wire formats** | `anthropic` and `openai` hardcoded in `VALID_WIRES` | Extensible wire registry: `anthropic`, `openai`, `gemini` (native), `generic-http` | Blocks Google Gemini native, other API formats |
| P3 | **No provider capability discovery** | Providers are static descriptors with no runtime capability check | Auto-discover: endpoint health, available models, rate limits, features (streaming, thinking, vision) | Users must manually research provider capabilities |
| P4 | **Provider validation at load-time only** | `validateProviders()` runs once at startup | Runtime health checks, latency monitoring, failover between providers | Silent provider failures possible |
| P5 | **No provider-level policy** | Policy can override provider config but can't define new providers | Complete provider lifecycle in policy: add, configure, enable/disable, set as default | Policy is incomplete as single config surface |

### 3.2 Model Agnosticism Gaps

| ID | Gap | Current State | Target State | Impact |
|----|-----|---------------|--------------|--------|
| M1 | **Models hardcoded per provider** | Each provider's `models` object is manually maintained in `providers.mjs` | Auto-discovered from provider API (`/models` endpoint) with manual override capability | New model releases require code change |
| M2 | **No model refresh mechanism** | Models are static. The DeepSeek v3→v4 migration required manual `providers.mjs` update | Scheduled model refresh from provider APIs; diff-based update with notification | Stale model lists, missed cost savings |
| M3 | **No model capability metadata** | Only model ID string stored — no context window, no feature flags, no training cutoff | Rich model metadata: context window, max output tokens, features (vision, tools, structured output), pricing tier | Router can't make informed decisions |
| M4 | **No model deprecation handling** | Deprecated models stay in config until manually removed | Deprecation detection from provider API; automatic fallback to successor model; warning in dashboard | Agents can silently use deprecated models |
| M5 | **Tiers map to single models** | Each tier → one model ID. No fallback, no A/B testing | Tier → ordered list of candidate models with fallback chain; canary routing for new models | No resilience if a model is unavailable |

### 3.3 Gateway & Monitoring Gaps

| ID | Gap | Current State | Target State | Impact |
|----|-----|---------------|--------------|--------|
| G1 | **Gateway only covers agent-spawned traffic** | `launcher.mjs` optionally injects gateway for anthropic-wire agent runs only | Gateway is universal proxy: agents, IDE plugins, CLI ad-hoc calls all route through it | 80%+ of AI spend potentially unmonitored |
| G2 | **OpenAI-wire launcher injection not built** | `inject.mjs` only handles anthropic wire; opencode gateway routing is documented follow-up | Both wires supported; IDE proxy config for all major editors | OpenCode/DeepSeek/OpenRouter agent traffic unmonitored |
| G3 | **Usage readers still primary** | Per-harness transcript scraping is the default metering path; gateway is opt-in | Gateway ledger is the single source of truth; usage readers demoted to fallback/compat | Dual metering paths = inconsistency, maintenance burden |
| G4 | **No IDE proxy configuration** | No mechanism to configure VS Code, Claude Cowork/Code, or other IDEs to route through gateway | One-click IDE proxy setup; environment variables or settings injection; documented per-IDE guides | IDE users have zero cost visibility |
| G5 | **No real-time spend alerts** | Budget checks are poll-based (watchdog tick); no push notification on threshold crossing | Real-time alerting: Slack, email, webhook when approaching budget cap; configurable thresholds | Budget overruns discovered too late |
| G6 | **Gateway is opt-in by default** | Set `policy.gateway.enabled: true` to activate | Gateway ON by default for all new setups; opt-out for advanced users | Most users won't discover the gateway |
| G7 | **Gateway dashboard basic** | F004 spend dashboard is "Proposed" — not built. Current dashboard shows board state only | Full spend analytics: per-provider, per-model, per-agent, per-task, trend lines, forecasts | No visual spend intelligence |

### 3.4 Configuration & Usability Gaps

| ID | Gap | Current State | Target State | Impact |
|----|-----|---------------|--------------|--------|
| C1 | **No GUI configuration** | All config via YAML files or JS DomainPlugin | Dashboard-based configuration UI; CLI wizard for first-time setup; validation with helpful errors | High barrier to entry |
| C2 | **DomainPlugin requires JavaScript** | Full power config needs a `.mjs` file | 100% declarative config via YAML + dashboard; JS plugin for advanced extensibility only | Non-developers can't configure |
| C3 | **Policy.yaml fragmented** | Some settings in policy.yaml, some in tenant.yaml, some in code | Single unified config surface: everything configurable from one place | Confusion about where to configure what |
| C4 | **No configuration validation feedback** | Invalid config may crash at runtime with cryptic errors | Real-time validation in dashboard and CLI; suggested fixes; config schema with descriptions | Frustrating trial-and-error setup |
| C5 | **No configuration profiles** | One config per tenant | Multiple named profiles (dev, prod, cost-optimized, quality-optimized); switch with one command | Can't easily test different configurations |
| C6 | **Setup wizard scope limited** | F012 defines guided setup but only for basic tenant init | Full wizard: add providers, configure models, set budgets, enable integrations, test connectivity | Initial setup still requires documentation reading |

### 3.5 Multi-Tenant & Platform Gaps

| ID | Gap | Current State | Target State | Impact |
|----|-----|---------------|--------------|--------|
| MT1 | **No project registry** | Each tenant runs as independent process; no supervisor | Control plane manages N projects: start/stop/monitor/update per project | Can't manage multiple projects |
| MT2 | **No shared gateway** | Gateway is per-daemon or standalone; no shared multi-tenant gateway | One gateway instance serves multiple tenants; tenant-labeled ledger for isolation | Resource waste running N gateways |
| MT3 | **DomainPlugin-as-data incomplete** | tenant.yaml supports basic fields; complex config still needs JS | 100% of DomainPlugin expressible as declarative config | Ceiling on what non-devs can configure |
| MT4 | **No project templates** | Every new project starts from scratch | Project templates: "SaaS web app", "Mobile app", "CLI tool", "Library" with pre-configured agents, prompts, categories | Slow project spin-up |

### 3.6 Integration & Ecosystem Gaps

| ID | Gap | Current State | Target State | Impact |
|----|-----|---------------|--------------|--------|
| I1 | **Only ADO connector built** | Azure DevOps is the only working bidirectional connector | Connector library: Jira, GitHub Issues, Linear, Trello, Asana, Notion | Limited to Microsoft ecosystem |
| I2 | **No IDE plugin/extension** | No VS Code extension, no Claude Cowork integration | VS Code extension: shows MeridianOS board, triggers tasks, routes Copilot through gateway; Claude Cowork MCP server | No in-editor experience |
| I3 | **No API for external tools** | Dashboard has ad-hoc endpoints; no stable REST API | Versioned REST API for: tasks CRUD, runs history, spend queries, config management, webhook registration | Can't build custom integrations |
| I4 | **Slack integration partial** | Escalation push to Slack exists; slash commands (F007) not built | Full Slack integration: slash commands, interactive messages, channel notifications, approval flows | Limited team collaboration |

---

## 4. Friction Point Analysis

These are the specific points in the current system where users, operators, or developers experience friction — things that work but are harder than they should be.

### 4.1 Developer/Operator Friction

| FP | Friction Point | Why It Hurts | Root Cause |
|----|---------------|-------------|------------|
| FP1 | **Adding a provider = editing core source** | Must find `providers.mjs`, understand the schema, add entry, validate, restart. Takes 30+ min for something that should be 2 min. | Providers are code, not config |
| FP2 | **New model = code change + pricing refresh** | When DeepSeek released v4, required: update `providers.mjs`, run pricing refresh, verify tests pass, redeploy. | Models hardcoded, no auto-discovery |
| FP3 | **Gateway setup is multi-step and fragile** | Must: set env vars, configure policy.yaml, ensure `gateway.enabled: true`, understand port assignment, check launcher injection. | Gateway is opt-in with many knobs |
| FP4 | **Debugging "why didn't the gateway meter that?"** | Check: is gateway enabled? Is policy right? Is route resolvable? Is it anthropic wire? Did launcher inject? Is token registered? | Too many conditions for gateway to activate |
| FP5 | **Dual metering confusion** | Usage readers show one number, gateway ledger shows another. Which is authoritative? Why do they differ? | Two metering paths active simultaneously |
| FP6 | **Policy vs tenant.yaml vs code** | Setting a model routing rule: is it in policy.yaml `model_routing`? Or `tenant.yaml` `defaultModels`? Or `providers.mjs`? | Three config surfaces with overlapping concerns |
| FP7 | **Testing provider changes requires full restart** | No hot-reload for provider config. Change `providers.mjs` → restart daemon → wait for tick. | Static module loading |
| FP8 | **"Silent fallback" paranoia** | The original bug: Claude Code silently falls back to Anthropic OAuth when `ANTHROPIC_BASE_URL` points elsewhere. Gateway fixes this structurally but only when enabled. | Wire-level auth leakage in harness CLIs |

### 4.2 End-User Friction

| FP | Friction Point | Why It Hurts | Root Cause |
|----|---------------|-------------|------------|
| FP9 | **No answer to "what am I spending?"** | Founder uses Claude Code interactively, MeridianOS runs agents — total monthly bill unknown until credit card statement. | IDE traffic unmonitored |
| FP10 | **"Which model should I use?"** | Model selection is tier-based but tiers are abstract. No guidance: "For your React component task, V4 Flash at $0.14/M is sufficient; you don't need V4 Pro at $0.87/M." | No model recommendation engine |
| FP11 | **Can't easily cap spend** | Budget caps are per-agent token counts. Founder thinks in dollars: "I want to spend max $50/week." Must calculate tokens from dollars manually. | Budget in tokens, not dollars |
| FP12 | **Subscription plan confusion** | Founder pays for Claude Pro ($20/mo) AND DeepSeek API (pay-per-use) AND maybe GitHub Copilot ($10/mo). Can MeridianOS use the Pro subscription? How? | No subscription plan integration |
| FP13 | **Dashboard is localhost-only** | Can only check board from the machine running the daemon. No remote access, no mobile view. | No authentication/remote access layer |

### 4.3 Architectural Friction

| FP | Friction Point | Why It Hurts | Root Cause |
|----|---------------|-------------|------------|
| FP14 | **Launcher knows about gateway** | `launcher.mjs` has gateway injection logic. If gateway API changes, launcher changes. Tight coupling. | Gateway injection lives in launcher, not as transparent proxy |
| FP15 | **Harness adapters know about provider wiring** | `harness-adapters.mjs` has per-provider env var logic (ANTHROPIC_BASE_URL, key injection, tier effort mapping). Adding a provider means updating harness adapters. | Provider wiring concerns leaked into harness layer |
| FP16 | **Gateway has no OpenAI-wire launcher path** | `inject.mjs` only does anthropic wire. opencode agents go UNMETERED through the gateway even when it's running. | Incomplete wire coverage in injection layer |
| FP17 | **Pricing refresh is manual** | `npm run aios:pricing:refresh` must be run by a human. No scheduled auto-refresh. | Pricing refresh is CLI-only, no cron/scheduler integration |
| FP18 | **No provider health monitoring** | If DeepSeek API is down, agents just fail. No circuit breaker, no automatic fallback to another provider. | No provider health abstraction |

---

## 5. Phased Transformation Plan

Each phase is a complete, independently shippable increment. Phases are ordered by dependency: each builds on the previous. Every phase includes **What** (scope), **Why** (rationale), **How** (approach), **Acceptance Criteria** (definition of done), and **Boundaries** (what's explicitly out of scope).

---

### Phase 0: Foundation Hardening

**Duration:** 2 weeks  
**Priority:** P0 — Must ship first  
**Depends on:** Nothing  
**Blocks:** All other phases

#### What This Phase Covers

Phase 0 hardens the existing system so subsequent phases build on a stable, well-tested foundation. It addresses the most critical architectural friction points without adding new features. This phase makes the gateway the **default and primary** metering path, retires the dual-metering confusion, and completes the gateway's wire coverage.

#### Why This Comes First

Subsequent phases assume the gateway is the universal source of truth for all metering. Building provider wizards, IDE integration, or dashboards on top of a system where the gateway is optional and incomplete would compound architectural debt. Phase 0 eliminates the "two sources of truth" problem permanently.

#### Detailed Scope

##### P0.1 — Gateway: Complete OpenAI-Wire Launcher Injection

**Current state:** `gateway/inject.mjs` only rewrites anthropic-wire spawn plans. opencode agents using DeepSeek/OpenRouter bypass the gateway entirely — their usage is only captured post-hoc by `opencode-usage.mjs` scraping.

**Target state:** `inject.mjs` handles both wires. For OpenAI-wire (opencode), the injection rewrites the generated `opencode.json`'s `baseURL` to point at the gateway and injects the gateway token. The opencode harness adapter already generates this file — the injection layer modifies it before the agent spawns.

**Key changes:**
- Extend `applyGatewayInjection` in `inject.mjs` to handle `wire === 'openai'`
- OpenAI-wire injection: modify the `files` array in the spawn plan, rewriting `opencode.json`'s `baseURL` and adding `apiKey` with the gateway token
- Add `openai` wire token auth support in `gateway/server.mjs`'s `buildForwardHeaders`
- Tests: `gateway/tests/inject.test.mjs` — new test cases for openai wire path

**Acceptance criteria:**
- opencode agent run with gateway enabled → traffic routes through gateway → usage appears in ledger
- `listEvents()` shows opencode runs with correct provider/model
- Existing anthropic-wire injection unchanged (byte-identical test)

##### P0.2 — Gateway: Make It the Default Metering Path

**Current state:** Gateway is opt-in (`policy.gateway.enabled: true`). Budget metering reads from usage readers first, ledger second (C9 path in `budget.mjs`).

**Target state:** When gateway is available and running, the ledger is the **primary and preferred** metering source. Usage readers demoted to fallback (used only when gateway is off or a run predates gateway enablement). Gateway auto-starts with the daemon unless explicitly disabled.

**Key changes:**
- In `budget.mjs`: reverse the metering priority — try `ledgerWindowUsage()` first, fall back to transcript/protobuf readers
- In `scheduler.mjs`: `maybeStartGateway` always runs (was gated on `policy.gateway.enabled === true`). Policy flag changes to `policy.gateway.disabled: true` to opt OUT
- In `launcher.mjs`: gateway injection always attempted for routable providers (was gated on `config.gateway.enabled === true`). Remove the `enabled` gate; gateway availability is determined by `config.gateway.url` presence
- Add `gatewayActive` flag to `config.gateway` — set by successful `assembleGateway`, checked by launcher
- Update all tests that assumed gateway-off default

**Acceptance criteria:**
- Fresh `createAios` + `start()` → gateway auto-starts → agents route through it → ledger populated
- Setting `policy.gateway.disabled: true` → gateway doesn't start → usage readers used instead
- Existing tests pass with updated defaults
- Gateway startup failure → daemon logs warning, continues with usage-reader fallback (graceful degradation, not crash)

##### P0.3 — Unify Policy & Tenant Configuration

**Current state:** Three config surfaces: `policy.yaml` (budget, routing, gateway), `tenant.yaml` (agents, prompts, domain), `providers.mjs` (provider code defaults). Users must know which setting goes where.

**Target state:** `policy.yaml` becomes the single user-facing config file. `tenant.yaml` is deprecated — its fields merge into `policy.yaml`. `providers.mjs` remains as code-level defaults but policy can fully override and extend it. The config loader merges all sources with clear precedence: policy > env vars > code defaults.

**Key changes:**
- Extend `policy.yaml` schema to include all `tenant.yaml` fields (`agents`, `prompts`, `guardrailCheck`, `boardTitle`, `riskToAction`, `knownRiskTags`, `budgetMeter`, `defaultModels`, `agentHarness`, `taskCategories`, `tagToCategory`, `mcpServers`, `cliPath`)
- Update `loadPolicy()` to merge tenant fields into the policy object
- Update `resolveDomain()` to read agent roster from policy when tenant.yaml absent
- Keep backward compat: `tenant.yaml` still works, but a deprecation warning is logged
- Add `policy-validate.mjs` schema for the unified policy with field descriptions and types
- Tests: ensure both old (tenant.yaml) and new (unified policy.yaml) paths work

**Acceptance criteria:**
- Single `policy.yaml` can define everything needed to boot a tenant (agents, prompts, budget, routing, providers)
- Old `tenant.yaml` still works with deprecation warning
- `validatePolicy()` catches invalid unified config with helpful error messages

##### P0.4 — Gateway: Add `source` Field to Token Events

**Current state:** `token_events` table has no distinction between agent-spawned traffic and other sources (because there were no other sources).

**Target state:** `token_events` gains a `source` column with values: `agent` (autonomous agent run), `ide` (IDE/editor traffic), `cli` (ad-hoc CLI usage), `api` (direct API calls). This enables Phase 4's IDE integration and Phase 5's dashboards to slice by traffic source.

**Key changes:**
- Add `source TEXT NOT NULL DEFAULT 'agent'` to `token_events` in `gateway/ledger-schema.sql`
- Update `makeTokenEvent()` to accept and store `source`
- Update `server.mjs` to pass `source` from run context (run-registry entry)
- Update `listEvents()` / `queryWindow()` to include `source` in results
- Migration: existing rows default to `'agent'` (correct — all existing traffic is agent-spawned)
- Tests: verify `source` field in token events

**Acceptance criteria:**
- New token events have `source` field populated
- Existing ledger rows have `source = 'agent'` after migration
- `listEvents()` returns `source` in results

##### P0.5 — Provider Health Checks

**Current state:** No provider health monitoring. Agent runs fail with opaque errors when a provider is down.

**Target state:** Gateway performs periodic health checks against configured providers. Results are queryable. Router can skip unhealthy providers. Dashboard shows provider status.

**Key changes:**
- Add `provider-health.mjs`: `checkProviderHealth(descriptor)` → `{ ok, latencyMs, error? }`
- Health check: simple models list request (lightweight) with 5s timeout
- Add `health` field to provider registry entries (in-memory only, not persisted)
- Add health check loop to gateway (`gateway/index.mjs`) — every 60s
- Add `GET /api/providers` to dashboard showing health status
- Tests: health check with mock HTTP server

**Acceptance criteria:**
- Gateway periodically checks each configured provider
- Dashboard shows provider status (green/yellow/red)
- Router considers health status when selecting provider (Phase 2 will use this)

#### Phase 0 Boundaries

- Does NOT add new providers — only hardens existing ones
- Does NOT add model auto-discovery — only prepares the schema
- Does NOT change the dashboard UI significantly
- Does NOT add IDE proxy support
- Does NOT remove `tenant.yaml` — only deprecates it with warning

---

### Phase 1: Universal Gateway

**Duration:** 3 weeks  
**Priority:** P0 — Critical path  
**Depends on:** Phase 0  
**Blocks:** Phases 2, 3, 4, 5

#### What This Phase Covers

Phase 1 transforms the gateway from an agent-only sidecar into a **universal forward proxy** that ALL LLM-bound traffic can route through. This is the architectural lynchpin: once the gateway is universal, every subsequent phase (provider wizards, IDE integration, dashboards) has a single, reliable metering source to build on.

#### Why This Comes Second

Phase 0 made the gateway the default for agent traffic. Phase 1 makes it available for ALL traffic. Until the gateway can meter arbitrary HTTP requests to any LLM provider, we can't integrate IDE traffic (Phase 4) or build comprehensive dashboards (Phase 5). Every monitoring and observability feature depends on the gateway being the universal entry point.

#### Detailed Scope

##### P1.1 — Standalone Gateway: Zero-Config Bootstrap

**Current state:** Gateway requires assembly (`assembleGateway`) with config, policy, and provider registry. The standalone CLI (`gateway/cli.mjs`) exists but requires explicit `--provider` and `--model` flags.

**Target state:** `npx meridian-gateway` without any flags boots a working gateway. It auto-discovers configured providers from env vars (any `*_KEY` env var → potential provider), offers interactive first-run setup if none found, and provides a dashboard URL with setup instructions.

**Key changes:**
- Auto-detect providers from environment: scan `process.env` for known key patterns (`*_API_KEY`, `*_KEY`)
- Interactive first-run mode: if no providers detected, prompt user to configure one
- Print clear startup message: "Gateway listening at http://127.0.0.1:8787 — point your agents/tools here"
- Generate a default `policy.yaml` if none exists
- Add `--init` flag for non-interactive default setup
- Tests: standalone gateway boot with zero config, with env vars, with --init

**Acceptance criteria:**
- `npx meridian-gateway` boots without arguments
- Auto-detects `DEEPSEEK_KEY` from env and configures DeepSeek route
- Prints clear getting-started instructions
- Gateway meters traffic immediately

##### P1.2 — Generic HTTP Provider Support

**Current state:** `VALID_WIRES` is `['anthropic', 'openai']`. No support for providers with different API formats.

**Target state:** New wire type `generic-http` that can forward to any HTTP endpoint. Metering is best-effort: parse known response formats (Anthropic, OpenAI), fall back to "metered but unknown token count" for unrecognized formats. This unlocks ANY provider.

**Key changes:**
- Add `generic-http` to `VALID_WIRES`
- In `gateway/server.mjs`: for `generic-http` wire, forward request as-is (pass through headers, body unchanged)
- Add response inspection: attempt to parse as Anthropic JSON, then OpenAI JSON, then log unknown format
- For unknown formats: emit token event with `null` usage but non-null `costUsd: null` — metering is honest about what it doesn't know
- Add `forward_headers` and `forward_body_template` options to provider config for advanced generic setup
- Tests: generic provider forwarding, unknown format handling

**Acceptance criteria:**
- Any HTTP endpoint can be registered as a provider via policy
- Requests are forwarded correctly (method, headers, body preserved)
- Known response formats (Anthropic, OpenAI) are metered
- Unknown formats produce honest `null` usage events (never fabricated zeros)

##### P1.3 — Gateway Auth: Multi-Key Management

**Current state:** Gateway reads a single key per provider from `process.env[route.keyEnv]`. Only BYO-key model supported.

**Target state:** Gateway supports multiple auth modes per provider: `env-var` (current), `oauth-token` (for subscription plan users), `api-key` (static key in config — not recommended but supported for testing). Multiple keys per provider with rotation.

**Key changes:**
- Add `auth` object to provider config with `mode: 'env' | 'oauth' | 'static'`
- For `oauth` mode: support bearer token from OAuth flow (e.g., Claude Pro session token)
- For `static` mode: key in config (with clear security warning)
- Add key rotation: `keyEnv` can be a comma-separated list; gateway round-robins or fails over
- Add key health: track which keys are working, skip failed ones
- Tests: multi-key, key rotation, auth mode switching

**Acceptance criteria:**
- Provider configured with multiple keys → gateway uses healthy ones
- OAuth token mode accepts bearer tokens from Claude/Copilot sessions
- Failed key → gateway skips it, tries next key, logs warning

##### P1.4 — Gateway: Request/Response Logging & Replay

**Current state:** Gateway logs token events (usage + cost) but not full request/response bodies. Debugging a failed call requires reproducing it.

**Target state:** Optional full request/response logging (configurable, off by default for privacy). Logged to separate append-only store. Replay capability for debugging: replay a stored request against current provider config.

**Key changes:**
- Add `gateway/logging.mjs`: request/response logger with configurable retention
- Policy flag: `gateway.logging.enabled` (default `false`), `gateway.logging.retention_days` (default `7`)
- Store in separate SQLite table: `request_logs(id, ts, provider, method, path, request_headers, request_body, response_status, response_headers, response_body, duration_ms)`
- Redact `authorization` and `x-api-key` headers before storage
- Add `POST /api/gateway/replay/:requestId` for debugging
- Tests: logging on/off, redaction, replay

**Acceptance criteria:**
- Full request/response logging when enabled
- Sensitive headers redacted
- Replay capability for debugging
- Logs pruned after retention period

##### P1.5 — Cross-Wire Translation (Anthropic ↔ OpenAI)

**Current state:** Gateway preserves wire format. A claude-code harness speaking Anthropic wire can only talk to Anthropic-wire endpoints. DeepSeek's dual-wire support is the exception that proves the rule.

**Target state:** Gateway can translate Anthropic-format requests to OpenAI-format and vice versa. This means ANY harness can talk to ANY provider, regardless of wire format. This is the ultimate provider-agnostic enabler.

**Key changes:**
- Add `gateway/translate.mjs`: `anthropicToOpenai(request)` and `openaiToAnthropic(request)` 
- Request translation: map messages, system prompt, tools, stop sequences between formats
- Response translation: map usage blocks, content blocks, tool calls back to original wire
- Streaming translation: more complex — buffer and translate SSE events
- Configurable per-route: `route.translate: true` enables translation for that route
- Phase 1 delivers non-streaming translation only; streaming is a documented follow-up
- Tests: round-trip translation for common request patterns

**Acceptance criteria:**
- Claude Code (Anthropic wire) → OpenAI-only provider → translated request sent → translated response returned → metered correctly
- OpenCode (OpenAI wire) → Anthropic-only provider → same
- Usage extraction works through translation layer
- Streaming requests pass through untranslated (graceful degradation)

#### Phase 1 Boundaries

- Does NOT add GUI configuration — Phase 3
- Does NOT add IDE proxy setup automation — Phase 4
- Does NOT build advanced dashboards — Phase 5
- Streaming cross-wire translation is deferred (non-streaming only)
- OAuth flow automation (browser-based login) is deferred

---

### Phase 2: Provider & Model Agnosticism

**Duration:** 3 weeks  
**Priority:** P0 — Core product requirement  
**Depends on:** Phase 1  
**Blocks:** Phases 3, 4, 5

#### What This Phase Covers

Phase 2 delivers the core promise: **any provider, any model, added without code changes**. It builds the Provider Wizard, the Model Auto-Discovery system, and the declarative provider registry that makes `providers.mjs` a fallback default rather than the only way to add a provider.

#### Why This Comes Third

Phase 1 made the gateway universal — any HTTP endpoint can be proxied and metered. Phase 2 makes it easy to ADD those endpoints. The wizard and auto-discovery depend on the generic HTTP support and multi-auth from Phase 1. Without Phase 1's foundation, the wizard would only support the 2 wire formats that already exist.

#### Detailed Scope

##### P2.1 — Declarative Provider Registry (Config-Driven)

**Current state:** `PROVIDERS` in `providers.mjs` is a JavaScript object — the only way to define a provider. Policy can override fields but can't add new providers.

**Target state:** Providers are fully definable in `policy.yaml`. `providers.mjs` becomes a set of curated defaults that ship with the product. Users add providers in YAML or via wizard. The resolved registry merges both: user-defined providers + code defaults, with user config winning on conflict.

**Key changes:**
- Extend `policy.yaml` schema: `providers.<name>` with full descriptor shape (name, baseUrl, anthropicBaseUrl, wire, keyEnv, auth, models, harnesses, thinking, headers, features)
- Update `resolveProvider()` to look up user-defined providers from policy when not found in code registry
- Add `policy-validate.mjs` provider schema validation with helpful errors
- Move default provider models to `pricing.json` as reference; `providers.mjs` models become defaults overridable in policy
- Add `provider-conformance.mjs`: validates a user-defined provider by making a test call (optional, opt-in)
- Tests: user-defined provider resolution, validation, conformance check

**Acceptance criteria:**
- Add a new provider entirely in `policy.yaml` → MeridianOS routes to it
- Provider validation catches: missing baseUrl for non-native, invalid wire type, missing keyEnv for non-native
- User provider with same name as built-in → user config wins (override)
- Conformance test: "Test Connection" button validates provider works

##### P2.2 — Provider Configuration Wizard (CLI + Dashboard)

**Current state:** No wizard for adding providers. Must edit code or YAML manually.

**Target state:** Interactive wizard that guides users through adding a provider. Two interfaces: CLI (`node cli.mjs provider add`) and Dashboard UI (form with validation). Both produce the same `policy.yaml` output.

**Key changes:**
- Add `provider-wizard.mjs` with CLI interface:
  - Step 1: "What's the provider name?" (slug, e.g., `groq`)
  - Step 2: "What API format?" (detect from base URL or manual select: OpenAI-compatible, Anthropic-compatible, Google Gemini, Generic HTTP)
  - Step 3: "What's the base URL?" (auto-suggest from known providers list)
  - Step 4: "API key env var name?" (e.g., `GROQ_API_KEY`)
  - Step 5: "Test connection?" (optional conformance check)
  - Step 6: "Enable any features?" (thinking/reasoning, vision, streaming)
  - Summary → confirm → write to policy.yaml
- Dashboard UI: same flow as form in `dashboard/index.html`
- Known providers database: curated list of 30+ providers with pre-filled URLs, wire types, features — shipped as JSON in the package
- Auto-detect mode: `node cli.mjs provider add --auto` scans env for `*_API_KEY` variables and auto-configures matching providers
- Tests: CLI wizard interaction, dashboard form submission, auto-detect

**Acceptance criteria:**
- `node cli.mjs provider add` → interactive wizard → provider added to policy.yaml
- Dashboard: "Add Provider" button → form → validation → saved
- `--auto` flag detects `GROQ_API_KEY` in env and configures Groq provider
- Known providers list covers Anthropic, DeepSeek, OpenRouter, OpenAI, Groq, Together, Fireworks, AWS Bedrock, Azure OpenAI, Google Gemini, Mistral, Cohere, Perplexity, xAI

##### P2.3 — Model Auto-Discovery & Registry

**Current state:** Models are hardcoded strings in `providers.mjs`. When a provider releases a new model, someone must manually update the code.

**Target state:** Models are auto-discovered from provider APIs where available (`/models` endpoint for OpenAI-compatible, `/v1/models` for others). Discovered models populate a local registry. Users can pin specific models or set policies ("always use latest"). Manual model override always available.

**Key changes:**
- Add `model-registry.mjs`:
  - `discoverModels(provider)` → fetches model list from provider's API
  - `refreshModelRegistry(policy, config)` → updates all providers' model lists
  - `resolveModel(provider, modelId)` → looks up model metadata
  - Discovery strategies: `openai-list` (GET /models), `anthropic-list` (if available), `models.dev` (fallback)
- Model metadata schema: `{ id, name, contextWindow, maxOutputTokens, features: {vision, tools, streaming, thinking, structuredOutput}, pricing: {inputPerM, outputPerM, cachedInputPerM}, Deprecated, deprecatedAt, successorModel }`
- Store in `model_registry` SQLite table (or JSON file for simplicity)
- Scheduled refresh: every 24h by default, configurable in policy
- Tier mapping: auto-assign discovered models to complexity tiers based on capability heuristics (context window size, pricing, known benchmarks) — user can override
- Dashboard: model list view with metadata, deprecation warnings, pricing
- Tests: discovery from mock OpenAI endpoint, tier mapping logic, refresh scheduling

**Acceptance criteria:**
- `node cli.mjs models refresh` → pulls latest models from all configured providers
- New model discovered → appears in dashboard model list → can be assigned to a tier
- Deprecated model detected → warning in dashboard → auto-fallback to successor
- Model metadata (context window, features) visible in dashboard
- Discovery failure → existing models unchanged, error logged

##### P2.4 — Tier-Based Model Routing with Fallback Chains

**Current state:** Each tier → exactly one model per provider. If that model is unavailable, the call fails. No A/B testing.

**Target state:** Each tier → ordered list of candidate models. Router tries the first, falls back to the next on failure. Supports canary routing: 10% of traffic to new model, 90% to current. Policy-driven.

**Key changes:**
- Extend `model_routing` in policy.yaml: tiers can specify arrays
  ```yaml
  model_routing:
    claude:
      medium:
        - model: deepseek-v4-flash
          weight: 90
        - model: deepseek-v4-pro  # canary
          weight: 10
  ```
- Update `routeModel()` to handle array form, select model by weight
- Add fallback logic: if primary model call fails (gateway returns 5xx or timeout), retry with next model in chain
- Add `model-fallback.mjs`: tracks per-model failure rates, temporarily disables flapping models
- Tests: weighted routing, fallback chain, flapping detection

**Acceptance criteria:**
- Tier configured with `[model-a, model-b]` → traffic split by weight
- Primary model fails → automatic fallback to next model
- Model has >50% failure rate → temporarily removed from rotation → auto-reinstated after recovery

#### Phase 2 Boundaries

- Does NOT build cost optimization engine (Phase 5)
- Does NOT integrate IDE traffic (Phase 4)
- Model auto-discovery is best-effort: providers without `/models` endpoints rely on models.dev fallback or manual entry
- Tier auto-assignment is heuristic — manual override expected for production

---

### Phase 3: End-User Configurability

**Duration:** 2 weeks  
**Priority:** P1 — Adoption blocker  
**Depends on:** Phase 2  
**Blocks:** Phases 4, 5

#### What This Phase Covers

Phase 3 makes MeridianOS configurable by non-developers. Every setting that currently requires YAML editing or JavaScript coding gets a dashboard UI and a validated CLI path. The DomainPlugin-as-JavaScript path remains for advanced extensibility, but it's no longer required for any standard configuration.

#### Why This Comes Fourth

Phase 2 made providers and models declarative. Phase 3 builds the UI on top of that declarative foundation. Until providers and models can be expressed as data (Phase 2), there's nothing for the configuration UI to write.

#### Detailed Scope

##### P3.1 — Unified Configuration Dashboard

**Current state:** Dashboard at `:4317` shows board status and basic actions. Configuration requires editing YAML files by hand.

**Target state:** Dashboard has a "Settings" section where ALL configuration is visible, editable, and validated in real-time. Changes are written to `policy.yaml` with version history.

**Key changes:**
- Add Settings panel to `dashboard/index.html`:
  - **General:** board title, cadence, worktree root, feature paths
  - **Agents:** roster, harness assignments, default models per agent
  - **Providers:** list, add, edit, test, enable/disable
  - **Models:** per-provider model list, tier assignments, deprecation status
  - **Budget:** per-agent caps (in dollars AND tokens), warning thresholds, kill switch
  - **Routing:** tier→model mapping, role-based routing, fallback chains
  - **Gateway:** port, logging, enforcement mode, thinking injection
  - **Integrations:** ADO, Slack, Jira (configure, test, enable/disable)
  - **Prompts:** domain governance rules editor
- Real-time validation: red border on invalid fields, error messages, save disabled until valid
- "Apply" writes to `policy.yaml`, triggers hot-reload where supported
- Configuration version history: each save creates a `policy.backup.<timestamp>.yaml`
- Dashboard API endpoints: `GET /api/config`, `PUT /api/config` (validated), `POST /api/config/test-provider`
- Tests: config CRUD API, validation, backup creation

**Acceptance criteria:**
- All configuration visible and editable in dashboard
- Invalid config prevented from saving with clear error messages
- Configuration changes take effect (hot-reload for providers, restart prompt for structural changes)
- Backups created on each save

##### P3.2 — Interactive Setup Wizard v2

**Current state:** F012 defines a basic CLI setup wizard (`setup.mjs`). It asks 3-5 questions and creates starter files.

**Target state:** Comprehensive setup wizard that takes a user from zero to running in under 5 minutes. Covers: project setup, provider configuration, agent roster, budget caps, and a test run.

**Key changes:**
- Extend `setup.mjs` with full flow:
  1. **Welcome:** "Let's set up MeridianOS. I'll ask a few questions."
  2. **Project:** name, board title, repository path
  3. **Providers:** auto-detect from env vars, offer to add more
  4. **Models:** for each provider, select which models to use per tier (intelligent defaults)
  5. **Agents:** how many? names? which harness per agent? (intelligent defaults: builder + reviewer)
  6. **Budget:** "What's your monthly AI budget?" → auto-calculate per-agent caps
  7. **Integrations:** ADO? Slack? Jira? (detect from env vars)
  8. **Review:** summary of all choices → confirm → write config
  9. **Test:** "Want to run a test task to verify everything works?"
  10. **Done:** "Your daemon is running at localhost:4317"
- Non-interactive mode: `node cli.mjs setup --init --providers deepseek --budget 50` for CI/automation
- Resume support: `node cli.mjs setup --resume` picks up where left off
- Tests: full wizard flow, non-interactive mode, resume

**Acceptance criteria:**
- First-time user completes setup in <5 minutes
- Wizard auto-detects existing env vars and pre-fills configuration
- Setup produces a working `policy.yaml`
- Test run succeeds (or clear error if provider unreachable)

##### P3.3 — Configuration Profiles

**Current state:** One configuration per tenant.

**Target state:** Named configuration profiles: `dev` (cheap models, lenient budget), `prod` (quality models, strict budget), `cost-optimized` (cheapest viable models), `quality` (best models regardless of cost). Switch with `--profile` flag or dashboard dropdown.

**Key changes:**
- Profile storage: `policy.profiles.<name>` in policy.yaml, or separate `profiles/<name>.yaml` files
- CLI: `node cli.mjs start --profile dev`
- Dashboard: profile selector dropdown, "Create Profile", "Duplicate Profile"
- Profile inheritance: `prod` extends `base` profile with overrides
- Tests: profile switching, inheritance

**Acceptance criteria:**
- Switch profile → models, budget, routing change accordingly
- Create profile from existing → all settings copied
- Inherited profile: override one setting, rest from parent

#### Phase 3 Boundaries

- Does NOT build mobile app or remote access (Phase 6)
- Does NOT build team collaboration features (Phase 6)
- Dashboard is still localhost-only (remote access in Phase 6)
- Hot-reload is limited to providers, models, and routing — structural changes still require restart

---

### Phase 4: IDE & Platform Traffic Integration

**Duration:** 3 weeks  
**Priority:** P0 — Product differentiator  
**Depends on:** Phase 1, Phase 3  
**Blocks:** Phase 5

#### What This Phase Covers

Phase 4 is the **strategic wedge**: making ALL LLM traffic — not just agent-spawned — visible and governed through the MeridianOS gateway. This covers VS Code with GitHub Copilot, Claude Cowork/Code, Cursor, Windsurf, and any other AI-enabled IDE. When a founder uses Copilot alongside MeridianOS agents, both show up in the same dashboard with the same cost tracking.

#### Why This Comes Fifth

Phase 1 made the gateway a universal HTTP proxy. Phase 3 built the configuration UI. Phase 4 uses both: the gateway is ready to accept arbitrary traffic, and users can configure their IDE proxy settings through the dashboard. Without Phase 1, the gateway couldn't handle arbitrary traffic. Without Phase 3, users couldn't configure IDE integration easily.

#### Detailed Scope

##### P4.1 — IDE Proxy Configuration Generator

**Current state:** No mechanism to route IDE traffic through the gateway.

**Target state:** Dashboard generates per-IDE proxy configuration instructions and, where possible, auto-applies them. One-click setup for supported IDEs.

**Key changes:**
- Add `ide-proxy.mjs`:
  - `generateProxyConfig(ide, gatewayUrl, token)` → IDE-specific configuration
  - Supported IDEs v1: VS Code (settings.json), Claude Code (environment variables), Cursor (settings.json), Windsurf (settings.json)
  - For VS Code/GitHub Copilot: generate proxy config for Copilot's HTTP client
  - For Claude Cowork/Code: generate `ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY` env setup
- Dashboard: "Connect Your IDE" page with per-IDE cards:
  - VS Code: "Copy these 3 lines to your settings.json" with copy button
  - Claude Code: "Run this command in your terminal" with copy button
  - Cursor/Windsurf: same as VS Code
  - Generic: "Set these environment variables" for any tool
- Auto-detect installed IDEs and show relevant instructions
- Test connectivity: "Send a test request to verify your IDE is routing through MeridianOS"
- Tests: config generation for each IDE type, auto-detect

**Acceptance criteria:**
- Dashboard shows IDE-specific setup instructions
- VS Code settings.json snippet correctly routes Copilot traffic through gateway
- Claude Code env vars correctly route interactive sessions through gateway
- Test button verifies IDE→gateway→provider connectivity

##### P4.2 — VS Code Extension (MeridianOS Sidebar)

**Current state:** No VS Code integration. Users switch between editor and dashboard browser tab.

**Target state:** A VS Code extension that provides: sidebar with MeridianOS board view, task creation from editor selection, one-click "route my Copilot through MeridianOS," and spend indicator in status bar.

**Key changes:**
- Create `vscode-extension/` package:
  - **Sidebar:** tree view of MeridianOS board (tasks by status, agent assignments)
  - **Status bar:** current spend this session, total spend this week, gateway connection status
  - **Commands:**
    - `MeridianOS: Create Task from Selection` — selected code/text → new task
    - `MeridianOS: Route Copilot Through Gateway` — one-click proxy setup
    - `MeridianOS: Open Dashboard` — opens `:4317` in browser
    - `MeridianOS: Toggle Gateway` — enable/disable proxy routing
  - **Configuration:** extension reads `policy.yaml` for gateway URL; settings for auto-start
  - **Copilot integration:** modify Copilot's HTTP client proxy settings to route through gateway
- Package as `.vsix` for easy install
- Publish to VS Code Marketplace (or provide manual install instructions)
- Tests: extension activation, sidebar rendering, command execution

**Acceptance criteria:**
- VS Code extension installs and activates
- Sidebar shows MeridianOS board with task statuses
- "Route Copilot Through Gateway" configures proxy correctly
- Status bar shows current spend
- Creating a task from selection works

##### P4.3 — Claude Cowork/Code MCP Integration

**Current state:** MeridianOS can spawn Claude Code as an agent harness. No integration for interactive Claude Code usage.

**Target state:** An MCP (Model Context Protocol) server that Claude Cowork/Code can connect to. Provides: task board access, spend visibility, and automatic gateway routing for the Claude session.

**Key changes:**
- Create MCP server as part of MeridianOS core:
  - Tools exposed to Claude:
    - `meridian_list_tasks` — list board tasks with filters
    - `meridian_create_task` — create a new task on the board
    - `meridian_get_spend` — get current spend for this session/week/month
    - `meridian_get_budget` — get budget status
  - Automatic gateway routing: MCP server configures Claude's API base URL to route through gateway
- Setup: dashboard provides MCP server config snippet for Claude's `.mcp.json`
- Configuration: dashboard → "Connect Claude Cowork" → copy JSON → paste into `.mcp.json`
- Tests: MCP server tool execution, gateway routing through MCP config

**Acceptance criteria:**
- Claude Cowork connected to MeridianOS MCP → can query board and spend
- Claude's API calls route through MeridianOS gateway automatically
- MCP server config snippet copyable from dashboard

##### P4.4 — GitHub Copilot Traffic Monitoring

**Current state:** No visibility into GitHub Copilot usage or cost.

**Target state:** Via the VS Code extension (P4.2), Copilot's HTTP traffic routes through the MeridianOS gateway. Token usage and estimated cost appear in the MeridianOS dashboard alongside agent traffic.

**Key changes:**
- Research Copilot's HTTP client implementation in VS Code to determine proxy configuration points
- If Copilot uses `http_proxy`/`https_proxy` env vars: document and auto-configure
- If Copilot has settings-based proxy: configure via VS Code settings API
- If Copilot uses a custom HTTP client: document limitation and workaround
- Token extraction: Copilot's API response format may differ from standard OpenAI — add parser
- Cost computation: use Copilot's known pricing or models.dev data for Copilot models
- Privacy note: Copilot code context sent to provider — dashboard clearly states this
- Tests: proxy configuration, token parsing for Copilot format

**Acceptance criteria:**
- Copilot traffic appears in MeridianOS ledger with `source: 'ide'`
- Copilot token usage and cost visible in dashboard
- Proxy setup documented and automatable where possible
- Clear privacy disclosure in dashboard

##### P4.5 — Subscription Plan Integration (BYO-Plan)

**Current state:** Only BYO-key model supported. Users with Claude Pro, GitHub Copilot, or Anti-Gravity subscriptions can't use those entitlements through MeridianOS.

**Target state:** MeridianOS can leverage existing subscriptions where technically feasible. For Claude Pro: session token extraction (documented, user-performed). For Copilot: proxy through existing Copilot auth. For Anti-Gravity: native Gemini auth passthrough. Clear documentation for each plan type.

**Key changes:**
- Add `auth.mode: 'oauth'` support (Phase 1.3 groundwork)
- Claude Pro: document how to extract session token from Claude CLI's auth store for gateway use
- GitHub Copilot: document how Copilot's auth token can be used through gateway (or proxy existing auth)
- Anti-Gravity: AGY CLI's own auth is already used — gateway passthrough preserves it
- Dashboard: "Subscription Plans" section with per-plan setup guides
- Clear legal note: "Ensure your subscription terms allow this usage"
- Tests: oauth token auth flow

**Acceptance criteria:**
- Claude Pro subscription usable through MeridianOS gateway (user provides session token)
- Copilot subscription traffic routable through gateway
- Dashboard shows subscription plan usage alongside BYO-key usage
- Legal disclaimer displayed

#### Phase 4 Boundaries

- Does NOT build a full OAuth PKCE flow for browser-based login (future)
- Does NOT reverse-engineer or bypass any provider's auth (user must provide tokens)
- VS Code extension is sidebar + status bar only — not a full IDE replacement
- Copilot traffic monitoring is limited to what VS Code's extension API allows

---

### Phase 5: Observability & Intelligence

**Duration:** 3 weeks  
**Priority:** P1 — Product completeness  
**Depends on:** Phase 4  
**Blocks:** Phase 6

#### What This Phase Covers

Phase 5 delivers the spend intelligence layer: comprehensive dashboards, cost analytics, budget forecasting, model cost optimization recommendations, and real-time alerting. This is what turns MeridianOS from a "metering tool" into an "AI cost intelligence platform."

#### Why This Comes Sixth

Phase 4 integrated IDE traffic — now ALL LLM usage flows through the gateway. Phase 5 builds the analytics on top of that complete data. Building dashboards before all traffic sources are integrated would mean incomplete data and misleading insights.

#### Detailed Scope

##### P5.1 — Spend Analytics Dashboard v1

**Current state:** F004 (Gateway Spend Dashboard) is "Proposed" — not built. Current dashboard shows board state only.

**Target state:** Full spend analytics dashboard with: overview KPIs, per-provider breakdown, per-model breakdown, per-agent breakdown, per-IDE-session breakdown, historical trends, and export capability.

**Key changes:**
- Build `dashboard/spend.js` module with API endpoints:
  - `GET /api/spend/overview?range=7d|30d|90d` → total cost, total tokens, call count, deny count, active sources
  - `GET /api/spend/by-provider?range=...` → per-provider cost, tokens, calls
  - `GET /api/spend/by-model?range=...` → per-model breakdown
  - `GET /api/spend/by-agent?range=...` → per-agent breakdown
  - `GET /api/spend/by-source?range=...` → per-source (agent/ide/cli) breakdown
  - `GET /api/spend/timeline?range=...&granularity=hour|day|week` → time-series data for charts
  - `GET /api/spend/export?range=...&format=csv|json` → data export
- Dashboard UI panels:
  - **Overview cards:** Total Spend (USD), Total Tokens, Call Count, Active Providers, Deny Events
  - **Spend over time:** line chart (last 7/30/90 days)
  - **Provider breakdown:** pie chart + table — cost by provider
  - **Model breakdown:** bar chart — cost by model within each provider
  - **Agent breakdown:** table — per-agent cost, tokens, runs, avg cost/run
  - **Source breakdown:** stacked bar — agent vs IDE vs CLI spend
  - **Recent events:** scrollable table of recent token events
- Vanilla JS charts using Canvas API (no chart library dependency) or lightweight Chart.js
- Auto-refresh every 30 seconds
- Tests: all spend API endpoints, dashboard rendering

**Acceptance criteria:**
- Dashboard shows complete spend picture across all sources
- Time range selector works (7d/30d/90d)
- Charts render correctly with real data
- CSV/JSON export produces valid files
- Dashboard loads in <2 seconds with 10,000+ events

##### P5.2 — Budget Intelligence & Forecasting

**Current state:** Budget is a hard cap: 5h and weekly token limits. No forecasting, no "will I exceed my budget?" prediction.

**Target state:** Budget dashboard shows: current spend vs cap, projected spend at current rate, "days until cap at current burn rate," anomaly detection (unusual spend spike), and budget recommendations.

**Key changes:**
- Add `budget-intelligence.mjs`:
  - `projectSpend(ledgerEvents, windowMs)` → projected spend based on linear regression of recent usage
  - `detectAnomalies(ledgerEvents)` → flag days/spikes where spend is 2σ above mean
  - `recommendBudget(ledgerEvents, targetUtilization)` → suggest budget caps based on historical usage
  - `daysUntilCap(currentSpend, cap, burnRate)` → "at current rate, you'll hit your cap in X days"
- Dashboard: "Budget" tab showing:
  - Gauge: current spend / cap with color coding (green/yellow/red)
  - Projection line: spend trajectory with projected intersection with cap
  - Anomaly markers: "Unusual spike on July 23: $4.20 in 1 hour (normally $0.50/hr)"
  - Recommendation: "Based on your usage, we recommend a $75/week cap (currently $50)"
- Tests: projection accuracy, anomaly detection, recommendations

**Acceptance criteria:**
- Budget projection within ±20% of actual for stable usage patterns
- Anomaly detection flags genuine spikes (low false positive rate)
- Budget recommendations are sensible and explainable
- Dashboard shows all budget intelligence widgets

##### P5.3 — Model Cost Optimization Engine

**Current state:** Model routing is complexity-tier-based. No cost optimization — a `medium` task always uses the configured medium model.

**Target state:** Intelligent model selection that optimizes for cost while maintaining quality. For a given task, the engine recommends the cheapest model with sufficient capability. Users set optimization preference: "max quality," "balanced," "max savings."

**Key changes:**
- Add `model-optimizer.mjs`:
  - `recommendModel(task, availableModels, optimizationPreference)` → best model for task
  - Uses task category, complexity, risk tags, and historical success rate per model
  - Quality threshold: won't recommend a model that historically fails on similar tasks
  - Cost-awareness: for "max savings" preference, recommends cheapest model that meets quality bar
- Optimization preference in policy: `model_optimization: max_quality | balanced | max_savings`
- Dashboard: "Optimization" tab showing:
  - Current cost by model vs optimized cost (savings opportunity)
  - "Switch to X would save $Y/week" recommendations
  - Model performance metrics: success rate, avg review score, rework rate per model
- One-click apply: "Switch my medium tier from V4 Pro to V4 Flash" → updates policy.yaml
- Tests: recommendation logic, quality threshold, savings calculation

**Acceptance criteria:**
- Optimizer recommends cheaper model when historical data shows it's sufficient
- "Max quality" preference keeps premium models for complex tasks
- Savings opportunity calculation is accurate
- One-click model switch works end-to-end

##### P5.4 — Real-Time Alerts & Notifications

**Current state:** Escalation push to Slack for governance hard-stops. No spend-based alerting.

**Target state:** Configurable alerts for: budget threshold crossing (50%/80%/90%/100%), unusual spend spike, provider outage, model deprecation, license expiry. Multiple channels: Slack, email, webhook, dashboard toast.

**Key changes:**
- Add `alerts.mjs`:
  - Alert rule engine: evaluate conditions on schedule (every 60s)
  - Alert channels: `slack`, `email`, `webhook`, `dashboard`
  - Alert rules configurable in policy.yaml:
    ```yaml
    alerts:
      - name: "Budget 80%"
        condition: "budget.utilization >= 80"
        channel: slack
        cooldown: 4h  # don't repeat within 4h
      - name: "Spend spike"
        condition: "spend.1h > avg_spend.24h * 3"
        channel: dashboard
    ```
  - Dashboard: alert history, alert configuration UI
- Email: SMTP configuration in policy; send via Node.js `net` module (no dependency)
- Webhook: POST JSON to configured URL
- Tests: alert rule evaluation, channel dispatch, cooldown

**Acceptance criteria:**
- Budget at 80% → Slack notification sent
- Unusual spend spike → dashboard toast appears
- Alert doesn't repeat within cooldown period
- All alert channels work

#### Phase 5 Boundaries

- Does NOT build a hosted SaaS dashboard (Phase 6)
- Does NOT include team-based alerting (per-user alert preferences) — Phase 6
- Forecasting is linear regression only — no ML-based prediction
- Model optimizer uses heuristic quality scoring — not a trained model

---

### Phase 6: Multi-Tenant Platform

**Duration:** 4 weeks  
**Priority:** P2 — Commercialization  
**Depends on:** Phase 5  
**Blocks:** None (final phase)

#### What This Phase Covers

Phase 6 delivers the multi-project, multi-user platform: control plane for managing multiple projects, team collaboration features, remote dashboard access with authentication, project templates, and the SaaS-ready architecture defined in ADR 0001 (D3).

#### Why This Comes Last

Every previous phase builds capabilities that the platform orchestrates. Until providers are configurable (Phase 2), dashboards show complete data (Phase 5), and IDE integration works (Phase 4), there's nothing to orchestrate across projects. The platform is the final layer that ties everything together.

#### Detailed Scope

##### P6.1 — Control Plane (Project Supervisor)

**Current state:** Each MeridianOS tenant runs as an independent daemon process. No supervisor for managing multiple projects.

**Target state:** A control plane daemon that manages N projects: start/stop, health monitoring, config updates, log aggregation. One control plane can manage projects on the same machine (L1) or across containers (L2).

**Key changes:**
- Add `control-plane.mjs`:
  - `ProjectManager` class: CRUD for project definitions
  - `startProject(id)` / `stopProject(id)` / `restartProject(id)`
  - Project health: heartbeat monitoring, auto-restart on failure
  - Resource monitoring: CPU, memory, disk per project process
  - Log aggregation: unified log stream across all projects
- Project definition: YAML file specifying repo, domain plugin, policy, port assignment
- Project storage: `projects.db` SQLite database with project definitions and run history
- Control plane dashboard: list of projects with status, resource usage, quick actions
- CLI: `node cli.mjs project list|start|stop|create|delete`
- Shared gateway: all projects route through one gateway instance (tenant-labeled ledger)
- Tests: project lifecycle, health monitoring, shared gateway

**Acceptance criteria:**
- Create 3 projects → all 3 run concurrently → each has independent board, agents, budget
- Shared gateway meters all 3 projects with correct tenant labels
- One project crashes → control plane auto-restarts it → other projects unaffected
- Control plane dashboard shows all projects with status

##### P6.2 — Remote Dashboard Access & Authentication

**Current state:** Dashboard binds to localhost only. No authentication beyond per-boot random token.

**Target state:** Dashboard accessible remotely with proper authentication: API keys for programmatic access, user/password for dashboard login, optional OAuth2/OIDC for team SSO. Role-based access: admin (full control), operator (manage tasks), viewer (read-only).

**Key changes:**
- Add `auth.mjs`:
  - API key management: generate, revoke, list keys with scopes
  - User/password auth with bcrypt hashing
  - Session management with JWT tokens
  - Optional OIDC integration for SSO
- RBAC: `admin`, `operator`, `viewer` roles with per-endpoint authorization
- HTTPS support: optional TLS with provided certificate or auto-generated self-signed
- Dashboard login page: redirect to login if not authenticated
- API key header: `Authorization: Bearer mk-...` for programmatic access
- Tests: auth flow, RBAC enforcement, API key management

**Acceptance criteria:**
- Dashboard accessible from remote machine with valid credentials
- API key with `viewer` scope cannot modify configuration
- Admin can create/revoke API keys for team members
- Login page functions correctly
- HTTPS works with provided certificate

##### P6.3 — Team Collaboration

**Current state:** Single-operator model. One founder manages everything.

**Target state:** Multiple team members can: view board, create tasks, review agent PRs, receive alerts. Activity feed shows who did what. Comments on tasks.

**Key changes:**
- Add user management: invite users by email, assign roles
- Activity feed: `activity` table tracking who created/updated/reviewed what
- Task comments: users can add comments to tasks via dashboard or Slack
- PR review assignment: team members can be assigned as reviewers
- Notification preferences: per-user alert settings
- Dashboard: team panel showing online status, recent activity
- Tests: multi-user scenarios, activity feed, comments

**Acceptance criteria:**
- Invite team member → they can log in and view board
- Comment on task → other team members see it
- Activity feed shows chronological history
- PR review assignment notifies assigned reviewer

##### P6.4 — Project Templates Library

**Current state:** Every new project starts from scratch.

**Target state:** Library of project templates that pre-configure agents, prompts, categories, and model routing for common project types. One command to bootstrap a new project from template.

**Key changes:**
- Template format: directory with `policy.yaml`, `prompts/`, optional `tenant.yaml`
- Built-in templates:
  - **SaaS Web App:** React + Node.js, 3 agents (builder, reviewer, designer), UI-component focused categories
  - **Mobile App:** React Native, 3 agents, mobile-specific categories
  - **CLI Tool:** Node.js, 2 agents (builder, reviewer), focused on backend categories
  - **Library/SDK:** TypeScript, 2 agents, testing-heavy categories
  - **Documentation Site:** Markdown/MDX, 2 agents (writer, reviewer), docs-focused
  - **Data Pipeline:** Python, 2 agents, ETL-focused categories
  - **Blank:** minimal setup, user configures everything
- CLI: `node cli.mjs project create --template saas-web-app`
- Dashboard: template gallery with descriptions and previews
- Community templates: import from URL
- Tests: template instantiation, resulting project boots correctly

**Acceptance criteria:**
- Create project from template → boots with correct agents, prompts, categories
- Template project completes a test task successfully
- All 6 built-in templates instantiate correctly
- Custom template import works

##### P6.5 — Stripe Billing & License Enforcement (Complete F005)

**Current state:** F005 (License Key System & Stripe Billing) is in "designing" status. License key validation partially implemented.

**Target state:** Complete monetization loop: Stripe Checkout → license key generation → gateway validation → tier enforcement (Free/Pro/Enterprise). Self-serve subscription management.

**Key changes:**
- Complete `license.mjs` implementation per F005 spec:
  - License key generation: `mer-XXXX-XXXX-XXXX-XXXX` format
  - Validation: local check + periodic heartbeat to license server
  - Tier enforcement: Free (1 agent, DeepSeek only, metering only), Pro (unlimited agents, all providers, budget enforcement), Enterprise (Pro + SSO, priority support, custom models)
- Stripe integration:
  - Checkout Session creation from dashboard
  - Webhook handler for `checkout.session.completed`, `customer.subscription.deleted`
  - License key delivery via email
- License server: simple Node.js service or serverless function
- Dashboard: license status, upgrade CTA, billing portal link
- Tests: license validation, tier enforcement, Stripe webhook

**Acceptance criteria:**
- Purchase Pro via Stripe → license key delivered → gateway runs in Pro mode
- Expired/cancelled license → gateway degrades to Free after grace period
- Free tier enforces: 1 agent, DeepSeek only
- Pro tier unlocks: unlimited agents, all providers, budget enforcement

#### Phase 6 Boundaries

- Does NOT build a hosted SaaS platform (managed cloud) — L3 from ADR 0001
- Does NOT include usage-based billing (per-token pricing) — only flat subscription
- Does NOT build a license server with high availability — single instance acceptable for v1
- Team size limited to 10 users in v1 (no enterprise directory integration)

---

## 6. Phase Dependency Map

```
Phase 0: Foundation Hardening
  └─▶ Phase 1: Universal Gateway
        └─▶ Phase 2: Provider & Model Agnosticism
              └─▶ Phase 3: End-User Configurability
                    ├─▶ Phase 4: IDE & Platform Traffic Integration
                    │     └─▶ Phase 5: Observability & Intelligence
                    │           └─▶ Phase 6: Multi-Tenant Platform
                    └─▶ (Phase 4 also depends directly on Phase 1)
```

**Parallelizable work:**
- Phase 0.3 (Unify config) and Phase 0.4 (source field) can run in parallel
- Phase 1.1 (Zero-config bootstrap) and Phase 1.2 (Generic HTTP) can run in parallel
- Phase 4.2 (VS Code extension) and Phase 4.3 (Claude MCP) can run in parallel
- Phase 5.1 (Dashboards) and Phase 5.4 (Alerts) can run in parallel
- Phase 6.2 (Auth) and Phase 6.4 (Templates) can run in parallel

**Total estimated duration:** 16 weeks (with parallelization: 12-14 weeks)

---

## 7. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Cross-wire translation (P1.5) is lossy — some features don't translate | Medium | High | Deliver non-streaming only; document known limitations; make translation opt-in per route |
| VS Code Copilot proxy configuration changes with Copilot updates | Medium | Medium | Monitor Copilot changelog; extension auto-update; fallback to manual proxy config |
| Model auto-discovery APIs change or are inconsistent across providers | High | Low | Graceful degradation: fall back to models.dev; manual model entry always available |
| Gateway becomes performance bottleneck for IDE traffic | Low | High | Lightweight proxy design (no transformation unless translation enabled); benchmark early |
| Multi-project control plane complexity exceeds estimate | Medium | Medium | Phase 6 is last — can be descoped or simplified without blocking earlier phases |
| Stripe integration requires business entity setup | Low | Low | Phase 6 only; use Stripe test mode for development; business setup in parallel |
| Subscription plan token extraction methods stop working | Medium | Medium | Document as best-effort; clearly communicate dependency on provider auth stability |

---

## Appendix A: Key Architectural Principles (Reaffirmed)

These principles from the existing codebase are preserved and extended:

1. **Null-is-unknown, never fabricated as zero.** All metering, pricing, and cost fields maintain this contract. New tables and fields follow it.

2. **BYO-key: keys are env var names, never literal secrets.** The registry, config files, and gateway registry carry `keyEnv` references only. Keys live in `process.env`.

3. **No ambient singleton.** `config` is always explicitly injected. Multi-tenancy is structural, not incidental.

4. **Gateway as enforcement boundary.** All traffic passes through the gateway. Keys are injected server-side. Workers never hold real provider keys.

5. **Policy as single config surface.** Policy → env vars → code defaults. Clear precedence chain. Everything configurable from one place.

6. **Dogfood first, sell second.** Every phase produces a dogfoodable increment. No phase ships without live testing against real provider traffic.

---

## Appendix B: Current State vs Target State Summary

| Dimension | Current State | Target State (Post-Phase 6) |
|-----------|--------------|---------------------------|
| **Add provider** | Edit `providers.mjs` code → restart | CLI wizard or dashboard form → saved to policy → live |
| **Add model** | Edit `providers.mjs` → pricing refresh → restart | Auto-discovered from provider API → assigned to tier → live |
| **Gateway coverage** | Agent-spawned, anthropic-wire only, opt-in | ALL traffic (agent + IDE + CLI), both wires, default ON |
| **Metering source** | Usage readers (primary) + gateway (secondary) | Gateway ledger (primary), usage readers (fallback) |
| **Configuration** | 3 files (policy.yaml, tenant.yaml, providers.mjs) | 1 file (policy.yaml) + dashboard UI + CLI wizard |
| **IDE integration** | None | VS Code extension, Claude MCP, Cursor/Windsurf proxy |
| **Dashboard** | Local board view only | Full spend analytics, budget intelligence, config UI, remote access |
| **Multi-project** | One daemon per project | Control plane managing N projects, shared gateway |
| **Monetization** | Free only | Free/Pro/Enterprise tiers, Stripe billing, license enforcement |
| **Team support** | Single operator | Multi-user with RBAC, activity feed, comments |

---

*End of MeridianOS Full System Audit & Transformation Plan.*
