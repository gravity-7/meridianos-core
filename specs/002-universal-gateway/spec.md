# Feature Specification: Universal Gateway

**Feature Branch**: `002-universal-gateway`

**Created**: 2026-07-28

**Status**: Draft

**Input**: User description: "Implement Phase 1: Universal Gateway from docs/MASTER-PLAN-CLOSE-GAPS.md — zero-config bootstrap, WireAdapter plugin interface, generic HTTP provider support, multi-key credential management, request logging with replay, and non-streaming Anthropic↔OpenAI cross-wire translation. Target: 6 stories."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Zero-Configuration Gateway Bootstrap (Priority: P1)

A developer wants to start metering their AI traffic immediately. They run a single command with no arguments, and the gateway automatically discovers available API keys from their environment, configures matching provider routes, and begins accepting traffic — all without touching a configuration file.

**Why this priority**: This is the entry point for all subsequent gateway functionality. Without it, every other feature requires manual setup before delivering value. A zero-config experience eliminates adoption friction and ensures the gateway can be deployed in any environment in seconds.

**Independent Test**: Can be fully tested by running the gateway start command in an environment with one or more recognized API key environment variables set. The gateway boots, prints a confirmation message listing auto-detected providers, and begins accepting proxied requests on the configured port. Delivers immediate value as a functional metering proxy.

**Acceptance Scenarios**:

1. **Given** the environment has `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` set, **When** the user starts the gateway with zero arguments, **Then** the gateway boots successfully, prints a startup message listing both detected providers, and routes traffic to the corresponding upstream APIs.

2. **Given** the environment has `DEEPSEEK_KEY` set but no other recognized AI keys, **When** the user starts the gateway, **Then** only DeepSeek is auto-detected and configured; the startup message shows exactly 1 provider detected.

3. **Given** the environment has a non-AI variable like `AWS_ACCESS_KEY_ID` set, **When** the user starts the gateway, **Then** the non-AI variable is NOT detected or configured as a provider — only recognized AI key patterns are matched.

4. **Given** no recognized API keys exist in the environment, **When** the user starts the gateway, **Then** the gateway boots but prompts the user interactively to configure at least one provider, or offers a `--init` flag to generate a default configuration file.

5. **Given** the user passes the `--init` flag, **When** the gateway starts, **Then** a default configuration file is generated with any auto-detected providers pre-populated, ready for the user to customize.

---

### User Story 2 - WireAdapter Plugin Interface (Priority: P1)

A developer or third-party contributor wants to add support for a new LLM provider's API format without modifying gateway source code. They implement a well-defined interface contract and drop the module into a designated directory — the gateway automatically discovers and registers it on next boot.

**Why this priority**: This is the architectural foundation that enables all wire-protocol-specific features (generic HTTP, cross-wire translation). Without a formal interface, every new provider requires changes to core gateway logic, creating maintenance burden and preventing community contributions. It must be defined before the generic HTTP adapter or translation layer can be built.

**Independent Test**: Can be fully tested by creating a minimal adapter module implementing only the required interface methods, placing it in the adapters directory, and restarting the gateway. The gateway's adapter listing endpoint shows the new adapter. Delivers value as an extensibility mechanism even before any specific adapters beyond the built-in ones exist.

**Acceptance Scenarios**:

1. **Given** a new adapter module implementing the required `detectRequest` and `extractUsage` methods is placed in the adapters directory, **When** the gateway boots, **Then** the adapter is automatically discovered and registered; a listing endpoint shows the new adapter by name.

2. **Given** an adapter implements only the required methods and omits optional methods like `injectAuth` or `formatDenial`, **When** the gateway loads it, **Then** the adapter functions correctly with sensible no-op defaults for the omitted methods — no errors occur.

3. **Given** an adapter module lacks the required `detectRequest` method, **When** the gateway attempts to load it, **Then** the gateway logs a clear error identifying the missing method and skips the invalid adapter without crashing.

