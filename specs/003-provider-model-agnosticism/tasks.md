# Tasks: Provider &amp; Model Agnosticism

**Input**: Design documents from `specs/003-provider-model-agnosticism/`

**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/, quickstart.md

**Tests**: Test tasks are included per the constitution's Test-First Discipline principle (Principle IV). Each user story has corresponding test tasks.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing. Critical path: US1 → US4 → US5; US2, US3, US6, US7, US8 are parallelizable after their dependencies.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Verification Baseline)

**Purpose**: Confirm clean starting state before any implementation

- [X] T001 Run full test suite to establish baseline: `npm test` — confirm 915+ tests pass, 0 failures
- [X] T002 Verify WireAdapter registry is functional from P1: check `gateway/wire-adapter-registry.mjs` exports `getValidWires()` — needed for provider schema `wire` enum validation
- [X] T003 [P] Verify existing `providers.mjs` structure — document all call sites that access `PROVIDERS` (run `rg "PROVIDERS\." --type js` to list files) for backward-compat planning

---

## Phase 2: Foundational — Provider Schema &amp; Registry Core (Blocks US1, US2, US3)

**Purpose**: JSON Schema for provider definitions and the three-source merge engine. All provider-related stories depend on this.

**⚠️ CRITICAL**: US1, US2, US3, US7 depend on this phase being complete.

- [X] T004 Create `schema/provider.schema.json` with JSON Schema draft-07: required fields (`name`, `wire`, `baseUrl`), enum validation on `wire` (to be dynamically validated against WireAdapter registry), optional fields (`displayName`, `keyEnv`, `auth`, `headers`, `features`). Reference data-model.md §Provider for field definitions.
- [X] T005 [P] Create `providers.defaults.yaml` with built-in provider defaults: Anthropic (anthropic wire), DeepSeek (openai wire), OpenRouter (openai wire), Ollama (openai wire). Each with `name`, `wire`, `baseUrl`, `keyEnv`, `displayName`.
- [X] T006 [P] Create `gateway/known-providers.json` with 15 curated providers per research.md R3: Anthropic, DeepSeek, OpenRouter, Ollama, OpenAI, Groq, Together, Fireworks, Google Gemini, Mistral, Cohere, Perplexity, xAI, Azure OpenAI, AWS Bedrock. Each with `name`, `displayName`, `wire`, `baseUrl`, `keyEnv`, `docsUrl`, `features`.

**Checkpoint**: Schema and data files exist. Provider merge engine can now be built on top.

---

## Phase 3: User Story 1 — Declarative Provider Registry (Priority: P1) 🎯 MVP

**Goal**: Transform the static `PROVIDERS` object in `providers.mjs` into a YAML-driven registry with three-source merge and backward-compatible lazy getter.

**Independent Test**: Add a provider entry to `policy.yaml`, restart the daemon, and verify `resolveAllProviders()` includes it alongside built-in defaults. Access `PROVIDERS.anthropic` from existing code — must work without changes.

### Tests for User Story 1 ⚠️

> **Write these FIRST, ensure they FAIL before implementation**

- [X] T007 [P] [US1] Create `tests/providers-registry.test.mjs` — test three-source merge priority (policy > .ai > defaults), field-level override, provider hiding via null override, deep merge of `headers`/`features`, backward-compatible `PROVIDERS` lazy getter
- [X] T008 [P] [US1] Create `tests/policy-validate-providers.test.mjs` — test that invalid `wire` values are rejected with message listing valid wires, missing required fields are caught, valid provider configs pass validation

### Implementation for User Story 1

- [X] T009 [US1] Implement `resolveAllProviders()` in `providers.mjs` — merge providers from three sources: `policy.yaml` providers key (highest), `.ai/providers.yaml` (middle), `providers.defaults.yaml` (lowest). Shallow merge top-level fields; deep merge `headers` and `features` objects. Return flat map keyed by provider name.
- [X] T010 [US1] Implement `resolveProvider(name)` in `providers.mjs` — single-provider lookup with same merge logic, returns resolved provider or throws if not found.
- [X] T011 [US1] Add backward-compatible lazy getter: `export const PROVIDERS = new Proxy({}, { get: (_, name) => resolveProvider(name), ownKeys: () => Object.keys(resolveAllProviders()), getOwnPropertyDescriptor: (_, name) => ({ enumerable: true, configurable: true }) })` in `providers.mjs`
- [X] T012 [US1] Extend `config.mjs` `loadPolicy()` to parse and validate `providers:` key from `policy.yaml`. Merge into resolved config under `config.providers`.
- [X] T013 [US1] Extend `policy-validate.mjs` to validate `providers:` entries against `schema/provider.schema.json` — check required fields, validate `wire` against WireAdapter registry `getValidWires()`, produce specific error messages with field paths.
- [X] T014 [US1] Update `init.mjs` `--init` flag to generate `.ai/providers.yaml` from `providers.defaults.yaml`, auto-uncomment providers whose `keyEnv` exists in `process.env`.
- [X] T015 [US1] Run `npm test` — confirm T007, T008 all pass, and all existing tests that access `PROVIDERS` produce identical results (zero regressions)

