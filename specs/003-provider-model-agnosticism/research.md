# Research &amp; Decisions: Provider &amp; Model Agnosticism

**Feature**: Provider &amp; Model Agnosticism (003) | **Date**: 2026-07-28
**Source**: spec.md + MASTER-PLAN-CLOSE-GAPS.md + existing codebase analysis

## Research Topics

### R1: Declarative Provider Registry — Three-Source Merge Strategy

**Decision**: Merge providers from three sources in priority order: (1) `policy.yaml` user overrides, (2) `.ai/providers.yaml` local state, (3) built-in defaults in `providers.defaults.yaml`. Preserve backward compatibility with a lazy getter on `PROVIDERS`.

**Rationale**:
- The existing `providers.mjs` exports a hardcoded `PROVIDERS` object consumed by 20+ call sites across the codebase.
- Three-source merge lets operators override any field (e.g., `baseUrl` for a proxy), the system persist wizard-generated config to `.ai/`, and built-in defaults provide the fallback for providers the operator hasn't customized.
- The lazy getter pattern (`export const PROVIDERS = new Proxy({}, { get: (_, k) => resolveAllProviders()[k] })`) is a standard JavaScript pattern for transparent backward compatibility — no call site changes needed.
- Priority order matches the existing config merge strategy (policy > local > defaults) established by `config.mjs`.

**Alternatives considered**:
- **Single source (policy.yaml only)**: Rejected — operators shouldn't need to copy built-in defaults just to override one field. Built-in defaults reduce boilerplate.
- **Environment-variable-based registration**: Rejected — scales poorly beyond a few providers. YAML provides structure for auth, headers, features.
- **Dynamic import from user directory**: Rejected — YAML is simpler, more portable, and the wizard can write it. Dynamic imports introduce security concerns.

---

### R2: JSON Schema for Provider Validation

**Decision**: Create `schema/provider.schema.json` (JSON Schema draft-07) with required fields (`name`, `wire`, `baseUrl`), enum validation on `wire` (against registered WireAdapters), and optional fields (`displayName`, `keyEnv`, `auth`, `headers`, `features`). Validate at boot time in `policy-validate.mjs`.

**Rationale**:
- JSON Schema draft-07 is the most widely supported version with broad validator compatibility. Node.js has no built-in JSON Schema validator, but the project already uses manual validation in `policy-validate.mjs` — the schema serves as documentation and structural validation.
- Enum validation on `wire` against the WireAdapter registry ensures typos are caught at boot, not at request time.
- Optional fields like `auth` (object with `mode: 'env' | 'oauth' | 'static'`) and `features` (object with booleans like `supportsStreaming`, `supportsToolUse`) provide forward compatibility for P3/P4 features.

**Alternatives considered**:
- **Ajv (npm package) for validation**: Rejected — violates zero-dependency constraint. Manual structural validation is sufficient for this scope.
- **TypeScript interfaces instead of JSON Schema**: Rejected — project is plain JavaScript; JSON Schema is language-agnostic and usable by the dashboard for form generation.

---

### R3: Known-Providers Database Curation

**Decision**: Ship `gateway/known-providers.json` — a static JSON file with 15 providers, each containing `displayName`, `wire`, `baseUrl`, `keyEnv`, `docsUrl`, and `features`. The wizard uses this database to pre-fill fields.

**Rationale**:
- The 15 providers from the MASTER-PLAN: Anthropic, DeepSeek, OpenRouter, Ollama, OpenAI, Groq, Together, Fireworks, Google Gemini, Mistral, Cohere, Perplexity, xAI, Azure OpenAI, AWS Bedrock.
- A static JSON file (not a database table) keeps the data version-controlled, easy to update, and available before any runtime initialization.
- Each entry includes `keyEnv` (the conventional environment variable name, e.g., `ANTHROPIC_API_KEY`) for auto-detection. The wizard matches `process.env[keyEnv]` to auto-detect providers with keys present.
- `docsUrl` provides a link to the provider's API documentation for operator reference.

**Alternatives considered**:
- **Fetching from a remote registry**: Rejected — adds network dependency, latency, and potential outage risk. Static file is version-controlled and always available.
- **Database table**: Rejected — over-normalized. The 15-provider list is small, static, and read-only at runtime.
- **YAML instead of JSON**: Rejected — JSON is parseable without the project's `yaml-lite.mjs`. `node:fs` + `JSON.parse` works everywhere.

