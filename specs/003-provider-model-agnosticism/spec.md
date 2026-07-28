# Feature Specification: Provider &amp; Model Agnosticism

**Feature Branch**: `003-provider-model-agnosticism`

**Created**: 2026-07-28

**Status**: Draft

**Input**: User description: "Implement Phase 2 i.e. P2: Complete Provider and Model Agnosticism Through Declarative Registries, Auto-Discovery, Wizard-Based Configuration, and Intelligent Fallback Routing from docs/MASTER-PLAN-CLOSE-GAPS.md. Target: 8 stories."

## User Scenarios &amp; Testing *(mandatory)*

### User Story 1 - Declarative Provider Registry (Priority: P1)

As a MeridianOS operator, I want to add a new LLM provider by adding a few lines to a YAML file — without touching any JavaScript source code — so that I can onboard new AI services in minutes instead of waiting for a developer to modify `providers.mjs`.

**Why this priority**: This is the architectural foundation for all provider/model agnosticism. Without a declarative registry, every other P2 feature (wizard, model discovery, fallback routing, pricing refresh) must hardcode provider knowledge. All 7 other stories depend on this being complete first.

**Independent Test**: Add a provider entry to `policy.yaml`, restart the daemon, and verify the provider appears in the resolved provider list via `resolveAllProviders()`. Delivers immediate value by enabling operator-driven provider onboarding without code changes.

**Acceptance Scenarios**:

1. **Given** a provider entry is added to `policy.yaml` with `name`, `wire`, and `baseUrl` fields, **When** the system boots, **Then** that provider is included in `resolveAllProviders()` alongside built-in defaults.
2. **Given** a user overrides a built-in provider's `baseUrl` in `policy.yaml`, **When** the system resolves providers, **Then** the user's override takes precedence over the built-in default for that provider.
3. **Given** a provider entry has an invalid `wire` value that doesn't match any registered WireAdapter, **When** the system boots, **Then** a validation error is produced listing the valid wire types — the system does not silently ignore the invalid configuration.
4. **Given** a fresh installation with `--init`, **When** the system initializes, **Then** a default providers file is generated with Anthropic, DeepSeek, OpenRouter, and Ollama pre-configured, and providers whose API keys exist in the environment are automatically uncommented.
5. **Given** existing code that accesses the static `PROVIDERS` object, **When** the declarative registry is deployed, **Then** all existing access patterns continue to work without modification — zero breaking changes.

---

### User Story 2 - Provider Conformance Testing (Priority: P1)

As a MeridianOS operator who has just added a new provider, I want to run a quick automated test that verifies my API key works, the endpoint is reachable, and the provider responds in the expected wire format — so I can be confident my configuration is correct before dispatching real agent tasks.

**Why this priority**: Without conformance testing, operators configure providers blind. A typo in an API key or base URL is only discovered when an agent task fails — often minutes into a run. Immediate feedback at configuration time prevents costly failures.

**Independent Test**: Run `node cli.mjs provider test <name>` with valid credentials → receive `{ ok: true, latencyMs, modelsFound }`. Run with an invalid API key → receive `{ ok: false, errorCode: "AUTH_FAILED" }`. Delivers value even before any other P2 feature is complete.

**Acceptance Scenarios**:

1. **Given** a provider is configured with valid credentials, **When** the operator runs the conformance test, **Then** the test returns `{ ok: true }` with latency and the number of models discovered.
2. **Given** a provider has an invalid API key, **When** the operator runs the conformance test, **Then** the test returns `{ ok: false, errorCode: "AUTH_FAILED" }` with a human-readable error message.
3. **Given** a provider endpoint is unreachable (network down, wrong base URL), **When** the operator runs the conformance test, **Then** the test returns `{ ok: false, errorCode: "CONNECTION_FAILED" }` within the configured timeout period.
4. **Given** the dashboard is running, **When** an operator navigates to the Providers tab, **Then** a "Test Connection" button is available for each provider, and clicking it runs the conformance test and displays results inline.

---

### User Story 3 - Provider Configuration Wizard (Priority: P2)

As a MeridianOS operator who is not familiar with YAML syntax or LLM API endpoint conventions, I want an interactive wizard — available from both the command line and the dashboard — that guides me through adding a new provider by asking simple questions, auto-detecting my API keys from the environment, and validating everything before saving.

