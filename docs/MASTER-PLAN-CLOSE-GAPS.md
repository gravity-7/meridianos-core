# MASTER-PLAN-CLOSE-GAPS — MeridianOS Complete Transformation Blueprint

> **Date**: 2026-07-27  
> **Status**: Final Synthesis — merging Plan A (AUDIT-AND-TRANSFORMATION-PLAN) + Plan B (SYSTEM-AUDIT-AND-PLAN) + Independent Review + Non-Technical Usability Review + Distribution Strategy  
> **Backbone**: Plan B's 6-phase execution structure, enhanced with Plan A's audit depth, plus new Prerequisite Phase + Distribution Phase (P7)  
> **Target**: Production-grade, agentic-development-ready, every minor detail captured for multi-agent orchestration systems (spec-kit, gem-team, BMAD-METHOD)  
> **This document is a running plan** — it will be updated as phases are executed, blockers are discovered, and decisions are revised.

---

## Executive Summary

MeridianOS has a solid architectural foundation but critical gaps in provider/model agnosticism, universal gateway monitoring, non-technical usability, and distribution. This master plan closes every gap identified across 5 independent analyses, producing a system that is:

- **Provider-agnostic**: Any LLM provider, any wire protocol, added in minutes — zero code changes
- **Model-agnostic**: Models auto-discovered, fresh pricing, capability-aware routing with fallback chains
- **Universally monitored**: All AI traffic — agent-spawned, IDE-driven, CLI-ad-hoc — metered through one gateway
- **Non-technical usable**: Browser-first setup, dollar-based budgets, one-click IDE integration, packaged installer
- **Commercially ready**: Stripe billing, license enforcement, multi-tenant platform, team collaboration

**Total estimated duration**: ~20 weeks (with parallelization: 16-18 weeks)  
**Phases**: Prerequisite + P0–P7 (9 phases)  
**Epics**: 9 | **Features**: ~55 | **User Stories**: ~180+

---

## Architecture Decision Record

### Decisions from Plan A + Plan B + Independent Review Synthesis

| # | Decision | Rationale | Source |
|---|----------|-----------|--------|
| AD-1 | Plan B's 6-phase backbone with Plan A's extras folded into P6/P7 | Independent review verdict: Plan B = superior execution, Plan A = superior depth | Review §12 |
| AD-2 | Prerequisite Phase before any code changes | Agentic development must be enabled first; stale branches/PRs must be resolved | User directive |
| AD-3 | Gateway as default ON (opt-out, not opt-in) | Eliminates dual-metering confusion; gateway is the single source of truth | Plan B P0.2 |
| AD-4 | Configurability (P3) before IDE Integration (P4) | Users need dashboard UI to configure IDE proxy settings before IDE features ship | Plan B sequencing |
| AD-5 | WireAdapter formal interface contract | Prevents adapter drift; cleaner than Plan B's `generic-http` alone | Plan A P1-D1 |
| AD-6 | Dollar-first budget (not token-first) | Non-technical users think in dollars; wizard converts to token caps | Plan B P3.2, Usability §4 |
| AD-7 | Browser-first wizard + CLI wizard coexist | CLI for automation/CI; browser (dashboard) for non-technical users | Distribution §Path 1, Usability §2 |
| AD-8 | VS Code Extension as distribution entry point | Fastest non-terminal path (3-4 weeks); VS Code has 22M+ MAU | Distribution §Path 1 |
| AD-9 | Packaged binary (.exe/.dmg) in Phase 7 | Required for true non-technical adoption; `bun compile` produces smallest binary | Distribution §Path 3 |
| AD-10 | `yaml-lite.mjs` → standards-compliant YAML library | Configuration profiles need YAML anchors/extends; `yaml-lite.mjs` doesn't support them | Review §11.4 |
| AD-11 | `null` = "no cap", `0` = "zero cap" (hard block) | Fix sentinel value bug in `windows.mjs`; correct semantics | Plan A G-CG-5 |
| AD-12 | Silent Anthropic OAuth fallback = Phase 0 security fix | Misconfigured gateway could silently allow unmetered direct API calls | Review §11.3 |

---

## Phase Structure Overview

| Phase | Epic Title | Duration | Stories | Critical Path |
|-------|-----------|----------|---------|---------------|
| **PR** | Establish Agentic Development Infrastructure, Repository Hygiene, and Quality Automation Before Any Code Changes | 3 days | 20 | 3 days |
| **P0** | Harden the Existing System Foundation by Fixing Critical Bugs, Unifying Configuration, and Making the Gateway the Default Metering Path | 5 days | 14 | 5 days |
| **P1** | Transform the Gateway into a Universal Forward Proxy with Zero-Config Bootstrap, Cross-Wire Translation, and Production-Grade Key Management | 10 days | 6 | 10 days |
| **P2** | Deliver Complete Provider and Model Agnosticism Through Declarative Registries, Auto-Discovery, Wizard-Based Configuration, and Intelligent Fallback Routing | 15 days | 8 | 15 days |
| **P3** | Achieve Full End-User Configurability with a Unified Dashboard Settings Panel, Browser-First Setup Wizard, Dollar-Based Budgets, and Inheritable Configuration Profiles | 10 days | 8 | — |
| **P4** | Integrate All Major IDE and Platform Traffic Sources Through Automatic Proxy Configuration, a VS Code Extension Entry Point, MCP Server Integration, and Subscription Plan Support | 15 days | 8 | — |
| **P5** | Build Comprehensive AI Spend Observability with Real-Time Analytics Dashboards, Budget Forecasting, Model Cost Optimization Recommendations, and Multi-Channel Alerting | 15 days | 12 | — |
| **P6** | Deliver a Commercial-Grade Multi-Tenant Platform with Project Supervision, Remote Dashboard Access, Team Collaboration, Stripe Billing, Kubernetes Deployment, and Compliance Reporting | 20 days | 14 | — |
| **P7** | Establish Multi-Path Distribution and a Thriving Ecosystem Through Packaged Binaries, Electron Desktop App, Public REST API, Plugin Marketplace, and Hybrid Cloud Control Plane | 20 days | 12 | — |

**Total: ~104 working days (~21 weeks) sequential; ~80 days (~16 weeks) with full parallelization.**

---

## Pre-Requisite Phase: Agentic Development Enablement

**Duration**: 3 days (with parallelization)  
**Priority**: P0 — Must complete before ANY code changes  
**Depends on**: Nothing  
**Blocks**: All phases P0–P7

### Rationale

Before any feature work begins, the repository must be prepared for multi-agent orchestrated development. This means: clean git state, defined agents/skills/plugins/MCP servers, coding rules, PR discipline, and CI/CD infrastructure. Without this, agentic development will create chaos (stale branches, merge conflicts, inconsistent code style).

### 📦 Parallel Execution Groups

| Group | Stories | Duration | Starts After | Rationale |
|-------|---------|----------|--------------|-----------|
| **G1-SEQUENTIAL** | PR-0.1.1 → PR-0.1.2 → PR-0.1.3 | 0.5 day | Hour 0 | Must clean branches before merging; inherently sequential |
| **G2-PARALLEL** | PR-0.2.1, PR-0.2.2, PR-0.2.3 | 0.5 day | G1 complete | Only depend on clean repo — no mutual dependencies |
| **G3-PARALLEL** | PR-1.1.1, PR-1.1.2, PR-1.1.3, PR-1.2.1, PR-1.2.2 | 0.5 day | G2 complete | All rules/config files are independent — no mutual dependencies |
| **G4-PARALLEL** | All 10 PR-2 stories | 1 day | G2 complete (∥ G3) | All static file creation — completely independent of rules |
| **G5-PARALLEL** | PR-3.1.1, PR-3.1.2, PR-3.1.3 | 0.5 day | G3 complete | CI workflows need rules defined first but are mutually independent |

---

### Epic PR-0: Establish a Clean and Agent-Ready Repository Baseline

#### Feature PR-0.1: Audit, Merge, and Close All Stale Branches and Pull Requests

**User Stories**:

- **PR-0.1.1**: Merge or close every stale remote branch so development begins from a pristine main branch with zero lingering work-in-progress
  - **Est. hours**: 2h | **Depends on**: None | **Parallel with**: None (sequential)
  - Audit all remote branches on `github.com/gravity-7/meridianos-core`; for each branch check PR status, mergeability, staleness (>14d)
  - ⚠️ **Risk**: Active work on a stale branch gets destroyed. **Mitigation**: Review each branch manually before automated close.
  - ✅ **Verify**: `git branch -r | wc -l` returns expected count. `git fetch --prune` confirms no dangling refs.

- **PR-0.1.2**: Review and close every open pull request so the repository has zero lingering unreviewed or unmerged code changes
  - **Est. hours**: 1h | **Depends on**: PR-0.1.1
  - List all open PRs via GitHub API; review, approve/merge or close with explanation
  - ✅ **Verify**: `gh pr list --state open --repo gravity-7/meridianos-core` returns zero results.

