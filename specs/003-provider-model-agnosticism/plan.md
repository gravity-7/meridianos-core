# Implementation Plan: Provider & Model Agnosticism

**Branch**: `003-provider-model-agnosticism` | **Date**: 2026-07-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/003-provider-model-agnosticism/spec.md`

## Summary

Deliver complete provider and model agnosticism by making LLM providers declarative (YAML-driven registry with JSON Schema validation), building an interactive provider configuration wizard with a curated 15-provider database, implementing automated model discovery with per-provider adapters, adding intelligent tier-based model routing with weighted canary selection and circuit-breaking fallback chains, and building a multi-source automated pricing refresh pipeline with cache-differentiated cost calculation. Eight independently testable user stories, each delivering standalone value. All changes are additive — the existing static `PROVIDERS` export is preserved via a backward-compatible lazy getter.

**Technical approach**: Extract the hardcoded `PROVIDERS` object from `providers.mjs` into a three-source merge (policy.yaml > .ai/providers.yaml > built-in defaults), backed by a JSON Schema. Build `provider-wizard.mjs` with CLI/dashboard dual interfaces and a known-providers JSON database. Create `model-registry.mjs` (SQLite-based) and `model-discovery.mjs` with per-provider adapter modules. Extend `model-router.mjs` with weighted candidate selection, fallback chains, and `model-fallback.mjs` circuit breaker. Build `pricing-refresh.mjs` with a 4-tier fallback chain and cache-differentiated cost formulas in `pricing.mjs`.

## Technical Context

**Language/Version**: Node.js 24+ (ES modules, `.mjs` extension, `"type": "module"`)

**Primary Dependencies**: `better-sqlite3` (sole runtime dependency — zero-dependency philosophy); Node.js built-ins for all other functionality (`node:http`, `node:https`, `node:crypto`, `node:fs`, `node:path`, `node:child_process`)

**Storage**: SQLite via `better-sqlite3` — existing `ledger.db` (token_events table) + new `model_registry` table. No new database or storage engine.

**Testing**: Node.js native test runner (`node --test`). Cassette system (`test/cassette.mjs`) for deterministic LLM response mocking. New test files: `tests/providers-registry.test.mjs`, `tests/provider-wizard.test.mjs`, `tests/model-discovery.test.mjs`, `tests/model-router-fallback.test.mjs`, `tests/pricing-refresh.test.mjs`, `tests/provider-conformance.test.mjs`.

**Target Platform**: Node.js daemon (Windows, macOS, Linux). Gateway and dashboard run as embedded HTTP servers. CLI tools (`node gateway/cli.mjs`) for operator workflows.

**Project Type**: Node.js daemon/orchestrator with embedded HTTP gateway proxy and dashboard web server. Flat project structure — all `.mjs` source files at repository root, gateway-specific modules in `gateway/`, tests in `tests/`.

**Performance Goals**: Provider resolution: sub-millisecond (in-memory Map lookup). Model discovery: under 60 seconds for all configured providers (network-bound, parallelized). Pricing refresh: under 30 seconds for all configured providers. Model routing selection: sub-millisecond (weighted random from in-memory candidate list). Circuit breaker state check: O(1) per model.

**Constraints**: Zero new npm dependencies. All existing 915+ tests must continue to pass. The static `PROVIDERS` export from `providers.mjs` must remain accessible via lazy getter — zero breaking changes to any existing call site. SQLite WAL mode for concurrent read/write safety between gateway, scheduler, and dashboard.

**Scale/Scope**: Single-tenant daemon process. Up to ~30 configured providers (typical: 5-15). Model registry: 100-500 models tracked. Pricing refresh: 4-tier fallback, <30 seconds total. Circuit breaker: per-model state tracking, <100 models in rotation. Dashboard API: standard CRUD endpoints for providers, models, pricing.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Assessment |
|---|-----------|--------|-----------|
| I | Provider & Model Agnosticism | ✅ PASS | This IS the direct implementation of this principle. Declarative registries, auto-discovery, wizard-based configuration, and fallback routing ensure any provider/model is addable without code changes. |
| II | Gateway as Single Source of Truth | ✅ PASS | All traffic continues to route through gateway. Model registry and pricing data are stored in the gateway's ledger.db — same source of truth. Provider auto-detection at gateway start ensures coverage. |
| III | Zero-Dependency Philosophy | ✅ PASS | All new modules use Node.js built-ins exclusively. `better-sqlite3` is the existing sole external dependency. Known-providers database is a static JSON file (no npm package). |
| IV | Test-First Discipline | ✅ PASS | Test files designed alongside implementation modules. Cassette system reused for deterministic provider API mocking. All existing tests must pass with zero regressions. |
| V | Configuration over Code | ✅ PASS | Providers defined in YAML, not JavaScript. Three-source merge (policy > .ai > defaults). JSON Schema validation. Wizard writes to policy.yaml. Fallback chains defined in config, not hardcoded. |
| VI | Observability & Auditability | ✅ PASS | Model discovery logs results per provider. Pricing refresh attributes source. Circuit breaker state transitions are logged. Dashboard surfaces all provider/model/pricing data. |
| VII | Non-Technical Usability | ✅ PASS | Provider wizard with dual CLI/dashboard interfaces. Known-providers database eliminates need to know API endpoint details. Dashboard Model/Provider tabs provide visual management. |
| VIII | ES Modules & Modern JavaScript | ✅ PASS | All new and modified code uses `.mjs` extension, `import`/`export` syntax, `node:` prefix for built-ins. |
| IX | PR Discipline & Code Review | ✅ PASS | All changes delivered via pull requests referencing the spec. Branches deleted after merge. |
| X | Spec-Driven Development | ✅ PASS | This plan follows the spec-kit workflow from spec → plan → tasks → implement → converge. |

**Gate Result: ALL 10 PRINCIPLES PASS — no violations, no justifications needed.**

### Post-Design Re-Check

*Re-evaluated after Phase 1 design (research.md, data-model.md, contracts, quickstart.md).*

| # | Principle | Status | Notes |
|---|-----------|--------|-------|
| I | Provider & Model Agnosticism | ✅ PASS | Three-source YAML merge + WireAdapter-backed `wire` validation + model discovery adapters + fallback chains = any provider/model addable without code changes. Research confirms all 11 design decisions align. |
| II | Gateway as Single Source | ✅ PASS | Model registry and pricing data co-located in gateway's `ledger.db`. Provider auto-detection at gateway start. No new data paths outside gateway. |
| III | Zero-Dependency | ✅ PASS | All 11 research decisions use Node.js built-ins exclusively. `known-providers.json` is static JSON. JSON Schema validation is manual structural checks. No npm install needed. |
| IV | Test-First | ✅ PASS | 7 new test files designed. Cassette system covers provider API mocking. Quickstart defines 11 validation scenarios + 20-point manual checklist. |
| V | Configuration over Code | ✅ PASS | Providers in YAML (not JS). Fallback chains in routing config. Wizard writes to policy.yaml. Circuit breaker thresholds configurable. Pricing fallback order configurable. |
| VI | Observability | ✅ PASS | Model discovery logs per-provider results. Pricing refresh attributes source. Circuit breaker logs every state transition. Dashboard surfaces all data. |
| VII | Non-Technical Usability | ✅ PASS | Provider wizard with CLI + dashboard. Known-providers DB eliminates need for API URL knowledge. Dashboard tabs for providers/models/pricing. Auto-detection at gateway start. |
| VIII | ES Modules | ✅ PASS | All new files: `.mjs` extension, `import`/`export`, `node:` prefix. JSON data files are standard JSON. |
| IX | PR Discipline | ✅ PASS | Standard PR process. Feature directory created. Branch naming follows convention. |
| X | Spec-Driven | ✅ PASS | Full spec-kit workflow: spec.md → plan.md → research.md → data-model.md → contracts/ → quickstart.md. Ready for `/speckit-tasks`. |

**Post-Design Gate Result: ALL 10 PRINCIPLES PASS — design is constitution-compliant.**

## Project Structure

### Documentation (this feature)

```text
specs/003-provider-model-agnosticism/
├── plan.md              # This file
├── research.md          # Phase 0 output — technical decisions
├── data-model.md        # Phase 1 output — entity definitions
├── quickstart.md        # Phase 1 output — validation guide
├── contracts/           # Phase 1 output — interface contracts
│   ├── provider-registry-api.md
│   └── model-discovery-adapter-interface.md
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
providers.mjs                 # MODIFIED: Extract PROVIDERS → lazy getter from registry
config.mjs                    # MODIFIED: Add provider merge logic (policy > .ai > defaults)
policy-validate.mjs           # MODIFIED: Validate provider entries against schema
init.mjs                      # MODIFIED: Generate .ai/providers.yaml from defaults