**Why this priority**: The declarative registry enables provider addition via YAML, but non-technical operators shouldn't need to know YAML syntax or the correct `baseUrl` for Groq. The wizard bridges the usability gap and is a prerequisite for the browser-first setup wizard in P3. It depends on the declarative registry being in place.

**Independent Test**: Run `node cli.mjs provider add` and follow the interactive prompts → the provider is added to `policy.yaml` with correct fields. Run `node cli.mjs provider add --auto` → all API keys found in the environment are auto-configured without any interactive input.

**Acceptance Scenarios**:

1. **Given** the operator runs the CLI wizard interactively, **When** they select a provider from the known-providers list and provide an API key, **Then** the provider is added to `policy.yaml` with all required fields correctly populated, and a confirmation message shows what was written.
2. **Given** API keys for multiple known providers exist in the environment, **When** the operator runs `--auto` mode, **Then** all detected providers are automatically configured without any prompts, and a summary lists which providers were added.
3. **Given** the operator uses the dashboard Add Provider form, **When** they select a known provider, enter an API key, and click Save, **Then** the provider is validated in real-time, saved to `policy.yaml`, and appears in the provider table with its health status.
4. **Given** the wizard's known-providers database, **When** an operator adds a provider, **Then** the correct `wire` type, `baseUrl`, and expected environment variable name are pre-filled from a curated database of at least 15 providers — the operator does not need to know these technical details.
5. **Given** two operators attempt to modify `policy.yaml` simultaneously (one via CLI wizard, one via dashboard), **When** the second save occurs, **Then** the system detects the conflict and returns a clear error message rather than silently overwriting the first operator's changes.

---

### User Story 4 - Automated Model Discovery (Priority: P2)

As a MeridianOS operator, I want the system to automatically discover which models each provider offers — including context windows, feature support, and deprecation status — so I always have an up-to-date model catalog without manually researching and entering model data.

**Why this priority**: Manual model management doesn't scale. Providers add, deprecate, and update models frequently. Without automated discovery, operators must constantly research model changes and update configuration — a losing battle. This depends on the declarative provider registry to know which providers to query.

**Independent Test**: Run `node cli.mjs models refresh` → query the model registry and verify models from all configured providers are present with metadata (context window, features, pricing tier). Deprecate a model in the registry → verify the dashboard shows a deprecation badge.

**Acceptance Scenarios**:

1. **Given** multiple providers are configured, **When** model discovery runs, **Then** models from all providers are populated in the local registry with their `model_id`, `provider`, `context_window`, and `features` metadata.
2. **Given** a provider returns models in its native API format, **When** the discovery adapter processes the response, **Then** models are normalized into a consistent schema regardless of the source provider's format.
3. **Given** a provider's API is unreachable during discovery, **When** the refresh runs, **Then** existing models for that provider are retained (not deleted), a warning is logged, and discovery continues for other providers.
4. **Given** a previously discovered model is no longer returned by the provider, **When** discovery runs, **Then** the model is marked as deprecated rather than deleted, preserving historical data for cost attribution.
5. **Given** model discovery is complete, **When** the operator views the dashboard Models tab, **Then** models are listed per provider with tier assignments, deprecation badges, context window sizes, and feature flags visible.

---

### User Story 5 - Intelligent Tier-Based Model Routing with Fallback (Priority: P2)

As a MeridianOS operator, I want to configure model routing in business terms — "use a fast cheap model for simple tasks, a powerful model for complex ones" — with automatic fallback when a model fails, so I get reliable task completion without manually managing individual model selection or error recovery.

**Why this priority**: This is the "intelligence" layer that makes model agnosticism valuable in practice. Without fallback routing, a single provider outage causes task failure. Without tier-based selection, operators must micromanage model choice. It depends on model discovery to know which models are available.

**Independent Test**: Configure a tier with two candidate models at 90/10 weight → run 100 tasks → verify approximately 90 use the primary and 10 use the canary. Configure fallback chains → simulate primary model failure → verify the next candidate is tried automatically.

**Acceptance Scenarios**:

