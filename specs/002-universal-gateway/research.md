# Research & Decisions: Universal Gateway

**Feature**: Universal Gateway (002) | **Date**: 2026-07-28
**Source**: spec.md + MASTER-PLAN-CLOSE-GAPS.md + existing gateway codebase analysis

## Research Topics

### R1: WireAdapter Interface Contract Design

**Decision**: Define a formal interface with 2 required methods, 4 optional methods. Auto-discover adapters from `gateway/wire-adapters/` at boot.

**Rationale**: The existing gateway (`server.mjs`) has Anthropic and OpenAI wire logic embedded inline — `buildForwardHeaders` (auth injection), `extractUsage` (usage parsing), `createSseUsageTracker` (SSE usage), `sendDeny`/`denyBody` (denial formatting). This logic must be extracted into separate modules implementing a formal contract so new wire protocols can be added without touching `server.mjs`. A 2-required/4-optional split prevents over-engineering: most adapters only need `detectRequest` and `extractUsage`. The auto-discovery pattern (scan directory, require modules, check interface compliance) is the Node.js equivalent of Python's entry points — battle-tested, zero-config.

**Alternatives considered**:
- **NPM-package-based plugin system**: Over-engineered for this scope. Requires packaging, versioning, publishing. Directory drop-in is simpler and sufficient.
- **YAML-config-based wire definition**: Insufficient for non-trivial protocol differences. Custom parsing logic is inherently code, not config.
- **Single method with discriminated return**: Less type-safe; harder to validate at load time.

**Interface contract**:
```
Required: detectRequest(req) → boolean | { wire, model, provider }
Required: extractUsage(parsedResponseBody) → { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } | null
Optional: injectAuth(headers, resolveKey) → void (default: no-op)
Optional: extractUsageFromSSE(sseEvent) → partial usage (default: returns null)
Optional: formatDenial(capWindow) → { status, body } (default: generic JSON 403)
Optional: normalizeModel(modelId) → string (default: identity)
```

### R2: Cross-Wire Translation Fidelity Matrix

**Decision**: Translate messages, system prompts, tools, and token usage bidirectionally. Drop thinking, computer use, and streaming silently. Make translation opt-in per route.

**Rationale**: The MASTER-PLAN specifies non-streaming only for Phase 1. Anthropic's extended thinking (`thinking` block) and computer use (`computer_*` tool types) have no OpenAI equivalents — dropping them silently prevents errors while the agent's core functionality (text generation, tool calls) works. Streaming translation is architecturally complex (SSE event remapping in real-time) and is deferred to Phase 2. Token usage field mapping is straightforward: `input_tokens` ↔ `prompt_tokens`, `output_tokens` ↔ `completion_tokens`, `cache_read_input_tokens` ↔ `prompt_tokens_details.cached_tokens`.

**Alternatives considered**:
- **Error on unsupported features**: Would break agents that use thinking by default. Worse UX than silent drop.
- **Streaming translation in Phase 1**: Would add 3-5 days of complexity and risk. Deferring is the right call.
- **Auto-detect translation need**: Could translate unintentionally. Opt-in per route is safer and explicit.

**Translation mapping**:

| Anthropic Field | OpenAI Field | Direction | Notes |
|----------------|-------------|-----------|-------|
| `model` | `model` | ↔ | Pass through; caller chooses |
| `messages[].role` | `messages[].role` | ↔ | `user`/`assistant` map 1:1; `system` → top-level |
| `system` (top-level) | `messages[0]` with `role: system` | ↔ | Anthropic has dedicated system field |
| `tools[]` | `tools[]` | ↔ | `input_schema` ↔ `parameters`; `description` same |
| `tool_use` content block | `tool_calls[]` | ↔ | Structural conversion needed |
| `stop_reason: end_turn` | `finish_reason: stop` | → | |
| `stop_reason: tool_use` | `finish_reason: tool_calls` | → | |
| `usage.input_tokens` | `usage.prompt_tokens` | ↔ | |
| `usage.output_tokens` | `usage.completion_tokens` | ↔ | |
| `thinking` block | — | → | Dropped (no equivalent) |
| `computer_*` tools | — | → | Dropped (no equivalent) |
| — | `stream: true` | — | Rejected with error in P1 |

### R3: Multi-Key Rotation Strategy

**Decision**: Round-robin selection with 60-second cooldown on 401 failure. Support comma-separated env var names. Re-enable automatically after cooldown.

**Rationale**: Round-robin is the simplest fair distribution. A 60-second cooldown is conservative — most rate limits reset within 60s, and it prevents thrashing on a permanently invalid key. Distinguishing 401 (permanent auth failure → cooldown) from 429 (transient rate limit → different key, shorter/no cooldown) from 5xx (server error → retry same key once, then try next) gives appropriate behavior for each failure mode.

