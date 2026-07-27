# Implementation Plan: Foundation Hardening

**Branch**: `001-foundation-hardening` | **Date**: 2026-07-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-foundation-hardening/spec.md`

## Summary

Harden the MeridianOS foundation by making the gateway the default metering path (opt-out instead of opt-in), implementing OpenAI wire injection for OpenCode agents, unifying tenant and policy configuration into a single `policy.yaml`, adding traffic source classification to the ledger, building provider health monitoring, replacing Windows-only PowerShell scripts with cross-platform Node.js equivalents, fixing all architecture diagram defects, correcting zero-vs-null budget sentinel semantics, removing the hardcoded Anthropic version header, auditing harness adapters for silent OAuth fallback, implementing self-healing bootstrap, and adding JSON Schema validation for configuration files. All 12 features target zero regressions on the existing 915-test suite.

## Technical Context

**Language/Version**: Node.js 24+ (ES modules, `.mjs` extension, `"type": "module"`)

**Primary Dependencies**: `better-sqlite3` (sole runtime dependency — zero-dependency philosophy); Node.js built-ins for all other functionality (`node:crypto`, `node:fs`, `node:http`, `node:https`, `node:path`, `node:child_process`, `node:url`)

**Storage**: SQLite via `better-sqlite3` — gateway ledger (`gateway/ledger-schema.sql` → `.ai/gateway/ledger.db`), daemon board DB (`schema.sql` → `.ai/state/db.sqlite`)

**Testing**: Node.js native test runner (`node --test`), cassette system (`test/cassette.mjs`) for deterministic LLM response mocking, 915 tests currently pass at 0 failures

**Target Platform**: Windows, macOS, Linux — daemon process with embedded HTTP dashboard (port 4317) and gateway sidecar (ephemeral port or configured)

**Project Type**: Node.js daemon/orchestrator with embedded HTTP gateway proxy and dashboard web server. Flat project structure — all `.mjs` source files at repository root, gateway-specific modules in `gateway/`, tests in `tests/`.

**Performance Goals**: Gateway proxy throughput: handle agent API call volume (tens of requests/minute, not thousands/second). Health check loop: 60-second interval, 5-second timeout per probe. Boot-time validation: sub-second.

**Constraints**: Zero new npm dependencies. All existing 915 tests must continue to pass. Gateway injection must be byte-identical for existing Anthropic-wire path. SQLite `ALTER TABLE ADD COLUMN` must be O(1) — no downtime for source column migration.

**Scale/Scope**: Single-tenant daemon process. Up to ~6 configured providers. Single-digit concurrent agent runs. Ledger grows append-only over months of operation.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Assessment |
|---|-----------|--------|-----------|
| I | Provider & Model Agnosticism | ✅ PASS | P0-F1 (OpenAI wire injection) extends gateway coverage to a second wire protocol. P0-F9 (per-provider headers) removes Anthropic-specific hardcoding. Both move toward agnosticism without adding provider-specific code paths. |
| II | Gateway as Single Source of Truth | ✅ PASS | P0-F2 is the DIRECT implementation of this principle: gateway defaults to ON, budget reads ledger first. P0-F4 (source classification) ensures all traffic is attributable. P0-F10 (harness audit) closes silent bypass paths. |
| III | Zero-Dependency Philosophy | ✅ PASS | All Phase 0 changes use Node.js built-ins exclusively. No new `npm install` required. `node:crypto` replaces DPAPI for cross-platform scripts. |
| IV | Test-First Discipline | ✅ PASS | P0-F1.2 explicitly creates test files (`inject-openai.test.mjs`, `server-openai.test.mjs`) alongside implementation. All existing tests must pass with zero regressions. |
| V | Configuration over Code | ✅ PASS | P0-F3 unifies tenant + policy config into one surface. P0-F12 adds JSON Schema validation. P0-F2 gateway behavior is policy-driven (`gateway.disabled: true` to opt out). |
| VI | Observability & Auditability | ✅ PASS | P0-F4 adds source attribution to every token event. P0-F5 adds provider health visibility. P0-F10 adds ledger-vs-reader discrepancy detection. |
| VII | Non-Technical Usability | ✅ PASS | P0-F11 (self-healing bootstrap) improves first-run experience with auto-created directories and human-readable errors instead of stack traces. |
| VIII | ES Modules & Modern JavaScript | ✅ PASS | All new and modified code uses `.mjs` extension, `import`/`export` syntax, `node:` prefix for built-ins. |
| IX | PR Discipline & Code Review | ✅ PASS | All changes delivered via pull requests referencing the spec. Branches deleted after merge. |
| X | Spec-Driven Development | ✅ PASS | This plan follows the spec-kit workflow from spec → plan → tasks → implement → converge. |

**Gate Result: ALL 10 PRINCIPLES PASS — no violations, no justifications needed.**

## Project Structure

### Documentation (this feature)

```text
specs/001-foundation-hardening/
├── plan.md              # This file
├── research.md          # Phase 0 output — technical decisions
├── data-model.md        # Phase 1 output — entity definitions
├── quickstart.md        # Phase 1 output — validation guide
├── contracts/           # Phase 1 output — (none needed; internal-only changes)
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
gateway/
├── inject.mjs              # P0-F1: Add OpenAI wire injection branch
├── server.mjs              # P0-F1: Add OpenAI forward headers, P0-F9: Remove hardcoded headers
├── index.mjs               # P0-F5: Start health check loop
├── ledger-schema.sql       # P0-F4: Add source column
├── ledger.mjs              # P0-F4: Update query/event functions for source
├── token-event.mjs         # P0-F4: Add source to token event shape
└── windows.mjs             # P0-F8: Fix zero-vs-null semantics

