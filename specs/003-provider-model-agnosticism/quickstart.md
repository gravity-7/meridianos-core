# Quickstart &amp; Validation Guide: Provider &amp; Model Agnosticism

**Feature**: Provider &amp; Model Agnosticism (003) | **Date**: 2026-07-28

## Prerequisites

- Node.js 24+ installed
- At least one LLM provider API key (Anthropic or OpenAI or DeepSeek)
- Repository cloned and dependencies installed (`npm install`)
- Existing test suite passing (`npm test` — 915+ tests, 0 failures)
- Phase 1 (Universal Gateway) features available: WireAdapter registry, multi-key management, zero-config bootstrap

## Quick Validation Scenarios

### VS-1: Declarative Provider Registry — Add Provider via YAML

**Purpose**: Verify a provider added to `policy.yaml` is resolved at boot without code changes.

**Setup**: Add a test provider to `policy.yaml`:
```yaml
providers:
  test-provider:
    name: test-provider
    wire: openai
    baseUrl: "https://test-api.example.com/v1"
    keyEnv: TEST_API_KEY
    displayName: "Test Provider"
```

**Run**:
```powershell
$env:TEST_API_KEY = "sk-test-key"
npm test -- --test-name-pattern="providers-registry"
```

**Expected**:
- `resolveAllProviders()` includes `test-provider` alongside built-in defaults
- `resolveProvider('test-provider')` returns the merged config
- Provider's `baseUrl` is the override value, NOT any built-in default

**Teardown**: Remove the test provider block from `policy.yaml`. Run `npm test` to confirm no regressions.

---

### VS-2: Provider Schema Validation — Invalid Wire Type

**Purpose**: Verify invalid provider configurations are caught at boot with specific error messages.

**Setup**: Add an invalid provider to `policy.yaml`:
```yaml
providers:
  bad-provider:
    name: bad-provider
    wire: nonexistent-wire
    baseUrl: "https://example.com"
```

**Run**:
```powershell
node -e "
  const { resolveAllProviders } = await import('./providers.mjs');
  // Should throw validation error
"
```

**Expected**:
- Validation error: `"policy.yaml: providers.bad-provider.wire: 'nonexistent-wire' is not a valid wire type. Valid values: anthropic, openai, generic-http, ..."`
- System does NOT silently accept the invalid config
- Built-in providers are still resolved correctly

**Teardown**: Remove the bad provider block.

---

### VS-3: Provider Backward Compatibility — Static PROVIDERS Lazy Getter

**Purpose**: Verify existing code that accesses `PROVIDERS` directly continues to work.

**Run**:
```powershell
node -e "
  const { PROVIDERS } = await import('./providers.mjs');
  console.log('Anthropic provider:', PROVIDERS.anthropic.name);
  console.log('Has baseUrl:', !!PROVIDERS.anthropic.baseUrl);
"
```

**Expected**:
- `PROVIDERS.anthropic` resolves to the Anthropic provider configuration
- No deprecation warnings or errors
- The object shape matches the pre-P2 `PROVIDERS` structure

---

### VS-4: Provider Conformance Testing

**Purpose**: Verify conformance tests correctly identify valid and invalid provider configurations.

**Setup**: Ensure at least one provider is configured with a valid API key in the environment.

**Run (valid provider)**:
```powershell
node gateway/cli.mjs provider test anthropic
```

**Expected**:
```
Testing anthropic... ✓ OK (XXms, N models found)
  Features: streaming, tool-use, vision, caching
```

**Run (invalid key)**:
```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-bad-key"
node gateway/cli.mjs provider test anthropic
```

**Expected**:
```
Testing anthropic... ✗ AUTH_FAILED (XXms)
  Authentication failed: API key is invalid or expired.
```

**Teardown**: Restore valid API key.

---

### VS-5: Provider Wizard — Interactive Addition

**Purpose**: Verify the CLI wizard correctly adds a provider and writes to policy.yaml.