- **PR-0.1.3**: Merge the current working branch docs/gtm-competitive-verification into main so all future development continues from the canonical main branch
  - **Est. hours**: 1h | **Depends on**: PR-0.1.2
  - Create PR from `docs/gtm-competitive-verification` → `main`; merge after review; delete source branch
  - ✅ **Verify**: `git branch` shows `* main`. `git status` is clean.

#### Feature PR-0.2: Create Standardized Repository Templates and Agent Instruction Files for Consistent Multi-Agent Development

**User Stories**:

- **PR-0.2.1**: Create a complete set of GitHub issue and pull request templates so every AI agent produces consistent, well-structured and traceable work items
  - **Est. hours**: 1.5h | **Depends on**: PR-0.1.3 | **Parallel with**: PR-0.2.2, PR-0.2.3
  - Create `.github/PULL_REQUEST_TEMPLATE.md`, `.github/ISSUE_TEMPLATE/feature_request.yml`, `bug_report.yml`, `chore_request.yml`
  - ✅ **Verify**: `gh issue create --template feature_request` opens interactive form.

- **PR-0.2.2**: Define a comprehensive AGENTS.md file at repository root that codifies all coding conventions, naming standards, and architectural rules for every AI agent to follow
  - **Est. hours**: 2h | **Depends on**: PR-0.1.3 | **Parallel with**: PR-0.2.1, PR-0.2.3
  - Contents: ES modules, file naming `*.mjs`, test conventions `*.test.mjs`, commit format `type(scope): description`, PR process
  - ✅ **Verify**: AGENTS.md contains sections: Naming, Imports, Testing, Commits, PR Process.

- **PR-0.2.3**: Write detailed per-agent instruction files defining the exact role boundaries, allowed tool sets, forbidden actions, output formats, and inter-agent handoff protocols for all four agent personas
  - **Est. hours**: 2h | **Depends on**: PR-0.1.3 | **Parallel with**: PR-0.2.1, PR-0.2.2
  - Create `.github/agents/builder.instructions.md`, `reviewer.instructions.md`, `designer.instructions.md`, `docs-writer.instructions.md`
  - ✅ **Verify**: 4 instruction files exist with Role, Allowed Tools, Forbidden Actions, Output Format, Handoff Protocol sections.

---

### Epic PR-1: Define and Automate Development Rules, Commit Discipline, and Coding Standards

#### Feature PR-1.1: Establish and Enforce Strict Pull Request Discipline and Branch Protection Rules

**User Stories**:

- **PR-1.1.1**: Define a mandatory PR discipline policy ensuring no feature is marked complete until every associated pull request is reviewed, approved, and merged into the main branch with zero stale artifacts
  - **Est. hours**: 1h | **Depends on**: PR-0 | **Parallel with**: PR-1.1.2, PR-1.1.3, PR-1.2.1, PR-1.2.2
  - Create `.github/rules/pr-discipline.md` with 6 rules: all PRs merged before feature done; no stale PRs >48h; branches deleted after merge; main always deployable; PR references parent issue; PR title format `[Epic]-[Feature]: description`
  - ✅ **Verify**: Rule file exists with all 6 rules and rationale.

- **PR-1.1.2**: Configure GitHub branch protection rules on the main branch to require mandatory pull request reviews, passing status checks, and up-to-date branches, preventing any direct or force pushes
  - **Est. hours**: 0.5h | **Depends on**: PR-0 | **Parallel with**: PR-1.1.1, PR-1.1.3, PR-1.2.1, PR-1.2.2
  - Require: 1 approver, status checks pass, branch up-to-date, no force push, no direct push, conversation resolution
  - ✅ **Verify**: `git push origin main` rejected; merge button disabled until CI passes + reviewer approves.

- **PR-1.1.3**: Implement a pre-commit hook that automatically validates code quality by running targeted fast checks and blocking commits that would fail CI
  - **Est. hours**: 1h | **Depends on**: PR-0 | **Parallel with**: PR-1.1.1, PR-1.1.2, PR-1.2.1, PR-1.2.2
  - Check for `.only()` in tests; validate no `console.log` in production `*.mjs`; lint staged files only
  - ✅ **Verify**: Commit with `.only()` rejected. `git commit --no-verify` bypasses.

#### Feature PR-1.2: Standardize Code Formatting, Linting Rules, and Editor Configuration Across the Entire Repository

**User Stories**:

- **PR-1.2.1**: Create a comprehensive .editorconfig file that enforces consistent whitespace handling, indentation style, line endings, and character encoding across all supported editors and IDEs
  - **Est. hours**: 0.5h | **Depends on**: PR-0 | **Parallel with**: PR-1.1.x
  - `indent_style = space`, `indent_size = 2`, `end_of_line = lf`, `charset = utf-8`
  - ✅ **Verify**: Open `.mjs` file → indentation is 2 spaces.

- **PR-1.2.2**: Configure ESLint with rules specifically tailored for ES module conventions, rejecting CommonJS patterns and enforcing the project's zero-dependency import/export philosophy
  - **Est. hours**: 1.5h | **Depends on**: PR-0 | **Parallel with**: PR-1.1.x
  - Rules: no `require()`, no `module.exports`, enforce `import`/`export`, `no-var` (error), `prefer-const` (error)
  - ⚠️ **Risk**: Lint reveals hundreds of violations. **Mitigation**: First PR adds config only; second PR fixes incrementally.
  - ✅ **Verify**: `npm run lint` runs without crashing.

---

### Epic PR-2: Define Agent Personas, Domain-Specific Skills, MCP Server Configurations, and Plugin Definitions

#### Feature PR-2.1: Create Formal Agent Definition Files for All Four Development Personas with Assigned Models and Tool Permissions

**User Stories**:

- **PR-2.1.1**: Define the meridian-build implementation agent with full code generation, test writing, file editing, terminal execution, code search, and GitHub integration capabilities
  - **Est. hours**: 1h | **Depends on**: PR-0 | **Parallel with**: All PR-2 stories
  - File: `.github/agents/meridian-build.agent.md` with YAML frontmatter: `name`, `description`, `model: claude-sonnet-4`, `tools`, `instructions`
  - ✅ **Verify**: Valid YAML frontmatter; all referenced files exist.

- **PR-2.1.2**: Define the meridian-review, meridian-design, and meridian-docs agent personas each with appropriately scoped tool permissions, read-only constraints, and specialized instruction file references
  - **Est. hours**: 1.5h | **Depends on**: PR-0 | **Parallel with**: All PR-2 stories
  - `meridian-review`: read-only + PR review; `meridian-design`: read-only + diagram generation; `meridian-docs`: read/write docs/ only
  - ✅ **Verify**: 4 agent definition files exist with unique `name`, `description`, `tools`.

#### Feature PR-2.2: Build a Complete Knowledge Base of MeridianOS Domain Skills Covering the Core System and All Five Architectural Subsystems

**User Stories**:

- **PR-2.2.1**: Create a comprehensive MeridianOS core skill file documenting the complete module map, data flow architecture, key design patterns, test conventions, and common development pitfalls
  - **Est. hours**: 2h | **Depends on**: PR-0 | **Parallel with**: All PR-2 stories
  - File: `.github/skills/meridianos-core/SKILL.md`
  - ✅ **Verify**: All 5 sections populated; referenced in agent instruction files.

- **PR-2.2.2**: Create dedicated skill files for each of the five major architectural subsystems covering gateway internals, dashboard architecture, orchestration pipeline, configuration management, and data storage patterns
  - **Est. hours**: 3h | **Depends on**: PR-0 | **Parallel with**: All PR-2 stories
  - `.github/skills/meridianos-gateway/SKILL.md`, `meridianos-dashboard/SKILL.md`, `meridianos-orchestration/SKILL.md`, `meridianos-config/SKILL.md`, `meridianos-data/SKILL.md`
  - ✅ **Verify**: 6 total skill files; each has Architecture Overview, Key Files, Key Functions, Common Modifications sections.

#### Feature PR-2.3: Configure Model Context Protocol Server Endpoints for GitHub Integration, Local File System Access, and MeridianOS Dashboard Monitoring

**User Stories**:

- **PR-2.3.1**: Configure the GitHub MCP server with proper repository targeting so agents can create, update, and manage pull requests and issues programmatically during development
  - **Est. hours**: 0.5h | **Depends on**: PR-0 | **Parallel with**: All PR-2 stories
  - File: `.github/mcp/github-mcp.json` → `owner: gravity-7`, `repo: meridianos-core`
  - ✅ **Verify**: Valid JSON with correct repo reference.

- **PR-2.3.2**: Configure the filesystem and terminal MCP servers with the correct workspace root path and an explicit allowlist of permitted shell commands for safe agent execution
  - **Est. hours**: 0.5h | **Depends on**: PR-0 | **Parallel with**: All PR-2 stories
  - Filesystem root: `c:/projects/meridianos-core`; Terminal allowed: `npm test`, `npm run lint`, `node`, `git status/diff/log/branch/add/commit/push`
  - ⚠️ **Risk**: Allowlist too permissive. **Mitigation**: Explicitly block `rm -rf`, `git push --force`, `npm publish`, `chmod`, `sudo`.
  - ✅ **Verify**: MCP configs valid JSON; allowed commands explicit (no wildcards).

