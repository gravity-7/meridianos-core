# Implementation Plan: Ecosystem, Distribution & Marketplace

**Branch**: `007-ecosystem-distribution` | **Date**: 2026-08-03 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/007-ecosystem-distribution/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Phase 7 delivers the distribution layer and ecosystem for MeridianOS, transforming it from a developer tool into a broadly accessible product. The feature includes: (1) Packaged native binaries for Windows/macOS/Linux using bun compile with embedded Node.js runtime, (2) Electron desktop application with GUI setup wizard and OS keychain integration, (3) Public REST API with OpenAPI 3.0 specification, scoped authentication, rate limiting, and webhook delivery, (4) Plugin marketplace with 6 pre-built connectors (Jira, Linear, Notion, GitHub Issues, Microsoft Teams, Generic Webhook), (5) Community plugin system with scaffolding CLI and registry, (6) Hybrid cloud control plane for centralized multi-machine management with metadata-only reporting.

Technical approach: Leverage bun compile for binary packaging, Electron for desktop app with OS keychain APIs, Node.js built-ins for REST API with custom rate limiting, contract-based plugin system with static analysis validation, and serverless cloud architecture (Cloudflare Workers + D1) for control plane with 90-day data retention.

## Technical Context

**Language/Version**: Node.js 24+ (required for better-sqlite3 ABI compatibility)

**Primary Dependencies**: better-sqlite3 (runtime), bun (build tool), electron + electron-builder (desktop app), electron-updater (auto-updates), keytar (OS keychain access - second exception to zero-dependency)

**Storage**: SQLite (better-sqlite3) for local data, Cloudflare D1 for cloud control plane metadata

**Testing**: Node.js native test runner (node --test), cassette system for LLM response mocking

**Target Platform**: Windows (10+), macOS (11+), Linux (Ubuntu 20.04+, Debian 11+, Fedora 35+)

**Project Type**: Desktop application + CLI tool + REST API + Cloud service

**Performance Goals**: API response <200ms p95, webhook delivery <5s (95% success), cloud metadata update <60s, plugin installation <3min

**Constraints**: Zero-dependency philosophy (except better-sqlite3 and keytar), ES modules only (.mjs), configuration via policy.yaml, API keys never leave local machine

**Scale/Scope**: 100 concurrent users, 500 API keys, 1000 webhooks, 50 connected machines to cloud control plane

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

### I. Provider & Model Agnosticism ✅ PASS
- Feature is about distribution and ecosystem, not provider/model logic
- No hardcoded provider switches or wire protocol changes
- Plugin system supports any intake source via contract
- **Post-Design**: Confirmed - IntakeSource contract is provider-agnostic

### II. Gateway as Single Source of Truth ✅ PASS
- Cloud control plane receives ONLY anonymized metadata (token counts, costs, provider names)
- API keys and prompt/response content NEVER leave local machine
- All AI traffic still routes through gateway
- **Post-Design**: Confirmed - CloudMetadata entity only stores anonymized data

### III. Zero-Dependency Philosophy ⚠️ JUSTIFIED EXCEPTION
- **Exception 1**: `better-sqlite3` (existing, required for SQLite)
- **Exception 2**: `keytar` (NEW - justified for OS keychain access, no Node.js built-in alternative)
- **Exception 3**: `systray` (NEW - justified for system tray access, no Node.js built-in alternative)
- Build tools (bun, electron, electron-builder) are dev-only, not runtime dependencies
- All other functionality uses Node.js built-ins
- **Post-Design**: Confirmed - Only 3 justified exceptions, all essential for desktop integration

### IV. Test-First Discipline ✅ PASS
- Will use Node.js native test runner (`node --test`)
- Tests written before implementation
- Cassette system for deterministic testing
- **Post-Design**: Confirmed - Test files defined in quickstart.md

### V. Configuration over Code ✅ PASS
- All behavior controlled by `policy.yaml`
- Cloud reporting interval configurable (60s default, range 30-300s)
- Plugin configuration via dashboard, not code
- **Post-Design**: Confirmed - PluginConfiguration entity stores config as JSON