**Checkpoint**: Providers are declarative. `resolveAllProviders()` returns merged config. `PROVIDERS.anthropic` works from existing code. `--init` generates provider defaults.

---

## Phase 4: User Story 2 — Provider Conformance Testing (Priority: P1)

**Goal**: Build automated conformance tests that verify provider connectivity, authentication, and wire format compatibility via lightweight API calls.

**Independent Test**: Run `node gateway/cli.mjs provider test anthropic` with valid key → `{ ok: true }`. Run with bad key → `{ ok: false, errorCode: "AUTH_FAILED" }`.

### Tests for User Story 2 ⚠️

- [ ] T016 [P] [US2] Create `tests/provider-conformance.test.mjs` — test each wire type's test call (OpenAI: GET /v1/models, Anthropic: POST /v1/messages with 1 token, Google AI: GET /v1beta/models, generic-http: GET /), error classification (AUTH_FAILED, CONNECTION_FAILED, TIMEOUT, UNEXPECTED_RESPONSE), 5-second timeout, cassette-mocked responses

### Implementation for User Story 2

- [X] T017 [US2] Create `provider-conformance.mjs` — export `testProviderConnection(providerConfig, resolvedKey)` → `{ ok, latencyMs, modelsFound?, features?, errorCode?, errorMessage? }`. Wire-type dispatch: `openai` → GET /v1/models, `anthropic` → POST /v1/messages (1 token), `google-ai` → GET /v1beta/models, `generic-http` → GET /. 5-second timeout per test. Classify errors: 401/403 → AUTH_FAILED, connection refused/DNS → CONNECTION_FAILED, timeout → TIMEOUT, unexpected status/body → UNEXPECTED_RESPONSE.
- [ ] T018 [US2] Add `provider test <name>` command to `gateway/cli.mjs` — resolves provider + API key, calls `testProviderConnection()`, prints result with ✓/✗ status, latency, and error details.
- [ ] T019 [US2] Add `POST /api/providers/test` endpoint to `dashboard/server.mjs` — accepts `{ provider }`, resolves key, calls conformance tester, returns result JSON.
- [ ] T020 [US2] Run `npm test` — confirm T016 passes, all existing tests pass

**Checkpoint**: Operators can test any provider's connection with a single command. Dashboard "Test Connection" button functional.

---

## Phase 5: User Story 3 — Provider Configuration Wizard (Priority: P2)

**Goal**: Build interactive CLI + programmatic wizard for adding providers, with auto-detection from environment and known-providers database pre-fill.

**Independent Test**: Run `node gateway/cli.mjs provider add --name groq --wire openai --base-url https://api.groq.com/openai/v1 --key-env GROQ_API_KEY` → provider appears in `policy.yaml`.

### Tests for User Story 3 ⚠️

- [ ] T021 [P] [US3] Create `tests/provider-wizard.test.mjs` — test interactive CLI mode (simulated stdin), `--auto` mode with env vars, `--name/--wire/--base-url/--key-env` non-interactive mode, dashboard API `POST /api/providers`, known-providers pre-fill, concurrent modification 409 detection

### Implementation for User Story 3