- **PR-2.3.3**: Configure a dedicated MeridianOS dashboard MCP server endpoint so agents can query live test results, verify gateway health, and check spend metrics directly during development cycles
  - **Est. hours**: 0.5h | **Depends on**: PR-0 | **Parallel with**: All PR-2 stories
  - File: `.github/mcp/meridianos-mcp.json` → connects to `localhost:4317`
  - ✅ **Verify**: MCP config exists with correct port and endpoints.

#### Feature PR-2.4: Define Plugin Manifests for the VS Code Extension and Azure DevOps Connector as the Two Highest-Priority Integration Surfaces

**User Stories**:

- **PR-2.4.1**: Create the VS Code extension plugin manifest defining the MeridianOS sidebar view, activation events, all registered commands, and the webview-based setup wizard entry point
  - **Est. hours**: 1h | **Depends on**: PR-0 | **Parallel with**: All PR-2 stories
  - File: `.github/plugins/vscode-meridianos/plugin.json` — `meridianos.vscode-agent`, `onStartupFinished`, commands: `meridian.setup/openDashboard/pause/createTask`
  - ✅ **Verify**: Plugin definition structurally valid JSON.

- **PR-2.4.2**: Create the Azure DevOps connector plugin manifest defining the bidirectional work item synchronization contract, webhook event subscriptions, and field mapping configuration schema
  - **Est. hours**: 1h | **Depends on**: PR-0 | **Parallel with**: All PR-2 stories
  - File: `.github/plugins/ado-connector/plugin.json` — bidirectional sync, field mappings, webhook events
  - ✅ **Verify**: Plugin definition exists with complete interface specification.

---

### Epic PR-3: Build Continuous Integration Pipelines and Automated Quality Gates for Every Pull Request

#### Feature PR-3.1: Create GitHub Actions Workflows for Automated Testing, Linting, npm Publishing, and Stale Branch Cleanup

**User Stories**:

- **PR-3.1.1**: Create a CI workflow that automatically runs the full test suite and lint checks on every pull request to main, blocking any merge that introduces broken code or style violations
  - **Est. hours**: 1h | **Depends on**: PR-1 | **Parallel with**: PR-3.1.2, PR-3.1.3
  - File: `.github/workflows/ci.yml` — jobs: `test` (Node 22+, `npm test`), `lint` (`npm run lint`); on: PR to main
  - ✅ **Verify**: PR triggers CI; broken test blocks merge.

- **PR-3.1.2**: Create an automated npm publish workflow that triggers on version tags, runs full validation, and publishes the package to the public npm registry without manual intervention
  - **Est. hours**: 0.5h | **Depends on**: PR-1 | **Parallel with**: PR-3.1.1, PR-3.1.3
  - File: `.github/workflows/publish.yml` — on `v*` tag; jobs: test → lint → npm publish; secrets: `NPM_TOKEN`
  - ✅ **Verify**: Push `v0.4.0-test` tag triggers publish workflow.

- **PR-3.1.3**: Create a scheduled workflow that automatically labels pull requests inactive for fourteen days and closes any that remain untouched for twenty-one days, deleting the associated branches to maintain repository hygiene
  - **Est. hours**: 0.5h | **Depends on**: PR-1 | **Parallel with**: PR-3.1.1, PR-3.1.2
  - File: `.github/workflows/stale-cleanup.yml` — weekly; label >14d, close >21d, delete branches
  - ✅ **Verify**: 15-day PR gets `stale` label; 22-day PR gets closed.

---

### Pre-Requisite Phase Verification

| Check | Command / Action | Expected Result |
|-------|-----------------|-----------------|
| Clean git state | `git branch -r` | Only `origin/main` |
| No open PRs | `gh pr list --state open` | Zero results |
| On main branch | `git branch --show-current` | `main` |
| AGENTS.md loads | Open in VS Code | All sections populated |
| Agent definitions valid | Parse YAML frontmatter | All 4 parse without errors |
| CI triggers on PR | Create test PR | CI workflow runs |
| Pre-commit hook works | Commit with `.only()` in test | Commit rejected |
| Full test suite | `npm test` | 915 tests pass, 0 failures |
| Branch protection | `git push origin main` | Rejected |

---

## Phase 0: Foundation Hardening

**Duration**: 5 days (with full parallelization)  
**Priority**: P0 — Must ship first  
**Depends on**: Pre-Requisite Phase  
**Blocks**: P1–P7

### Rationale

Phase 0 hardens the existing system so all subsequent phases build on a stable, well-tested foundation: gateway as default metering path, OpenAI wire completion, unified config, source field for traffic origin, provider health checks, and critical bug fixes. Every fix is isolated and independently verifiable.

### 📦 Parallel Execution Groups

| Group | Stories | Duration | Starts After | Dependency Rationale |
|-------|---------|----------|--------------|---------------------|
| **G1** | P0-F1.1 → P0-F1.2 | 3 days | Day 1 | Tests need implementation first |
| **G2** | P0-F2.1 → P0-F2.2 | 2 days | G1 complete | Gateway defaults change only AFTER injection works |
| **G3-G12** | All remaining 10 stories | 1-3 days | Day 1 (∥ G1) | All independent — different files, zero code overlap |

**Critical path**: G1 (3 days) → G2 (2 days) = **5 working days**. Phase 0 completes in exactly 1 week.

---

### Epic P0: Harden the Existing System Foundation by Fixing Critical Bugs, Unifying Configuration, and Making the Gateway the Default Metering Path

#### Feature P0-F1: Implement OpenAI-Wire Launcher Injection So OpenCode Agent Traffic Routes Through the Gateway for Complete Metering Coverage

> **Source**: Plan B P0.1 | **Est. Effort**: 3 days | **Files**: `gateway/inject.mjs`, `gateway/server.mjs`, `harness-adapters.mjs`, `tests/gateway/inject-openai.test.mjs`

**User Stories**:

- **P0-F1.1**: Extend the gateway injection layer so OpenCode agents using OpenAI-compatible wire protocols have their spawn plans automatically rewritten to route all API calls through the MeridianOS gateway for unified metering
  - **Est. hours**: 16h | **Depends on**: None | **Blocks**: P0-F1.2
  - `applyGatewayInjection()` in `gateway/inject.mjs`: add `wire === 'openai'` branch rewriting `opencode.json`'s `baseURL` and injecting `apiKey`
  - `buildForwardHeaders()` in `gateway/server.mjs`: add `case 'openai'` → `Bearer ${apiKey}`
  - `buildOpenCodeSpawnPlan()` in `harness-adapters.mjs`: ensure `wire: 'openai'` in metadata
  - ⚠️ **Risk**: Breaking existing anthropic-wire injection. **Mitigation**: Run `inject.test.mjs` BEFORE and AFTER — must be byte-identical.
  - 🔄 **Rollback**: Pure code change — `git revert` restores.
  - ✅ **Verify**: OpenCode agent run → `sqlite3 .ai/gateway/ledger.db "SELECT provider, model, total_tokens FROM token_events WHERE source='agent' ORDER BY ts DESC LIMIT 1"` shows provider/model. Gateway log shows `"openai-wire agent traffic routed through gateway"`.

- **P0-F1.2**: Create comprehensive test coverage that verifies OpenAI wire injection produces correct spawn plan rewrites and that the gateway correctly authenticates and meters OpenCode agent traffic
  - **Est. hours**: 8h | **Depends on**: P0-F1.1
  - Create `tests/gateway/inject-openai.test.mjs`, `tests/gateway/server-openai.test.mjs`; extend `tests/cassette.test.mjs`
  - ✅ **Verify**: All new tests pass. Existing inject tests pass (no regression). Full suite 0 new failures.

#### Feature P0-F2: Make the Gateway the Default and Primary Metering Path by Auto-Starting It with the Daemon and Reversing the Budget Metering Priority Order

> **Source**: Plan B P0.2 | **Est. Effort**: 2 days | **Depends on**: P0-F1 | **Files**: `scheduler.mjs`, `launcher.mjs`, `budget.mjs`

**User Stories**:

- **P0-F2.1**: Change the gateway from an opt-in sidecar to an always-on default service that automatically starts with the daemon so every agent run is metered without requiring any manual configuration flags
  - **Est. hours**: 10h | **Depends on**: P0-F1 | **Blocks**: P0-F2.2
  - `maybeStartGateway()` in `scheduler.mjs`: remove `gateway.enabled === true` gate; always call `assembleGateway()`. Policy flag becomes `gateway.disabled: true` to opt OUT.
  - `buildSpawnPlan()` in `launcher.mjs`: remove `gateway.enabled` gate; check `config.gateway.url` presence instead.
  - ⚠️ **Risk**: Every existing test that assumed gateway-off breaks. **Mitigation**: Audit tests; add `gateway: { disabled: true }` to fixtures that need it.
  - 🔄 **Rollback**: Set `policy.gateway.disabled: true`.
  - ✅ **Verify**: Fresh `createAios() + start()` → `config.gateway.gatewayActive === true`. Full suite passes.