---

### R4: Provider Conformance Testing Strategy

**Decision**: Lightweight API calls per wire type: OpenAI → `GET /v1/models`, Anthropic → 1-token `POST /v1/messages`, Google AI → `GET /v1beta/models`, generic-http → `GET /`. 5-second timeout. Classify errors: `AUTH_FAILED`, `CONNECTION_FAILED`, `TIMEOUT`, `UNEXPECTED_RESPONSE`.

**Rationale**:
- The conformance test must verify (a) the endpoint is reachable, (b) the API key is valid, and (c) the response format matches expectations — all without consuming significant tokens or triggering rate limits.
- `GET /v1/models` is the standard OpenAI-compatible health check endpoint — returns model list, validates auth, costs zero tokens.
- Anthropic doesn't have a `GET /v1/models` endpoint, so a minimal 1-token message is the lightest valid request.
- Error classification enables the dashboard to show specific, actionable messages: "Authentication failed — check your API key" vs "Connection refused — is the base URL correct?"
- The conformance tester reuses the gateway's credential resolution (multi-key from P1) so it tests the same auth path that real requests use.

**Alternatives considered**:
- **Full model discovery as conformance test**: Rejected — conflates two concerns. Conformance is fast (under 10s), model discovery can take 60s+. Operator needs quick feedback.
- **Ping-only (TCP connection)**: Rejected — doesn't validate auth or API compatibility. A reachable endpoint with a bad key is not "healthy."

---

### R5: Model Registry Schema Design

**Decision**: New `model_registry` table in `ledger.db` with columns: `id` (TEXT PK, `provider:model_id`), `provider` (TEXT), `model_id` (TEXT), `display_name` (TEXT), `context_window` (INTEGER, nullable), `max_output_tokens` (INTEGER, nullable), `features` (TEXT, JSON), `pricing_input_per_m` (REAL, nullable), `pricing_cached_input_per_m` (REAL, nullable), `pricing_output_per_m` (REAL, nullable), `pricing_source` (TEXT), `pricing_refreshed` (TEXT, ISO-8601), `deprecated` (INTEGER, 0/1), `deprecated_successor` (TEXT, nullable), `tier_assigned` (TEXT, nullable), `last_seen` (TEXT, ISO-8601). Use `provider:model_id` as composite PK for model identity scoping.

**Rationale**:
- Composite PK (`provider:model_id`) ensures `anthropic:claude-sonnet-4-20250514` and `openrouter:claude-sonnet-4-20250514` are distinct rows — critical because they have different pricing and capabilities.
- Nullable numeric fields follow the "null is unknown" convention established by P0-F8 (zero-vs-null sentinel semantics). A model with unknown context window stores NULL, not 0.
- `features` as JSON text avoids schema bloat for provider-specific capabilities (vision, tool-use, streaming, caching, thinking). SQLite's JSON functions (`json_extract`) enable querying specific features.
- `deprecated` + `deprecated_successor` preserve historical data for cost attribution while guiding operators to replacement models.
- `tier_assigned` is denormalized from routing config for efficient dashboard queries — the source of truth remains in `policy.yaml` routing tiers.

**Alternatives considered**:
- **Separate database file**: Rejected — adds connection management complexity. `ledger.db` already uses WAL mode for concurrent access.
- **Normalized features table**: Rejected — over-normalized for a small, infrequently updated dataset. JSON column is simpler and sufficient.

---

### R6: Model Discovery Adapter Architecture

**Decision**: Per-provider adapter modules in `gateway/model-discovery-adapters/` following a consistent interface: `discoverModels(providerConfig)` → `[{ model_id, display_name?, context_window?, features? }]`. Four adapters shipped: `openai.mjs`, `anthropic.mjs`, `google-ai.mjs`, `generic-http.mjs`.