- [ ] T022 [US3] Create `provider-wizard.mjs` — export `runProviderWizard({ interactive, auto, name, wire, baseUrl, keyEnv })`. Interactive: prompt provider name → match against known-providers → pre-fill → confirm/save. Auto: scan `process.env` for `keyEnv` matches in known-providers → auto-configure all. Non-interactive: use provided params directly.
- [ ] T023 [US3] Implement `runProviderWizardDashboard(name, keyEnv, apiKey)` in `provider-wizard.mjs` — programmatic interface for dashboard API, same logic as interactive but no stdin prompts
- [ ] T024 [US3] Add `provider add [--auto|--name X --wire Y --base-url Z --key-env W]` command to `gateway/cli.mjs` — dispatches to `runProviderWizard()` with appropriate mode
- [ ] T025 [US3] Add `provider list` command to `gateway/cli.mjs` — prints table of all providers with name, displayName, wire, health status, latency
- [ ] T026 [US3] Add `POST /api/providers` endpoint to `dashboard/server.mjs` — accepts `{ name, keyEnv, apiKey, source }`, calls wizard, writes to `policy.yaml`, creates timestamped backup, returns 201 or 409 on conflict
- [ ] T027 [US3] Implement concurrent modification detection in `provider-wizard.mjs` — read `policy.yaml` mtime before wizard, compare after, return 409 if changed
- [ ] T028 [US3] Run `npm test` — confirm T021 passes, all existing tests pass

**Checkpoint**: Full provider lifecycle works: `provider add` → `provider list` shows it → `provider test` validates it.

---

## Phase 6: User Story 4 — Automated Model Discovery (Priority: P2)

**Goal**: Automatically discover models from configured providers, normalize formats, persist to SQLite registry, schedule daily refresh.

**Independent Test**: Run `node gateway/cli.mjs models refresh` → query registry and verify models from all providers present with metadata.

### Tests for User Story 4 ⚠️

- [ ] T029 [P] [US4] Create `tests/model-registry.test.mjs` — test SQLite table creation, `upsertModel()` (insert + update), `getModels()` with provider/tier/deprecated filters, `markDeprecated()`, `autoAssignTiers()` heuristic, composite PK scoping (`anthropic:claude-sonnet-4` vs `openrouter:claude-sonnet-4`)
- [ ] T030 [P] [US4] Create `tests/model-discovery.test.mjs` — test each discovery adapter (openai, anthropic, google-ai, generic-http) with cassette-mocked responses, normalization of provider formats, deprecation marking for unseen models, error resilience (one provider fails → others continue), parallel discovery

### Implementation for User Story 4

- [ ] T031 [US4] Add `model_registry` table to `gateway/ledger-schema.sql` per data-model.md — columns: `id` (TEXT PK, `provider:model_id`), `provider`, `model_id`, `display_name`, `context_window`, `max_output_tokens`, `features` (JSON TEXT), `pricing_input_per_m`, `pricing_cached_input_per_m`, `pricing_output_per_m`, `pricing_source`, `pricing_refreshed`, `deprecated`, `deprecated_successor`, `tier_assigned`, `last_seen`, `created_at`, `updated_at`. Indexes on `provider`, `tier_assigned`, `deprecated`.
- [X] T032 [US4] Create `model-registry.mjs` — functions: `upsertModel(provider, modelData)` (INSERT OR REPLACE), `getModels({ provider, tier, deprecated, search })` (SELECT with optional filters), `markDeprecated(provider, activeModelIds)` (UPDATE deprecated=1 for unseen models), `markUnseenAsDeprecated(provider, seenIds)` (batch update), `autoAssignTiers()` (heuristic: context_window < 32k OR output_price < $1 → quick; 32k-128k → medium; ≥128k → best)
- [X] T033 [US4] Create `gateway/model-discovery-adapters/openai.mjs` — `discoverModels(providerConfig)` → GET /v1/models, parse `{ data: [{ id }] }`, lookup context windows from static mapping, infer features from model ID patterns
- [X] T034 [P] [US4] Create `gateway/model-discovery-adapters/anthropic.mjs` — curated static list of known Claude models with context windows and features
- [X] T035 [P] [US4] Create `gateway/model-discovery-adapters/google-ai.mjs` — GET /v1beta/models, parse response, filter to generateContent-supporting models, strip models/ prefix
- [X] T036 [P] [US4] Create `gateway/model-discovery-adapters/generic-http.mjs` — try GET /v1/models (OpenAI-compatible), return empty list if fails
- [X] T037 [US4] Create `model-discovery.mjs` — `discoverAllModels(providers)` iterates providers in parallel, resolves adapter by wire type, catches per-provider errors, upserts via model-registry.mjs, marks unseen as deprecated. `refreshModelRegistry()` orchestrates full refresh cycle.
- [ ] T038 [US4] Add `models refresh` and `models list [--provider X] [--tier Y]` commands to `gateway/cli.mjs`
- [ ] T039 [US4] Add `modelDiscoveryTick` to `scheduler.mjs` — calls `refreshModelRegistry()` every 24 hours
- [ ] T040 [US4] Run `npm test` — confirm T029, T030 pass, all existing tests pass