- **P0-F2.2**: Reverse the metering priority order in the budget module so the gateway ledger becomes the authoritative primary data source and usage-reader transcript scraping is demoted to a legacy fallback path
  - **Est. hours**: 6h | **Depends on**: P0-F2.1
  - `currentUsage()` in `budget.mjs`: try `ledgerWindowUsage()` first; fall back to `usageReaderUsage()` on error.
  - ✅ **Verify**: Run 3 agent tasks → budget returns gateway numbers. Kill gateway → falls back to usage readers with warning.

#### Feature P0-F3: Merge Tenant Configuration into Policy Configuration to Create a Single Unified Config Surface That Eliminates Confusion About Where Settings Belong

> **Source**: Plan B P0.3 | **Est. Effort**: 3 days | **Files**: `config.mjs`, `tenant-config.mjs`, `policy-validate.mjs`

**User Stories**:

- **P0-F3.1**: Consolidate all tenant.yaml fields into a single unified policy.yaml so operators configure everything from one file without needing to know which settings live in which configuration surface
  - **Est. hours**: 16h | **Depends on**: None | **Blocks**: P0-F3.2
  - `loadPolicy()` in `config.mjs`: extend to merge tenant fields from policy. `resolveDomain()` reads from `policy.agents` when `tenant.yaml` absent.
  - `loadTenantConfig()` in `tenant-config.mjs`: add deprecation warning. Create `docs/migration-guide.md`.
  - ⚠️ **Risk**: JS DomainPlugin users break. **Mitigation**: `resolveDomain()` reads from policy first, falls back to tenant.yaml.
  - ✅ **Verify**: Boot with only `policy.yaml` (no `tenant.yaml`) → agent roster loaded. Boot with `tenant.yaml` → deprecation warning, system works.

- **P0-F3.2**: Build comprehensive configuration validation that catches invalid unified policy settings at boot time and provides actionable human-readable error messages pointing to the exact problematic field
  - **Est. hours**: 8h | **Depends on**: P0-F3.1
  - Extend `policy-validate.mjs`: validate `model_routing` references valid providers, `keyEnv` env vars exist, `wire` values valid
  - Error format: `"policy.yaml: model_routing.builder.medium references unknown provider 'nonexistent' at line 42"`
  - ✅ **Verify**: Boot with invalid config → specific errors with line numbers. Valid config → no errors.

#### Feature P0-F4: Add a Traffic Source Classification Column to Token Events Enabling Precise Attribution of Costs to Agent, IDE, CLI, and API Traffic Origins

> **Source**: Plan B P0.4 | **Est. Effort**: 1 day | **Files**: `gateway/ledger-schema.sql`, `gateway/server.mjs`, `gateway/token-event.mjs`, `gateway/ledger.mjs`

**User Stories**:

- **P0-F4.1**: Extend the token_events database schema with a source column that classifies every recorded API call by its traffic origin so operators can attribute costs precisely across agents, IDE sessions, CLI usage, and direct API calls
  - **Est. hours**: 8h | **Depends on**: None
  - `ALTER TABLE token_events ADD COLUMN source TEXT NOT NULL DEFAULT 'agent'` (O(1) in SQLite — no row rewriting)
  - Update `makeTokenEvent()`, `server.mjs`, `listEvents()`, `queryWindow()` to include `source`
  - ✅ **Verify**: Column exists; all existing rows = `'agent'`.

#### Feature P0-F5: Implement Periodic Provider Health Monitoring So Agent Failures from Downstream Outages Are Detected Proactively Before Tasks Are Dispatched

> **Source**: Plan B P0.5 | **Est. Effort**: 2 days | **Files**: `provider-health.mjs` [NEW], `gateway/index.mjs`, `dashboard/server.mjs`

**User Stories**:

- **P0-F5.1**: Build a background health check loop that probes every configured provider endpoint every sixty seconds and surfaces real-time availability status in the dashboard so operators can see problems before agents encounter failures
  - **Est. hours**: 16h | **Depends on**: None
  - New module `provider-health.mjs`: `checkProviderHealth()` → `{ ok, latencyMs, error? }` (lightweight GET, 5s timeout). Health states: `ok`, `degraded`, `down`.
  - Gateway integration: `gateway/index.mjs` calls `startHealthLoop()`. Dashboard: `GET /api/providers` with health.
  - ✅ **Verify**: Dashboard shows green indicator. Kill network → red within 60s. Router checks health before routing.

#### Feature P0-F6: Replace Windows-Only PowerShell Scripts with Cross-Platform Node.js Equivalents That Work Identically on Windows, macOS, and Linux

> **Source**: Plan A P0-D3 | **Est. Effort**: 2 days | **Files**: `scripts/publish.mjs` [NEW], `scripts/register-conductor.mjs` [NEW], `dashboard/server.mjs`

**User Stories**:

- **P0-F6.1**: Rewrite the publish and conductor registration scripts as platform-agnostic Node.js modules using node:crypto for key management and OS-native service registration abstractions for all three major operating systems
  - **Est. hours**: 16h | **Depends on**: None
  - `scripts/publish.mjs`: uses `node:crypto` instead of DPAPI; reads token from `~/.npmrc`
  - `scripts/register-conductor.mjs`: platform detection → Windows Task Scheduler / macOS launchd / Linux systemd
  - `dashboard/server.mjs` `/api/restart`: replace PowerShell with platform-agnostic `process.spawn`
  - ✅ **Verify**: Scripts work on all 3 platforms.

#### Feature P0-F7: Correct All Rendering Defects, Inaccuracies, and Missing Elements Across the Five Architecture Diagrams to Match the Actual System

> **Source**: Plan A P0-D4 | **Est. Effort**: 1 day | **Files**: All 5 `docs/diagrams/*.md` and `*.png`

**User Stories**:

- **P0-F7.1**: Fix every identified rendering artifact, restore missing diagram nodes, correct inaccurate data model representations, and add the missing terminal states and IDE external system boundaries across all five architecture diagrams
  - **Est. hours**: 8h | **Depends on**: None
  - Fix floating text in high-level-architecture; fix garbled "propoAReclaim" in processing-pipeline; restore missing Filesystem Inbox node; correct leases box in data-model; add Done/Complete state; re-export all PNGs
  - ✅ **Verify**: All 5 diagrams visually inspected — no artifacts, all elements present.

#### Feature P0-F8: Fix the Zero-Versus-Null Sentinel Value Semantics in Budget Windows So Zero Means Hard Block and Null Means No Cap

> **Source**: Plan A G-CG-5 | **Est. Effort**: 0.5 day | **Files**: `gateway/windows.mjs`

**User Stories**:

- **P0-F8.1**: Correct the budget window sentinel value semantics so setting a token cap of zero immediately blocks all requests while omitting the cap or setting it to null removes the limit entirely
  - **Est. hours**: 4h | **Depends on**: None
  - Fix: `cap === 0` → hard block (not "no cap"). `cap === null || undefined` → no cap.
  - ⚠️ **Risk**: Existing config with `per_5h_tokens: 0` (intending "no cap") suddenly blocks all traffic. **Mitigation**: Audit dogfood config; add migration note.
  - ✅ **Verify**: `per_5h_tokens: 0` → 403. Omitted → allowed. `per_5h_tokens: 50000` → normal enforcement.

#### Feature P0-F9: Remove the Hardcoded Anthropic API Version Header and Replace It with Per-Provider Header Configuration from the Provider Registry

> **Source**: Plan A G-PA-8 | **Est. Effort**: 0.5 day | **Files**: `gateway/server.mjs`

**User Stories**:

- **P0-F9.1**: Replace the hardcoded DEFAULT_ANTHROPIC_VERSION constant in the gateway server with a per-provider header configuration lookup so non-Anthropic providers no longer receive inappropriate Anthropic-specific HTTP headers
  - **Est. hours**: 4h | **Depends on**: None
  - Remove `DEFAULT_ANTHROPIC_VERSION`; use `route.providerHeaders || {}` from provider config
  - ✅ **Verify**: Anthropic request includes `anthropic-version`; DeepSeek request does NOT; Google AI gets `x-goog-api-version`.

#### Feature P0-F10: Audit and Harden All Harness Adapters to Prevent Silent OAuth Fallback That Could Allow Unmetered Direct API Calls Bypassing the Gateway

> **Source**: Independent Review §11.3 | **Est. Effort**: 1 day | **Files**: `harness-adapters.mjs`, `gateway/server.mjs`

**User Stories**:

- **P0-F10.1**: Audit every harness adapter to ensure BASE_URL overrides are applied correctly and add explicit gateway-side detection that warns operators when unmetered traffic is detected through ledger-to-usage-reader comparison
  - **Est. hours**: 8h | **Depends on**: None
  - Audit Claude Code, OpenCode, Antigravity adapters for correct `*_BASE_URL` settings
  - Gateway: periodic comparison `ledgerWindowUsage()` vs `usageReaderWindowUsage()` — if discrepancy >10%, log warning
  - Create `docs/KNOWN-ISSUES.md` for Claude Code OAuth fallback
  - ✅ **Verify**: Claude Code → gateway → ledger vs usage readers within 5%. Mismatch >10% triggers warning.

#### Feature P0-F11: Implement Self-Healing Bootstrap That Auto-Creates Required Directory Structures Instead of Crashing with Cryptic Stack Traces on First Run

