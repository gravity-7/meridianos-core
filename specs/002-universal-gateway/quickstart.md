# Quickstart & Validation Guide: Universal Gateway

**Feature**: Universal Gateway (002) | **Date**: 2026-07-28

## Prerequisites

- Node.js 24+ installed
- At least one LLM provider API key (Anthropic, OpenAI, DeepSeek, or Groq)
- Repository cloned and dependencies installed (`npm install`)
- Existing test suite passing (`npm test` — 915+ tests, 0 failures)

## Quick Validation Scenarios

These scenarios validate the feature end-to-end. Run them in order — each builds on the previous.

### VS-1: Zero-Config Bootstrap

**Purpose**: Verify the gateway auto-detects API keys from environment and boots without configuration.

**Setup**:
```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-test-key"
$env:OPENAI_API_KEY = "sk-test-key"
```

**Run**:
```powershell
node gateway/cli.mjs
```

**Expected**:
- Gateway starts without errors
- Prints: `MeridianOS Gateway vX.Y.Z | Listening on http://127.0.0.1:<port> | 2 providers auto-detected: anthropic, openai | Dashboard: http://127.0.0.1:4317`
- Process exits cleanly on Ctrl+C

**Teardown**:
```powershell
Remove-Item Env:\ANTHROPIC_API_KEY
Remove-Item Env:\OPENAI_API_KEY
```

### VS-2: WireAdapter Auto-Discovery

**Purpose**: Verify that dropping a new adapter module auto-registers it.

**Setup**: Create a minimal test adapter:
```javascript
// gateway/wire-adapters/__test-wire.mjs  (create temporarily)
export const detectRequest = (req) => {
  if (req.headers['x-test-wire']) {
    return { wire: 'test-wire', model: 'test-model', provider: 'test-provider' };
  }
  return null;
};
export const extractUsage = (parsedBody) => ({
  inputTokens: parsedBody?.usage?.in ?? null,
  outputTokens: parsedBody?.usage?.out ?? null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
});
```

**Run**: Start the gateway and query the adapter listing:
```powershell
# Start gateway in background, then:
Invoke-RestMethod -Uri "http://127.0.0.1:<port>/api/wire-adapters" | ConvertTo-Json
```

**Expected**:
- `test-wire` appears in the adapter list with `hasInjectAuth: false`, `hasSSEExtraction: false`, `hasFormatDenial: false`, `hasNormalizeModel: false`

**Teardown**: Delete `gateway/wire-adapters/__test-wire.mjs`.

### VS-3: Generic HTTP Provider

**Purpose**: Verify any HTTP endpoint can be registered and metered without a custom adapter.

**Setup**: Register a generic HTTP route (via test config or policy.yaml):
```yaml
routes:
  - provider: test-generic
    wire: generic-http
    baseUrl: http://localhost:9999  # a test echo server
```

**Run**: Send a request through the gateway to the generic provider. Use the test suite:
```powershell
npm test -- tests/gateway/generic-http.test.mjs
```

**Expected**:
- Request forwarded as-is to the upstream
- Response returned to client unchanged
- Token event emitted (with usage if response is Anthropic/OpenAI format, `null` usage otherwise)
- All tests pass

### VS-4: Multi-Key Rotation & Failover

**Purpose**: Verify round-robin key selection and automatic failover on 401.

**Run**:
```powershell
npm test -- tests/gateway/multi-key.test.mjs
```

**Expected**:
- Provider configured with 3 key env vars → requests distributed across all 3
- Simulated 401 on key 1 → subsequent requests use key 2
- Key 1 re-enabled after cooldown (test uses short cooldown for speed)
- All tests pass

### VS-5: Non-Streaming Cross-Wire Translation

**Purpose**: Verify Anthropic↔OpenAI bidirectional translation.

**Run**:
```powershell
npm test -- tests/gateway/translate.test.mjs
```

**Expected**:
- Anthropic-format request → translated to OpenAI → response translated back → client sees Anthropic response
- OpenAI-format request → translated to Anthropic → response translated back → client sees OpenAI response
- Messages, system prompts, tools, and token usage preserved
- Thinking and computer_use fields silently dropped (not errored)
- Translation disabled by default (passthrough)
- Usage extracted correctly from translated responses
- All tests pass

### VS-6: Request Logging & Replay

**Purpose**: Verify request-response logging with redaction and replay.

**Run**:
```powershell
npm test -- tests/gateway/logging.test.mjs
```

**Expected**:
- Logging disabled by default → no entries created
- Logging enabled → request-response pair stored
- Auth headers (`authorization`, `x-api-key`, `api-key`) stored as `[REDACTED]`
- Replay endpoint resubmits stored request and returns new response
- Retention pruning removes old entries
- Privacy warning printed at startup when logging enabled
- All tests pass

### VS-7: Full Regression

**Purpose**: Verify all existing functionality still works after WireAdapter extraction.

**Run**:
```powershell
npm test
```

**Expected**:
- All existing tests pass (915+ tests, 0 failures)
- No regressions in Anthropic or OpenAI routing behavior
- No regressions in token event emission
- No regressions in budget enforcement

## Manual Dogfood Scenarios

These scenarios require real API keys and validate real-world behavior.

### MD-1: Live Anthropic Request

```powershell
$env:ANTHROPIC_API_KEY = "<real-key>"
# Start gateway, then send a request through it
# Verify: response returned, token event logged with real usage
```

### MD-2: Live Cross-Wire (Claude Code → OpenAI)

```powershell
$env:OPENAI_API_KEY = "<real-key>"
# Configure route with translate: true
# Run Claude Code pointing at gateway
# Verify: Claude Code works normally, usage attributed to OpenAI
```

### MD-3: Key Rotation Under Load

```powershell
# Configure 3 keys for one provider
# Send rapid requests
# Verify: round-robin distribution in ledger
# Revoke one key → verify failover works without errors
```
