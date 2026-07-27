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

### VI. Observability & Auditability
Every decision, cost, and action must be traceable.
- Structured logging through `daemon-logger.mjs`
- Token events with source attribution (agent/IDE/CLI/API)
- Dashboard provides real-time cost visibility
- Alert routing through `escalation-push.mjs` for anomalies

### VII. Non-Technical Usability
The system must be usable by non-developers within 10 minutes of install.
- Browser-first setup wizard (dashboard) + CLI wizard coexist
- Dollar-based budgets (not token-based)
- One-click IDE integration (VS Code extension)
- Packaged installer for Windows/macOS/Linux

### VIII. ES Modules & Modern JavaScript
All source code uses ES module syntax with `.mjs` extension.
- `import`/`export` exclusively — no `require()` or `module.exports`
- Node.js 24+ required (better-sqlite3 ABI compatibility)
- `"type": "module"` in package.json
- Native `node:test` runner — no Jest/Mocha dependency

### IX. PR Discipline & Code Review
Every change to `main` goes through a reviewed pull request.
- PR title format: `[Epic]-[Feature]: description`
- Branch deleted after merge
- No direct/force pushes to main
- Stale PRs auto-closed at 21 days
- See `.github/rules/pr-discipline.md`

### X. Spec-Driven Development
All feature work follows the spec-kit workflow:
1. **Constitution** (this document) — governing principles
2. **Specify** — define what to build (user stories, acceptance criteria)
3. **Plan** — technical design with technology choices
4. **Tasks** — dependency-ordered, estimated task breakdown
5. **Implement** — execute tasks in order
6. **Converge** — verify completeness against spec/plan/tasks


## [SECTION_2_NAME]
<!-- Example: Additional Constraints, Security Requirements, Performance Standards, etc. -->

[SECTION_2_CONTENT]
<!-- Example: Technology stack requirements, compliance standards, deployment policies, etc. -->

## [SECTION_3_NAME]
<!-- Example: Development Workflow, Review Process, Quality Gates, etc. -->

[SECTION_3_CONTENT]
<!-- Example: Code review requirements, testing gates, deployment approval process, etc. -->

## Governance
<!-- Example: Constitution supersedes all other practices; Amendments require documentation, approval, migration plan -->

[GOVERNANCE_RULES]
<!-- Example: All PRs/reviews must verify compliance; Complexity must be justified; Use [GUIDANCE_FILE] for runtime development guidance -->

**Version**: [CONSTITUTION_VERSION] | **Ratified**: [RATIFICATION_DATE] | **Last Amended**: [LAST_AMENDED_DATE]
<!-- Example: Version: 2.1.1 | Ratified: 2025-06-13 | Last Amended: 2025-07-16 -->