1. **Given** a routing tier has multiple candidate models with configured weights, **When** tasks are dispatched, **Then** model selection follows the weighted distribution — a model with weight 90 is selected approximately 90% of the time.
2. **Given** a primary model returns a retryable error (timeout, 5xx, rate limit), **When** the router processes the failure, **Then** the next candidate model in the same tier is automatically tried without operator intervention.
3. **Given** all candidates in a tier have failed, **When** the router exhausts the tier, **Then** it falls back to the next configured tier (e.g., "medium" → "best") rather than failing immediately.
4. **Given** a model returns 5 consecutive failures, **When** the circuit breaker evaluates the model, **Then** the model is temporarily removed from rotation (circuit open) and a health probe is sent after 5 minutes to check for recovery.
5. **Given** an existing configuration that specifies a single model per tier (legacy format), **When** the router processes it, **Then** it is automatically treated as a single-candidate list — backward compatible with no configuration changes required.
6. **Given** all models across all tiers have been exhausted, **When** the router has no more candidates, **Then** the task fails with a clear error message — the system does not loop infinitely.

---

### User Story 6 - Automated Multi-Source Pricing Refresh (Priority: P2)

As a MeridianOS operator, I want the system to automatically keep model pricing up to date from multiple sources — so cost tracking is always accurate without me manually updating pricing tables whenever a provider changes their rates.

**Why this priority**: Pricing data decays. Providers change rates, introduce new models with different pricing, and add features like cache-aware pricing. Without automated refresh, cost tracking becomes inaccurate within weeks. This depends on model discovery to know which models need pricing.

**Independent Test**: Run `node cli.mjs pricing refresh` → verify per-model pricing is populated with source attribution. Simulate network failure → verify the system falls back to last-known-good cached pricing. Change a model's price by >10% → verify a notification is generated.

**Acceptance Scenarios**:

1. **Given** model discovery has populated the registry, **When** pricing refresh runs, **Then** per-model input and output pricing (per million tokens) is populated with attribution to the pricing source (provider-native, OpenRouter, models.dev, or local cache).
2. **Given** a model supports cache-aware pricing (discounted rates for cached input tokens), **When** cost is calculated, **Then** cached vs. uncached input tokens are costed at their respective rates — not averaged or conflated.
3. **Given** a pricing source is unreachable, **When** the refresh runs, **Then** the next source in the priority chain is tried (provider-native → OpenRouter → models.dev → last-known-good local cache), and a stale-data warning is issued if only cached data is available.
4. **Given** a model's price has changed by more than 10% since the last refresh, **When** pricing is updated, **Then** a dashboard notification is generated alerting the operator to the significant price change.
5. **Given** pricing data is older than 7 days, **When** the operator views pricing information, **Then** a staleness warning is displayed indicating the data may be outdated.

---

### User Story 7 - Provider Auto-Detection on Gateway Start (Priority: P3)

As a developer starting the MeridianOS gateway for the first time, I want it to automatically discover which AI providers I have API keys for and configure them without me touching any files — so I can start metering immediately.

**Why this priority**: This is the lowest-friction entry point. Combined with P1's zero-config bootstrap, it means a developer with API keys in their environment can go from zero to fully metered in seconds. It depends on the declarative provider registry and known-providers database but is independently valuable as the "first-run experience" for the gateway.

**Independent Test**: Set `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` in the environment → start the gateway with no configuration → verify both providers are auto-detected, configured, and passing health checks.

**Acceptance Scenarios**:

1. **Given** recognized AI API key environment variables are set, **When** the gateway starts with no prior configuration, **Then** corresponding providers are automatically detected and configured using the known-providers database.
2. **Given** a mix of AI and non-AI environment variables is set, **When** auto-detection runs, **Then** only recognized AI key patterns are matched — non-AI variables like `AWS_ACCESS_KEY_ID` are not mistakenly configured as providers.
3. **Given** no recognized API keys exist in the environment, **When** the gateway starts, **Then** it boots successfully but prompts the operator to configure at least one provider, offering the `--init` flag to generate a starter configuration.

---

### User Story 8 - Dashboard Model &amp; Provider Management (Priority: P3)

As a MeridianOS operator using the dashboard, I want to view, manage, and test all providers and models from a visual interface — without using the command line — so I can administer the system entirely from a browser.

**Why this priority**: The dashboard is the primary interface for non-technical operators as defined by the constitution's Non-Technical Usability principle. This story consolidates all provider/model management into a unified dashboard experience, making P2's capabilities accessible to non-developers. It integrates with P2-F1 through P2-F5 but is independently testable as a UI layer over existing APIs.