4. **Given** the existing Anthropic and OpenAI wire handling logic in the gateway, **When** the WireAdapter interface is implemented, **Then** that existing logic is extracted into conforming adapter modules without changing external gateway behavior — all existing tests continue to pass.

5. **Given** multiple adapters are registered, **When** an incoming request arrives, **Then** the gateway iterates through adapters calling `detectRequest` on each until one claims the request, falling through to the generic HTTP adapter if no specific adapter matches.

---

### User Story 3 - Generic HTTP Provider Support (Priority: P2)

A user wants to meter traffic to any LLM provider that exposes a REST API, even if no custom WireAdapter exists for that provider. They register the provider's endpoint URL and the gateway forwards requests as-is, performing best-effort usage extraction from responses in known formats (Anthropic, OpenAI) and logging unknown formats honestly with a null usage marker.

**Why this priority**: This eliminates the last barrier to provider adoption — users are no longer blocked waiting for a custom adapter. Combined with the WireAdapter interface, it means any HTTP-based AI service can be metered within minutes of discovery. It depends on the WireAdapter interface being defined first.

**Independent Test**: Can be fully tested by registering an arbitrary HTTP endpoint as a provider route, sending a request through the gateway, and verifying the request is forwarded correctly and a token event is recorded (with either extracted usage or null for unknown formats). Delivers immediate value by enabling metering for any REST API.

**Acceptance Scenarios**:

1. **Given** a provider is registered with a generic HTTP wire type and a base URL, **When** a request is sent through the gateway to that provider's route, **Then** the request is forwarded as-is to the upstream endpoint and the response is returned to the client without modification.

2. **Given** a generic HTTP provider returns a response in Anthropic format, **When** the gateway processes the response, **Then** token usage is extracted from the response and recorded in the ledger with accurate `total_tokens`.

3. **Given** a generic HTTP provider returns a response in OpenAI format, **When** the gateway processes the response, **Then** token usage is extracted and recorded similarly.

4. **Given** a generic HTTP provider returns a response in an unrecognized format, **When** the gateway processes the response, **Then** a token event is recorded with `null` usage (honest, never fabricated as zero) and the response is still returned to the client successfully.

5. **Given** a generic HTTP provider is configured with custom headers, **When** requests are forwarded, **Then** those headers are included in the upstream request.

---

### User Story 4 - Multi-Key Credential Management (Priority: P2)

An operations engineer managing production AI traffic needs to prevent API rate-limit disruptions and authentication failures. They configure multiple API keys for a single provider — the gateway round-robins across them and automatically skips any key that returns an authentication error, re-enabling it after a cooldown period.

**Why this priority**: Single-key configurations are a single point of failure for production deployments. Rate limits on individual keys can halt all AI traffic. Multi-key support with automatic failover is essential for reliability but is independently valuable — it doesn't require the WireAdapter interface or translation layer.

**Independent Test**: Can be fully tested by configuring a provider with three API keys, sending requests, and verifying round-robin distribution. Then, simulating an authentication failure on one key and verifying the gateway automatically routes to the next key while temporarily disabling the failed one. Delivers immediate value for any production deployment.

**Acceptance Scenarios**:

1. **Given** a provider is configured with three comma-separated API key environment variable names, **When** multiple requests are sent, **Then** the gateway distributes requests across all three keys in round-robin order.

2. **Given** a provider has three keys and key 1 returns a 401 authentication error, **When** the next request arrives, **Then** the gateway skips key 1 and uses key 2; key 1 is marked as failed and excluded from rotation for 60 seconds.

3. **Given** a key was marked as failed due to a 401 error, **When** 60 seconds have elapsed since the failure, **Then** the key is automatically re-enabled and rejoins the rotation pool.

4. **Given** a provider supports OAuth authentication, **When** the OAuth token is about to expire, **Then** the gateway proactively refreshes the token before the next request is made.

