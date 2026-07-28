# WireAdapter Interface Contract

**Version**: 1.0.0 | **Feature**: Universal Gateway (002)

## Overview

A WireAdapter is a module that teaches the gateway how to speak a specific LLM provider's API protocol. Each adapter lives in `gateway/wire-adapters/` as a `.mjs` file and is auto-discovered at gateway boot.

## Contract Shape

A WireAdapter module MUST export an object with at minimum the two **required** methods below. Four **optional** methods may also be provided; the gateway supplies sensible no-op defaults for any that are absent.

```typescript
interface WireAdapter {
  // ── REQUIRED ──────────────────────────────────────────────

  /**
   * Determine whether this adapter handles the given incoming request.
   * Called for EVERY incoming request until one adapter claims it.
   *
   * @param req - Node.js IncomingMessage (headers, method, url available)
   * @returns An object with wire, model, and provider if this adapter
   *          handles the request; null otherwise.
   */
  detectRequest(req: IncomingMessage): { wire: string; model: string; provider: string } | null;

  /**
   * Extract token usage from a parsed (JSON) upstream response body.
   * Called AFTER the upstream responds. The parsed body is the full
   * JSON response object.
   *
   * @param parsedBody - The JSON.parse'd upstream response body
   * @returns Token usage fields. Every field is number | null.
   *          null means "genuinely unknown" — never fabricate as 0.
   */
  extractUsage(parsedBody: Record<string, unknown>): UsageBlock | null;

  // ── OPTIONAL ──────────────────────────────────────────────

  /**
   * Inject authentication into the upstream request headers.
   * Called BEFORE forwarding. Default: no-op (headers sent as-is).
   *
   * @param headers    - Mutable headers object. Add auth headers directly.
   * @param resolveKey - (keyEnv: string) => string | undefined.
   *                     Resolves an env var name to its value.
   */
  injectAuth?(headers: Record<string, string>, resolveKey: (keyEnv: string) => string | undefined): void;

  /**
   * Extract token usage from a single SSE (Server-Sent Events) event.
   * Called incrementally during streaming responses. The tracker
   * accumulates the latest value for each field across events.
   *
   * @param event - A single parsed SSE data event object
   * @returns Partial usage fields that were found in this event,
   *          or null if this event contains no usage data.
   */
  extractUsageFromSSE?(event: Record<string, unknown>): Partial<UsageBlock> | null;

  /**
   * Format a budget-denial response in this wire's native error format.
   * Called when the gateway blocks a request due to budget exhaustion.
   * Default: generic JSON `{ error: { message, type: "permission_error" } }`
   * with HTTP 403 and `x-should-retry: false` header.
   *
   * @param capWindow - Which cap was hit ("5h" or "week")
   * @returns HTTP status code and response body for the denial.
   */
  formatDenial?(capWindow: string): { status: number; body: Record<string, unknown> };

  /**
   * Normalize a model identifier for consistent ledger recording.
   * Called before emitting token events. Default: identity (return as-is).
   *
   * @param model - The model string from the request or route
   * @returns Normalized model string
   */
  normalizeModel?(model: string): string;
}

interface UsageBlock {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
}
```

## Built-in Adapters

The gateway ships with these adapters (extracted from existing `server.mjs` logic):

| Adapter | Wire Key | File |
|---------|----------|------|
| Anthropic | `anthropic` | `gateway/wire-adapters/anthropic.mjs` |
| OpenAI | `openai` | `gateway/wire-adapters/openai.mjs` |
| Generic HTTP | `generic-http` | `gateway/wire-adapters/generic-http.mjs` |

### Anthropic Adapter Specifics

- **detectRequest**: Checks for `x-api-key` header (Anthropic's auth method) or Anthropic-format request body (`model` starting with `claude-`)
- **extractUsage**: Reads `usage.input_tokens`, `usage.output_tokens`, `usage.cache_read_input_tokens`, `usage.cache_creation_input_tokens`
- **injectAuth**: Sets `x-api-key` header from resolved key
- **extractUsageFromSSE**: Parses `message_start.usage` and `message_delta.usage.output_tokens`
- **formatDenial**: Returns Anthropic-formatted error: `{ type: "error", error: { type: "permission_error", message: "..." } }`

### OpenAI Adapter Specifics

- **detectRequest**: Checks for `authorization: Bearer` header or OpenAI-format request body (`model` field with typical OpenAI model names)
- **extractUsage**: Reads `usage.prompt_tokens`, `usage.completion_tokens`, `usage.prompt_tokens_details.cached_tokens`
- **injectAuth**: Sets `authorization: Bearer <key>` header
- **extractUsageFromSSE**: Parses `usage` field from SSE events
- **formatDenial**: Returns OpenAI-formatted error: `{ error: { message: "...", type: "permission_error", code: "over_budget" } }`

### Generic HTTP Adapter Specifics

- **detectRequest**: Never claims a request directly. Acts as fallback when no specific adapter matches. Activated by route configuration (`wire: "generic-http"`), not by request detection.
- **extractUsage**: Tries Anthropic format first, then OpenAI format. Returns `null` for unrecognized formats.
- **injectAuth**: Sets `authorization: Bearer <key>` header (most common pattern for generic APIs).
- **extractUsageFromSSE**: Returns `null` (generic HTTP cannot parse unknown SSE formats).
- **formatDenial**: Uses the default generic JSON format.

## Discovery & Registration

1. At gateway boot, scan `gateway/wire-adapters/` for `*.mjs` files
2. `import` each module
3. Validate the exported object has `detectRequest` and `extractUsage` as functions
4. Register valid adapters by their `wire` key (derived from filename: `anthropic.mjs` → `anthropic`)
5. Log and skip any module missing required methods
6. Expose registered adapters via `GET /api/wire-adapters`

## Error Handling Contract

- **Adapter load failure**: If an adapter module throws during import, log the error with the filename, skip it, continue booting. The gateway MUST NOT crash due to a bad adapter.
- **detectRequest throws**: Caught by the gateway; treated as "adapter does not handle this request" (null). The error is logged.
- **extractUsage throws**: Caught by the gateway; treated as "usage unknown" (null return). The error is logged. The response is still returned to the client.
- **injectAuth throws**: Caught; auth injection is skipped. Request may fail upstream with 401 — this is logged.
- **formatDenial throws**: Caught; falls back to default generic denial format.
