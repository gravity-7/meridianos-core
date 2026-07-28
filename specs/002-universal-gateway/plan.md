# Implementation Plan: Universal Gateway

**Branch**: `002-universal-gateway` | **Date**: 2026-07-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-universal-gateway/spec.md`

## Summary

Transform the MeridianOS gateway from an agent-only sidecar into a universal forward proxy capable of metering ANY LLM provider's traffic. Deliver zero-config bootstrap (auto-detect API keys from environment), a formal WireAdapter plugin interface for protocol extensibility, generic HTTP provider support for unadapted APIs, multi-key credential management with automatic failover, append-only request logging with replay, and non-streaming Anthropic↔OpenAI cross-wire translation. Six independently testable user stories, each delivering standalone value.

**Technical approach**: Extract existing Anthropic/OpenAI wire logic from `gateway/server.mjs` into conforming WireAdapter modules under `gateway/wire-adapters/`. Build a WireAdapter registry that auto-discovers modules at boot. Add a `generic-http` adapter for passthrough forwarding with best-effort usage extraction. Implement a credential resolver with round-robin key selection and 60-second cooldown on auth failure. Add an append-only `request_logs` SQLite table with header redaction and replay endpoint. Build `gateway/translate.mjs` for bidirectional Anthropic↔OpenAI message/response conversion. Wire zero-config auto-detection into `gateway/cli.mjs` with strict whitelist matching.

## Technical Context

**Language/Version**: Node.js 24+ (ES modules, `.mjs` extension)

**Primary Dependencies**: `better-sqlite3` (existing, for ledger storage); all other functionality uses Node.js built-ins (`node:http`, `node:https`, `node:crypto`, `node:fs`, `node:path`)

**Storage**: SQLite via `better-sqlite3` — existing `ledger.db` (`token_events` table) + new `request_logs` table. No new database or storage engine.

**Testing**: Node.js native test runner (`node --test`). Existing cassette system (`test/cassette.mjs`) for deterministic LLM response mocking. New test files: `tests/gateway/wire-adapter-registry.test.mjs`, `tests/gateway/generic-http.test.mjs`, `tests/gateway/multi-key.test.mjs`, `tests/gateway/logging.test.mjs`, `tests/gateway/translate.test.mjs`.

**Target Platform**: Node.js server (Linux, macOS, Windows). The gateway listens on `127.0.0.1` by default (loopback-only for security).

**Project Type**: CLI + web service. The gateway is a long-running HTTP proxy server started via CLI (`node gateway/cli.mjs` or `npx meridian-gateway`).

**Performance Goals**: Proxy overhead <50ms p95 per request (excluding upstream latency). Key resolution and WireAdapter dispatch must be sub-millisecond.

**Constraints**: Zero external runtime dependencies beyond `better-sqlite3`. All new modules use `import`/`export` syntax exclusively. No breaking changes to existing `startGateway` or `assembleGateway` signatures — new features are additive or injectable via seams.

**Scale/Scope**: Single gateway instance per developer/team. Typical configuration: 3-10 providers, 2-5 keys per provider, 100-10,000 requests/day. Request log retention: configurable, default 7 days (~10-100MB typical).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence |
|-----------|--------|----------|
| I. Provider & Model Agnosticism | ✅ PASS | WireAdapter interface + generic HTTP = any provider addable without code changes |
| II. Gateway as Single Source | ✅ PASS | This IS the gateway hardening — default-ON, single metering path |
| III. Zero-Dependency Philosophy | ✅ PASS | All features use `node:*` built-ins only. `better-sqlite3` is existing and sole external dep |
| IV. Test-First Discipline | ✅ PASS | Test files designed alongside modules; cassette system reused |
| V. Configuration over Code | ✅ PASS | WireAdapters auto-discovered from directory; routes from config; translation opt-in per route |
| VI. Observability & Auditability | ✅ PASS | Request logging, token events with source attribution, adapter listing endpoint |
| VII. Non-Technical Usability | ✅ PASS | Zero-config bootstrap; clear startup messaging with dashboard URL |
| VIII. ES Modules & Modern JS | ✅ PASS | All `.mjs` files, `import`/`export` exclusively |
| IX. PR Discipline & Code Review | ✅ PASS | Standard PR process per AGENTS.md |
| X. Spec-Driven Development | ✅ PASS | This document is the plan phase; spec.md defines what; tasks.md will define how |

**Gate Result**: ALL PASS — no violations, no complexity justifications needed.

### Post-Design Re-Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Provider Agnosticism | ✅ PASS | `generic-http` wire type closes the last coverage gap; any REST endpoint is meterable |
| II. Gateway as Single Source | ✅ PASS | Design preserves gateway as sole metering path; no bypass paths introduced |
| III. Zero-Dependency | ✅ PASS | No new dependencies in design. SQLite table addition uses existing `better-sqlite3` |
| IV. Test-First | ✅ PASS | Test contracts defined in quickstart.md; 7 validation scenarios |
| V. Configuration over Code | ✅ PASS | Adapter discovery is directory-based (config); translation is route-level flag (config) |
| VI. Observability | ✅ PASS | `request_logs` table + `/api/gateway/logs` endpoint + replay endpoint |
| VII. Non-Technical Usability | ✅ PASS | Zero-config boot with clear messaging; all management via HTTP API |
| VIII. ES Modules | ✅ PASS | All new files `.mjs` |

**Post-Design Gate Result**: ALL PASS — design is constitution-compliant.

## Project Structure

### Documentation (this feature)

```text
specs/002-universal-gateway/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0: Research & decisions
├── data-model.md        # Phase 1: Entity model & DB schema
├── quickstart.md        # Phase 1: Validation scenarios
├── contracts/           # Phase 1: Interface contracts
│   ├── wire-adapter-interface.md
│   └── gateway-api.md
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
gateway/
├── server.mjs              # MODIFIED: Extract wire logic → delegate to WireAdapter registry
├── index.mjs               # MODIFIED: Wire WireAdapter registry into assembleGateway
├── cli.mjs                 # MODIFIED: Add zero-config auto-detection + startup messaging
├── provider-registry.mjs   # MODIFIED: Dynamic VALID_WIRES from adapter registry
├── token-event.mjs         # MODIFIED: Add 'generic-http' to VALID_WIRES
├── ledger-schema.sql       # MODIFIED: Add request_logs table
├── wire-adapters/          # NEW directory
│   ├── anthropic.mjs       # NEW: Extracted from server.mjs
│   ├── openai.mjs          # NEW: Extracted from server.mjs
│   └── generic-http.mjs    # NEW: Passthrough adapter
├── wire-adapter-registry.mjs  # NEW: Auto-discovery + loading + dispatch
├── logging.mjs             # NEW: Request/response logging + redaction + replay
├── translate.mjs           # NEW: Anthropic↔OpenAI cross-wire translation
└── tests/
    ├── wire-adapter-registry.test.mjs  # NEW
    ├── generic-http.test.mjs           # NEW
    ├── multi-key.test.mjs              # NEW
    ├── logging.test.mjs                # NEW
    └── translate.test.mjs              # NEW