> **Source**: Plan A P0-D1 | **Est. Effort**: 2 days | **Files**: `boot-guard.mjs`, `init.mjs`, `daemon-entry.mjs`

**User Stories**:

- **P0-F11.1**: Replace every crash-on-missing-directory code path with automatic directory creation using recursive mkdir and provide clear human-readable error messages with specific remediation steps for any remaining failure conditions
  - **Est. hours**: 16h | **Depends on**: None
  - `boot-guard.mjs`: missing directory → `fs.mkdirSync(dir, { recursive: true })` + log. Missing env var → `"Missing ${var} — set it in .env or environment"`.
  - `daemon-entry.mjs`: add `--init` flag → runs `init.mjs` scaffold.
  - Error format: `"[MERIDIANOS] ${checkName}: ${problem}. Fix: ${action}."` — no stack traces.
  - ✅ **Verify**: Clone to fresh dir → run daemon → `.ai/` dirs auto-created. No crash.

#### Feature P0-F12: Build Comprehensive JSON Schema Validation for All Configuration Files So Invalid Settings Are Caught at Boot Time with Actionable Error Messages

> **Source**: Plan A P0-D2 | **Est. Effort**: 2 days | **Files**: `schema/policy.schema.json` [NEW], `policy-validate.mjs`

**User Stories**:

- **P0-F12.1**: Create full JSON schemas for both policy.yaml and tenant.yaml configurations and integrate validation at boot time so every misconfiguration is caught with a specific field-level error message before the daemon attempts to use invalid settings
  - **Est. hours**: 16h | **Depends on**: None
  - Create `schema/policy.schema.json` (JSON Schema draft-07). Required fields, enum validation, reference validation.
  - `policy-validate.mjs`: validates on boot; warnings for unknown fields (forward-compat).
  - ✅ **Verify**: Invalid `wire` → boot prints valid values. Invalid `model_routing` reference → specific error. Valid config → no errors.

---

### Phase 0 Verification

| # | Check | Command / Action | Expected Result |
|---|-------|-----------------|-----------------|
| 1 | Full test suite | `npm test` | 915+ tests pass, 0 failures |
| 2 | OpenAI wire injection | Spawn OpenCode agent with gateway on | `listEvents()` shows run with correct provider/model |
| 3 | Anthropic regression | Spawn Claude Code agent with gateway on | Byte-identical inject output |
| 4 | Gateway auto-start | `createAios()` + `start()` | `config.gateway.gatewayActive === true` |
| 5 | Gateway opt-out | Set `policy.gateway.disabled: true` | Gateway doesn't start; usage readers used |
| 6 | Unified config | Boot with only `policy.yaml` | Agent roster loaded; board created |
| 7 | Backward compat | Boot with `tenant.yaml` | Deprecation warning; system works |
| 8 | Source field | Query `token_events` | `source` column exists; all = `'agent'` |
| 9 | Provider health | `GET /api/providers` | Each has `health: { status, latencyMs }` |
| 10 | Cross-platform | Run scripts on each OS | Works on all 3 |
| 11 | Diagrams | Open all 5 PNGs | No artifacts; all elements present |
| 12 | Zero cap | `per_5h_tokens: 0` | 403 denied |
| 13 | Null cap | Omit `per_5h_tokens` | Allowed |
| 14 | Anthropic header | Route non-Anthropic provider | No `anthropic-version` |
| 15 | OAuth detection | Compare ledger vs readers | Within 5%; >10% warns |
| 16 | Bootstrap | Clone empty dir, run daemon | `.ai/` auto-created; no crash |
| 17 | Config validation | Boot with invalid policy | Specific error messages with file:line:field |

---

## Phase 1: Universal Gateway

**Duration**: 10 working days (2 weeks with parallelization)  
**Priority**: P0 — Critical path  
**Depends on**: Phase 0  
**Blocks**: P2, P3, P4, P5

### Rationale

The gateway must become the universal entry point for ALL LLM traffic before any provider wizards, IDE integration, or dashboards can be built. Phase 1 transforms the gateway from an agent-only sidecar to a universal forward proxy with cross-wire translation — the architectural lynchpin.

### 📦 Parallel Execution Groups

| Group | Stories | Duration | Starts After | Dependency Rationale |
|-------|---------|----------|--------------|---------------------|
| **G1** | P1-F1.1 | 4 days | Day 1 | New code in `gateway/cli.mjs` — no dependencies |
| **G2** | P1-F2.1, P1-F2.2 | 5 days | Day 1 (∥ G1) | WireAdapter interface designed first, then generic-http implements it |
| **G3** | P1-F3.1 | 3 days | Day 1 (∥ G1) | Independent — modifies `gateway/provider-registry.mjs` |
| **G4** | P1-F4.1 | 3 days | Day 1 (∥ G1) | New file `gateway/logging.mjs` — zero conflicts |
| **G5** | P1-F5.1 | 5 days | G2 complete | Cross-wire translation depends on WireAdapter interface |

**Critical path**: G2 (5 days) → G5 (5 days) = **10 working days**. Phase 1 completes in exactly 2 weeks.

---

### Epic P1: Transform the Gateway into a Universal Forward Proxy with Zero-Config Bootstrap, Cross-Wire Translation, and Production-Grade Key Management

#### Feature P1-F1: Deliver a Zero-Configuration Gateway Bootstrap That Auto-Detects API Keys from Environment Variables and Starts Metering Traffic Immediately Without Any Setup

> **Source**: Plan B P1.1 | **Est. Effort**: 4 days | **Files**: `gateway/cli.mjs`, `gateway/index.mjs`, `gateway/server.mjs`, `init.mjs`

**User Stories**:

- **P1-F1.1**: Enable users to start the MeridianOS gateway by simply running npx meridian-gateway with zero arguments, where it automatically scans the environment for known API key patterns, self-configures matching provider routes, and prints clear getting-started instructions with the dashboard URL
  - **Est. hours**: 32h | **Depends on**: None
  - `autoDetectProviders()` — scan env for whitelist patterns (not wildcard `*_KEY`): `ANTHROPIC_API_KEY`, `DEEPSEEK_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`, etc.
  - Match env var → lookup in `gateway/known-providers.json` → auto-configure route
  - Startup message: `"MeridianOS Gateway v0.4.0 | Listening on http://127.0.0.1:8787 | 2 providers auto-detected | Dashboard: http://127.0.0.1:4317"`
  - `--init` flag: generates default `policy.yaml` with detected providers
  - ⚠️ **Risk**: Auto-detection misidentifies non-AI env vars. **Mitigation**: Strict whitelist — no wildcard matching.
  - ✅ **Verify**: `DEEPSEEK_KEY=sk-test npx meridian-gateway` → prints detected provider. `AWS_ACCESS_KEY_ID=xxx` → does NOT detect. Unset all keys → interactive prompt.

#### Feature P1-F2: Implement a Formal WireAdapter Plugin Interface and Generic HTTP Provider Support So Any REST Endpoint Can Be Registered and Metered Without Custom Code

> **Source**: Plan B P1.2 + Plan A WireAdapter contract | **Est. Effort**: 5 days | **Files**: `gateway/wire-adapters/anthropic.mjs`, `gateway/wire-adapters/openai.mjs`, `gateway/wire-adapter-registry.mjs` [all NEW], `gateway/server.mjs`

**User Stories**:

- **P1-F2.1**: Add a generic-http wire type that forwards requests as-is to any HTTP endpoint and performs best-effort response parsing so users can register and meter any LLM provider regardless of its API format
  - **Est. hours**: 20h | **Depends on**: P1-F2.2 (interface)
  - `gateway/server.mjs`: add `'generic-http'` case — forward as-is. Parse response as Anthropic JSON → OpenAI JSON → log unknown format.
  - Unknown formats: emit token event with `null` usage (honest, never fabricated zero).
  - ✅ **Verify**: Generic HTTP endpoint registered → forwarded correctly. Unknown format → `null` usage. `npm test -- tests/gateway/generic-http.test.mjs` — all pass.

- **P1-F2.2**: Define a formal WireAdapter interface contract with six typed methods—detectRequest, injectAuth, extractUsage, extractUsageFromSSE, formatDenial, and normalizeModel—so new wire protocols can be added by simply dropping a module into the adapters directory
  - **Est. hours**: 20h | **Depends on**: None | **Blocks**: P1-F2.1, P1-F5.1
  - Interface: `detectRequest` + `extractUsage` required; `injectAuth`, `extractUsageFromSSE`, `formatDenial`, `normalizeModel` optional with no-op defaults
  - Auto-discovery: scan `gateway/wire-adapters/` at boot; any `.mjs` exporting object with `detectRequest` is auto-registered
  - Concrete: `anthropic.mjs`, `openai.mjs` extracted from existing `server.mjs` logic
  - ⚠️ **Risk**: 6-method contract over-engineered for simple providers. **Mitigation**: Only 2 required; rest have defaults.
  - ✅ **Verify**: Drop `test-wire.mjs` with only `detectRequest` + `extractUsage` → gateway auto-loads → `GET /api/wire-adapters` shows it.