gateway/
├── cli.mjs                   # MODIFIED: Add `provider add|test|list` and `models refresh` commands
├── provider-registry.mjs     # MODIFIED: Dynamic VALID_WIRES from WireAdapter registry
├── known-providers.json      # [NEW] Curated database of 15+ providers
└── ledger-schema.sql         # MODIFIED: Add model_registry table

schema/
├── policy.schema.json        # MODIFIED: Add provider validation subschema
└── provider.schema.json      # [NEW] JSON Schema draft-07 for provider definitions

provider-conformance.mjs      # [NEW] Automated provider connection testing
provider-wizard.mjs           # [NEW] Interactive CLI + programmatic wizard
model-registry.mjs            # [NEW] SQLite-backed model storage layer
model-discovery.mjs           # [NEW] Per-provider model discovery orchestrator
model-discovery-adapters/     # [NEW] Provider-specific discovery adapters
├── openai.mjs                # [NEW] GET /v1/models + context-window lookup
├── anthropic.mjs             # [NEW] models.dev + curated list
├── google-ai.mjs             # [NEW] GET /v1beta/models
└── generic-http.mjs          # [NEW] Heuristic + models.dev fallback

model-fallback.mjs            # [NEW] Circuit breaker with healthy/degraded/open states
model-router.mjs              # MODIFIED: Weighted candidate selection, fallback chains