**Setup**: Back up current `policy.yaml`:
```powershell
Copy-Item policy.yaml policy.yaml.vs5-backup
```

**Run**:
```powershell
node gateway/cli.mjs provider add --name groq --wire openai --base-url https://api.groq.com/openai/v1 --key-env GROQ_API_KEY
```

**Expected**:
- Provider `groq` is added to `policy.yaml` under the `providers:` key
- Confirmation message: "Provider 'groq' added to policy.yaml"
- Backup file `policy.backup.{timestamp}.yaml` is created

**Run (auto-detect)**:
```powershell
$env:OPENAI_API_KEY = "sk-test-key"
node gateway/cli.mjs provider add --auto
```

**Expected**:
- OpenAI is detected from `OPENAI_API_KEY` and configured
- Summary: "1 provider auto-detected and configured: openai"

**Teardown**: Restore `policy.yaml` from backup. Clean up `policy.backup.*.yaml` files.

---

### VS-6: Model Discovery

**Purpose**: Verify model discovery populates the registry from configured providers.

**Run**:
```powershell
node gateway/cli.mjs models refresh
```

**Expected**:
- Progress output showing each provider being queried
- Final summary: "Discovered 28 models across 5 providers. 2 models deprecated."
- `node gateway/cli.mjs models list` shows models grouped by provider with metadata

**Run (dashboard API)**:
```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:4317/api/models?provider=anthropic" | ConvertTo-Json -Depth 3
```

**Expected**:
- Response includes models from Anthropic only
- Each model has `id`, `contextWindow`, `features`, `pricing`, `deprecated` fields

---

### VS-7: Weighted Model Routing

**Purpose**: Verify weighted candidate selection distributes tasks according to configured weights.

**Setup**: Configure a tier with two candidates at 90/10 weights in `policy.yaml`:
```yaml
model_routing:
  builder:
    quick:
      candidates:
        - model: "deepseek:deepseek-chat"
          weight: 90
        - model: "groq:llama-3.3-70b-versatile"
          weight: 10
```

**Run**:
```powershell
# Run with deterministic seed for test verification
node --test tests/model-router-fallback.test.mjs
```

**Expected**:
- Over 100 iterations with deterministic seed: ~90 selections of deepseek-chat, ~10 of llama
- Weighted distribution is within 5% tolerance of expected values
- All tests pass

---

### VS-8: Circuit Breaker and Fallback

**Purpose**: Verify failed models are excluded from rotation and fallback chains work.

**Run**:
```powershell
node --test tests/model-router-fallback.test.mjs
```

**Expected tests pass**:
1. Primary model returns 5 consecutive 500 errors → circuit opens → model excluded
2. Next candidate in tier is selected after primary excluded
3. All candidates in tier excluded → falls back to next tier
4. Authentication error (401) opens circuit immediately (not after 5 failures)
5. After 5-minute cooldown + successful probe → circuit closes → model re-enters rotation
6. All tiers exhausted → task fails with clear error (no infinite loop)

---

### VS-9: Pricing Refresh with Fallback

**Purpose**: Verify multi-source pricing refresh with cache-differentiated cost calculation.

**Run**:
```powershell
node gateway/cli.mjs pricing refresh
```

**Expected**:
- Output shows pricing source for each model: `provider-native`, `openrouter`, `models-dev`, or `cache`
- Cache-differentiated models show separate input and cached-input pricing

**Run (cost calculation)**:
```powershell
node -e "
  const { getEffectiveCost } = await import('./pricing.mjs');
  // 50% cache hit: 500 cached + 500 uncached input, 200 output
  const cost = getEffectiveCost('anthropic:claude-sonnet-4-20250514', 1000, 200, 500);
  console.log('Cost:', cost);
  // Expected: (500 * 3.00 + 500 * 0.30 + 200 * 15.00) / 1000000 = (1500 + 150 + 3000) / 1000000 = $0.00465
"
```