#### Feature P1-F3: Build a Multi-Key Credential Management System Supporting Environment Variables, OAuth Tokens, Static Keys, and Automatic Key Rotation with Health-Based Failover

> **Source**: Plan B P1.3 | **Est. Effort**: 3 days | **Files**: `gateway/provider-registry.mjs`, `gateway/server.mjs`

**User Stories**:

- **P1-F3.1**: Support multiple authentication modes per provider including comma-separated key rotation lists so the gateway can round-robin across multiple API keys and automatically skip any key that returns authentication failures
  - **Est. hours**: 24h | **Depends on**: None
  - `auth: { mode: 'env' | 'oauth' | 'static' }`. `keyEnv` comma-separated: `ANTHROPIC_KEY_1,ANTHROPIC_KEY_2,ANTHROPIC_KEY_3`
  - `resolveApiKey()` → array; `selectKey()` round-robin; `markKeyFailed()` → disable 60s; auto-reenable after cooldown
  - ✅ **Verify**: Provider with 3 keys → key 1 fails 401 → key 2 used. After 60s, key 1 reenabled. `npm test -- tests/gateway/multi-key.test.mjs` — all pass.

#### Feature P1-F4: Add Optional Full Request and Response Logging with Automatic Sensitive Header Redaction and a Replay Capability for Debugging Failed Provider Calls

> **Source**: Plan B P1.4 | **Est. Effort**: 3 days | **Files**: `gateway/logging.mjs` [NEW], `gateway/ledger-schema.sql`, `gateway/server.mjs`

**User Stories**:

- **P1-F4.1**: Implement an optional append-only request and response log store with configurable retention and automatic redaction of authorization headers, plus a replay endpoint that resubmits stored requests against the current provider configuration for debugging
  - **Est. hours**: 24h | **Depends on**: None
  - `gateway/logging.mjs`: `logRequestResponse()`, `pruneOldLogs()`, `replayRequest()`. Schema: `request_logs` table.
  - Redact `authorization`, `x-api-key`, `api-key` → `[REDACTED]` before storage
  - Config: `gateway.logging.enabled` (default `false`), `gateway.logging.retention_days` (default `7`)
  - Dashboard: `POST /api/gateway/replay/:requestId`
  - ⚠️ **Risk**: PII in request bodies. **Mitigation**: Default off; privacy warning; auto redaction.
  - ✅ **Verify**: Enable → call → `request_logs` has row with `[REDACTED]` headers. Replay works. `retention_days: 0` → pruned.

#### Feature P1-F5: Build Non-Streaming Cross-Wire Translation Between Anthropic and OpenAI API Formats So Any Agent Harness Can Communicate with Any Provider Regardless of Native Wire Protocol

> **Source**: Plan B P1.5 | **Est. Effort**: 5 days | **Depends on**: P1-F2 | **Files**: `gateway/translate.mjs` [NEW], `gateway/server.mjs`, `tests/gateway/translate.test.mjs` [NEW]

**User Stories**:

- **P1-F5.1**: Implement bidirectional request and response translation between Anthropic and OpenAI wire formats at the gateway layer so Claude Code agents can use OpenAI-only providers and OpenCode agents can use Anthropic-only providers, with accurate usage extraction through the translation layer
  - **Est. hours**: 40h | **Depends on**: P1-F2 (WireAdapter interface)
  - `gateway/translate.mjs`: `anthropicToOpenai()`, `openaiToAnthropic()`, `openaiResponseToAnthropic()`, `anthropicResponseToOpenai()`
  - Translation fidelity: ✅ Messages, system prompts, tools, token usage. ⚠️ Thinking, computer use — drop silently. ❌ Streaming — NOT translated in P1.
  - Per-route opt-in: `route.translate: true`. Default: `false` (passthrough).
  - ⚠️ **Risk**: Translation lossy. **Mitigation**: Document fidelity matrix. Opt-in per route. Non-streaming only.
  - 🔄 **Rollback**: `translate: false` bypasses entirely. Purely additive.
  - ✅ **Verify**: Claude Code → OpenAI endpoint with `translate: true` → works. OpenCode → Anthropic endpoint → works. Usage extracted correctly. Round-trip fidelity tests pass.

---

### Phase 1 Verification

| # | Check | Command / Action | Expected Result |
|---|-------|-----------------|-----------------|
| 1 | Zero-config boot | `npx meridian-gateway` (env keys set) | Boots; auto-detects; prints URL |
| 2 | Unknown format | Route to unknown-format endpoint | Token event with `null` usage |
| 3 | WireAdapter auto-load | Drop `.mjs` in `wire-adapters/` → restart | Appears in `GET /api/wire-adapters` |
| 4 | Multi-key rotation | 3 keys; key 1 fails | Uses key 2; key 1 reenabled after 60s |
| 5 | Request logging | Enable → call | Logged with `[REDACTED]` headers |
| 6 | Request replay | `POST /api/gateway/replay/:id` | Response matches original |
| 7 | Anthropic→OpenAI | Claude Code → OpenAI with `translate: true` | Works without error |
| 8 | OpenAI→Anthropic | OpenCode → Anthropic with `translate: true` | Works without error |
| 9 | Translation opt-out | `translate: false` | Passes through untranslated |
| 10 | Usage extraction | Check `token_events` after translated call | `total_tokens > 0`; matches provider |
| 11 | Full test suite | `npm test` | All P0 + P1 tests pass; 0 regressions |

---

## Phase 2: Provider & Model Agnosticism

**Duration**: 15 working days (3 weeks with full parallelization)  
**Priority**: P0 — Core product requirement  
**Depends on**: Phase 1 (WireAdapter interface, multi-key management, zero-config bootstrap)  
**Blocks**: P3, P4, P5

### Rationale

Phase 2 delivers the core product promise: any provider, any model, added without code changes. Currently, adding a provider requires editing `providers.mjs` in source code; adding a model requires a code change and manual pricing refresh. Phase 2 makes both operations wizard-driven, declarative, and auto-refreshing.

### 📦 Parallel Execution Groups

| Group | Stories | Duration | Starts After | Dependency Rationale |
|-------|---------|----------|--------------|---------------------|
| **G1** | P2-F1.1 → P2-F1.2 | 5 days | Day 1 | P2-F1.2 (conformance) needs P2-F1.1 (registry schema + loader) complete first |
| **G2** | P2-F2.1 | 4 days | P2-F1.1 complete | Provider wizard writes to declarative registry — needs schema from G1 |
| **G3** | P2-F3.1, P2-F3.2 | 6 days | G1 complete | Model discovery needs provider registry to know WHICH providers to query |
| **G4** | P2-F4.1 | 4 days | G3 complete | Fallback chains need populated model registry for candidate lists |
| **G5** | P2-F5.1 | 4 days | G3 complete (∥ G4) | Pricing needs model list but independent of fallback chains |

**Critical path**: G1 (5 days) → G3 (6 days) → G4 (4 days) = **15 working days**. G2 overlaps G3; G5 ∥ G4.  
**Result: Phase 2 completes in exactly 3 weeks.**

---

### Epic P2: Deliver Complete Provider and Model Agnosticism Through Declarative Registries, Auto-Discovery, Wizard-Based Configuration, and Intelligent Fallback Routing

#### Feature P2-F1: Build a Fully Declarative Provider Registry Where Providers Are Defined as YAML Data with Schema Validation, Runtime Merging of Built-In Defaults and User Overrides, and Automated Conformance Testing

> **Source**: Plan B P2.1 + Plan A P1-D2 | **Est. Effort**: 5 days | **Critical path**: Yes  
> **Files**: `schema/provider.schema.json` [NEW], `providers.yaml` [NEW], `providers.mjs`, `provider-conformance.mjs` [NEW], `init.mjs`, `policy-validate.mjs`, `config.mjs`

**User Stories**:

- **P2-F1.1**: Transform the static JavaScript PROVIDERS object in providers.mjs into a YAML-driven registry with a formal JSON Schema, three-source merge (policy.yaml > .ai/providers.yaml > built-in defaults), and backward-compatible lazy getter export
  - **Est. hours**: 28h | **Depends on**: None | **Blocks**: P2-F1.2, all other P2 features
  - **Step A**: Create `schema/provider.schema.json` — required fields `name`, `wire`, `baseUrl`; enum on `wire` against WireAdapters; optional `displayName`, `keyEnv`, `auth`, `headers`, `features`
  - **Step B**: Extract PROVIDERS to `.ai/providers.yaml` (gitignored). Ship `providers.defaults.yaml` with Anthropic + DeepSeek + OpenRouter + Ollama
  - **Step C**: Refactor `providers.mjs` — `resolveProvider(name)`, `resolveAllProviders()`. Export `PROVIDERS` as lazy getter for backward compat
  - **Step D**: `init.mjs` — copy defaults → `.ai/providers.yaml`. Auto-uncomment providers whose keys exist in env
  - **Step E**: `policy-validate.mjs` — validate `model_routing` references valid providers
  - ⚠️ **Risk**: Static PROVIDERS used in 20+ files. **Mitigation**: Lazy getter. All existing access patterns continue.
  - 🔄 **Rollback**: Lazy getter can return built-in defaults. No DB migration.
  - ✅ **Verify**: `npm test` all pass. Add provider via YAML → resolved. Override baseUrl → uses override. Invalid wire → validation error. Fresh `--init` → defaults generated.