5. **Given** a provider is configured with a static API key (not from an environment variable), **When** that key is used for authentication, **Then** the gateway includes it in the upstream request according to the provider's expected header convention.

---

### User Story 5 - Non-Streaming Cross-Wire Translation (Priority: P3)

A developer uses an AI coding agent built for Anthropic's API format, but their organization only has OpenAI API keys. They enable cross-wire translation on the gateway route, and the gateway transparently translates requests from Anthropic format to OpenAI format and responses back — the agent works without modification against the OpenAI backend.

**Why this priority**: Cross-wire translation unlocks the full promise of provider agnosticism — tools and agents can use any backend regardless of their native wire protocol. It depends on the WireAdapter interface being in place. It is prioritized below multi-key and generic HTTP because those features are needed for basic production use first.

**Independent Test**: Can be fully tested by configuring an OpenAI provider route with translation enabled, then sending an Anthropic-format request to that route. The request is translated to OpenAI format, forwarded, and the response is translated back to Anthropic format. Delivers immediate value by enabling Anthropic-native tools to use OpenAI backends (and vice versa).

**Acceptance Scenarios**:

1. **Given** an OpenAI provider route has translation enabled, **When** an Anthropic-format messages request arrives (with system prompt, user messages, and tools), **Then** the gateway translates it to an OpenAI chat completions request, forwards it, translates the response back to Anthropic format, and returns it to the client — the client sees a valid Anthropic response.

2. **Given** an Anthropic provider route has translation enabled, **When** an OpenAI-format chat completions request arrives, **Then** the gateway translates it to Anthropic messages format, forwards it, translates the response back to OpenAI format, and returns it — the client sees a valid OpenAI response.