pricing.mjs                   # MODIFIED: Cache-differentiated cost calculation
pricing-refresh.mjs           # [NEW] 4-tier fallback pricing refresh pipeline

scheduler.mjs                 # MODIFIED: modelDiscoveryTick + pricingRefreshTick
dashboard/
└── server.mjs                # MODIFIED: GET/POST /api/providers, /api/models, /api/pricing

tests/
├── providers-registry.test.mjs       # [NEW] YAML merge, schema validation, backward compat
├── provider-wizard.test.mjs          # [NEW] CLI wizard, auto-detect, dashboard API
├── provider-conformance.test.mjs     # [NEW] Connection testing, error classification
├── model-discovery.test.mjs          # [NEW] Discovery adapters, normalization, deprecation
├── model-registry.test.mjs           # [NEW] SQLite CRUD, upsert, tier assignment
├── model-router-fallback.test.mjs    # [NEW] Weighted selection, fallback chains, circuit breaker
└── pricing-refresh.test.mjs          # [NEW] Multi-source refresh, fallback chain
```

**Structure Decision**: MeridianOS uses a flat structure — all `.mjs` source files at the repository root with `gateway/` and `dashboard/` subdirectories. New model discovery adapters live in `gateway/model-discovery-adapters/` (organized by provider, similar to `gateway/wire-adapters/`). This matches the existing convention.

## Complexity Tracking

*No violations — constitution check passes all 10 principles without exception. This section intentionally left empty.*