- **P2-F1.2**: Build an automated provider conformance tester that validates connectivity, authentication, wire format compatibility, and feature support via lightweight API calls
  - **Est. hours**: 12h | **Depends on**: P2-F1.1
  - `provider-conformance.mjs`: `testProviderConnection()` — OpenAI: `GET /v1/models`; Anthropic: 1-token `POST /v1/messages`; Google AI: `GET /v1beta/models`; generic: `GET /`
  - Returns `{ ok, latencyMs, modelsFound, features, error?, errorCode? }` with error classification
  - Dashboard: `POST /api/providers/test`. CLI: `node cli.mjs provider test <name>`
  - ⚠️ **Risk**: Test consumes tokens (~$0.00001). **Mitigation**: Optional; show cost estimate.
  - ✅ **Verify**: Valid key → `{ ok: true }`. Bad key → `{ ok: false, errorCode: "AUTH_FAILED" }`.

---

#### Feature P2-F2: Create a Dual-Interface Provider Configuration Wizard Accessible from Both CLI and Dashboard That Auto-Detects API Keys, Pre-Fills Known Provider Settings from a Curated Database of 15 Providers, and Validates Every Configuration in Real Time

> **Source**: Plan B P2.2 | **Est. Effort**: 4 days | **Depends on**: P2-F1.1  
> **Files**: `provider-wizard.mjs` [NEW], `gateway/known-providers.json` [NEW], `gateway/cli.mjs`, `dashboard/server.mjs`, `dashboard/index.html`

**User Stories**:

- **P2-F2.1**: Build a comprehensive provider addition wizard with curated known providers, auto-detection, real-time schema validation, optional connection test, and dual CLI/dashboard interfaces
  - **Est. hours**: 32h | **Depends on**: P2-F1.1
  - `gateway/known-providers.json`: 15 providers (Anthropic, DeepSeek, OpenRouter, Ollama, OpenAI, Groq, Together, Fireworks, Google Gemini, Mistral, Cohere, Perplexity, xAI, Azure OpenAI, AWS Bedrock). Each: `displayName`, `wire`, `baseUrl`, `keyEnv`, `features`
  - `provider-wizard.mjs`: `runProviderWizard()` (6-step CLI), `runProviderWizardAuto()` (non-interactive env scan), `runProviderWizardDashboard()` (programmatic API)
  - CLI: `node cli.mjs provider add|add --auto|add --name X --wire Y|list|test <name>`
  - Dashboard: Settings → Providers tab with table + Add Provider form
  - ⚠️ **Risk**: Concurrent policy.yaml edits corrupt file. **Mitigation**: File locking; 409 if modified since read.
  - ✅ **Verify**: CLI wizard adds Groq → in policy.yaml. Auto-detect finds all. Dashboard form validates + saves. Tests pass.

---

#### Feature P2-F3: Build an Automated Model Discovery Service with Per-Provider Adapters That Fetches Available Models, Extracts Rich Metadata Including Context Windows and Feature Flags, Persists to a Local SQLite Registry, and Schedules Daily Automatic Refresh

> **Source**: Plan B P2.3 + Plan A P2-D1 | **Est. Effort**: 6 days | **Depends on**: P2-F1  
> **Files**: `model-registry.mjs` [NEW], `model-discovery.mjs` [NEW], `model-discovery-adapters/` [NEW], `scheduler.mjs`, `dashboard/server.mjs`

**User Stories**:

- **P2-F3.1**: Design and implement the model storage layer with a SQLite-backed registry supporting atomic upserts, deprecation tracking, capability metadata, and efficient querying
  - **Est. hours**: 20h | **Depends on**: P2-F1.1 | **Blocks**: P2-F3.2
  - New table `model_registry` in `ledger.db`: 16 columns including `id` (PK), `provider`, `model_id`, `context_window`, `features` (JSON), `pricing_*_per_m`, `deprecated`, `tier_assigned`, `last_seen`
  - Key functions: `upsertModel()`, `getModels()` with filters, `markDeprecated()`, `autoAssignTiers()` (heuristic)
  - null-is-unknown: `pricing_cached_input_per_m` = NULL if no caching; `max_output_tokens` = NULL if unknown
  - ⚠️ **Risk**: SQLite write contention with gateway. **Mitigation**: WAL mode; batched transactions.
  - ✅ **Verify**: Table exists. `upsertModel()` + `getModels()` round-trip works. `autoAssignTiers()` works.

- **P2-F3.2**: Implement per-provider discovery adapters that fetch model lists, normalize formats, handle rate limiting, and degrade gracefully to models.dev fallback
  - **Est. hours**: 28h | **Depends on**: P2-F3.1
  - `model-discovery.mjs`: `discoverAllModels()`, `refreshModelRegistry()`. Adapters: `openai.mjs` (GET /v1/models + known-context-windows.json lookup), `anthropic.mjs` (models.dev + curated list), `google-ai.mjs` (GET /v1beta/models), `generic-http.mjs` (heuristic + models.dev fallback)
  - Scheduler: `modelDiscoveryTick` every 24h. Dashboard: `GET /api/models`, `POST /api/models/refresh`
  - ⚠️ **Risk**: Rate limits, models.dev offline, context window data unavailable. All with documented mitigations.
  - ✅ **Verify**: `node cli.mjs models refresh` discovers from all providers. Registry populated. Dashboard shows models with metadata.

---

#### Feature P2-F4: Implement Intelligent Tier-Based Model Routing with Weighted Canary Selection, Automatic Fallback Chains on Failure, and Flapping Model Detection That Temporarily Removes Unreliable Models from Rotation

> **Source**: Plan B P2.4 + Plan A P2-D2 | **Est. Effort**: 4 days | **Depends on**: P2-F3  
> **Files**: `model-router.mjs`, `model-fallback.mjs` [NEW], `schema/policy.schema.json`, `planner.mjs`

**User Stories**:

- **P2-F4.1**: Extend the model routing system to support ordered candidate model lists per tier with weighted probabilistic selection for canary testing, automatic fallback chains, and intelligent circuit-breaking
  - **Est. hours**: 32h | **Depends on**: P2-F3
  - **Part A**: Config-driven tiers with `candidates: [{ model, weight }]` arrays. Backward compat: old format auto-wrapped.
  - **Part B**: `selectModelFromCandidates()` — validates, filters circuit-broken, weighted random. Deterministic mode for tests.
  - **Part C**: Fallback — retryable errors (5xx, timeout, rate limit) trigger next candidate → next tier. Non-retryable (400, 401, 404) don't. Max 9 attempts (3 candidates × 3 tiers).
  - **Part D**: `model-fallback.mjs` — circuit breaker with healthy/degraded/circuit_open states. Auto-recovery via 5-min probe.
  - ⚠️ **Risk**: Fallback masks systemic problems; circuit breaker too aggressive; weighted selection non-deterministic. All with mitigations.
  - ✅ **Verify**: 90/10 canary split works. Fallback works. 5 failures → circuit_open → recovery. All same error → stops at 2. Tests pass.

---

#### Feature P2-F5: Build an Automated Multi-Source Pricing Refresh Pipeline with a Priority Fallback Chain from Provider-Native APIs to OpenRouter to Models.dev to Last-Known-Good Local Cache, Supporting Cache-Differentiated Pricing and Daily Scheduled Updates

> **Source**: Plan A P2-D3 | **Est. Effort**: 4 days | **Depends on**: P2-F3 | **Parallel with**: P2-F4  
> **Files**: `pricing-refresh.mjs`, `pricing.mjs`, `scheduler.mjs`, `dashboard/server.mjs`

**User Stories**:

- **P2-F5.1**: Implement an automated pricing refresh system with 4-tier fallback chain, cache-differentiated cost calculation, stale detection, and pricing change alerts
  - **Est. hours**: 32h | **Depends on**: P2-F3
  - Priority chain: Provider-native → OpenRouter → Models.dev → Last-Known-Good local cache
  - `getEffectiveCost(model, input, output, cachedInput)` — formula: `(uncachedInput × inputPerM + cachedInput × cachedInputPerM + output × outputPerM) / 1,000,000`
  - Stale detection: >7 days → warning. Pricing diff: >10% change → notification. >50% change → alert.
  - Scheduler: `pricingRefreshTick` daily, AFTER `modelDiscoveryTick`
  - ⚠️ **Risk**: OpenRouter margin; cache pricing complexity; silent pricing changes. All with mitigations.
  - ✅ **Verify**: Pricing refresh with source attribution. Cache-differentiated cost calculation. Network failure → last-known-good. Tests pass.

---

### Phase 2 Verification