**Checkpoint**: Models auto-discovered from all providers. Registry populated. Dashboard shows models with metadata. Daily refresh scheduled.

---

## Phase 7: User Story 5 — Intelligent Tier-Based Model Routing with Fallback (Priority: P2)

**Goal**: Extend model router with weighted candidate selection, automatic fallback chains across tiers, and circuit breaker protection.

**Independent Test**: Configure 90/10 weighted candidates → run 100 tasks with deterministic seed → verify ~90 primary, ~10 canary. Simulate failures → verify fallback and circuit breaker behavior.

### Tests for User Story 5 ⚠️

- [ ] T041 [P] [US5] Create `tests/model-router-fallback.test.mjs` — test weighted selection distribution (within 5% tolerance over 100 iterations with seeded PRNG), fallback on retryable errors (5xx, timeout, rate limit), fallback across tiers when current tier exhausted, circuit breaker transitions (healthy→degraded→circuit_open), immediate open on auth errors, auto-recovery probe after 5-min cooldown, all-tiers-exhausted terminates with error (no infinite loop), backward compatibility (single-model tier auto-wrapped as single-candidate list)

### Implementation for User Story 5

- [X] T042 [US5] Create `model-fallback.mjs` — export `CircuitBreaker` class: per-model state tracking (`healthy`/`degraded`/`circuit_open`), `recordSuccess(modelId)`, `recordFailure(modelId, error)`, `isAvailable(modelId)`, `getState(modelId)`. Auth errors (401, 403) → immediate `circuit_open`. Other errors → increment counter, `degraded` at 2, `circuit_open` at 5. Probe allowed after 5-min cooldown. State transitions logged.
- [ ] T043 [US5] Extend `model-router.mjs` `selectModelFromCandidates(tierConfig)` — parse `candidates: [{ model, weight }]` array from tier config, validate each model exists in registry, filter circuit-broken models via `CircuitBreaker.isAvailable()`, weighted random selection using cumulative distribution, deterministic mode with seeded PRNG for tests (accept optional `seed` parameter)
- [ ] T044 [US5] Implement fallback chain in `model-router.mjs` `resolveModelWithFallback(taskConfig, tiers)` — try tier 0 candidates in order, on retryable error try next candidate, on tier exhaustion advance to next tier, on all tiers exhausted throw `AllModelsExhaustedError`. Track attempted models to avoid re-selecting same model.
- [ ] T045 [US5] Integrate circuit breaker into gateway `server.mjs` proxy error handling — on upstream error, call `circuitBreaker.recordFailure(modelId, error)`. On success, call `circuitBreaker.recordSuccess(modelId)`.
- [ ] T046 [US5] Add backward-compatible handling in `model-router.mjs` — if tier has `model: "x"` (string, old format), auto-wrap as `candidates: [{ model: "x", weight: 100 }]` with deprecation log
- [ ] T047 [US5] Run `npm test` — confirm T041 passes, all existing router tests pass with zero regressions

**Checkpoint**: Weighted canary routing works. Fallback chains traverse tiers. Circuit breaker protects against broken models.

---

## Phase 8: User Story 6 — Automated Multi-Source Pricing Refresh (Priority: P2)

**Goal**: Build automated pricing refresh with 4-tier fallback chain and cache-differentiated cost calculation.

**Independent Test**: Run `node gateway/cli.mjs pricing refresh` → per-model pricing populated with source attribution. Kill network → falls back to last-known-good cache.

### Tests for User Story 6 ⚠️

- [ ] T048 [P] [US6] Create `tests/pricing-refresh.test.mjs` — test 4-tier fallback chain (provider-native → OpenRouter → models.dev → cache), source attribution in results, stale detection (>7 days), price change notifications (>10% → notify, >50% → alert), cache-differentiated cost calculation formula, network failure graceful degradation, daily scheduled refresh sequencing (after model discovery)

### Implementation for User Story 6