**Independent Test**: Open the dashboard → navigate to Providers tab → view all configured providers with health status. Navigate to Models tab → view discovered models with tier assignments, deprecation badges, and pricing. Click "Refresh Models" → models update. Click "Test Connection" on a provider → see conformance results.

**Acceptance Scenarios**:

1. **Given** the dashboard is loaded, **When** the operator navigates to the Providers tab, **Then** all configured providers are listed with name, wire type, health status indicator (green/amber/red), last checked time, and a "Test Connection" button.
2. **Given** the dashboard Models tab, **When** the operator views it, **Then** models are grouped by provider with tier assignment dropdowns, deprecation badges, context window information, and current pricing per million tokens.
3. **Given** the operator clicks "Refresh Models", **When** the refresh completes, **Then** the model table updates without requiring a page reload, and a timestamp shows when the last refresh occurred.
4. **Given** the operator clicks "Add Provider" from the dashboard, **When** the wizard form is completed and saved, **Then** the new provider appears in the list and can immediately be tested.

---

### Edge Cases

- What happens when a provider's discovery API returns thousands of models (e.g., OpenRouter proxies hundreds of providers)? The system must handle large model lists without timeout or memory issues — pagination and incremental updates are required.
- What happens when a user configures a provider with `wire: 'generic-http'` but the provider actually speaks an Anthropic-compatible format? The generic HTTP adapter should still attempt best-effort usage extraction, and the conformance test should report the format ambiguity.
- What happens when two providers return models with the same `model_id`? Model identity must be scoped by provider — `anthropic:claude-sonnet-4-20250514` is distinct from `openrouter:claude-sonnet-4-20250514`.
- What happens when a model is deprecated by the provider mid-task? The circuit breaker should detect the pattern of failures and exclude the model from subsequent selections without crashing the running task.
- What happens when pricing refresh and model discovery run simultaneously? The operations must be sequenced — pricing refresh always runs after model discovery completes — to ensure pricing is fetched for newly discovered models.
- What happens when the `policy.yaml` file is edited externally while the wizard is running? The system must detect file modification and either warn the user or merge changes safely.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support defining LLM providers declaratively in YAML configuration with fields: `name`, `wire`, `baseUrl`, `displayName`, `keyEnv`, `auth`, `headers`, and `features`.
- **FR-002**: System MUST merge provider definitions from three sources in priority order: user `policy.yaml` overrides > `.ai/providers.yaml` local state > built-in defaults.
- **FR-003**: System MUST validate provider configurations at boot time against a JSON Schema, rejecting invalid `wire` values with a message listing all valid options.
- **FR-004**: System MUST ship with built-in defaults for at least 4 providers (Anthropic, DeepSeek, OpenRouter, Ollama) and a curated known-providers database of at least 15 providers for the wizard.
- **FR-005**: System MUST provide an automated conformance test for each provider that verifies connectivity, authentication, and wire format compatibility through lightweight API calls.
- **FR-006**: System MUST provide an interactive provider configuration wizard accessible from both CLI (`node cli.mjs provider add`) and dashboard, with auto-detection of API keys from environment variables.
- **FR-007**: System MUST automatically discover available models from configured providers, normalizing provider-specific formats into a consistent schema including `model_id`, `context_window`, `features`, and deprecation status.
- **FR-008**: System MUST persist discovered models in a local SQLite registry and schedule automatic daily refresh, retaining historical data for deprecated models.
- **FR-009**: System MUST support tier-based model routing with weighted candidate lists, where each tier contains one or more candidate models with configurable selection weights.
- **FR-010**: System MUST automatically fall back to the next candidate model on retryable errors (timeout, 5xx, rate limit), progressing through all candidates in a tier before trying the next tier.
- **FR-011**: System MUST implement circuit breaker logic that temporarily removes a model from rotation after consecutive failures and probes for recovery after a cooldown period.
- **FR-012**: System MUST refresh model pricing from multiple sources in priority order: provider-native API → OpenRouter → models.dev → last-known-good local cache.
- **FR-013**: System MUST support cache-differentiated pricing where cached input tokens are costed at a different rate than uncached input tokens.
- **FR-014**: System MUST generate notifications when model pricing changes by more than 10% between refreshes and display staleness warnings when pricing data exceeds 7 days.
- **FR-015**: System MUST provide dashboard API endpoints for listing providers with health status, listing models with metadata, triggering model refresh, and running provider conformance tests.
- **FR-016**: System MUST maintain backward compatibility with all existing code that accesses the `PROVIDERS` object, requiring zero changes to existing call sites.
- **FR-017**: System MUST detect concurrent modification conflicts when multiple interfaces attempt to write to `policy.yaml` simultaneously, returning a clear error instead of silently overwriting.
- **FR-018**: System MUST automatically detect recognized AI provider API keys from environment variables at gateway startup using strict pattern matching against the known-providers database.