### VI. Observability & Auditability ✅ PASS
- Cloud control plane provides centralized multi-machine visibility
- All metadata events include source attribution
- 90-day retention with automatic deletion
- **Post-Design**: Confirmed - CloudMetadata entity includes timestamp and machine_id

### VII. Non-Technical Usability ✅ PASS
- Primary goal of this feature
- Packaged binaries for non-developers
- GUI setup wizard in Electron app
- Installation time <5 minutes
- **Post-Design**: Confirmed - Quickstart scenarios validate non-technical usability

### VIII. ES Modules & Modern JavaScript ✅ PASS
- All new code uses `.mjs` extension
- `import`/`export` exclusively
- Node.js 24+ required
- **Post-Design**: Confirmed - All plugin contracts use ES module syntax

### IX. PR Discipline & Code Review ✅ PASS
- Standard PR process followed
- Branch: `007-ecosystem-distribution`
- Will follow `[Epic]-[Feature]: description` format
- **Post-Design**: Confirmed - No changes needed

### X. Spec-Driven Development ✅ PASS
- Following spec-kit workflow: Specify → Plan → Tasks → Implement → Converge
- All work derived from [spec.md](spec.md)
- **Post-Design**: Confirmed - All design artifacts align with spec

**Overall Status**: ✅ PASS (3 justified exceptions: better-sqlite3, keytar, systray)

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
scripts/
├── build.mjs                    # NEW: bun compile build pipeline
├── install-service.mjs          # NEW: OS service registration
└── setup-wizard-minimal.mjs     # NEW: Console-based setup wizard

desktop/                         # NEW: Electron desktop application
├── main.js                      # Main process (daemon spawn, system tray, auto-updater)
├── preload.js                   # Context bridge for secure IPC
├── renderer/                    # Dashboard loaded in BrowserWindow
└── package.json                 # Electron app configuration

api/v1/                          # NEW: Public REST API
├── tasks.mjs                    # Task CRUD endpoints
├── costs.mjs                    # Cost query endpoints
├── providers.mjs                # Provider management endpoints
├── models.mjs                   # Model discovery and tiering
├── config.mjs                   # Configuration management
├── webhooks.mjs                 # Webhook registration and delivery
└── openapi.yaml                 # OpenAPI 3.0 specification

intake-adapters/                 # NEW: Pre-built plugin connectors
├── jira-source.mjs              # Jira integration
├── linear-source.mjs            # Linear integration
├── notion-source.mjs            # Notion integration
├── github-issues-source.mjs     # GitHub Issues integration
├── teams-source.mjs             # Microsoft Teams integration
└── webhook-source.mjs           # Generic webhook receiver

plugin-loader.mjs                # NEW: Plugin auto-discovery and loading
plugin-scaffold.mjs              # NEW: Plugin scaffolding CLI

cloud/                           # NEW: Hybrid cloud control plane
├── cloud-control-plane.mjs      # Multi-tenant cloud service
├── local-agent.mjs              # Local metadata reporter
└── dashboard/                   # Cloud dashboard UI

dashboard/static/
├── marketplace-panel.mjs        # NEW: Plugin marketplace UI
└── community-plugins.mjs        # NEW: Community plugins UI

tests/
├── api-v1.test.mjs              # NEW: REST API tests
├── plugin-loader.test.mjs       # NEW: Plugin system tests
├── cloud-agent.test.mjs         # NEW: Cloud agent tests
└── integration/
    ├── binary-install.test.mjs  # NEW: Binary installation tests
    ├── electron-app.test.mjs    # NEW: Electron app tests
    └── webhook-delivery.test.mjs # NEW: Webhook delivery tests
```

**Structure Decision**: Multi-component architecture spanning build tooling, desktop application, REST API, plugin system, and cloud services. Each component has dedicated directories with clear separation of concerns.
directories captured above]

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
