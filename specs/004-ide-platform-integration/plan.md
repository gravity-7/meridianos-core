# Implementation Plan: IDE & Platform Traffic Integration

**Branch**: `004-ide-platform-integration` | **Date**: 2026-07-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/004-ide-platform-integration/spec.md`

## Summary

Integrate all major IDE and platform AI traffic sources through the MeridianOS gateway by building an IDE proxy configuration generator with auto-detection, a VS Code extension serving as the primary distribution entry point with sidebar task board and one-click Copilot routing, an MCP server for Claude Code/Cowork integration, GitHub Copilot traffic monitoring via proxy routing, and subscription plan support for unified BYO-key + subscription cost visibility. Six independently testable user stories across five features, each delivering standalone value. All changes are additive — new modules and a new `vscode-extension/` directory, zero modifications to the core orchestration pipeline.

**Technical approach**: Build `ide-proxy.mjs` as a standalone detection + config generation module with dashboard API endpoints. Create `vscode-extension/` as a standard VS Code extension using only the VS Code Extension API (no framework dependencies). Build `mcp-server.mjs` as a stdio-based MCP protocol server using Node.js built-ins. Extend the gateway ledger schema with `ide_name` and `billing_type` columns. Add subscription auth mode to the existing provider registry. All new dashboard UI lives within the existing single-file SPA (`dashboard/index.html`).

## Technical Context

**Language/Version**: Node.js 24+ (ES modules, `.mjs` extension, `"type": "module"`). VS Code extension uses JavaScript (CommonJS for `extension.js` entry point, ES modules for internal modules where supported by VS Code's Node.js version).

**Primary Dependencies**: `better-sqlite3` (sole runtime dependency — zero-dependency philosophy). VS Code Extension API (`vscode` module) is provided by the VS Code host — not an npm dependency. All other functionality uses Node.js built-ins (`node:http`, `node:https`, `node:fs`, `node:path`, `node:os`, `node:child_process`, `node:readline`).

**Storage**: SQLite via `better-sqlite3` — existing `ledger.db` (token_events table extended with `ide_name` and `billing_type` columns). Existing `aios.db` (state/task board). No new database or storage engine. Subscription tokens stored in policy.yaml (keyEnv references) — no token storage in the database.

**Testing**: Node.js native test runner (`node --test`). Cassette system (`test/cassette.mjs`) for deterministic LLM response mocking where applicable. New test files: `tests/ide-proxy.test.mjs`, `tests/mcp-server.test.mjs`, `tests/gateway/ide-tokens.test.mjs`, `tests/gateway/subscription-auth.test.mjs`. VS Code extension tests use `@vscode/test-electron` (dev dependency only, not runtime).

**Target Platform**: Cross-platform daemon (Windows, macOS, Linux). VS Code extension targets VS Code 1.85+. Dashboard is a single-page web app served by the embedded HTTP server on port 4317. MCP server runs as a child process over stdio.

**Project Type**: Multi-component system — Node.js daemon/orchestrator with embedded HTTP gateway proxy and dashboard web server, plus a VS Code extension and an MCP server. Flat project structure for core `.mjs` files, new `vscode-extension/` directory for the extension.

**Performance Goals**: IDE detection: <500ms (filesystem checks). Proxy config generation: <10ms (in-memory template rendering). Test Connection probe: <5s (includes network round-trip). MCP tool response: <2s for standard queries. VS Code extension activation: <3s to display sidebar with cached data. Dashboard IDE detection endpoint: <1s. Spend indicator refresh: 30s interval, <100ms per refresh.

**Constraints**: Zero new npm runtime dependencies. VS Code extension uses only the VS Code Extension API — no React, Vue, or other UI frameworks. All IDE traffic MUST route through the gateway (Constitution II). MCP server communicates exclusively over stdio (no network ports). Subscription tokens are user-provided — MeridianOS never extracts or stores them automatically. Copilot proxy support is best-effort (documented limitation if Copilot's HTTP client doesn't respect proxy settings).

**Scale/Scope**: 6 user stories. 5 new modules (`ide-proxy.mjs`, `mcp-server.mjs`, `vscode-extension/extension.js`, `vscode-extension/sidebar.js`, `vscode-extension/daemon-manager.js`). Dashboard UI additions: IDE Connect page, Subscription Setup page. Gateway schema: 2 new columns (`ide_name`, `billing_type`). 7 new dashboard API endpoints. 5 supported IDE types (VS Code, Cursor, Windsurf, Claude Code, JetBrains). 3 subscription plan types (Claude Pro, GitHub Copilot, Anti-Gravity). 5 MCP tools exposed.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Assessment |
|---|-----------|--------|-----------|
| I | Provider & Model Agnosticism | ✅ PASS | This feature does not add or modify providers — it routes IDE traffic through the existing gateway. Subscription auth mode extends provider registry without breaking existing patterns. |
| II | Gateway as Single Source of Truth | ✅ PASS | All IDE traffic (Copilot, Claude Code, etc.) routes through the gateway. Ledger extended with `source='ide'`, `ide_name`, and `billing_type` for precise attribution. No bypass paths. |
| III | Zero-Dependency Philosophy | ✅ PASS | All new modules use Node.js built-ins. VS Code Extension API is host-provided (not an npm install). MCP server uses `node:readline` for stdio. `@vscode/test-electron` is dev-only for extension tests. |
| IV | Test-First Discipline | ✅ PASS | 4 new test files planned. Cassette system reused where applicable. Extension tests use VS Code's test infrastructure. All existing 915+ tests must continue to pass. |
| V | Configuration over Code | ✅ PASS | IDE detection paths configurable via policy. Proxy port read from gateway config (not hardcoded). Subscription plans defined in policy with `auth.mode: 'subscription'`. MCP tool set is static but tool implementations read from live dashboard API — no hardcoded data. |
| VI | Observability & Auditability | ✅ PASS | New `source='ide'` classification enhances traffic attribution. `ide_name` tracks which IDE generated traffic. `billing_type` distinguishes subscription vs API-key costs. All logged through existing daemon-logger. |
| VII | Non-Technical Usability | ✅ PASS | This IS the primary usability feature — zero-terminal onboarding, one-click Copilot routing, dashboard-based IDE setup, spend visible in status bar. All designed for non-developer operators. |
| VIII | ES Modules & Modern JavaScript | ✅ PASS | All new core modules use `.mjs`, `import`/`export`, `node:` prefix. VS Code extension entry point uses CommonJS (VS Code requirement) but internal modules can use ES modules where the host Node version supports it. |
| IX | PR Discipline & Code Review | ✅ PASS | All changes delivered via pull requests referencing this spec. Standard branch naming. Branches deleted after merge. |
| X | Spec-Driven Development | ✅ PASS | This plan follows the spec-kit workflow: spec.md → plan.md → research.md → data-model.md → contracts/ → quickstart.md → tasks.md → implement → converge. |

**Gate Result: ALL 10 PRINCIPLES PASS — no violations, no justifications needed.**

**Note on Principle III**: The VS Code extension technically requires `@vscode/test-electron` for testing, but this is a dev dependency (not runtime) and is scoped to the `vscode-extension/` directory's own `package.json`. The core MeridianOS daemon remains at exactly one runtime dependency (`better-sqlite3`).

**Note on Principle VIII**: VS Code extensions currently require a CommonJS entry point (`extension.js` using `require()`). This is a platform constraint, not a project choice. Internal extension modules may use ES module syntax where the host Node.js version (bundled with VS Code) supports it. The core daemon codebase is unaffected and remains pure ES modules.

## Project Structure

### Documentation (this feature)

``text
specs/004-ide-platform-integration/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── dashboard-api.md # Dashboard REST API contracts
│   └── mcp-tools.md     # MCP tool schemas
└── tasks.md             # Phase 2 output (/speckit-tasks command)
``

### Source Code (repository root)

``text
# Core daemon modules (existing flat structure + new additions)
ide-proxy.mjs                   # [NEW] IDE detection + proxy config generation
mcp-server.mjs                  # [NEW] MCP protocol server (stdio transport)
gateway/
├── server.mjs                  # [MODIFIED] Add ide_name + billing_type to token events
├── token-event.mjs             # [MODIFIED] Extend makeTokenEvent with new fields
├── ledger.mjs                  # [MODIFIED] Add ide_name + billing_type to queries
├── ledger-schema.sql           # [MODIFIED] ALTER TABLE token_events ADD ide_name, billing_type
├── provider-registry.mjs       # [MODIFIED] Add subscription auth mode support
└── ...
dashboard/
├── server.mjs                  # [MODIFIED] Add IDE detection, subscription, MCP config endpoints
├── index.html                  # [MODIFIED] Add IDE Connect and Subscription Setup UI panels
└── ...
tests/
├── ide-proxy.test.mjs          # [NEW]
├── mcp-server.test.mjs         # [NEW]
└── gateway/
    ├── ide-tokens.test.mjs     # [NEW]
    └── subscription-auth.test.mjs  # [NEW]

# VS Code Extension (new top-level directory)
vscode-extension/
├── package.json                # Extension manifest + VS Code API contributions
├── extension.js                # Entry point — activation, deactivation, command registration
├── sidebar.js                  # TreeView data provider for task board
├── status-bar.js               # Status bar spend indicator
├── daemon-manager.js           # Daemon lifecycle: check, start, stop, download, wizard
├── .vscodeignore               # Packaging exclude list
└── test/                       # Extension tests
    └── extension.test.js
``

**Structure Decision**: The existing flat structure is preserved for core modules — `ide-proxy.mjs` and `mcp-server.mjs` live at the repository root alongside `scheduler.mjs`, `config.mjs`, etc. The VS Code extension is a new top-level `vscode-extension/` directory with its own `package.json` because it has a separate lifecycle (packaged as `.vsix`, published to the VS Code Marketplace independently of the npm package). Gateway and dashboard modifications are inline with existing files. This follows the precedent set by `gateway/` and `dashboard/` as subsystem directories.

### Post-Design Re-Check

*Re-evaluated after Phase 1 design (research.md, data-model.md, contracts/, quickstart.md).*

| # | Principle | Status | Notes |
|---|-----------|--------|-------|
| I | Provider & Model Agnosticism | ✅ PASS | Research R2 confirms proxy snippets are template-based with no provider-specific code. R6 confirms subscription auth extends existing provider registry pattern (auth.mode) without new provider types. |
| II | Gateway as Single Source | ✅ PASS | All 7 dashboard API endpoints read from gateway ledger or dashboard state. MCP tools wrap dashboard API — no direct DB access. IdeAttribution and BillingType extend token_events inline with existing schema. |
| III | Zero-Dependency | ✅ PASS | All 7 research decisions use Node.js built-ins exclusively. VS Code Extension API is host-provided. MCP server uses node:readline. @vscode/test-electron is dev-only, scoped to vscode-extension/package.json. |
| IV | Test-First | ✅ PASS | quickstart.md defines 15 validation scenarios with specific commands and expected results. 4 new test files designed. Existing test suite must pass with 0 regressions. |
| V | Configuration over Code | ✅ PASS | IDE detection paths in policy.yaml. Proxy port from live gateway config. Subscription auth mode in provider YAML. MCP dashboard URL via env var. No hardcoded IDE lists, ports, or URLs. |
| VI | Observability | ✅ PASS | source='ide' + ide_name + billing_type triple attribution. Dashboard IDE status endpoint surfaces Copilot monitoring status. All MCP tool calls logged. Connectivity test results timestamped. |
| VII | Non-Technical Usability | ✅ PASS | 15 quickstart validations cover all user-facing flows. Copy-paste proxy snippets, one-click Copilot routing, zero-terminal onboarding, dashboard-based subscription setup all validated. |
| VIII | ES Modules | ✅ PASS | Core modules: .mjs, import/export, node: prefix. VS Code extension: CommonJS entry point (platform constraint), documented justification. No CommonJS in core daemon. |
| IX | PR Discipline | ✅ PASS | All changes scoped to feature branch. Standard naming. Spec directory created. |
| X | Spec-Driven | ✅ PASS | Full workflow: spec.md → plan.md → research.md → data-model.md → contracts/ (dashboard-api.md, mcp-tools.md) → quickstart.md. Ready for /speckit-tasks. |

**Post-Design Gate Result: ALL 10 PRINCIPLES PASS — design is constitution-compliant.**

## Complexity Tracking

> No constitution violations — this section is intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