**Rationale**:
- Each provider's model discovery API differs: OpenAI uses `GET /v1/models` returning `{ data: [{ id, ... }] }`, Anthropic has no public models endpoint (use curated list + models.dev), Google AI uses `GET /v1beta/models`, generic HTTP providers may have no discovery endpoint at all.
- The adapter pattern (matching WireAdapters from P1) keeps provider-specific logic isolated. Adding a new provider's discovery only requires a new adapter module — no changes to `model-discovery.mjs`.
- The `generic-http.mjs` adapter uses heuristic approach: try `GET /v1/models` (OpenAI-compatible pattern), fall back to models.dev API, return empty list if both fail.
- Context window data is NOT available from most provider APIs. The `openai.mjs` adapter uses a static lookup table (`known-context-windows.json`) mapping model IDs to known context windows. This table can be updated without code changes.

**Alternatives considered**:
- **Single discovery function with switch/case**: Rejected — violates the adapter pattern established by WireAdapters. Harder to extend.
- **models.dev as primary source**: Rejected — models.dev is community-maintained and may lag behind provider releases. Provider-native APIs are more authoritative.

---

### R7: Weighted Model Selection Algorithm

**Decision**: Weighted random selection without replacement for candidate models within a tier. Weights are normalized to probabilities. Deterministic mode (seeded PRNG) for tests. Selection validates model health (circuit breaker) before inclusion.

**Rationale**:
- The spec requires weighted canary selection: a model with weight 90 should be selected ~90% of the time.
- Weighted random selection using cumulative distribution + `Math.random()` is the standard algorithm. O(n) per selection, where n = candidates in tier (typically 1-5).
- Seeded PRNG (using `node:crypto` or a simple mulberry32 implementation) enables deterministic test assertions: "given seed X, model A is selected."
- Models excluded by circuit breaker are removed from the candidate list before selection. If all candidates are excluded, the tier is skipped (fallback to next tier).

**Alternatives considered**:
- **Round-robin**: Rejected — doesn't support weighted canary testing. Round-robin would give equal distribution regardless of configured weights.
- **Thompson sampling / multi-armed bandit**: Rejected — over-engineered for this use case. Operators configure weights explicitly; no need for automatic optimization.

---

### R8: Circuit Breaker Design

**Decision**: Three-state circuit breaker per model: `healthy` (normal rotation), `degraded` (probation after 2+ failures, still in rotation), `circuit_open` (excluded after 5 consecutive failures, auto-recovery probe after 5 minutes). State transitions are logged. Recovery probe sends a lightweight test request; if it succeeds, model returns to `healthy`.

**Rationale**:
- The `degraded` state provides a buffer zone: a single network blip doesn't immediately exclude a model. Two failures trigger degraded; five consecutive trigger open.
- Auto-recovery via 5-minute probe balances availability with protection: a model that was temporarily down gets re-tested, but not so frequently that it wastes resources.
- Circuit breaker state is stored in-memory (not persisted to SQLite) because it's ephemeral operational state — restarting the daemon resets all breakers to `healthy`, which is the correct behavior (fresh start, fresh state).
- Error classification determines breaker behavior: authentication errors (401, 403) open the circuit immediately (not retryable), while timeout/5xx errors follow the consecutive-failure threshold.
- The breaker logs every state transition: `"[CIRCUIT] model anthropic:claude-sonnet-4: healthy → degraded (2 failures)"`.

**Alternatives considered**:
- **Persisted circuit breaker state**: Rejected — adds SQLite write contention for ephemeral state. If the daemon restarts, all models should get a fresh chance.
- **Per-provider breaker (not per-model)**: Rejected — too coarse. A provider may have one broken model and several healthy ones.

---

### R9: Multi-Source Pricing Refresh Pipeline

**Decision**: Four-tier fallback chain: (1) Provider-native pricing API (if available), (2) OpenRouter model pricing API, (3) models.dev community database, (4) Last-known-good local cache. Each tier is tried in order; first successful response is used. Source is attributed: `provider-native`, `openrouter`, `models.dev`, or `cache`.

**Rationale**:
- Provider-native APIs are the most authoritative but least standardized. OpenAI's pricing isn't in their API; Anthropic's is. OpenRouter aggregates pricing for many models with a consistent API. models.dev is community-maintained and free.
- The fallback chain ensures pricing data is available even if the primary sources are down. The last-known-good cache ensures the system never loses pricing data entirely.
- Stale detection: pricing older than 7 days triggers a warning in the dashboard. Pricing changes >10% trigger notifications; >50% trigger alerts (possible error or major price change).
- The refresh runs daily via the scheduler, AFTER model discovery completes (sequencing ensures new models get pricing on first refresh).