**Alternatives considered**:
- **Least-recently-used (LRU)**: More complex state tracking without meaningful benefit over round-robin for typical 2-5 key deployments.
- **Weighted distribution**: Premature optimization. Most users have identical keys from the same provider.
- **Exponential backoff cooldown**: Adds complexity. Fixed 60s is simple and sufficient for auth failures.
- **Per-key rate-limit tracking (token counters)**: Requires parsing rate-limit headers from every provider. Too complex for Phase 1.

### R4: Request Logging Privacy & Redaction

**Decision**: Append-only SQLite table with header redaction. Default OFF. Configurable retention (default 7 days). Redact `authorization`, `x-api-key`, `api-key` header values to `[REDACTED]`.

**Rationale**: The existing ledger already uses SQLite; adding a `request_logs` table to the same `ledger.db` keeps the storage story simple. Redacting only known auth headers is a practical balance — full body scanning for PII (regex for emails, credit cards, etc.) is fragile and expensive. The privacy warning at startup and default-off posture ensures users knowingly opt into logging. Append-only prevents tampering.

**Alternatives considered**:
- **Separate log database**: Unnecessary complexity for Phase 1. Same DB, separate table.
- **Full body redaction**: Makes logs useless for debugging. Headers are the primary PII vector for API calls.
- **Encrypted log storage**: Over-engineered for local debugging. Could be added later if needed.
- **File-based logging (JSON lines)**: Simpler to implement but harder to query, prune, and replay. SQLite wins for structured access.

### R5: Zero-Config Auto-Detection Pattern

**Decision**: Strict whitelist of known AI provider key patterns. No wildcard matching. Startup message with dashboard URL.

**Rationale**: Wildcard matching (`*_KEY`, `*_API_KEY`) would pick up non-AI environment variables like `AWS_ACCESS_KEY_ID`, `GITHUB_TOKEN`, `DATABASE_URL` — causing confusing false positives. A curated whitelist (~8 patterns initially: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_KEY`, `GROQ_API_KEY`, `GOOGLE_API_KEY`, `MISTRAL_API_KEY`, `COHERE_API_KEY`, `TOGETHER_API_KEY`) is safe and covers the vast majority of users. The startup message (version, port, detected providers, dashboard URL) gives immediate feedback.

**Alternatives considered**:
- **Wildcard + exclusion list**: Exclusion lists are a maintenance burden and never complete. Whitelist is safer.
- **Interactive-only**: Frustrating for CI/automation. Zero-config must work non-interactively.
- **Config file scan**: Overly complex. Environment variables are the universal convention for API keys.

### R6: Generic HTTP Provider Support

**Decision**: Forward requests as-is with best-effort response parsing (Anthropic → OpenAI → null). No custom WireAdapter required.

**Rationale**: The `generic-http` wire type closes the provider coverage gap completely. Any REST endpoint can be metered — the only tradeoff is usage extraction quality. Trying Anthropic format first, then OpenAI, covers ~95% of LLM APIs (most follow one of these two formats). The honest `null` usage marker for unrecognized formats preserves data integrity — users know when usage wasn't captured rather than seeing misleading zeros.

**Alternatives considered**:
- **Require WireAdapter for all providers**: Creates adoption friction. Generic HTTP is the "just works" fallback.
- **Configurable response parsing regex/path**: Over-engineered. Two-format attempt covers the vast majority.
- **Auto-detect content-type for parsing**: Unreliable — most providers return `application/json` regardless of internal format.

### R7: Constitution Alignment Verification

**Decision**: All 10 constitutional principles are satisfied by this design. No violations.

**Verification**:
| Principle | How Satisfied |
|-----------|--------------|
| I. Provider Agnosticism | WireAdapter interface + generic HTTP = any provider addable without code changes |
| II. Gateway as Single Source | This IS the gateway hardening — default-ON, single metering path |
| III. Zero-Dependency | All features use `node:http`, `node:https`, `node:crypto`. Only existing `better-sqlite3` for storage |
| IV. Test-First | Test files created alongside each module: `wire-adapter-registry.test.mjs`, `translate.test.mjs`, `logging.test.mjs`, `multi-key.test.mjs` |
| V. Configuration over Code | WireAdapters auto-discovered from directory; routes from config; translation opt-in per route |
| VI. Observability | Request logging, token events with source attribution, dashboard endpoint for adapter listing |
| VII. Non-Technical Usability | Zero-config bootstrap; startup message with dashboard URL |
| VIII. ES Modules | All new files `.mjs` with `import`/`export` |
| IX. PR Discipline | Per standard process; referenced in AGENTS.md |
| X. Spec-Driven | This document is the spec-kit plan phase |