**Expected**: Cost calculation uses cached input rate ($0.30/M) for the 500 cached tokens and standard rate ($3.00/M) for the 500 uncached tokens.

**Run (fallback chain)**:
```powershell
# Simulate network failure — pricing refresh falls back through chain
node gateway/cli.mjs pricing refresh
```

**Expected** when sources are unavailable:
- `provider-native` fails → tries `openrouter`
- `openrouter` fails → tries `models.dev`
- `models.dev` fails → uses last-known-good cache
- Warning: "Pricing data is from cache (refreshed 2026-07-21). May be stale."

---

### VS-10: Full Integration — End-to-End Provider Lifecycle

**Purpose**: Validate the complete provider lifecycle from addition to routing.

**Steps**:

1. **Add provider via dashboard API**:
```powershell
$body = @{ name = "groq"; keyEnv = "GROQ_API_KEY"; apiKey = $env:GROQ_API_KEY; source = "dashboard" } | ConvertTo-Json
Invoke-RestMethod -Uri "http://127.0.0.1:4317/api/providers" -Method Post -Body $body -ContentType "application/json"
```

2. **Test connection**:
```powershell
$body = @{ provider = "groq" } | ConvertTo-Json
Invoke-RestMethod -Uri "http://127.0.0.1:4317/api/providers/test" -Method Post -Body $body -ContentType "application/json"
```

3. **Discover models**:
```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:4317/api/models/refresh" -Method Post
```

4. **Refresh pricing**:
```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:4317/api/pricing/refresh" -Method Post
```

5. **Verify models available for routing**:
```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:4317/api/models?provider=groq"
```

**Expected**: All steps return success. Groq models appear in the registry with pricing. Models are available for routing tier assignment.

---

### VS-11: Regression — Full Test Suite

**Purpose**: Verify all existing tests pass with zero regressions.

**Run**:
```powershell
npm test
```

**Expected**:
- All 915+ tests pass
- 0 failures
- No `.only()` markers in committed tests
- No new console warnings or errors

---

## Manual Validation Checklist

| # | Scenario | Command | Expected |
|---|----------|---------|----------|
| 1 | Add provider via YAML | Edit policy.yaml + restart | Provider in `resolveAllProviders()` |
| 2 | Invalid wire rejected | Boot with bad wire | Specific error with valid options |
| 3 | PROVIDERS backward compat | Access `PROVIDERS.anthropic` | Works without changes |
| 4 | Conformance valid | `cli.mjs provider test anthropic` | `{ ok: true }` |
| 5 | Conformance bad key | Test with wrong key | `{ ok: false, errorCode: "AUTH_FAILED" }` |
| 6 | Wizard add provider | `cli.mjs provider add --name groq ...` | Provider in policy.yaml |
| 7 | Auto-detect | `cli.mjs provider add --auto` | Keys in env → providers configured |
| 8 | Model discovery | `cli.mjs models refresh` | Models populated with metadata |
| 9 | Dashboard models API | `GET /api/models` | Models with tier, pricing, features |
| 10 | Dashboard providers API | `GET /api/providers` | Providers with health status |
| 11 | Weighted routing | 90/10 weights, 100 iterations | ~90 primary, ~10 canary |
| 12 | Fallback on failure | Primary model 500 error | Next candidate tried |
| 13 | Circuit breaker | 5 consecutive failures | Model excluded; red indicator |
| 14 | Breaker recovery | 5-min probe succeeds | Model re-enters rotation |
| 15 | Pricing refresh | `cli.mjs pricing refresh` | Per-model rates with source |
| 16 | Pricing fallback | Network down → refresh | Last-known-good; stale warning |
| 17 | Cache cost calc | 50% cached input | Separate cached/uncached rates |
| 18 | Price change alert | >10% change | Dashboard notification |
| 19 | Backward compat | Old single-model tier format | Auto-wrapped; works |
| 20 | Full test suite | `npm test` | All pass; 0 regressions |