**Alternatives considered**:
- **Single source (OpenRouter only)**: Rejected — OpenRouter adds margin to pricing. Provider-native pricing is more accurate for direct API users.
- **Real-time pricing lookup per request**: Rejected — adds latency to every model selection. Batch refresh is more efficient.

---

### R10: Cache-Differentiated Cost Calculation

**Decision**: Formula: `cost = (uncachedInputTokens × inputPricePerM + cachedInputTokens × cachedInputPricePerM + outputTokens × outputPricePerM) / 1,000,000`. When a model doesn't support cache-aware pricing, `cachedInputPricePerM` is NULL and cached tokens are costed at the standard input rate.

**Rationale**:
- Anthropic and some other providers offer discounted pricing for cache hits (typically 10-25% of standard input pricing). This is a significant cost factor: a prompt with 90% cache hit rate is far cheaper than one with 0%.
- The formula handles three cases: (a) model supports cache pricing → cached tokens at discounted rate, (b) model doesn't support caching → `cachedInputPricePerM` is NULL, all input at standard rate, (c) gateway doesn't track cache usage → `cachedInputTokens` is 0, standard formula applies.
- NULL semantics follow the "null is unknown" convention: NULL cached price means "not applicable," not "free."

**Alternatives considered**:
- **Average blended rate**: Rejected — loses granularity. An operator who sees "input: $3/M" can't tell if that's with or without cache optimization.
- **Separate cache-token budget**: Rejected — over-complicates the budget model. Cache savings should reduce cost, not create a separate accounting dimension.

---

### R11: Provider Auto-Detection Pattern Matching

**Decision**: Match environment variable names against `known-providers.json` `keyEnv` fields using exact string match. Only recognized AI provider patterns are matched — no heuristic guessing. Non-AI variables (AWS, GCP, Azure infrastructure keys) are excluded by definition since they're not in the known-providers database.

**Rationale**:
- The spec requires that `AWS_ACCESS_KEY_ID` is NOT detected as a provider. This is guaranteed by the whitelist approach: only variables matching known `keyEnv` values are considered.
- Exact string matching is simple, predictable, and has zero false positives. The known-providers database is the single source of truth for "what is an AI provider key."
- Detection runs at gateway startup (in `gateway/cli.mjs`) and during wizard `--auto` mode. Results are printed as: "Detected 3 providers: anthropic (ANTHROPIC_API_KEY), openai (OPENAI_API_KEY), groq (GROQ_API_KEY)."

**Alternatives considered**:
- **Heuristic matching (contains "API_KEY")**: Rejected — too many false positives. Database API keys, service API keys, etc.
- **Probing endpoints to verify**: Rejected — too slow at startup. Auto-detection must be instant.

---

## Summary of Decisions

| # | Topic | Decision | Key Constraint |
|---|-------|----------|---------------|
| R1 | Provider Registry | Three-source YAML merge with lazy getter | Backward compat with PROVIDERS |
| R2 | Schema Validation | JSON Schema draft-07 + manual structural validation | Zero new dependencies |
| R3 | Known Providers | Static JSON file, 15 providers | Version-controlled, always available |
| R4 | Conformance Testing | Lightweight API calls per wire type, 5s timeout | Under 10 seconds, zero cost |
| R5 | Model Registry | SQLite table, composite PK (provider:model_id) | Same ledger.db, WAL mode |
| R6 | Discovery Adapters | Per-provider modules matching WireAdapter pattern | Extensible without code changes |
| R7 | Model Selection | Weighted random without replacement, seeded PRNG for tests | Deterministic test assertions |
| R8 | Circuit Breaker | 3-state in-memory: healthy/degraded/open, 5-min auto-recovery | Auth failures open immediately |
| R9 | Pricing Refresh | 4-tier fallback: provider → OpenRouter → models.dev → cache | Daily, after model discovery |
| R10 | Cache Cost | Separate cached/uncached input rates, NULL = not applicable | Matches provider billing |
| R11 | Auto-Detection | Exact keyEnv match against known-providers.json | Zero false positives |