3. **Given** translation is enabled but the request contains features not supported by the translation layer (such as streaming or Anthropic's extended thinking), **When** such a request arrives, **Then** those unsupported features are silently dropped from the translated request rather than causing errors, and the response is still returned successfully.

4. **Given** translation is enabled on a route, **When** a request is processed through translation, **Then** the token usage from the upstream response is accurately extracted and recorded in the ledger despite the format conversion.

5. **Given** a route has translation disabled (the default), **When** a request arrives, **Then** it passes through without any format translation — the default behavior is passthrough.

---

### User Story 6 - Request Logging with Replay (Priority: P3)

A developer debugging a failed provider call needs to see exactly what was sent and received. They enable request logging, and the gateway records every request-response pair with sensitive headers automatically redacted. Later, they can replay a stored request against the current provider configuration to reproduce and diagnose the issue.

**Why this priority**: Request logging is a debugging and audit capability that becomes valuable once the gateway is in active use. It is independent of all other features and can be built in parallel. It is prioritized below the core operational features (zero-config, multi-key, generic HTTP) because those are needed for the gateway to be useful at all.

**Independent Test**: Can be fully tested by enabling logging, sending a request through the gateway, verifying the request-response pair is stored with redacted authorization headers, and then using the replay endpoint to resubmit the stored request. Delivers immediate value as a debugging tool.

**Acceptance Scenarios**:

1. **Given** request logging is enabled (default: disabled), **When** a request passes through the gateway, **Then** the full request and response are stored in an append-only log with `authorization`, `x-api-key`, and `api-key` header values replaced with `[REDACTED]`.

2. **Given** a request has been logged, **When** the user triggers a replay for that request ID, **Then** the stored request is resubmitted against the current provider configuration and the new response is returned — without modifying the original log entry.

3. **Given** a retention period of 7 days is configured, **When** logs older than 7 days exist, **Then** they are automatically pruned — only recent logs remain.

4. **Given** request logging is disabled (the default), **When** requests pass through the gateway, **Then** no request or response data is persisted — ensuring privacy by default.

5. **Given** a request body contains personally identifiable information beyond authentication headers, **When** the request is logged, **Then** a clear privacy warning is displayed at startup informing the user that request bodies may contain PII and logging should be used with caution.

---

### Edge Cases

- What happens when the gateway starts with zero auto-detected providers and no existing configuration? The gateway boots but prompts for interactive configuration or offers the `--init` flag to generate a starter configuration file.
- What happens when all API keys for a provider fail (all return 401)? The gateway returns a clear error to the client indicating all keys are exhausted, with a retry-after hint based on the shortest cooldown remaining.
- What happens when a WireAdapter module throws an unhandled exception during request processing? The gateway catches the error, logs it with the adapter name, marks that adapter as temporarily disabled, and falls through to the next matching adapter or returns a gateway error.
- What happens when translation encounters a malformed request that doesn't match either Anthropic or OpenAI format? The gateway passes it through untranslated, logging a warning that the format was unrecognized.
- What happens when the request log store grows beyond available disk space? The pruning mechanism runs on a schedule; if storage is critically low, logging is automatically suspended with an alert until space is available.
- What happens during cross-wire translation when the upstream provider returns an error response (non-200)? The error is translated to the corresponding client-format error structure where possible, or passed through with the original status code and message.
- What happens when a key in rotation has a transient network error (not a 401)? The gateway retries the same key once before marking it for cooldown — transient errors are distinguished from permanent auth failures.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST auto-detect API keys from environment variables using a strict whitelist of recognized patterns (e.g., `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_KEY`, `GROQ_API_KEY`) — NOT wildcard matching — and automatically configure corresponding provider routes.
- **FR-002**: System MUST print a startup message displaying the gateway version, listening address and port, count of auto-detected providers, and the dashboard URL.
- **FR-003**: System MUST provide a `--init` flag that generates a default configuration file with auto-detected providers pre-populated.
- **FR-004**: System MUST define a formal WireAdapter interface contract with required methods (`detectRequest`, `extractUsage`) and optional methods (`injectAuth`, `extractUsageFromSSE`, `formatDenial`, `normalizeModel`) that default to no-ops.
- **FR-005**: System MUST auto-discover WireAdapter modules placed in a designated adapters directory at boot time and register any module exporting an object with the required `detectRequest` method.
- **FR-006**: System MUST support a generic HTTP wire type that forwards requests as-is to any configured HTTP endpoint without requiring a custom WireAdapter.
- **FR-007**: System MUST perform best-effort usage extraction from generic HTTP responses: parse as Anthropic format first, then OpenAI format, then log `null` usage for unrecognized formats (never fabricate zero usage).
- **FR-008**: System MUST support multiple API keys per provider configured via comma-separated environment variable names, with round-robin distribution across available keys.
- **FR-009**: System MUST automatically mark a key as failed when it returns an authentication error (401), skip it in rotation for a configurable cooldown period (default 60 seconds), and automatically re-enable it after the cooldown expires.
- **FR-010**: System MUST support three authentication modes per provider: environment variable (`env`), OAuth token with automatic refresh (`oauth`), and static key (`static`).
- **FR-011**: System MUST provide an optional, append-only request/response logging capability that stores request-response pairs with automatic redaction of `authorization`, `x-api-key`, and `api-key` header values replaced with `[REDACTED]`.
- **FR-012**: System MUST default request logging to disabled (opt-in) with a clear privacy warning at startup when enabled.
- **FR-013**: System MUST support configurable log retention with automatic pruning of entries older than the configured retention period (default 7 days).
- **FR-014**: System MUST provide a replay capability that resubmits a stored request against the current provider configuration and returns the new response without modifying the original log entry.
- **FR-015**: System MUST implement bidirectional request and response translation between Anthropic Messages API format and OpenAI Chat Completions API format, covering messages, system prompts, tools, and token usage.
- **FR-016**: System MUST silently drop unsupported features (extended thinking, computer use, streaming) during translation rather than causing errors, and document which features are preserved and which are dropped.
- **FR-017**: System MUST make cross-wire translation opt-in per route (default: disabled/passthrough) via a configuration flag.
- **FR-018**: System MUST accurately extract and record token usage from translated responses in the ledger, matching what the upstream provider reports.
- **FR-019**: System MUST provide an endpoint listing all registered WireAdapters, enabling discovery and diagnostics.
- **FR-020**: System MUST gracefully handle adapter loading failures: log a clear error identifying the problematic adapter and the missing method, skip it, and continue booting with remaining adapters.

### Key Entities

- **WireAdapter**: Represents a protocol handler for a specific API wire format. Key attributes: adapter name, supported request detection logic, authentication injection strategy, usage extraction logic, and optional translation/normalization capabilities. Registered by dropping a module into the adapters directory.
- **Provider Route**: Represents a configured upstream LLM provider accessible through the gateway. Key attributes: provider name, wire type (specific adapter name or `generic-http`), base URL, authentication configuration (mode, key references), optional custom headers, and whether cross-wire translation is enabled.
- **Credential Key**: Represents a single API key or token used to authenticate with a provider. Key attributes: key reference (environment variable name or static value), authentication mode, current status (active/failed), failure timestamp, and cooldown expiry.
- **Request Log Entry**: Represents a stored request-response pair for debugging. Key attributes: unique request ID, timestamp, provider route, redacted request headers and body, response headers and body, and extracted usage data.
- **Translation Mapping**: Represents the bidirectional conversion rules between Anthropic and OpenAI wire formats. Covers message structure, system prompts, tool definitions, token usage fields, and error response formats.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user with no prior MeridianOS experience can start the gateway and have it auto-detect their API keys and begin metering traffic in under 30 seconds from command execution to first proxied request.
- **SC-002**: Adding support for a new LLM provider with a standard REST API takes no more than 10 minutes, requiring only configuration — no source code changes.
- **SC-003**: Adding a WireAdapter for a provider with a non-standard API format requires implementing at most 2 required methods; a minimal adapter can be written in under 50 lines of code.
- **SC-004**: In a multi-key configuration where one key fails with an authentication error, the gateway fails over to the next available key without any user-visible error or dropped request.
- **SC-005**: Request replay against a logged request reproduces the original provider call with the current provider configuration and returns a response within 200% of the original request duration.
- **SC-006**: Cross-wire translation preserves all critical message content (user messages, system prompts, tool calls, token usage) such that an agent using the translated format completes its task without format-related errors.
- **SC-007**: 100% of existing gateway tests continue to pass after the WireAdapter extraction — no regressions in existing Anthropic or OpenAI routing behavior.
- **SC-008**: Sensitive header values (authorization, API keys) are never written to disk in plaintext — 100% redaction rate in request logs when logging is enabled.

## Assumptions

- The gateway runs on a developer's local machine or a server with Node.js 24+ available — no containerization is required for Phase 1.
- Users have at least one API key for an LLM provider (Anthropic, OpenAI, DeepSeek, or Groq) set as an environment variable before starting the gateway.
- The existing gateway codebase (`gateway/server.mjs`, `gateway/index.mjs`) contains working Anthropic and OpenAI wire handling that can be extracted into conforming WireAdapter modules.
- The existing dashboard on port 4317 remains available and functional throughout Phase 1 changes.
- Streaming (SSE) translation between Anthropic and OpenAI formats is explicitly out of scope for Phase 1 — only non-streaming request/response translation is delivered.
- Authentication failure detection relies on HTTP 401 status codes; providers that use non-standard auth error responses (e.g., 403 or 200 with error body) may not trigger automatic key rotation without a custom WireAdapter.
- The `generic-http` wire type makes a best-effort attempt at usage parsing but does not guarantee usage extraction for providers with non-standard response formats.
- The request log store is local to the gateway instance — distributed or remote log storage is out of scope for Phase 1.
- Configuration of provider routes after initial bootstrap is handled through manual editing of configuration files — the browser-based provider wizard is a Phase 2 feature.
