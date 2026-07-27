# MeridianOS Core — Full System Audit & Transformation Plan

> **Date**: 2026-07-27  
> **Scope**: Complete codebase audit of `meridianos-core` — 60+ source modules, 5 architecture diagrams, 13 gateway files, 4 dashboard files, 19 documentation/feature specs, infrastructure configs, and 69 test files.  
> **Goal**: Transform MeridianOS into a fully provider-agnostic, model-agnostic, wizard-configurable operating system with comprehensive gateway monitoring for all AI traffic including IDE platforms.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Audit Methodology](#2-audit-methodology)
3. [Current State Assessment](#3-current-state-assessment)
4. [Diagram-by-Diagram Critical Analysis](#4-diagram-by-diagram-critical-analysis)
5. [Gap Analysis — Consolidated Findings](#5-gap-analysis--consolidated-findings)
6. [Friction Points](#6-friction-points)
7. [Transformation Plan — Phased Execution](#7-transformation-plan--phased-execution)
   - [Phase 0: Foundation Hardening](#phase-0-foundation-hardening)
   - [Phase 1: Universal Provider Abstraction Layer](#phase-1-universal-provider-abstraction-layer)
   - [Phase 2: Dynamic Model Registry & Auto-Integration](#phase-2-dynamic-model-registry--auto-integration)
   - [Phase 3: Universal Gateway — IDE & Platform Traffic Interception](#phase-3-universal-gateway--ide--platform-traffic-interception)
   - [Phase 4: Wizard-Based Configuration & Onboarding](#phase-4-wizard-based-configuration--onboarding)
   - [Phase 5: Comprehensive Cost Governance & Observability](#phase-5-comprehensive-cost-governance--observability)
   - [Phase 6: Subscription & BYOK Multi-Modal Support](#phase-6-subscription--byok-multi-modal-support)
   - [Phase 7: Dashboard 2.0 — Real-Time Observability Platform](#phase-7-dashboard-20--real-time-observability-platform)
   - [Phase 8: Enterprise Scalability & Multi-Tenant Hardening](#phase-8-enterprise-scalability--multi-tenant-hardening)
   - [Phase 9: Ecosystem Integrations & Marketplace](#phase-9-ecosystem-integrations--marketplace)
8. [Phase Dependency Map](#8-phase-dependency-map)
9. [Glossary](#9-glossary)

---

## 1. Executive Summary

MeridianOS is an autonomous agent orchestrator with an inline cost-governance gateway. The current implementation demonstrates strong foundational patterns — BYOK key custody, append-only token ledger, multi-tenant data isolation, and a pluggable configuration layer via `DomainPlugin`. However, the system falls critically short of its stated goals of being **provider-agnostic**, **model-agnostic**, and **universally configurable**.

### Key Findings

| Dimension | Current State | Target State | Gap Severity |
|---|---|---|---|
| **Provider Agnosticism** | Only 2 wire protocols (`anthropic`, `openai`). Hardcoded provider references in 12+ files. | Any provider with any wire protocol. Zero code changes to add a provider. | 🔴 Critical |
| **Model Agnosticism** | Static `PROVIDERS` registry. Models must be manually coded. 5 fixed complexity tiers. | Auto-discovery from provider APIs. Any model auto-integrates. N custom tiers. | 🔴 Critical |
| **Gateway Monitoring** | Monitors only traffic routed through the gateway sidecar. Only Anthropic wire injection works. | Intercepts ALL AI traffic — CLI agents, IDE extensions, direct API calls. | 🔴 Critical |
| **IDE Traffic** | Only Antigravity IDE explicitly tracked. Claude Code and OpenCode tracked via local file parsing only. | VS Code Copilot, Cursor, Claude Code/Desktop, JetBrains AI, Antigravity IDE — all intercepted at the proxy layer. | 🔴 Critical |
| **Configuration** | Requires manual YAML editing and understanding of `DomainPlugin` structure. Setup crashes without `.ai/` skeleton. | Interactive wizard. No YAML knowledge required. Guided setup with validation. | 🟡 Major |
| **BYOK Support** | Works for providers with `keyEnv`. No UI for key management. No subscription plan awareness. | Wizard-driven key entry. Subscription plan detection. Usage-based billing integration. | 🟡 Major |
| **Cost Observability** | 7-day rolling window only. No historical trends. No per-task ROI. | Unlimited history. Time-series charts. Per-task cost attribution. Budget forecasting. | 🟡 Major |
| **Multi-Tenant** | Architecture supports it. Single default tenant `'pv'` hardcoded. | N tenants. Tenant-scoped dashboards. Isolated billing. | 🟢 Moderate |
| **Scalability** | Single-process daemon. SQLite local storage. | Horizontal scale-out. Optional remote DB. Distributed gateway fleet. | 🟢 Moderate |

---

## 2. Audit Methodology

This audit examined every component of the MeridianOS codebase through seven analytical lenses executed in parallel:

1. **Diagram Analysis** — All 5 architecture diagrams (C4 Context, Component Relationships, Data Model, Deployment Infrastructure, Processing Pipeline) were analyzed at the PNG rendering level and Mermaid source level for accuracy, completeness, and gaps.
2. **Core Module Analysis** — 20 core files (config, providers, model-router, pricing, budget, router, state, launcher, runner, scheduler, init, control-plane, bus, bus-guard, boot-guard, tenant-config, schema.sql, package.json, README).
3. **Gateway Analysis** — All 13 gateway files (server, cli, inject, ledger, provider-registry, registry-pull, registry-source, run-registry, token-event, windows, index, README).
4. **Usage & Monitoring Analysis** — 20 files covering usage tracking, monitoring, cost management (claude-usage, antigravity-usage, opencode-usage, usage-readers, watchdog, status, event-log, event-store, runlog, daemon-entry/logger, verify-loop, verifier, conformance, sensitive, harness-adapters, machine, state-store, policy-validate/write).
5. **Documentation & Feature Spec Analysis** — 19 documents (README, DEPLOY, GATEWAY, PRICING, PROVIDERS, ADR-0001, F001-F012, GTM critical-review, wedge-and-ICP).
6. **Infrastructure & Config Analysis** — 25 files (Docker, domain-record, schema, doc-store, project-store, intake-registry, source adapters, worktree, planner, render, validate, definition-of-ready, exit-classify, escalation-push, yaml-lite, scripts).
7. **Dashboard & UI Analysis** — All 4 dashboard files (index.html, server.mjs, actions.mjs, spec-file.mjs).

For each finding, three questions were applied systematically:
- **WHY** does this gap exist? (Root cause)
- **WHAT** is the impact? (User/system consequence)
- **HOW** should it be resolved? (Concrete remedy)

---

## 3. Current State Assessment

### 3.1 Architecture Overview

MeridianOS operates as a local-first autonomous agent orchestrator structured in 5 layers:

```
┌─────────────────────────────────────────────────────────────┐
│  CONFIGURATION — config.mjs, tenant.yaml, policy.yaml,     │
│                  providers.mjs, DomainPlugin                │
├─────────────────────────────────────────────────────────────┤
│  ORCHESTRATION — scheduler.mjs, planner.mjs, verifier.mjs, │
│                  runner.mjs, launcher.mjs, model-router.mjs │
├─────────────────────────────────────────────────────────────┤
│  EXECUTION — worktree.mjs, harness-adapters.mjs,            │
│              gateway/server.mjs, dashboard/server.mjs        │
├─────────────────────────────────────────────────────────────┤
│  DATA — db.mjs (SQLite), state.mjs, gateway/ledger.mjs,    │
│         budget.mjs, runlog.mjs                               │
├─────────────────────────────────────────────────────────────┤
│  CROSS-CUTTING — usage-readers.mjs, pricing.mjs,            │
│                  sensitive.mjs, escalation-push.mjs,         │
│                  boot-guard.mjs                              │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 What Works Well

- **BYOK Key Custody**: Real API keys never leave the gateway server. Agents receive only ephemeral UUID tokens. The `keyEnv` pattern (storing env var *names*, not values) is sound.
- **Append-Only Ledger**: `token_events` in `ledger.db` with the `null-is-unknown` contract is an excellent auditing foundation.
- **Multi-Tenant Data Isolation**: `control-plane.mjs` can spin up N isolated AIOS instances in one process with separate state DBs and configs.
- **Git Worktree Isolation**: Each agent run gets a clean, isolated `git worktree` preventing collisions.
- **Declarative Config via `tenant.yaml`**: `DomainPlugin` can be expressed as data rather than code.
- **Budget Enforcement**: Rolling 5-hour and 7-day token/USD windows with hard `403` denial at the gateway.
- **Comprehensive Test Suite**: 69 test files covering every major module.

### 3.3 What Doesn't Work

- **Only 2 Wire Protocols**: The system only understands `anthropic` and `openai` wire formats. Any provider with a different protocol is unsupported.
- **Static Model Registry**: Models must be manually coded into `providers.mjs`. No auto-discovery.
- **Hardcoded Agent Names**: `bus.mjs` hardcodes `from: antigravity` / `to: claude-code`. Dashboard hardcodes CSS for `claude` and `antigravity`.
- **IDE Blind Spots**: VS Code Copilot, Cursor, JetBrains AI, Claude Desktop — none of these are intercepted.
- **Manual Setup Only**: No wizard. Users must hand-author YAML files. Setup crashes with cryptic errors if `.ai/` skeleton is missing.
- **No Historical Analytics**: Dashboard only shows 7-day rolling window. No time-series graphs. Event log capped at 30 entries.
- **Windows-Coupled Scripts**: `publish.ps1` uses Windows DPAPI. `register-conductor.ps1` uses `Register-ScheduledTask`. No Linux/macOS equivalents.

---

## 4. Diagram-by-Diagram Critical Analysis

### 4.1 High-Level Architecture (C4 Context)

**File**: `docs/diagrams/high-level-architecture.md` / `.png`

#### What It Shows
A C4 System Context diagram with MeridianOS as a central hub coordinating between People (Founder, Dev Team), Sources (ADO, Slack, Inbox), Providers (Anthropic, DeepSeek, OpenRouter, Ollama), and Storage (State DB, Ledger DB, Git Repo).

#### Critical Analysis

| # | Question | Finding | Severity |
|---|----------|---------|----------|
| 1 | **WHY** are only 4 providers shown? | The diagram was manually authored to reflect the providers currently in `providers.mjs`. | 🔴 Critical — misrepresents the system as limited to these 4. |
| 2 | **WHAT** happens when Google AI (Gemini API), Azure OpenAI, AWS Bedrock, or Cohere are added? | The diagram and the code both need manual updates. | 🔴 Critical — violates provider agnosticism. |
| 3 | **HOW** should this be fixed? | Replace the static provider list with a "Provider Registry" abstraction node. Individual providers become runtime data, not diagram nodes. | ✅ Remedy |
| 4 | **WHY** is the "Filesystem Inbox" missing from the PNG rendering? | Mermaid rendering bug — the node exists in the `.md` source but was lost in the PNG export. | 🟡 Rendering defect. |
| 5 | **WHAT** about IDE traffic as external systems? | IDEs (VS Code, Claude Desktop, Cursor) are completely absent from the context diagram. They are a major external system boundary that should be shown. | 🔴 Critical — users won't understand that IDE traffic can be governed. |
| 6 | **WHY** is there floating text ("Agent PRs, board commits") unattached in the top-left corner? | Mermaid rendering artifact from a long edge label. | 🟡 Cosmetic defect. |

#### Gaps
- No IDE/platform systems shown as external actors
- No subscription/billing system shown
- No indication of which providers use which wire protocols
- Missing: Google AI, Azure OpenAI, AWS Bedrock, Cohere, Mistral, xAI (Grok)

---

### 4.2 Component Relationships (C4 Component)

**File**: `docs/diagrams/component-relationships.md` / `.png`

#### What It Shows
A 5-layer decomposition (Configuration, Orchestration, Execution, Data, Cross-Cutting) with specific `.mjs` files in each.

#### Critical Analysis

| # | Question | Finding | Severity |
|---|----------|---------|----------|
| 1 | **WHY** does `harness-adapters.mjs` explicitly list only `claude-code · antigravity · opencode`? | These are the only 3 harnesses currently implemented. The system has no plugin/adapter discovery mechanism. | 🔴 Critical — Adding Cursor, Copilot, or Aider requires code changes. |
| 2 | **WHAT** is missing between Cross-Cutting and other layers? | Cross-cutting concerns (`usage-readers.mjs`, `sensitive.mjs`) sit in a disconnected box with no visual links to where they're actually invoked. | 🟡 Misleading — implies these are standalone utilities. |
| 3 | **HOW** does Configuration flow to Execution? | Only one arrow (`ConfigMJS → Scheduler`). No direct path showing how `providers.mjs` feeds into `gateway/server.mjs` or how `policy.yaml` constraints reach the `Launcher`. | 🟡 Incomplete dependency mapping. |
| 4 | **WHY** is `model-router.mjs` placed inside Orchestration but visually disconnected from the Planner? | The router is invoked by Runner, not Planner, but in practice, the Planner's spec stage also needs model awareness for spec-agent routing. | 🟡 Architectural ambiguity. |

#### Gaps
- No wizard/CLI setup component shown
- No subscription/licensing component
- No remote API/webhook for external management
- Missing: intake-registry.mjs, conformance.mjs, pricing-refresh.mjs

---

### 4.3 Data Model & Storage Architecture

**File**: `docs/diagrams/data-model.md` / `.drawio.png`

#### What It Shows
The most detailed diagram — covers `aios.db` schema (tasks, events, task_history), `ledger.db` schema (token_events with null-is-unknown contract), git-tracked configs, and runtime state.

#### Critical Analysis

| # | Question | Finding | Severity |
|---|----------|---------|----------|
| 1 | **WHY** is `leases` shown as a separate box from `tasks`? | Leases are actually columns within the `tasks` table (`lease_owner`, `lease_expires`, `lease_session`), not a separate table. The diagram is misleading. | 🟡 Inaccurate representation. |
| 2 | **WHAT** is the schema of `board.json`? | Described only as "Generated snapshot" — no field listing. This is a core external contract consumed by the dashboard. | 🟡 Missing contract specification. |
| 3 | **WHY** is there no cost aggregation table? | Token events are stored raw. Aggregation (per-day, per-provider, per-model) is computed on-the-fly via SQL `GROUP BY`. | 🟡 Performance concern at scale — no materialized summaries. |
| 4 | **WHAT** about subscription/billing data? | Completely absent. No tables for license keys, subscription tiers, usage quotas per subscription plan. | 🔴 Critical for paid plan support. |
| 5 | **HOW** do IDE-native usage stores relate? | Transcript stores (`~/.claude/`, `~/.gemini/`, `~/.local/share/opencode/`) are shown but only as passive read targets. No architecture for consolidating these into the ledger. | 🔴 Critical gap in unified monitoring. |

#### Gaps
- No subscription/billing schema
- No provider configuration persistence (provider registry is in-memory)
- No historical aggregation tables
- No user/team/organization hierarchy for multi-tenant billing

---

### 4.4 Deployment & Infrastructure

**File**: `docs/diagrams/deployment-infrastructure.md` / `.png`

#### What It Shows
A Docker-based deployment with 2 containers (Gateway on `:8787`, Daemon on `:4317`), Docker volumes, and external provider APIs.

#### Critical Analysis

| # | Question | Finding | Severity |
|---|----------|---------|----------|
| 1 | **WHY** is there no network link between the Daemon and Gateway containers? | The diagram shows them side-by-side but doesn't illustrate how spawned agents inside the Daemon route traffic through the Gateway. This is the most critical data flow. | 🔴 Critical — the core value proposition (all traffic through gateway) is not shown. |
| 2 | **WHAT** about non-Docker deployments? | No bare-metal, no cloud-native (Kubernetes), no serverless option shown. | 🟡 Limits deployment flexibility. |
| 3 | **HOW** does a user access the dashboard? | No user ingress path shown. Port `:4317` is mapped but no external access arrow exists. | 🟡 Misleading for ops teams. |
| 4 | **WHY** are only 3 env vars shown? | `DEEPSEEK_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_KEY` are hardcoded. A dynamic provider system needs N env vars. | 🔴 Contradicts provider agnosticism. |

#### Gaps
- No Kubernetes/Helm deployment option
- No cloud-hosted gateway variant (for teams without Docker)
- No TLS/HTTPS shown (local-only assumption)
- No load balancer for multi-instance gateway

---

### 4.5 Processing Pipeline (C4 Container)

**File**: `docs/diagrams/processing-pipeline.md` / `.png`

#### What It Shows
A 7-stage operational pipeline: Intake → Planner → Model Router → Runner → Launcher → Gateway Sidecar → Verifier → Escalation, with a Watchdog side-loop.

#### Critical Analysis

| # | Question | Finding | Severity |
|---|----------|---------|----------|
| 1 | **WHY** is there no "Done/Complete" terminal state? | The Verifier shows "Auto-merge or bounce" but there's no arrow to a success terminal. | 🟡 Incomplete flow — readers don't know where successful tasks end up. |
| 2 | **WHAT** about the spec stage routing? | The Planner assigns a spec agent for designing, but the diagram doesn't show how spec-stage model routing differs from impl-stage routing. | 🟡 Oversimplification. |
| 3 | **WHY** are only 3 agent harnesses shown in the Agent Execution box? | Same as Component diagram — hardcoded to `Claude Code`, `Antigravity`, `OpenCode`. | 🔴 Not extensible. |
| 4 | **WHAT** is the rendering artifact "propoAReclaim failed → retry (up to cap)iyr-impl"? | A mermaid rendering bug from a long edge label that got garbled during PNG export. | 🟡 Cosmetic defect. |

#### Gaps
- No IDE pass-through traffic shown (VS Code extensions calling LLM APIs directly)
- No parallel execution paths shown (only sequential)
- Missing: subscription check gate, license validation step

---

## 5. Gap Analysis — Consolidated Findings

### 5.1 Provider Agnosticism Gaps

| # | File(s) | Gap | Root Cause | Impact |
|---|---------|-----|------------|--------|
| G-PA-1 | `gateway/token-event.mjs`, `gateway/provider-registry.mjs` | `VALID_WIRES` hardcoded to `['anthropic', 'openai']` | Only two protocols were needed at launch | Cannot add Google AI (Gemini), AWS Bedrock, or any non-standard wire |
| G-PA-2 | `gateway/inject.mjs` | Only `anthropic` wire injection works | OpenAI wire injection was deferred ("3.2d-ii" in docs) | OpenCode and any OpenAI-wire harness bypass the gateway entirely |
| G-PA-3 | `model-router.mjs` | Fallback provider hardcoded to `'anthropic'` | Design shortcut | If Anthropic is removed, the fallback breaks |
| G-PA-4 | `init.mjs` | Default templates hardcode `deepseek-chat` and `claude-sonnet-4-20250514` | Bootstrap convenience | New users are steered to specific providers |
| G-PA-5 | `bus.mjs` | `submitHandoff` hardcodes `from: antigravity` / `to: claude-code` | Implementation shortcut for design handoffs | Cannot hand off between arbitrary agent types |
| G-PA-6 | `harness-adapters.mjs` | Only 3 harnesses: `claude-code`, `antigravity`, `opencode` | No plugin/adapter discovery system | Adding Cursor, Copilot, Aider requires code changes |
| G-PA-7 | `pricing-refresh.mjs` | Hardcodes Models.dev and OpenRouter API URLs | Only 2 pricing sources were known | Cannot fetch pricing from provider-native APIs |
| G-PA-8 | `gateway/server.mjs` | `DEFAULT_ANTHROPIC_VERSION = '2023-06-01'` | Anthropic-specific header injection | Breaks abstraction for non-Anthropic providers |

### 5.2 Model Agnosticism Gaps

| # | File(s) | Gap | Root Cause | Impact |
|---|---------|-----|------------|--------|
| G-MA-1 | `providers.mjs` | Static `PROVIDERS` registry requires manual code additions for new models | No auto-discovery mechanism | Every new model requires a code release |
| G-MA-2 | `model-router.mjs` | Fixed 5 complexity tiers: `simple`, `medium`, `medium_high`, `complex`, `critical` | Design-time assumption about model granularity | Cannot express custom tiers like `reasoning`, `coding`, `vision` |
| G-MA-3 | `model-router.mjs` | Harness inference: defaults to `claude-code` for Anthropic, `opencode` for everything else | No explicit harness-per-model mapping | Silent wrong-harness assignment for new providers |
| G-MA-4 | `dashboard/index.html` | `shortModel()` strips `'claude-'`, `'opus 4 8'`, `'haiku 4 5'` | Display formatting hardcoded to known model names | Unknown model names display as full raw strings |
| G-MA-5 | `conformance.mjs` | Only tests OpenAI/Anthropic wire compliance | Cannot validate Google AI, Bedrock, or custom wire | New providers can't be conformance-tested |

### 5.3 IDE & Platform Traffic Monitoring Gaps

| # | File(s) | Gap | Root Cause | Impact |
|---|---------|-----|------------|--------|
| G-IDE-1 | `gateway/inject.mjs` | Only Anthropic wire injection implemented | Deferred feature | OpenCode, Copilot, Cursor traffic bypasses the gateway |
| G-IDE-2 | `antigravity-usage.mjs` | Hardcoded protobuf field offsets for Google's undocumented format | Reverse-engineered, not API-stable | Any Google schema change breaks tracking silently |
| G-IDE-3 | `usage-readers.mjs` | Only 3 readers: Claude, Antigravity, OpenCode | No plugin mechanism | Cursor, Copilot, Aider, JetBrains AI all invisible |
| G-IDE-4 | Entire system | VS Code Copilot traffic is completely unmonitored | Copilot uses its own GitHub-proxied API; no interception hook exists | Shadow spend from Copilot seats is invisible |
| G-IDE-5 | Entire system | Cursor IDE traffic is completely unmonitored | Cursor uses its own proxy; different from standard OpenAI | Shadow spend from Cursor is invisible |
| G-IDE-6 | Entire system | JetBrains AI Assistant traffic is completely unmonitored | No JetBrains integration exists | Shadow spend invisible |

### 5.4 Configuration & Onboarding Gaps

| # | File(s) | Gap | Root Cause | Impact |
|---|---------|-----|------------|--------|
| G-CFG-1 | `init.mjs`, `boot-guard.mjs` | Missing `.ai/` skeleton causes cryptic crashes | No guided setup | Terrible first-run experience |
| G-CFG-2 | Entire system | No interactive wizard for setup | Designed for founder-only operation | Users must manually author complex YAML |
| G-CFG-3 | `policy-validate.mjs` | Validation only checks WIP vs parallel coherence | Minimal validation surface | Invalid model routing, budget configs, or provider settings not caught |
| G-CFG-4 | `tenant-config.mjs` | YAML loader uses custom `yaml-lite.mjs` | Avoided external dependencies | Limited YAML feature support (no anchors, no multi-doc) |

### 5.5 Cost Governance & Observability Gaps

| # | File(s) | Gap | Root Cause | Impact |
|---|---------|-----|------------|--------|
| G-CG-1 | `dashboard/server.mjs` | 7-day query window hardcoded | Design decision | No historical analysis beyond 7 days |
| G-CG-2 | `dashboard/index.html` | No time-series charts, only point-in-time cards | UI was built for quick status, not analytics | Cannot visualize spend trends |
| G-CG-3 | `pricing.mjs` | No cached vs. uncached input cost split | Deferred | Over-reports costs for cache-heavy workloads |
| G-CG-4 | `budget.mjs` | Budget windows hardcoded to 5h and 7d | Design assumption | Cannot create custom windows (daily, monthly, per-sprint) |
| G-CG-5 | `gateway/windows.mjs` | `per_5h_tokens: 0` means "no cap" instead of "zero cap" | Sentinel value design flaw | Impossible to set a true zero budget (hard block) |
| G-CG-6 | `ledger.mjs` | No cost aggregation tables | Raw events only | Dashboard queries scan full event table every poll |

---

## 6. Friction Points

### 6.1 Developer Experience Friction

1. **Crash-on-First-Run**: Running the daemon without manually creating `.ai/state/`, `.ai/logs/`, `.ai/worktrees/`, etc. causes unrecoverable crashes. The error messages are stack traces, not guidance.
2. **YAML-Only Configuration**: Every configuration change requires editing `policy.yaml` or `tenant.yaml` by hand. No validation until runtime. No schema documentation in the files themselves.
3. **Windows-Only Tooling**: `publish.ps1` (Windows DPAPI), `register-conductor.ps1` (Windows Scheduled Tasks) have no cross-platform alternatives. macOS/Linux developers cannot publish or register conductors.
4. **Manual Provider Addition**: Adding a new LLM provider requires touching 5+ files: `providers.mjs`, `model-router.mjs`, `harness-adapters.mjs`, `init.mjs` templates, and `conformance.mjs`.

### 6.2 Operator Experience Friction

1. **No Setup Wizard**: Feature spec F012 proposes a guided setup but it's not implemented. Operators must understand the full system to get started.
2. **Dashboard Blindness Past 7 Days**: The dashboard only shows the last 7 days. There's no export, no drill-down, no "last month" view.
3. **Monolithic Dashboard HTML**: The entire dashboard is a single 85KB `index.html` file with inline CSS and JavaScript. Extremely difficult to extend, test, or maintain.
4. **Hardcoded Dashboard Restart**: The `/api/restart` endpoint hardcodes a Windows PowerShell invocation. Linux operators cannot restart via the dashboard.

### 6.3 Scaling Friction

1. **SQLite Local-Only**: Both `aios.db` and `ledger.db` are local SQLite files. No option for PostgreSQL, MySQL, or any remote database.
2. **Single-Process Daemon**: `scheduler.mjs` runs everything in one process — planner, verifier, runner, watchdog, dashboard server. No horizontal scaling.
3. **Tenant `'pv'` Hardcoded**: Despite multi-tenant architecture, the default tenant `'pv'` is baked into multiple files. No self-service tenant creation.

---

## 7. Transformation Plan — Phased Execution

---

### Phase 0: Foundation Hardening

> **WHY**: Before building upward, the foundation must be stabilized. Current crashes on first run, missing validation, and platform-specific scripts create an unreliable base.

#### Scope
- Fix all crash-on-first-run paths
- Implement comprehensive configuration validation
- Cross-platform scripting
- Fix diagram rendering defects
- Remove all floating text artifacts from diagrams

#### Deliverables

##### P0-D1: Robust Bootstrap & Self-Healing Init

**What**: Replace the crash-on-missing-directory behavior with a self-healing initialization flow.

**How**:
- Modify `boot-guard.mjs` to detect missing `.ai/` subdirectories and auto-create them with safe defaults instead of throwing.
- Add a `--init` flag to the daemon entry that runs `init.mjs` scaffold if no `.ai/` exists.
- Provide clear, human-readable error messages with remediation steps for every boot failure.
- Add integration tests that verify cold-start from an empty repository.

**Files to modify**:
- `boot-guard.mjs` — Add directory auto-creation with `fs.mkdirSync(path, { recursive: true })`
- `init.mjs` — Make idempotent; skip already-created directories/files
- `daemon-entry.mjs` — Add bootstrap check before scheduler start

**Boundary**: This phase does NOT add any new features. It only makes the existing system reliably startable.

**Connection to bigger picture**: Every subsequent phase depends on a system that boots cleanly. Phase 4 (Wizard) builds on top of this init flow.

---

##### P0-D2: Comprehensive Configuration Validation

**What**: Extend `policy-validate.mjs` to validate all configuration fields, not just WIP vs parallel coherence.

**How**:
- Create a JSON Schema for `policy.yaml` (extending the existing `domain-record.schema.json` pattern)
- Create a JSON Schema for `tenant.yaml`
- Validate all `model_routing` entries reference valid providers and models
- Validate all `agent_budget` entries reference agents defined in the roster
- Validate `keyEnv` environment variables actually exist in `process.env` at boot
- Emit warnings for deprecated or unknown configuration fields

**Files to modify/create**:
- `schema/policy.schema.json` — [NEW] Full JSON Schema for policy.yaml
- `schema/tenant.schema.json` — [NEW] Full JSON Schema for tenant.yaml
- `policy-validate.mjs` — Expand to use JSON Schema validation
- `tenant-config.mjs` — Add schema validation after YAML parsing

**Boundary**: Validation only. No configuration modification. Reports errors; doesn't fix them.

**Connection to bigger picture**: Phase 4 (Wizard) uses these schemas to generate UI forms. Phase 1 (Provider Abstraction) uses provider schema for validation.

---

##### P0-D3: Cross-Platform Tooling

**What**: Replace Windows-only scripts with cross-platform Node.js equivalents.

**How**:
- Rewrite `scripts/publish.ps1` as `scripts/publish.mjs` — use `node:crypto` for key management instead of DPAPI
- Rewrite `scripts/register-conductor.ps1` as `scripts/register-conductor.mjs` — use `node-cron` or systemd/launchd abstractions
- Add platform detection in `dashboard/server.mjs` for the `/api/restart` endpoint

**Files to modify/create**:
- `scripts/publish.mjs` — [NEW] Cross-platform publish script
- `scripts/register-conductor.mjs` — [NEW] Cross-platform conductor registration
- `dashboard/server.mjs` — Replace hardcoded PowerShell restart with platform-agnostic subprocess

**Boundary**: Only replaces existing functionality. No new features.

**Connection to bigger picture**: Phase 8 (Enterprise) requires Linux deployment. These scripts must work on all platforms first.

---

##### P0-D4: Diagram Corrections

**What**: Fix all rendering defects and inaccuracies in the 5 architecture diagrams.

**How**:
- Fix floating "Agent PRs, board commits" text in high-level-architecture
- Fix garbled "propoAReclaim" text in processing-pipeline
- Restore missing "Filesystem Inbox" node in high-level-architecture PNG
- Correct "leases" box in data-model to show it as columns within the `tasks` table
- Add "Done/Complete" terminal state to processing-pipeline
- Re-export all PNGs using `scripts/drawio-export.mjs`

**Files to modify**:
- All 5 `docs/diagrams/*.md` files — Fix mermaid source
- All 5 `docs/diagrams/*.png` files — Re-render

**Boundary**: Diagram accuracy only. No code changes.

**Connection to bigger picture**: Accurate diagrams are the communication substrate for all subsequent phases. Every phase adds to these diagrams.

---

#### Phase 0 Verification Plan

- **Automated Tests**: Run full test suite (`npm test`). All 69 existing tests pass. New init/validation tests pass.
- **Manual Verification**: Clone repo to fresh directory, run daemon with zero setup. Verify clean boot with auto-created skeleton. Verify meaningful error messages for missing env vars.

---

### Phase 1: Universal Provider Abstraction Layer

> **WHY**: The current system is structurally biased toward Anthropic and OpenAI wire protocols. Adding any provider with a different wire protocol (Google AI, AWS Bedrock, Azure OpenAI) requires code changes in 5+ files. This violates the core promise of provider agnosticism.

#### Scope
- Abstract wire protocols into a plugin system
- Create a universal provider registry with declarative definition
- Eliminate all hardcoded provider references
- Support any wire protocol via adapter plugins

#### Deliverables

##### P1-D1: Wire Protocol Adapter Plugin System

**What**: Replace the hardcoded `VALID_WIRES = ['anthropic', 'openai']` with a pluggable wire adapter registry.

**How**:
- Define a `WireAdapter` interface contract:
  ```
  WireAdapter {
    name: string                          // e.g., 'anthropic', 'openai', 'google-ai', 'bedrock'
    detectRequest(headers, body): bool     // Can this adapter handle this request?
    injectAuth(req, apiKey): req           // Inject authentication into the request
    extractUsage(response): TokenUsage     // Extract token counts from response
    extractUsageFromSSE(chunk): TokenUsage  // Extract from streaming events
    formatDenial(statusCode, msg): resp    // Format a budget denial response
    normalizeModel(modelId): string        // Normalize model identifiers
  }
  ```
- Create concrete implementations:
  - `wire-adapters/anthropic.mjs` — Extract from existing `server.mjs` logic
  - `wire-adapters/openai.mjs` — Extract from existing `server.mjs` logic
  - `wire-adapters/google-ai.mjs` — [NEW] For Gemini API native protocol
  - `wire-adapters/bedrock.mjs` — [NEW] For AWS Bedrock SigV4 protocol
- Implement adapter auto-discovery: scan `wire-adapters/` directory at boot
- Remove `VALID_WIRES` constant from `token-event.mjs` and `provider-registry.mjs`

**Files to modify/create**:
- `gateway/wire-adapters/` — [NEW] Directory with adapter implementations
- `gateway/wire-adapter-registry.mjs` — [NEW] Plugin loader and dispatcher
- `gateway/server.mjs` — Refactor to use adapter registry instead of inline protocol checks
- `gateway/token-event.mjs` — Remove `VALID_WIRES` hardcode; accept any wire name
- `gateway/provider-registry.mjs` — Remove wire validation; defer to adapter registry

**Boundary**: This phase changes only the gateway's protocol handling. It does NOT change the orchestration layer, dashboard, or CLI.

**Connection to bigger picture**: This is the foundation for Phase 2 (Model Registry) and Phase 3 (IDE Traffic). Every provider added in Phase 2 uses adapters defined here. Phase 3's IDE interception uses adapter detection to handle diverse IDE protocols.

---

##### P1-D2: Declarative Provider Registry

**What**: Replace the static `PROVIDERS` object in `providers.mjs` with a YAML/JSON-driven registry that supports runtime additions.

**How**:
- Create `schema/provider.schema.json` defining the provider configuration contract:
  ```json
  {
    "name": "string",
    "displayName": "string",
    "wire": "string (references a WireAdapter)",
    "upstreamUrl": "string (URL)",
    "keyEnv": "string | null",
    "models": ["string"],
    "capabilities": { "streaming": true, "thinking": false, "vision": false },
    "pricing": { "source": "api | manual | openrouter", "refreshUrl": "string" },
    "conformance": { "tested": true, "lastTested": "ISO date" }
  }
  ```
- Move the `PROVIDERS` data into `.ai/providers.yaml` (user-editable, schema-validated)
- Keep `providers.mjs` as the runtime loader that merges:
  1. Built-in defaults (shipped with the package)
  2. User overrides from `.ai/providers.yaml`
  3. Runtime additions via the dashboard API

**Files to modify/create**:
- `schema/provider.schema.json` — [NEW] Provider definition schema
- `providers.yaml` — [NEW] Default provider definitions (data file)
- `providers.mjs` — Refactor to load from YAML + merge overrides
- `init.mjs` — Generate default `providers.yaml` during scaffold

**Boundary**: Providers become data. The code becomes a generic loader. No changes to the model routing or budget systems.

**Connection to bigger picture**: Phase 2 (Model Registry) reads from this provider registry. Phase 4 (Wizard) uses the schema to generate provider setup forms.

---

##### P1-D3: Eliminate Hardcoded Provider References

**What**: Remove every hardcoded provider name, model name, and agent name from the codebase.

**How**:
- `bus.mjs`: Replace `from: antigravity` / `to: claude-code` with configurable handoff rules from `policy.yaml`
- `model-router.mjs`: Replace fallback `'anthropic'` with `config.defaultProvider` from policy
- `init.mjs`: Replace hardcoded `deepseek-chat` / `claude-sonnet-4-*` templates with a `{{provider}}` / `{{model}}` template system that uses the first provider from the registry
- `dashboard/index.html`: Replace hardcoded CSS for `claude`/`antigravity` with a generic agent color assignment (hash-based)
- `dashboard/index.html`: Replace `shortModel()` provider-specific stripping with a generic `displayName` lookup from the provider registry
- `dashboard/index.html`: Replace `copySession()` hardcoded CLI commands with a harness-provided session command
- `gateway/server.mjs`: Replace `DEFAULT_ANTHROPIC_VERSION` with a per-provider header config
- `boot-guard.mjs`: Remove hardcoded `GENERATED_BOARD_FILES` list; derive from config

**Files to modify**: `bus.mjs`, `model-router.mjs`, `init.mjs`, `dashboard/index.html`, `gateway/server.mjs`, `boot-guard.mjs`, `harness-adapters.mjs`

**Boundary**: Pure refactoring. Behavior must remain identical for existing providers. All existing tests must pass without modification.

**Connection to bigger picture**: This cleanup is required before Phase 2 can add providers dynamically. If hardcodes remain, dynamic providers will collide with static assumptions.

---

#### Phase 1 Verification Plan

- **Automated Tests**: All existing 69 tests pass. New tests for wire adapter detection, provider YAML loading, and handoff routing.
- **Conformance Testing**: Run `conformance.mjs` against Anthropic, DeepSeek, OpenRouter, and Ollama to verify no regression.
- **Manual Verification**: Add a dummy "test-provider" via YAML. Verify it appears in the provider registry, dashboard, and can be routed to.

---

### Phase 2: Dynamic Model Registry & Auto-Integration

> **WHY**: Currently, every new model requires a manual code change in `providers.mjs`. In a world where providers release new models weekly, this creates constant maintenance burden. The system should auto-discover and integrate new models.

#### Scope
- Automated model discovery from provider APIs
- Dynamic pricing catalog refresh
- Custom complexity tier system
- Model capability tagging (reasoning, coding, vision, function-calling)

#### Deliverables

##### P2-D1: Model Auto-Discovery Service

**What**: A background service that periodically queries provider APIs to discover available models and their capabilities.

**How**:
- Create `model-discovery.mjs` with provider-specific discovery adapters:
  - Anthropic: `GET /v1/models` (when available) or parse from docs
  - OpenAI-compatible: `GET /v1/models` (standard endpoint)
  - Google AI: `GET /v1beta/models`
  - OpenRouter: `GET /api/v1/models` (already partially supported via `pricing-refresh.mjs`)
- Each discovered model is normalized to a `ModelRecord`:
  ```
  ModelRecord {
    id: string,                    // e.g., "claude-sonnet-4-20250514"
    provider: string,              // references Provider registry
    displayName: string,           // human-readable
    capabilities: string[],        // ['reasoning', 'coding', 'vision', 'function-calling']
    contextWindow: number,         // max tokens
    maxOutput: number,             // max output tokens
    pricing: { input, output, cacheRead, cacheWrite },
    tier: string | null,           // auto-suggested or user-assigned
    lastSeen: ISO date,            // for staleness detection
    deprecated: boolean
  }
  ```
- Store discovered models in `.ai/models.json` (auto-refreshed, user-reviewable)
- Merge with user overrides from `policy.yaml` `model_routing` section

**Files to create/modify**:
- `model-discovery.mjs` — [NEW] Model discovery service
- `model-discovery-adapters/` — [NEW] Per-provider discovery adapters
- `scheduler.mjs` — Add discovery tick (daily or on-demand)
- `providers.mjs` — Load from `models.json` instead of static `PROVIDERS`

**Boundary**: Discovery only. Does not change model routing decisions. Discovered models are stored as data; routing remains configurable.

**Connection to bigger picture**: Phase 5 (Cost Governance) uses pricing from auto-discovery. Phase 4 (Wizard) presents discovered models in the setup UI.

---

##### P2-D2: Flexible Complexity Tier System

**What**: Replace the hardcoded 5-tier system with a user-definable tier taxonomy.

**How**:
- Allow `policy.yaml` to define custom tiers:
  ```yaml
  complexity_tiers:
    - name: trivial
      description: "Simple formatting, typo fixes"
      default_model: deepseek-chat
    - name: standard
      description: "Normal feature implementation"
      default_model: claude-sonnet-4
    - name: reasoning
      description: "Complex algorithmic tasks"
      default_model: claude-opus-4
      capabilities_required: ['reasoning']
    - name: vision
      description: "UI/image analysis tasks"
      default_model: gemini-2.5-pro
      capabilities_required: ['vision']
  ```
- Modify `model-router.mjs` to read tiers from config instead of hardcoded `TASK_CATEGORIES`
- Provide sensible defaults that match the current 5-tier system for backward compatibility

**Files to modify/create**:
- `model-router.mjs` — Refactor tier system to be config-driven
- `schema/policy.schema.json` — Add `complexity_tiers` schema
- `planner.mjs` — Allow spec agents to assign custom tiers

**Boundary**: Tier definitions become data. Routing logic remains the same algorithm, just parameterized.

**Connection to bigger picture**: Phase 4 (Wizard) lets users configure tiers visually. Phase 5 (Cost Governance) maps tiers to budget rules.

---

##### P2-D3: Automated Pricing Catalog Refresh

**What**: Extend `pricing-refresh.mjs` to automatically refresh pricing from multiple sources with fallback chains.

**How**:
- Add provider-native pricing API calls (Google AI, Anthropic docs, etc.)
- Implement a priority chain: Provider API → OpenRouter → Models.dev → Last Known
- Support cached vs. uncached input cost differentiation (resolving gap G-CG-3)
- Auto-schedule refresh daily via the scheduler
- Alert if any model's pricing is stale (>7 days)

**Files to modify**:
- `pricing-refresh.mjs` — Add multi-source refresh with fallback
- `pricing.mjs` — Add `cacheReadCost` and `cacheWriteCost` fields
- `scheduler.mjs` — Add daily pricing refresh tick

**Boundary**: Pricing data management only. Does not change cost calculation logic.

**Connection to bigger picture**: Phase 5 (Cost Governance) uses accurate pricing for budget enforcement and ROI calculations.

---

#### Phase 2 Verification Plan

- **Automated Tests**: Model discovery returns expected models for each provider. Custom tiers route correctly. Pricing refresh fetches and merges from multiple sources.
- **Manual Verification**: Start system, verify `models.json` is auto-populated. Change a tier in `policy.yaml`, verify routing changes. Verify pricing catalog shows cache-differentiated costs.

---

### Phase 3: Universal Gateway — IDE & Platform Traffic Interception

> **WHY**: The gateway currently only intercepts traffic from agents that MeridianOS itself spawns. IDE extensions (VS Code Copilot, Cursor, JetBrains AI, Claude Desktop) make direct API calls that completely bypass monitoring. For enterprises paying for Copilot/Cursor seats alongside direct API usage, this shadow spend is invisible.

#### Scope
- System-level proxy configuration for IDE traffic interception
- Wire adapter injection for all supported protocols
- IDE-specific configuration generators
- Transparent TLS interception with certificate management
- Pass-through metering (meter but don't enforce budgets on IDE traffic)

#### Deliverables

##### P3-D1: OpenAI Wire Injection (Complete the Gap)

**What**: Implement the deferred "3.2d-ii" feature — inject the gateway proxy URL for OpenAI-wire harnesses.

**How**:
- Modify `gateway/inject.mjs` to handle `wire === 'openai'` by setting:
  - `OPENAI_BASE_URL` → `http://localhost:8787/v1`
  - `OPENAI_API_KEY` → ephemeral run token
- Ensure OpenCode spawns route through the gateway (currently bypassed)
- Add DeepSeek, OpenRouter, and any OpenAI-compatible provider injection

**Files to modify**:
- `gateway/inject.mjs` — Add OpenAI wire injection
- `harness-adapters.mjs` — Update OpenCode spawn plan to use injected URLs
- `gateway/server.mjs` — Ensure `/v1/chat/completions` path routing works for injected traffic

**Boundary**: Only covers MeridianOS-spawned agents using OpenAI wire. Does not yet cover external IDEs.

**Connection to bigger picture**: This is a prerequisite for P3-D2 (IDE Interception). If native OpenAI wire isn't working, IDE interception will fail.

---

##### P3-D2: IDE Traffic Interception Framework

**What**: Create a system-level proxy configuration that intercepts AI traffic from IDEs and desktop applications.

**How**:
- Create `gateway/ide-interceptor.mjs` with platform-specific proxy configuration:
  - **VS Code Copilot**: Configure `http.proxy` setting or `HTTP_PROXY` env var to route `api.githubcopilot.com` through the gateway
  - **Cursor**: Configure proxy settings to route `api2.cursor.sh` through the gateway
  - **Claude Desktop/Claude Code**: `ANTHROPIC_BASE_URL` → gateway
  - **JetBrains AI**: Configure IDE proxy settings
  - **Antigravity IDE**: `GEMINI_API_BASE_URL` → gateway (Google AI wire adapter from Phase 1)
- Create `gateway/tls-manager.mjs`:
  - Generate a local CA certificate on first run
  - Issue per-upstream TLS certificates for HTTPS interception
  - Store in `.ai/gateway/certs/`
  - Guide user through OS trust store installation
- Tag IDE-origin traffic with `source: 'ide'` and `ide: 'vscode-copilot'` in `token_events`
- IDE traffic defaults to **meter-only** mode (no budget enforcement) — configurable via policy

**Files to create/modify**:
- `gateway/ide-interceptor.mjs` — [NEW] IDE proxy configuration generator
- `gateway/tls-manager.mjs` — [NEW] TLS certificate management
- `gateway/server.mjs` — Add `source` and `ide` fields to token events
- `gateway/token-event.mjs` — Extend schema for IDE metadata
- `gateway/ledger-schema.sql` — Add `source`, `ide_name` columns

**Boundary**: This phase creates the interception infrastructure. It does NOT build the dashboard visualizations (Phase 7) or the configuration wizard for IDEs (Phase 4).

**Connection to bigger picture**: Phase 5 (Cost Governance) aggregates IDE costs alongside agent costs. Phase 7 (Dashboard 2.0) visualizes IDE-specific spend. Phase 4 (Wizard) guides users through IDE proxy setup.

---

##### P3-D3: Subscription Plan Detection

**What**: Detect when users are on paid subscription plans (Copilot Pro, Cursor Pro, Claude Pro) vs. using direct API keys, and adjust metering accordingly.

**How**:
- Create `gateway/subscription-detector.mjs`:
  - Detect Copilot subscription by inspecting `api.githubcopilot.com` auth tokens
  - Detect Cursor subscription by inspecting `api2.cursor.sh` auth patterns
  - Detect Claude Pro by inspecting session-based auth vs. API key auth
- Tag token events with `billing_type: 'subscription' | 'api_key' | 'byok'`
- Track subscription-included vs. overage usage separately

**Files to create**:
- `gateway/subscription-detector.mjs` — [NEW] Subscription plan detection
- `gateway/token-event.mjs` — Add `billing_type` field

**Boundary**: Detection and tagging only. Does not implement any billing or subscription management.

**Connection to bigger picture**: Phase 6 (Subscription Support) builds on this detection to provide cost attribution per plan type.

---

#### Phase 3 Verification Plan

- **Automated Tests**: OpenAI wire injection produces correct env vars. IDE interceptor generates valid proxy configs. TLS certificates are generated and valid.
- **Manual Verification**: Start gateway, configure VS Code to use it as proxy, make a Copilot request, verify token event appears in ledger with `source: 'ide'` and `ide: 'vscode-copilot'`. Repeat for Claude Code and Cursor.

---

### Phase 4: Wizard-Based Configuration & Onboarding

> **WHY**: The current system requires deep technical knowledge of YAML structure, provider APIs, and the MeridianOS architecture to configure. This creates an extremely high barrier to entry. A wizard-based approach makes the system accessible to non-technical operators and enables "zero to monitored" in minutes.

#### Scope
- Interactive CLI setup wizard
- Web-based configuration UI
- Provider onboarding with guided key entry
- Model selection with recommendations
- Budget configuration with templates
- IDE proxy setup assistant

#### Deliverables

##### P4-D1: Interactive CLI Setup Wizard

**What**: A step-by-step CLI wizard that guides users from zero to a fully configured MeridianOS instance.

**How**:
- Create `setup-wizard.mjs` with these stages:
  1. **Welcome & Prerequisites Check**: Node.js version, Git availability, Docker presence
  2. **Repository Detection**: Detect if running inside a Git repo, offer to init one
  3. **Provider Selection**: List available providers from the registry (Phase 1), let user select which ones to enable
  4. **API Key Entry**: For each selected provider, prompt for API key. Store as env var name in config, actual key in `.env` (gitignored). Validate key by making a test API call.
  5. **Model Selection**: For each provider, show available models (from Phase 2 auto-discovery), let user assign to complexity tiers
  6. **Agent Roster**: Configure which agent harnesses to use (Claude Code, Antigravity, OpenCode, etc.)
  7. **Budget Configuration**: Offer templates (Conservative, Balanced, Aggressive) with customizable caps
  8. **IDE Proxy Setup** (optional): Detect installed IDEs, offer to configure proxy settings
  9. **Review & Confirm**: Show generated `tenant.yaml`, `policy.yaml`, and `providers.yaml` for review
  10. **Bootstrap**: Create `.ai/` skeleton, write configs, start gateway, verify connectivity

- Use schema files from Phase 0 (P0-D2) to validate all inputs
- Generate detailed comments in YAML files explaining each field

**Files to create/modify**:
- `setup-wizard.mjs` — [NEW] Interactive CLI wizard
- `setup-wizard-templates/` — [NEW] Budget/config templates (conservative, balanced, aggressive)
- `init.mjs` — Refactor to be callable from wizard
- `gateway/cli.mjs` — Add `--setup` command

**Boundary**: CLI-only wizard. The web-based configuration UI is P4-D2. The wizard produces configuration files; it does not run the daemon.

**Connection to bigger picture**: The wizard uses schemas from Phase 0, providers from Phase 1, models from Phase 2, and IDE configs from Phase 3. It produces the configuration consumed by all subsequent phases.

---

##### P4-D2: Web-Based Configuration UI

**What**: A browser-based configuration panel accessible from the dashboard for ongoing configuration changes.

**How**:
- Extend `dashboard/server.mjs` with configuration management endpoints:
  - `GET /api/config/providers` — List all configured providers with status (active, error, unconfigured)
  - `POST /api/config/providers/:id` — Add/update a provider
  - `DELETE /api/config/providers/:id` — Remove a provider
  - `GET /api/config/models` — List all models with assignment status
  - `POST /api/config/models/:id/tier` — Assign a model to a tier
  - `GET /api/config/budget` — Get current budget configuration
  - `POST /api/config/budget` — Update budget configuration
  - `GET /api/config/ide` — List detected IDEs and proxy status
  - `POST /api/config/ide/:name/enable` — Enable proxy for an IDE
- Build a "Settings" tab in the dashboard with form-based editors generated from JSON schemas
- Include a "Provider Health" panel showing real-time connectivity status for each configured provider

**Files to modify/create**:
- `dashboard/config-api.mjs` — [NEW] Configuration management API handlers
- `dashboard/server.mjs` — Mount config API routes
- `dashboard/index.html` — Add Settings tab with provider/model/budget/IDE configuration forms

**Boundary**: Configuration management only. Does not replace the CLI wizard (P4-D1); complements it for day-2 operations.

**Connection to bigger picture**: This UI is the operator's primary day-2 configuration surface. Phase 7 (Dashboard 2.0) may rebuild this as a proper component-based app, but Phase 4 delivers the MVP.

---

##### P4-D3: Provider Onboarding Flow

**What**: A guided "Add Provider" flow that handles API key validation, model discovery, and default tier assignment in one operation.

**How**:
- When a user adds a provider (via wizard or dashboard):
  1. Select from known providers or enter custom provider details (URL, wire protocol)
  2. Enter API key → validate with a lightweight API call (e.g., `GET /v1/models`)
  3. Auto-discover available models → display with pricing and capabilities
  4. Auto-suggest tier assignments based on model capabilities (reasoning → complex, small → simple)
  5. Set default budget limits based on provider pricing (suggest caps that equal ~$10/day)
  6. Save to `.ai/providers.yaml` and `.ai/policy.yaml`
  7. Run conformance test to verify streaming/thinking support
- For custom/unknown providers:
  1. Auto-detect wire protocol by sending a test request and inspecting the response format
  2. If detection fails, prompt user to select wire protocol manually

**Files to create**:
- `provider-onboarding.mjs` — [NEW] Provider onboarding orchestrator

**Boundary**: Onboarding flow only. Requires Phase 1 (Provider Registry) and Phase 2 (Model Discovery) to be complete.

**Connection to bigger picture**: This is the user-facing realization of Phases 1 and 2. It makes "add a new provider" a 2-minute guided operation instead of a code change.

---

#### Phase 4 Verification Plan

- **Automated Tests**: Wizard produces valid YAML configs for all input combinations. Config API endpoints validate against schemas. Provider onboarding correctly handles valid and invalid API keys.
- **Manual Verification**: Run wizard on a fresh system. Add 3 providers (Anthropic, DeepSeek, Google AI). Verify all models appear. Assign tiers. Start daemon. Verify dashboard shows all providers healthy.

---

### Phase 5: Comprehensive Cost Governance & Observability

> **WHY**: The current cost monitoring is limited to a 7-day rolling window with no historical trends, no per-task ROI, no budget forecasting, and no alerting beyond the gateway's inline 403 denial. For enterprises managing AI spend across multiple providers and IDEs, this is insufficient.

#### Scope
- Unlimited historical data retention
- Materialized cost aggregation tables
- Custom budget windows (hourly, daily, weekly, monthly, per-sprint)
- Per-task cost attribution and ROI analysis
- Budget forecasting and anomaly detection
- Multi-channel alerting (Slack, email, webhook)

#### Deliverables

##### P5-D1: Cost Aggregation Engine

**What**: A background service that materializes cost aggregations from raw `token_events` into queryable summary tables.

**How**:
- Create summary tables in `ledger.db`:
  ```sql
  CREATE TABLE cost_summary_hourly (
    hour TEXT,        -- ISO hour bucket
    tenant TEXT,
    provider TEXT,
    model TEXT,
    agent TEXT,
    source TEXT,      -- 'agent' | 'ide'
    total_tokens INTEGER,
    total_cost_usd REAL,
    request_count INTEGER,
    deny_count INTEGER
  );
  
  CREATE TABLE cost_summary_daily (
    day TEXT,
    tenant TEXT,
    provider TEXT,
    model TEXT,
    agent TEXT,
    source TEXT,
    total_tokens INTEGER,
    total_cost_usd REAL,
    request_count INTEGER,
    deny_count INTEGER
  );
  ```
- Run aggregation on each scheduler tick (or every 5 minutes)
- Support time-range queries without scanning raw events

**Files to create/modify**:
- `gateway/cost-aggregator.mjs` — [NEW] Materialized aggregation engine
- `gateway/ledger-schema.sql` — Add summary tables
- `gateway/ledger.mjs` — Add query methods for summary tables
- `scheduler.mjs` — Add aggregation tick

**Boundary**: Data aggregation only. Does not change the dashboard or alerting.

**Connection to bigger picture**: Phase 7 (Dashboard 2.0) visualizes these aggregations. Phase 5-D3 (Forecasting) projects from these summaries.

---

##### P5-D2: Flexible Budget Windows

**What**: Replace the hardcoded 5-hour and 7-day budget windows with user-configurable windows.

**How**:
- Extend `policy.yaml` budget configuration:
  ```yaml
  agent_budget:
    claude:
      windows:
        - period: 1h
          token_cap: 50000
          cost_cap_usd: 2.00
          enforcement: warn
        - period: 24h
          token_cap: 500000
          cost_cap_usd: 20.00
          enforcement: halt
        - period: 7d
          token_cap: 2000000
          cost_cap_usd: 100.00
          enforcement: halt
        - period: monthly
          token_cap: null    # no token cap
          cost_cap_usd: 500.00
          enforcement: halt
  ```
- Modify `gateway/windows.mjs` to support arbitrary window periods
- Fix the `per_5h_tokens: 0` sentinel value bug — `0` should mean "zero cap" (hard block), `null` should mean "no cap"

**Files to modify**:
- `gateway/windows.mjs` — Support arbitrary windows, fix zero-vs-null semantics
- `budget.mjs` — Read flexible windows from policy
- `schema/policy.schema.json` — Add window configuration schema

**Boundary**: Budget logic only. Does not change enforcement mechanism (still 403).

**Connection to bigger picture**: Phase 6 (Subscription) maps subscription plan limits to budget windows. Phase 7 (Dashboard) shows per-window usage meters.

---

##### P5-D3: Budget Forecasting & Anomaly Detection

**What**: Project future spend based on historical patterns and alert when anomalies are detected.

**How**:
- Create `cost-forecast.mjs`:
  - Calculate rolling average daily/weekly spend per provider, model, agent
  - Project "end of month" spend estimate
  - Detect anomalies: >2x average daily spend triggers an alert
  - Detect trends: steady cost increase over 7+ days triggers a warning
- Integrate with escalation system (`escalation-push.mjs`):
  - New escalation types: `budget_forecast_breach`, `cost_anomaly`, `spend_trend_warning`
  - Configurable alert channels (Slack, email, webhook)

**Files to create/modify**:
- `cost-forecast.mjs` — [NEW] Forecasting and anomaly engine
- `escalation-push.mjs` — Add cost-related escalation types
- `watchdog.mjs` — Add forecast check to health tick

**Boundary**: Forecasting and alerting only. Does not enforce budgets or change routing.

**Connection to bigger picture**: Phase 7 (Dashboard) displays forecasts. Phase 8 (Enterprise) uses forecasts for cross-tenant capacity planning.

---

##### P5-D4: Per-Task Cost Attribution

**What**: Link every dollar spent back to the specific task (board card) that caused it, enabling ROI analysis.

**How**:
- Ensure `task_id` is propagated through the entire chain: Runner → Launcher → Harness → Gateway → Ledger
- Create `task_cost_summary` view:
  ```sql
  CREATE VIEW task_cost_summary AS
  SELECT task, 
         SUM(total_tokens) as total_tokens,
         SUM(cost_usd) as total_cost,
         COUNT(*) as api_calls,
         COUNT(DISTINCT run_id) as runs,
         COUNT(DISTINCT model) as models_used
  FROM token_events
  GROUP BY task;
  ```
- Surface in the dashboard: "This feature cost $4.72 across 3 runs using 2 models"

**Files to modify**:
- `gateway/ledger-schema.sql` — Add task cost view
- `gateway/ledger.mjs` — Add task cost query
- `runner.mjs` — Ensure task_id propagation
- `launcher.mjs` — Pass task_id to harness environment

**Boundary**: Attribution and reporting. Does not change task lifecycle or routing.

**Connection to bigger picture**: Phase 7 (Dashboard) shows per-task costs. Phase 8 (Enterprise) aggregates task costs per team/project.

---

#### Phase 5 Verification Plan

- **Automated Tests**: Aggregation produces correct hourly/daily summaries. Flexible windows correctly enforce at each boundary. Forecasts calculate within expected ranges. Task attribution links correctly.
- **Manual Verification**: Run 10 agent tasks. Verify per-task costs in the dashboard sum to the total provider spend. Set a 1-hour budget window. Verify enforcement triggers at the correct threshold.

---

### Phase 6: Subscription & BYOK Multi-Modal Support

> **WHY**: Users access AI capabilities through multiple billing modalities — direct API keys (BYOK), paid subscriptions (Copilot Pro, Claude Pro), team plans, and enterprise agreements. The system must support all of these and provide cost visibility across billing types.

#### Scope
- BYOK key management UI
- Subscription plan configuration
- Cost attribution by billing type
- License key integration (Stripe)
- Free vs. Pro tier gating

#### Deliverables

##### P6-D1: BYOK Key Management Interface

**What**: A secure UI for managing API keys across providers, with validation and rotation support.

**How**:
- Create a "Keys" panel in the dashboard:
  - List all configured providers and their key status (valid, expired, missing)
  - "Add Key" flow: select provider → enter key → validate → store as env var name in config
  - "Rotate Key" flow: enter new key → validate → swap atomically
  - "Test Key" button: make a lightweight API call to verify key is still valid
- Key storage strategy:
  - Keys are NEVER stored in config files
  - Keys are stored in the OS keychain (via `node:crypto` + platform keystore) or `.env` file
  - Config files only reference the env var name (`keyEnv: ANTHROPIC_API_KEY`)
- Key health monitoring:
  - Periodic validation (daily) via lightweight API calls
  - Alert on key expiration, rate limiting, or revocation

**Files to create/modify**:
- `gateway/key-manager.mjs` — [NEW] Key storage, validation, and rotation
- `dashboard/config-api.mjs` — Add key management endpoints
- `dashboard/index.html` — Add "Keys" panel

**Boundary**: Key management only. Does not change how keys are used at runtime (still via `keyEnv`).

**Connection to bigger picture**: Phase 4 (Wizard) uses this for initial key entry. Phase 3 (IDE Interception) uses validated keys for proxy auth.

---

##### P6-D2: Subscription Plan Configuration

**What**: Allow users to declare their subscription plans so the system can accurately attribute costs.

**How**:
- Extend `policy.yaml` with subscription configuration:
  ```yaml
  subscriptions:
    - provider: github-copilot
      plan: pro
      monthly_cost_usd: 10.00
      seats: 5
      billing_cycle_start: 2026-07-01
    - provider: cursor
      plan: pro
      monthly_cost_usd: 20.00
      seats: 1
    - provider: anthropic
      plan: api
      billing_type: usage_based
  ```
- Create `subscription-tracker.mjs`:
  - Track subscription-included usage vs. overage
  - For seat-based plans: attribute per-seat costs across team members
  - For usage-based plans: track against subscription tier limits
- Surface in dashboard: "Copilot Pro: $10/mo for 5 seats • Used: 3 active seats this month"

**Files to create/modify**:
- `subscription-tracker.mjs` — [NEW] Subscription plan tracking
- `schema/policy.schema.json` — Add subscription configuration schema
- `dashboard/server.mjs` — Add subscription status endpoints

**Boundary**: Configuration and tracking. Does not implement billing or payments.

**Connection to bigger picture**: Phase 7 (Dashboard) visualizes subscription vs. BYOK costs side-by-side. Phase 8 (Enterprise) aggregates across teams.

---

##### P6-D3: License Key & Billing Integration

**What**: Implement the F005 feature spec — Stripe-based license keys for MeridianOS itself.

**How**:
- Implement the licensing system as specified in `docs/features/F005-license-key-stripe-billing.md`:
  - Stripe checkout for Pro licenses
  - RSA-signed license keys with 24-hour offline cache
  - Free tier: 1 agent, DeepSeek-only
  - Pro tier: unlimited agents, all providers, full dashboard
- Add license validation to `boot-guard.mjs`
- Gate advanced features (multi-provider routing, IDE interception, budget forecasting) behind Pro license

**Files to create**:
- `licensing/` — [NEW] Directory with license management
  - `license-validate.mjs` — Local license validation with RSA signature check
  - `license-refresh.mjs` — 24-hour heartbeat to licensing server
  - `stripe-webhook.mjs` — Webhook handler for Stripe events

**Boundary**: Licensing and gating. Does not change core functionality — only gates access.

**Connection to bigger picture**: This monetization layer enables sustainable development of all other phases.

---

#### Phase 6 Verification Plan

- **Automated Tests**: Key validation correctly identifies valid/invalid/expired keys. Subscription tracking calculates correct usage. License validation accepts valid signatures, rejects expired ones.
- **Manual Verification**: Add API keys via dashboard. Rotate a key. Verify old key no longer works. Add a Copilot subscription. Verify usage attribution shows "subscription" vs "api_key" labels.

---

### Phase 7: Dashboard 2.0 — Real-Time Observability Platform

> **WHY**: The current dashboard is an 85KB monolithic HTML file with inline everything. It only shows 7-day rolling windows, has no time-series charts, and has hardcoded provider-specific logic. For a system that aims to be the single pane of glass for AI cost governance, this is inadequate.

#### Scope
- Component-based dashboard architecture
- Time-series cost visualization
- Multi-provider spend comparison
- IDE traffic visualization
- Per-task cost drill-down
- Real-time event streaming
- Export and reporting

#### Deliverables

##### P7-D1: Dashboard Architecture Migration

**What**: Migrate the monolithic `index.html` to a component-based architecture.

**How**:
- Restructure `dashboard/` directory:
  ```
  dashboard/
  ├── index.html           # Shell with minimal bootstrap
  ├── server.mjs           # Backend API (existing, enhanced)
  ├── config-api.mjs       # Config management (from Phase 4)
  ├── static/
  │   ├── app.mjs          # Main application module
  │   ├── components/
  │   │   ├── cost-chart.mjs
  │   │   ├── provider-grid.mjs
  │   │   ├── agent-tiles.mjs
  │   │   ├── budget-meters.mjs
  │   │   ├── ide-traffic.mjs
  │   │   ├── task-costs.mjs
  │   │   ├── settings-panel.mjs
  │   │   └── event-log.mjs
  │   ├── styles/
  │   │   ├── base.css
  │   │   └── components.css
  │   └── utils/
  │       ├── api-client.mjs
  │       └── chart-utils.mjs
  ```
- Use native ES modules (no build step) — maintain zero-dependency philosophy
- Use `<canvas>` or a lightweight charting library for time-series graphs
- Remove all hardcoded provider CSS/logic. Generate agent/provider styles dynamically from registry

**Files to create/modify**:
- `dashboard/static/` — [NEW] Component directory structure
- `dashboard/index.html` — Slim down to shell
- `dashboard/server.mjs` — Add static file serving for new structure

**Boundary**: Frontend restructuring. Backend API changes are minimal (serving new routes).

**Connection to bigger picture**: This architecture supports all subsequent dashboard features. Phase 7-D2 through D4 add features to this component framework.

---

##### P7-D2: Time-Series Cost Visualization

**What**: Interactive time-series charts showing cost trends across providers, models, agents, and IDEs.

**How**:
- Query cost aggregation tables from Phase 5 (hourly/daily summaries)
- Render line charts: daily spend by provider, stacked area charts by model, bar charts by agent
- Support time range selection: Last 24h, 7d, 30d, 90d, Custom range
- Add comparison view: "This week vs. last week" or "This month vs. last month"
- Include budget lines overlay: show budget cap as a horizontal line on cost charts

**Files to create**:
- `dashboard/static/components/cost-chart.mjs` — [NEW] Time-series chart component

**Boundary**: Visualization only. Uses data from Phase 5 aggregation.

**Connection to bigger picture**: This is the primary cost visibility tool for operators. Phase 8 (Enterprise) adds tenant-scoped views.

---

##### P7-D3: IDE Traffic Dashboard

**What**: A dedicated panel showing AI traffic from IDEs and desktop applications.

**How**:
- Query `token_events` filtered by `source = 'ide'`
- Show per-IDE breakdown: Copilot, Cursor, Claude Desktop, JetBrains AI
- Show per-user breakdown (if multi-user proxy)
- Display subscription vs. overage costs
- Show "shadow spend" metric: cost from IDE traffic that was previously invisible
- Alert indicator: "Your team's Copilot usage costs more than your API budget"

**Files to create**:
- `dashboard/static/components/ide-traffic.mjs` — [NEW] IDE traffic visualization

**Boundary**: Visualization of Phase 3 (IDE Interception) data. Requires Phase 3 to be deployed.

**Connection to bigger picture**: This panel is the key differentiator for enterprise customers who need visibility into "shadow AI spend" from IDE subscriptions.

---

##### P7-D4: Export & Reporting

**What**: Export cost data for finance teams, compliance, and external tooling.

**How**:
- Add export endpoints to dashboard API:
  - `GET /api/export/csv?from=DATE&to=DATE&groupBy=provider,model` — CSV export
  - `GET /api/export/json?from=DATE&to=DATE` — JSON export
  - `GET /api/export/pdf` — PDF report with charts (using a headless render)
- Add scheduled report generation:
  - Weekly cost summary email/Slack message
  - Monthly invoice-style report per tenant
- Support integration with finance tools (QuickBooks, Xero) via webhook

**Files to create**:
- `dashboard/export.mjs` — [NEW] Export engine
- `dashboard/report-templates/` — [NEW] Report templates (HTML → PDF)

**Boundary**: Export and reporting. Does not change data collection or visualization.

**Connection to bigger picture**: Phase 8 (Enterprise) extends reporting to multi-tenant cross-organizational views.

---

#### Phase 7 Verification Plan

- **Automated Tests**: Export produces valid CSV/JSON. Chart components render without errors. API endpoints return correct time-range filtered data.
- **Manual Verification**: Open dashboard. Verify time-series charts show historical data. Switch time ranges. Export CSV. Verify IDE traffic panel shows intercepted requests. Generate a PDF report.

---

### Phase 8: Enterprise Scalability & Multi-Tenant Hardening

> **WHY**: The current system is designed for single-operator use on a local machine. For enterprise adoption, it needs to support multiple teams, centralized governance, horizontal scaling, and remote database backends.

#### Scope
- Full multi-tenant isolation with self-service tenant creation
- Remote database support (PostgreSQL)
- Horizontal gateway scaling
- Role-based access control
- Centralized policy management
- Kubernetes deployment

#### Deliverables

##### P8-D1: Multi-Tenant Self-Service

**What**: Replace the hardcoded `'pv'` tenant with self-service tenant provisioning.

**How**:
- Create `tenant-manager.mjs`:
  - `createTenant(name, config)` — Provision a new tenant with isolated DB, config, and gateway scope
  - `listTenants()` — List all registered tenants
  - `deleteTenant(name)` — Decommission a tenant (soft-delete, preserve data)
- Each tenant gets:
  - Isolated `aios.db` (state)
  - Shared `ledger.db` with tenant-scoped queries (already designed)
  - Independent `policy.yaml` and `tenant.yaml`
  - Scoped dashboard views (see only your tenant's data)
- Add `X-Tenant` header to gateway requests for tenant routing
- Remove all `'pv'` hardcodes

**Files to create/modify**:
- `tenant-manager.mjs` — [NEW] Tenant lifecycle management
- `control-plane.mjs` — Extend to support dynamic tenant addition
- `gateway/server.mjs` — Add tenant routing via header
- `dashboard/server.mjs` — Add tenant-scoped API queries

**Boundary**: Tenant management only. Does not add auth/RBAC (P8-D3) or remote DB (P8-D2).

**Connection to bigger picture**: Phase 8-D2 (Remote DB) enables shared tenant data. Phase 8-D3 (RBAC) controls tenant access.

---

##### P8-D2: Remote Database Support

**What**: Add PostgreSQL as an alternative to SQLite for both `aios.db` and `ledger.db`.

**How**:
- Create `db-adapter.mjs` with a storage abstraction:
  ```
  DbAdapter {
    query(sql, params): rows
    run(sql, params): result
    transaction(fn): result
    close(): void
  }
  ```
- Implement two adapters:
  - `db-sqlite.mjs` — Wraps existing `node:sqlite` usage
  - `db-postgres.mjs` — Uses `pg` (node-postgres)
- Configure via `policy.yaml`:
  ```yaml
  storage:
    backend: postgres  # or 'sqlite' (default)
    connection_string: postgres://user:pass@host:5432/meridian
  ```
- Migrate schema: `schema.sql` → `migrations/001-initial.sql` with up/down scripts

**Files to create/modify**:
- `db-adapter.mjs` — [NEW] Storage abstraction
- `db-sqlite.mjs` — [NEW] SQLite adapter (extract from `db.mjs`)
- `db-postgres.mjs` — [NEW] PostgreSQL adapter
- `migrations/` — [NEW] Schema migration scripts
- `db.mjs` — Refactor to use adapter pattern

**Boundary**: Storage layer only. All existing queries must work transparently on both backends.

**Connection to bigger picture**: Remote DB enables centralized multi-tenant storage, cloud deployment, and data durability guarantees.

---

##### P8-D3: Role-Based Access Control

**What**: Add user authentication and role-based authorization for the dashboard and API.

**How**:
- Define roles: `admin`, `operator`, `viewer`, `agent`
- Implement authentication:
  - Local: username/password with bcrypt hashing
  - SSO: OAuth2/OIDC integration (Google, Azure AD, GitHub)
- Implement authorization middleware for all API endpoints
- Tenant-scoped roles: a user can be `admin` of one tenant and `viewer` of another
- API token support for CI/CD integration

**Files to create**:
- `auth/` — [NEW] Authentication and authorization module
  - `auth-middleware.mjs` — Express-like middleware for route protection
  - `user-store.mjs` — User management
  - `oauth-provider.mjs` — OAuth2 integration
  - `api-tokens.mjs` — Machine-to-machine tokens

**Boundary**: Auth/authz layer. Does not change business logic.

**Connection to bigger picture**: RBAC is required for any enterprise deployment. Without it, the dashboard is open to anyone on the network.

---

##### P8-D4: Kubernetes Deployment

**What**: Provide Helm charts and Kubernetes manifests for cloud-native deployment.

**How**:
- Create `deploy/kubernetes/`:
  - `helm/meridian-gateway/` — Helm chart for gateway deployment (horizontally scalable)
  - `helm/meridian-daemon/` — Helm chart for daemon deployment (single-replica with leader election)
  - `helm/meridian-dashboard/` — Helm chart for dashboard (horizontally scalable)
- Support for:
  - Horizontal Pod Autoscaling for gateway (scale by request rate)
  - Persistent Volume Claims for SQLite (or PostgreSQL connection)
  - ConfigMaps for `tenant.yaml` and `policy.yaml`
  - Secrets for API keys
  - Ingress with TLS for dashboard access

**Files to create**:
- `deploy/kubernetes/` — [NEW] K8s deployment manifests
- `deploy/helm/` — [NEW] Helm charts

**Boundary**: Deployment artifacts only. No code changes required (the app already runs in Docker).

**Connection to bigger picture**: K8s deployment is required for enterprise cloud adoption. Combined with P8-D2 (Remote DB) and P8-D3 (RBAC), this completes the enterprise deployment story.

---

#### Phase 8 Verification Plan

- **Automated Tests**: Multi-tenant isolation prevents cross-tenant data access. PostgreSQL adapter passes all existing SQLite tests. RBAC denies unauthorized access.
- **Manual Verification**: Create 2 tenants. Log in as each. Verify data isolation. Deploy to K8s cluster. Verify horizontal gateway scaling under load.

---

### Phase 9: Ecosystem Integrations & Marketplace

> **WHY**: A truly provider-agnostic system should integrate with the broader ecosystem — project management tools, communication platforms, CI/CD pipelines, and compliance frameworks. This phase transforms MeridianOS from a standalone tool into a platform.

#### Scope
- Pluggable intake source marketplace
- Pre-built integrations (Jira, Linear, Notion, Teams)
- Webhook/API framework for custom integrations
- Compliance and audit reporting
- Community plugin system

#### Deliverables

##### P9-D1: Intake Source Plugin Marketplace

**What**: A registry of pre-built and community-contributed intake source adapters.

**How**:
- Formalize the `IntakeSource` contract from `intake-registry.mjs` as a published interface
- Create pre-built adapters:
  - `jira-source.mjs` — Jira Cloud/Server integration
  - `linear-source.mjs` — Linear integration
  - `notion-source.mjs` — Notion database integration
  - `teams-source.mjs` — Microsoft Teams integration
  - `webhook-source.mjs` — Generic webhook receiver
- Create a plugin discovery mechanism:
  - Scan `node_modules/@meridian-plugins/` for adapters
  - Support local plugins from `.ai/plugins/` directory
- Surface in wizard (Phase 4): "Select your intake sources"

**Files to create**:
- `intake-adapters/` — [NEW] Pre-built source adapters
- `plugin-loader.mjs` — [NEW] Plugin discovery and loading

**Boundary**: Intake source plugins only. Does not change the orchestration or execution layers.

**Connection to bigger picture**: Each new intake source expands the addressable market. Phase 4 (Wizard) presents these as options during setup.

---

##### P9-D2: Compliance & Audit Reporting

**What**: Generate compliance reports for enterprise governance requirements.

**How**:
- Create `compliance-reporter.mjs`:
  - SOC2 audit trail: who accessed what data, when, via which model
  - GDPR data flow mapping: where does user data go (which providers, regions)
  - Cost allocation reports: per-department, per-project, per-team
  - Model usage reports: which models are used for which tasks (for AI governance)
- Store compliance events in a dedicated audit log (separate from operational events)
- Support export to compliance tools (Vanta, Drata, etc.)

**Files to create**:
- `compliance/` — [NEW] Compliance reporting module
  - `audit-log.mjs` — Dedicated compliance event log
  - `reports/` — Report generators (SOC2, GDPR, cost allocation)

**Boundary**: Reporting only. Uses existing data from the ledger and state DB.

**Connection to bigger picture**: Compliance reporting is a hard requirement for enterprise adoption. This makes MeridianOS viable for regulated industries.

---

##### P9-D3: API & Webhook Framework

**What**: A public API and webhook system for custom integrations.

**How**:
- Create a documented REST API:
  - `GET /api/v1/tasks` — List tasks
  - `GET /api/v1/costs` — Query cost data
  - `POST /api/v1/webhooks` — Register webhooks for events
  - `GET /api/v1/providers` — List providers and status
  - `POST /api/v1/tasks` — Create tasks programmatically
- Implement webhook delivery for events:
  - `task.created`, `task.completed`, `task.failed`
  - `budget.warning`, `budget.exceeded`
  - `provider.error`, `provider.added`
  - `cost.anomaly`, `cost.threshold`
- Include API documentation (OpenAPI/Swagger spec)

**Files to create**:
- `api/v1/` — [NEW] Public REST API
- `api/webhooks.mjs` — [NEW] Webhook delivery engine
- `api/openapi.yaml` — [NEW] API documentation

**Boundary**: External API surface. Does not change internal architecture.

**Connection to bigger picture**: The public API enables ecosystem integrations that haven't been imagined yet. CI/CD tools, custom dashboards, finance systems, and third-party platforms can all integrate via this API.

---

#### Phase 9 Verification Plan

- **Automated Tests**: All intake adapters correctly normalize to `IntakeSource` contract. Webhooks deliver to registered URLs. API endpoints return expected data.
- **Manual Verification**: Add a Jira integration via wizard. Verify tasks are imported. Register a webhook. Verify events are delivered. Generate a SOC2 compliance report.

---

## 8. Phase Dependency Map

```mermaid
graph TD
    P0["Phase 0\nFoundation Hardening"]
    P1["Phase 1\nProvider Abstraction"]
    P2["Phase 2\nModel Registry"]
    P3["Phase 3\nIDE Interception"]
    P4["Phase 4\nWizard Config"]
    P5["Phase 5\nCost Governance"]
    P6["Phase 6\nSubscription & BYOK"]
    P7["Phase 7\nDashboard 2.0"]
    P8["Phase 8\nEnterprise Scale"]
    P9["Phase 9\nEcosystem"]

    P0 --> P1
    P0 --> P4
    P1 --> P2
    P1 --> P3
    P2 --> P4
    P3 --> P4
    P2 --> P5
    P3 --> P5
    P4 --> P6
    P5 --> P7
    P3 --> P7
    P6 --> P7
    P7 --> P8
    P8 --> P9
    P5 --> P8

    style P0 fill:#ff6b6b,stroke:#c92a2a,color:white
    style P1 fill:#ff922b,stroke:#d9480f,color:white
    style P2 fill:#fcc419,stroke:#e67700,color:black
    style P3 fill:#51cf66,stroke:#2b8a3e,color:white
    style P4 fill:#339af0,stroke:#1864ab,color:white
    style P5 fill:#845ef7,stroke:#5f3dc4,color:white
    style P6 fill:#f06595,stroke:#c2255c,color:white
    style P7 fill:#20c997,stroke:#087f5b,color:white
    style P8 fill:#868e96,stroke:#495057,color:white
    style P9 fill:#ffd43b,stroke:#f08c00,color:black
```

### Execution Order

| Order | Phase | Duration (est.) | Prerequisites | Parallel With |
|-------|-------|-----------------|---------------|---------------|
| 1st | Phase 0 — Foundation | 1 week | None | — |
| 2nd | Phase 1 — Provider Abstraction | 2 weeks | Phase 0 | — |
| 3rd | Phase 2 — Model Registry | 2 weeks | Phase 1 | Phase 3 |
| 3rd | Phase 3 — IDE Interception | 2 weeks | Phase 1 | Phase 2 |
| 4th | Phase 4 — Wizard Config | 2 weeks | Phases 2, 3 | — |
| 5th | Phase 5 — Cost Governance | 2 weeks | Phases 2, 3 | Phase 6 |
| 5th | Phase 6 — Subscription & BYOK | 2 weeks | Phase 4 | Phase 5 |
| 6th | Phase 7 — Dashboard 2.0 | 3 weeks | Phases 5, 6 | — |
| 7th | Phase 8 — Enterprise Scale | 3 weeks | Phases 5, 7 | — |
| 8th | Phase 9 — Ecosystem | 3 weeks | Phase 8 | — |

**Total estimated duration**: ~18 weeks (4.5 months) with parallelization.

---

## 9. Glossary

| Term | Definition |
|------|-----------|
| **BYOK** | Bring Your Own Key — users provide their own API keys for LLM providers |
| **Wire Protocol** | The HTTP API format used by a provider (e.g., Anthropic uses `x-api-key` auth and `/v1/messages`; OpenAI uses `Bearer` auth and `/v1/chat/completions`) |
| **Harness** | A CLI tool that wraps an LLM for agent execution (e.g., `claude-code`, `opencode`, `antigravity`) |
| **Ledger** | The append-only SQLite database (`ledger.db`) recording every LLM API call with token counts and costs |
| **Gateway Sidecar** | The local forward proxy that intercepts, meters, and enforces budgets on all agent-to-LLM traffic |
| **DomainPlugin** | A configuration object defining project-specific agents, prompts, guardrails, and risk taxonomies |
| **Tenant** | An isolated instance of MeridianOS with its own state, config, and budget scope |
| **Complexity Tier** | A classification of task difficulty used to select the appropriate model (e.g., `simple` → cheap model, `critical` → premium model) |
| **Shadow Spend** | AI costs from IDE extensions and subscriptions that are invisible to traditional monitoring |
| **Intake Source** | An external system (ADO, Jira, Slack, filesystem) that provides tasks to MeridianOS |
| **Conformance Test** | A test that verifies a provider's API is compatible with a given wire protocol |
| **null-is-unknown** | The ledger's data integrity contract: `null` means the value is genuinely unknown, never fabricated as `0` |

---

> **End of Document**  
> This plan covers 10 phases (0-9), 30+ deliverables, and addresses every gap identified across 100+ source files and 5 architecture diagrams. Each phase is self-contained enough for an independent agent to execute end-to-end while maintaining clear boundary definitions and connections to the broader system.