scheduler.mjs               # P0-F2: Always start gateway (remove opt-in gate)
launcher.mjs                # P0-F2: Check config.gateway.url not enabled flag
budget.mjs                  # P0-F2: Budget reads ledger first, falls back to usage readers
config.mjs                  # P0-F3: Merge tenant fields into policy
tenant-config.mjs           # P0-F3: Add deprecation warning
policy-validate.mjs         # P0-F3: Extend validation, P0-F12: JSON Schema validation

provider-health.mjs         # [NEW] P0-F5: Background health check loop
schema/
└── policy.schema.json      # [NEW] P0-F12: JSON Schema draft-07 for policy.yaml

scripts/
├── publish.mjs             # [NEW] P0-F6: Cross-platform publish using node:crypto
└── register-conductor.mjs  # [NEW] P0-F6: Cross-platform service registration

harness-adapters.mjs        # P0-F1: Ensure opencode metadata has wire:'openai'; P0-F10: Audit BASE_URL
boot-guard.mjs              # P0-F11: Auto-create missing directories
init.mjs                    # P0-F11: --init flag support
daemon-entry.mjs            # P0-F11: Wire --init flag

dashboard/
└── server.mjs              # P0-F5: GET /api/providers with health; P0-F6: Platform-agnostic restart

docs/
├── migration-guide.md      # [NEW] P0-F3: tenant.yaml → policy.yaml migration
├── KNOWN-ISSUES.md         # [NEW] P0-F10: Document Claude Code OAuth fallback
└── diagrams/               # P0-F7: Fix all 5 diagrams + re-export PNGs

tests/
├── gateway/
│   ├── inject-openai.test.mjs   # [NEW] P0-F1.2: OpenAI injection tests
│   └── server-openai.test.mjs   # [NEW] P0-F1.2: OpenAI server forwarding tests
└── provider-health.test.mjs     # [NEW] P0-F5: Health check tests
```

**Structure Decision**: MeridianOS uses a flat structure — all `.mjs` source files at the repository root with `gateway/` and `dashboard/` subdirectories. No `src/` directory. This matches the existing convention.

## Complexity Tracking

*No violations — constitution check passes all 10 principles without exception. This section intentionally left empty.*