tests/
└── gateway/
    ├── wire-adapter-registry.test.mjs  # NEW (symlink or direct)
    ├── generic-http.test.mjs           # NEW
    ├── multi-key.test.mjs              # NEW
    ├── logging.test.mjs                # NEW
    └── translate.test.mjs              # NEW
```

**Structure Decision**: Single-project structure. The gateway is already a well-defined subsystem under `gateway/`. New modules follow the existing pattern: one `.mjs` file per concern, tests alongside in `gateway/tests/`. The `wire-adapters/` directory is new but follows the plugin-directory pattern common in Node.js tools.

## Complexity Tracking

> No violations detected. Constitution Check passed on all 10 principles. No complexity justifications needed.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |

## Implementation Order

Based on dependency analysis from MASTER-PLAN-CLOSE-GAPS.md:

| Group | Stories | Duration | Depends On | Rationale |
|-------|---------|----------|------------|-----------|
| G1 | Story 1: Zero-Config Bootstrap | 4 days | None | New code in `gateway/cli.mjs` — no conflicts |
| G2 | Story 2: WireAdapter Interface + Story 3: Generic HTTP | 5 days | None (∥ G1) | Interface designed first, then generic-http implements it |
| G3 | Story 4: Multi-Key Credentials | 3 days | None (∥ G1) | Modifies `gateway/provider-registry.mjs` — independent |
| G4 | Story 6: Request Logging | 3 days | None (∥ G1) | New file `gateway/logging.mjs` — zero conflicts |
| G5 | Story 5: Cross-Wire Translation | 5 days | G2 complete | Depends on WireAdapter interface for format detection |

**Critical path**: G2 → G5 = 10 working days. All groups can run in parallel except G5 which depends on G2.

## Design Artifacts

| Artifact | Path | Description |
|----------|------|-------------|
| Research | [research.md](./research.md) | 7 research decisions with rationale and alternatives |
| Data Model | [data-model.md](./data-model.md) | 5 entities, ER diagram, new `request_logs` schema |
| WireAdapter Contract | [contracts/wire-adapter-interface.md](./contracts/wire-adapter-interface.md) | Formal interface with 2 required + 4 optional methods |
| Gateway API Contract | [contracts/gateway-api.md](./contracts/gateway-api.md) | Management endpoints, proxy behavior, startup output |
| Quickstart | [quickstart.md](./quickstart.md) | 7 validation scenarios + 3 manual dogfood scenarios |