- [X] T049 [US6] Extend `pricing-refresh.mjs` — export `refreshAllModelPricing(db, policy, config)` with 4-tier chain: (1) provider-native pricing, (2) OpenRouter, (3) models.dev, (4) last-known-good cache. Per-model fallback with source attribution.
- [X] T050 [US6] Implement `getEffectiveCost(modelId, inputTokens, outputTokens, cachedInputTokens)` in `pricing.mjs` — formula: `(uncachedInput × inputPerM + cachedInput × cachedInputPerM + output × outputPerM) / 1,000,000`. Handle NULL `cachedInputPerM`: cost cached tokens at standard input rate.
- [X] T051 [US6] Implement price change detection in pricing-refresh.mjs — compare new price with previous record. >10% difference → notification. >50% → alert. Log all changes.
- [X] T052 [US6] Implement stale detection in pricing-refresh.mjs — `isPricingStale(pricingRefreshed)` → true if >7 days.
- [ ] T053 [US6] Add `pricing refresh` and `pricing show [--provider X]` commands to `gateway/cli.mjs`
- [ ] T054 [US6] Add `pricingRefreshTick` to `scheduler.mjs` — runs daily, sequenced AFTER `modelDiscoveryTick` completes. Calls `refreshAllPricing()`.
- [ ] T055 [US6] Add `POST /api/pricing/refresh` and `GET /api/pricing` endpoints to `dashboard/server.mjs`
- [ ] T056 [US6] Run `npm test` — confirm T048 passes, all existing pricing tests pass

**Checkpoint**: Pricing auto-refreshed daily from multiple sources. Cache-differentiated costs calculated correctly. Price changes trigger notifications.

---

## Phase 9: User Story 7 — Provider Auto-Detection on Gateway Start (Priority: P3)

**Goal**: Gateway auto-detects AI provider API keys from environment at startup using known-providers whitelist matching.

**Independent Test**: Set `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` → start gateway → both providers auto-detected and configured.

### Implementation for User Story 7

- [ ] T057 [US7] Implement `autoDetectProviders()` in `gateway/cli.mjs` (or new helper) — scan `process.env` for keys matching `known-providers.json` `keyEnv` fields using exact string match. Return list of `{ name, displayName, wire, baseUrl, keyEnv }` for matched providers. Non-AI keys (AWS, GCP, Azure infra) excluded by definition (not in known-providers database).
- [ ] T058 [US7] Integrate auto-detection into gateway startup in `gateway/cli.mjs` — if no providers configured, run `autoDetectProviders()`, print "Detected N providers: name (KEY_ENV), ...". If zero detected, prompt operator to run `--init` or `provider add`.
- [ ] T059 [US7] Integrate auto-detection into `provider-wizard.mjs` `--auto` mode — reuses `autoDetectProviders()`, writes detected providers to `.ai/providers.yaml`.
- [ ] T060 [US7] Run `npm test` — confirm existing gateway startup tests pass, auto-detection integration doesn't break zero-config bootstrap from P1

**Checkpoint**: Gateway zero-config experience complete — auto-detection + P1 bootstrap = instant-on metering.

---

## Phase 10: User Story 8 — Dashboard Model &amp; Provider Management (Priority: P3)

**Goal**: Provide visual management of providers and models via dashboard with health status, tier assignment, and refresh controls.

**Independent Test**: Open dashboard → Providers tab shows all providers with health. Models tab shows models with tier assignment. "Test Connection" works. "Refresh Models" triggers discovery.

### Implementation for User Story 8

- [ ] T061 [US8] Add `GET /api/providers` endpoint to `dashboard/server.mjs` — returns all resolved providers with health status (`ok`/`degraded`/`down`/`unknown`), latency, last checked time, source (default/local/policy), override count. Includes `healthyCount`, `degradedCount`, `downCount` aggregates.
- [ ] T062 [US8] Add `GET /api/models` endpoint to `dashboard/server.mjs` — returns models with optional filters (`provider`, `tier`, `deprecated`, `search`). Each model includes `pricing` sub-object with source and refresh timestamp. Includes `refreshedAt` and `count`.
- [ ] T063 [US8] Add `POST /api/models/refresh` endpoint — triggers `refreshModelRegistry()`, returns 202 with estimated duration
- [ ] T064 [US8] Add `GET /api/models/refresh/status` endpoint — returns current refresh progress (running/complete, providers done/total, models discovered, errors)
- [ ] T065 [US8] Build Providers tab UI in `dashboard/index.html` — table with columns: name, displayName, wire, health (colored dot), latency, last checked, "Test Connection" button. "Add Provider" button opens wizard form. Uses existing dashboard styling (single-page app, fetch-based API calls).
- [ ] T066 [US8] Build Models tab UI in `dashboard/index.html` — table grouped by provider with columns: model ID, display name, context window, features (icons), pricing (per-M input/output), tier assignment dropdown, deprecated badge. "Refresh Models" button with progress indicator. Uses existing dashboard patterns.
- [ ] T067 [US8] Run `npm test` — confirm dashboard tests pass, existing dashboard API tests not broken