### Key Entities

- **Provider**: Represents an LLM service endpoint. Key attributes: name (unique identifier), wire type (protocol format), base URL, authentication method, feature flags, health status. Defined declaratively in YAML with built-in defaults overridable by operators.
- **Model**: Represents a specific AI model offered by a provider. Key attributes: model ID (scoped to provider), context window size, feature support (vision, tool-use, streaming, caching), pricing per million tokens (input, cached input, output), deprecation status, assigned routing tier. Discovered automatically and persisted locally.
- **Routing Tier**: A logical grouping of models by capability/cost (e.g., "quick", "medium", "best"). Contains an ordered list of candidate models with selection weights. Used by the model router to select models for agent tasks.
- **Circuit Breaker State**: Per-model tracking of health: healthy (normal rotation), degraded (probation after some failures), circuit_open (temporarily excluded after consecutive failures). Includes failure count, last failure timestamp, and cooldown timer.
- **Pricing Record**: Per-model cost data from a specific source. Includes input price per million tokens, cached input price per million, output price per million, source attribution, and last-refreshed timestamp.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator can add a new LLM provider by editing only YAML configuration — zero JavaScript source code changes required — and the provider is operational within 2 minutes of configuration.
- **SC-002**: The provider conformance test completes in under 10 seconds for responsive endpoints and returns a definitive pass/fail result with a classified error code for failures.
- **SC-003**: The provider configuration wizard auto-detects at least 80% of commonly used AI providers from environment variables without manual input.
- **SC-004**: Model discovery populates the local registry with models from all configured providers within 60 seconds, handling API rate limits gracefully without data loss.
- **SC-005**: Tier-based model routing with fallback chains successfully completes at least 95% of agent tasks that would have failed with single-model routing, given at least one healthy model remains in the chain.
- **SC-006**: Circuit breaker detection and model exclusion occurs within 2 consecutive failures for clearly broken models (e.g., authentication errors) and within 5 consecutive failures for intermittent failures.
- **SC-007**: Pricing refresh completes for all configured providers within 30 seconds under normal network conditions, with source attribution for every price point.
- **SC-008**: Cache-differentiated cost calculation is accurate to within 1% of the actual cost when compared against provider billing records.
- **SC-009**: Operators can complete the full provider-add workflow (wizard → conformance test → model discovery → pricing refresh) entirely from the dashboard without using a command line.
- **SC-010**: All existing tests (915+) continue to pass with zero regressions, and the static `PROVIDERS` backward-compatibility layer introduces no breaking changes to any existing module.

## Assumptions

- All configured providers expose standard REST APIs accessible over HTTPS. Providers requiring non-HTTP protocols (gRPC, WebSocket) are out of scope for P2.
- The known-providers database of 15 providers covers the most commonly used LLM services as of mid-2026. Niche or newly launched providers may require manual configuration via YAML until the database is updated.
- The models.dev community pricing database remains available as a fallback pricing source. If it becomes permanently unavailable, the OpenRouter API can serve as the primary fallback.
- The gateway SQLite database (ledger.db) has sufficient capacity for the model registry table — estimated at under 1MB even with hundreds of models tracked.
- Operators have stable internet connectivity for model discovery and pricing refresh operations. Offline-first operation is not required for P2.
- The WireAdapter plugin interface from P1 (002-universal-gateway) is fully implemented and stable, providing the `wire` type enumeration that the declarative registry validates against.
- Multi-key credential management from P1 is available for conformance testing — the conformance tester uses the same key resolution logic as the gateway proxy.
- Concurrent `policy.yaml` modification is rare in single-tenant deployments. The conflict detection mechanism (FR-017) provides safety but is not designed for high-contention multi-user scenarios.
- The dashboard is accessible on `localhost:4317` and the operator has a modern web browser. Mobile browser support is not required for P2 dashboard features.