| # | Check | Command / Action | Expected Result |
|---|-------|-----------------|-----------------|
| 1 | Provider in YAML | Add provider to policy.yaml → restart | In `resolveAllProviders()` |
| 2 | Override built-in | Set custom baseUrl in policy.yaml | Resolved uses override |
| 3 | Invalid provider | `wire: 'invalid'` | Validation error listing valid wires |
| 4 | Conformance valid | `node cli.mjs provider test anthropic` | `{ ok: true, features: {...} }` |
| 5 | Conformance bad key | Test with wrong key | `{ ok: false, errorCode: "AUTH_FAILED" }` |
| 6 | CLI wizard | `node cli.mjs provider add` → Groq | Provider in policy.yaml |
| 7 | Auto-detect | `--auto` with keys in env | All detected auto-configured |
| 8 | Dashboard add | Dashboard → form → save | Provider in list with health |
| 9 | Model discovery | `node cli.mjs models refresh` | 28+ models across providers |
| 10 | Deprecation warning | Mark model deprecated | Dashboard shows badge + successor |
| 11 | Canary routing | 90/10 weight → 100 tasks | ~90 primary, ~10 canary |
| 12 | Fallback on failure | Primary 500 | Next candidate tried; succeeds |
| 13 | Circuit breaker | 5 consecutive failures | Model removed; red indicator |
| 14 | Recovery | 5-min probe | Auto-recovered; green |
| 15 | All exhausted | ALL tiers fail | Task fails; no infinite loop |
| 16 | Pricing refresh | `node cli.mjs pricing refresh` | Per-model rates with source |
| 17 | Fallback chain | Kill network → refresh | Last-known-good; stale warning |
| 18 | Cache cost | 50% cached input | Correctly separated |
| 19 | Price change | >10% change | Dashboard notification |
| 20 | Backward compat | Old single-model tier format | Auto-wrapped; works |
| 21 | Full test suite | `npm test` | All pass; 0 regressions |

---

## Cross-Phase Dependency Chain (PR → P0 → P1 → P2 → P3)

```
PR (3 days)
 └─→ P0 (5 days)
      ├─→ G1 (P0-F1, 3d) → G2 (P0-F2, 2d) [P0 CRITICAL PATH]
      ├─→ G3-G12: All 10 parallel groups, complete ≤ 3d
      └─→ P1 (10 days)
           ├─→ G2 (P1-F2, 5d) → G5 (P1-F5, 5d) [P1 CRITICAL PATH]
           ├─→ G1 (P1-F1, 4d), G3 (P1-F3, 3d), G4 (P1-F4, 3d)
           └─→ P2 (15 days)
                ├─→ G1 (P2-F1, 5d) → G3 (P2-F3, 6d) → G4 (P2-F4, 4d) [P2 CRITICAL PATH]
                ├─→ G2 (P2-F2, 4d) starts after P2-F1.1, ends day 9
                ├─→ G5 (P2-F5, 4d) runs ∥ G4, days 12-15
                └─→ P3 (End-User Configurability) [next phase — detailed plan pending]
```

---

## Subsequent Phases (P3–P7): Summary

> **P3–P7 are maintained at the same quality bar as PR–P2. Their detailed refinement (parallel groups, per-story risks, verification commands, rollback strategies) will be added as each phase approaches execution.**

### P3: End-User Configurability (10 days)
- P3-F1: Unified Dashboard Settings panel with real-time validation and version history
- P3-F2: Interactive Setup Wizard v2 — 10-step browser-first wizard with dollar budgets
- P3-F3: Configuration Profiles — dev/prod/cost-optimized with YAML anchor inheritance
- P3-F4: yaml-lite → standards-compliant YAML library replacement

### P4: IDE & Platform Traffic Integration (15 days)
- P4-F1: IDE Proxy Configuration Generator with per-IDE setup + auto-detect
- P4-F2: VS Code Extension — sidebar, status bar, Copilot routing, daemon management
- P4-F3: Claude Cowork/Code MCP Integration — board query + spend visibility
- P4-F4: Subscription Plan Integration — Claude Pro, Copilot, Anti-Gravity BYO-plan

### P5: Observability & Intelligence (15 days)
- P5-F1: Spend Analytics Dashboard — KPI cards, time-series, breakdowns, export
- P5-F2: Budget Intelligence & Forecasting — projections, anomaly detection, "Pause All AI Spend"
- P5-F3: Model Cost Optimization Engine — "Switch to X saves $Y/week" with one-click apply
- P5-F4: Real-Time Alerts — Slack, email, webhook, dashboard toast with cooldown
- P5-F5: Per-Task Cost Attribution — "This feature cost $4.72 across 3 runs"
- P5-F6: Cost Aggregation Engine — materialized hourly/daily summary tables

### P6: Multi-Tenant Platform & Commercialization (20 days)
- P6-F1: Control Plane — manage N projects from one supervisor
- P6-F2: Remote Dashboard Access — auth, RBAC, HTTPS, JWT sessions
- P6-F3: Team Collaboration — invites, activity feed, comments, PR assignment
- P6-F4: Project Templates — 7 built-in templates for common project types
- P6-F5: Stripe Billing & License Enforcement — Free/Pro/Enterprise tiers
- P6-F6: Kubernetes/Helm Deployment — cloud-native enterprise deployment
- P6-F7: Compliance & Audit Reporting — SOC2, GDPR, cost allocation

### P7: Ecosystem, Distribution & Marketplace (20 days)
- P7-F1: Packaged Binary Distribution — `.exe`/`.dmg` via `bun compile`
- P7-F2: Electron Desktop App — native GUI, system tray, OS keychain, auto-update
- P7-F3: Public REST API & OpenAPI Spec — documented, versioned, webhook-capable
- P7-F4: Intake Source Plugin Marketplace — Jira, Linear, Notion, GitHub Issues
- P7-F5: Community Plugin System — scaffolding CLI, registry, ratings
- P7-F6: Cloud Control Plane (L3 Hybrid) — local binary + cloud dashboard (keys stay local)

---

## Cross-Cutting Requirements (All Phases)

1. **Tests**: Every deliverable includes automated tests. Maintain 100% pass rate, no regressions.
2. **Documentation**: Every new module includes JSDoc. Every feature updates relevant docs.
3. **Backward Compatibility**: No breaking changes without deprecation warning (1 phase minimum).
4. **Dogfood**: Every phase produces a dogfoodable increment tested against real provider traffic.
5. **PR Discipline**: All PRs merged to `main`. No stale branches. `main` always deployable.
6. **Zero-Dependency Philosophy**: Maintain existing approach. Only exception: `yaml` npm package (P3-F4).

---

## Risk Register

| # | Risk | L | I | Mitigation | Phase |
|---|------|---|---|-----------|-------|
| R1 | Cross-wire translation is lossy | M | H | Fidelity matrix; opt-in; non-streaming only | P1 |
| R2 | VS Code Copilot proxy changes with updates | M | M | Monitor changelog; auto-update extension; fallback | P4 |
| R3 | Model auto-discovery APIs change | H | L | Graceful degradation; models.dev fallback; manual entry | P2 |
| R4 | Gateway becomes performance bottleneck | L | H | Lightweight proxy; benchmark early; horizontal scaling in P6 | P1 |
| R5 | Multi-project control plane complexity | M | M | P6 is later phase; can descope without blocking P0-P5 | P6 |
| R6 | Stripe requires business entity | L | L | Test mode for dev; business setup in parallel | P6 |
| R7 | Subscription token extraction stops working | M | M | Best-effort; document provider auth dependency | P4 |
| R8 | SQLite scalability cliff with IDE traffic | M | H | Benchmark in P0; remote DB trigger threshold defined | P0 |
| R9 | TLS cert trust requires admin privileges | H | M | HTTP-only fallback; clear UX for cert installation | P4 |
| R10 | `bun compile` SQLite issues on some platforms | L | M | Test all 3 platforms early; fallback to `pkg` | P7 |

L = Likelihood (L/M/H), I = Impact (L/M/H)

---

## Glossary

| Term | Definition |
|------|-----------|
| **BYOK** | Bring Your Own Key — users provide their own API keys for LLM providers |
| **WireAdapter** | Formal interface (6 typed methods) defining detect/authenticate/meter/deny for a wire protocol |
| **Harness** | CLI tool wrapping an LLM for agent execution (claude-code, opencode, antigravity) |
| **Ledger** | Append-only SQLite DB (`ledger.db`) recording every LLM API call with token counts and costs |
| **Gateway** | Universal forward proxy intercepting, metering, and enforcing budgets on ALL AI traffic |
| **null-is-unknown** | Data integrity contract: `null` = genuinely unknown, never fabricated as `0` |
| **Parallel Execution Group** | Set of user stories executable simultaneously by independent agents with zero merge conflicts |
| **Critical Path** | Longest chain of dependent stories determining minimum phase duration |

---

> **Running Document Note**: This file is a living plan. Update it when:
> - A phase is completed (mark stories done ✅)
> - A dependency is incorrect (update dependency maps)
> - A risk materializes (document impact + resolution)
> - A new gap is found (add to relevant/new phase)
> - Estimates prove inaccurate (update with actual durations)
>
> **Orchestrator Note**: This file is the **single authoritative plan** for the MeridianOS transformation. All source documents were fully synthesized into this plan. Multi-agent orchestration systems should read ONLY this file.
>
> **Next planned update**: Refine P3 with full parallel groups, per-story risks, verification commands, and rollback strategies.