**Checkpoint**: Full dashboard management experience. Operators can manage providers and models entirely from browser.

---

## Phase 11: Polish &amp; Cross-Cutting Concerns

**Purpose**: Final integration validation, edge case hardening, documentation.

- [ ] T068 Run full test suite: `npm test` — confirm 915+ tests pass, 0 failures, zero `.only()` markers
- [ ] T069 [P] Verify backward compatibility: grep all `PROVIDERS.` references across codebase, confirm each resolves correctly via lazy getter
- [ ] T070 [P] Verify zero-dependency constraint: `npm ls --prod` shows only `better-sqlite3`
- [ ] T071 Run quickstart.md VS-1 through VS-11 validation scenarios manually, confirm all pass
- [ ] T072 [P] Edge case hardening per spec.md: large model lists (OpenRouter 500+ models), model identity scoping, mid-task model deprecation, concurrent discovery/pricing, external policy.yaml modification during wizard

---

## Dependencies &amp; Execution Order

### User Story Dependency Graph

```
Phase 1: Setup (T001-T003)
    ↓
Phase 2: Foundational (T004-T006) — Schema + known-providers + defaults
    ↓
    ├─→ Phase 3: US1 (T007-T015) — Provider Registry [P1] 🎯 MVP
    │       ↓
    ├─→ Phase 4: US2 (T016-T020) — Conformance Testing [P1] (depends on US1 for provider resolution)
    │
    ├─→ Phase 5: US3 (T021-T028) — Provider Wizard [P2] (depends on US1 + known-providers)
    │
    ├─→ Phase 6: US4 (T029-T040) — Model Discovery [P2] (depends on US1 for provider resolution)
    │       ↓
    ├─→ Phase 7: US5 (T041-T047) — Model Routing/Fallback [P2] (depends on US4 for model registry)
    │
    ├─→ Phase 8: US6 (T048-T056) — Pricing Refresh [P2] (depends on US4 for model registry)
    │
    ├─→ Phase 9: US7 (T057-T060) — Auto-Detection [P3] (depends on US1 + known-providers)
    │
    └─→ Phase 10: US8 (T061-T067) — Dashboard Management [P3] (depends on US1-US6 for API endpoints)

Phase 11: Polish (T068-T072)
```

### Critical Path

**Setup (T001-T003) → Foundational (T004-T006) → US1 (T007-T015) → US4 (T029-T040) → US5 (T041-T047)**

Estimated: 10 working days on critical path.

### Parallel Opportunities

After US1 completes, these phases can run in parallel:
- US2 ∥ US3 ∥ US4 ∥ US7 (all depend on US1, no mutual dependencies)
- US5 and US6 can run in parallel (both depend on US4)
- US8 can start after US1, with progressive enhancement as US2-US6 complete

### Within-Story Parallel Tasks

- T007 ∥ T008 (different test files, same story)
- T016 alone (single test file)
- T029 ∥ T030 (different test files)
- T033 ∥ T034 ∥ T035 ∥ T036 (different adapter files, no mutual dependencies)
- T041 alone (single test file)
- T048 alone (single test file)

## Implementation Strategy

### MVP Scope (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T003)
2. Complete Phase 2: Foundational (T004-T006)
3. Complete Phase 3: User Story 1 (T007-T015)

**Deliverable**: Providers are declarative via YAML. `PROVIDERS` backward-compatible. `--init` generates defaults. This alone delivers the core architectural promise: "add a provider without code changes."

### Incremental Delivery

| Milestone | Stories | New Capability |
|-----------|---------|---------------|
| **M1: Declarative** | US1 | Providers in YAML, no code changes |
| **M2: Validated** | US1 + US2 | Conformance testing ensures config is correct |
| **M3: Discovered** | US1 + US2 + US4 | Models auto-discovered, daily refresh |
| **M4: Intelligent** | US1-US6 | Weighted routing, fallback chains, auto-pricing |
| **M5: Complete** | US1-US8 | Full dashboard management, zero-config auto-detection |
