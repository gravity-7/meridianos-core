# Model Discovery Adapter Interface Contract

**Feature**: Provider &amp; Model Agnosticism (003) | **Date**: 2026-07-28

## Overview

Model discovery adapters are per-provider modules that fetch and normalize model lists from provider APIs. Each adapter lives in `gateway/model-discovery-adapters/` and exports a consistent interface. The orchestrator (`model-discovery.mjs`) loads adapters based on the provider's `wire` type and calls them in parallel.

## Interface Contract

### Required Export: `discoverModels(providerConfig) → Promise<Model[]>`

**Parameters**:
- `providerConfig`: Resolved provider configuration object with fields: `name`, `wire`, `baseUrl`, `keyEnv`, `auth`, `headers`, `features`. The orchestrator resolves the API key before calling the adapter, passing it as `providerConfig._resolvedKey`.

**Returns**: `Promise<Model[]>` — Array of discovered model objects.

**Model object shape**:
```typescript
{
  model_id: string;           // Provider-specific model identifier (required)
  display_name?: string;      // Human-readable name (optional, defaults to model_id)
  context_window?: number;    // Max context window in tokens (optional, null if unknown)
  max_output_tokens?: number; // Max output tokens (optional, null if unknown)
  features?: {                // Capability flags (optional, defaults to empty)
    vision?: boolean;
    toolUse?: boolean;
    streaming?: boolean;
    caching?: boolean;
    thinking?: boolean;
  };
  deprecated?: boolean;       // Whether model is deprecated (optional, defaults to false)
  deprecated_successor?: string; // Recommended replacement model_id (optional)
}
```

**Error handling**: Adapters should throw on unrecoverable errors (network failure, auth failure). The orchestrator catches errors per-provider and logs them. A failed adapter does not block other providers' discovery.

### Optional Export: `normalizeModelId(modelId: string) → string`

Normalizes a raw model ID from the provider into a consistent format. Default is identity (pass-through).

### Optional Export: `supportsDiscovery(providerConfig) → boolean`

Quick check whether the adapter can handle this provider. Default: check if `providerConfig.wire` matches the adapter's expected wire type.

## Adapter Discovery

The orchestrator (`model-discovery.mjs`) discovers adapters by:
1. Scanning `gateway/model-discovery-adapters/` for `.mjs` files
2. Loading each module and checking for the required `discoverModels` export
3. Mapping adapters to wire types via the module's `supportsDiscovery` or naming convention (filename = wire type)
4. Calling the appropriate adapter for each provider based on its `wire` field

If no specific adapter matches a provider's wire type, the `generic-http.mjs` adapter is used as fallback.

## Built-in Adapters

### `openai.mjs`

**Wire types**: `openai`

**Discovery method**: `GET {baseUrl}/v1/models` → parse `{ data: [{ id, owned_by, created }] }`.

**Context window**: Looked up from a static `known-context-windows.json` mapping since OpenAI's API doesn't return context window sizes.

**Features heuristic**: Based on model ID patterns:
- `gpt-4o*` → vision, toolUse, streaming
- `gpt-4*` → toolUse, streaming
- `o1*`, `o3*` → streaming (but NOT toolUse or vision in some cases)

**Deprecation detection**: Models not seen in 2+ consecutive discovery runs are marked deprecated.

### `anthropic.mjs`

**Wire types**: `anthropic`

**Discovery method**: Anthropic has no public models listing endpoint. Uses:
1. Curated static list of known Anthropic models (committed in the adapter)
2. models.dev API as supplementary source for newly released models

**Context window**: From curated list (Claude models have known context windows).

**Features**: From curated list (all Claude models support vision, toolUse, streaming; Sonnet 4+ supports thinking; caching varies).

### `google-ai.mjs`

**Wire types**: `google-ai`

**Discovery method**: `GET {baseUrl}/v1beta/models?key={apiKey}` → parse `{ models: [{ name, displayName, inputTokenLimit, outputTokenLimit, supportedGenerationMethods }] }`.

**Model ID normalization**: Strips `models/` prefix from `name` field. Filters to models supporting `generateContent` method.

### `generic-http.mjs`

**Wire types**: `generic-http`, and fallback for any unrecognized wire type.

**Discovery method**: Multi-strategy with fallbacks:
1. Try `GET {baseUrl}/v1/models` (OpenAI-compatible pattern) — if response matches `{ data: [...] }`, use it
2. Try models.dev API: `GET https://models.dev/api/v1/models?provider={name}`
3. Return empty list if both fail

**Features**: Unknown for all models — all feature flags default to `false`.

## Orchestrator Logic (`model-discovery.mjs`)

```
discoverAllModels(providers) {
  results = {}
  errors = []

  for each provider in parallel:
    try {
      adapter = resolveAdapter(provider.wire)
      models = adapter.discoverModels(provider)
      results[provider.name] = models
    } catch (err) {
      errors.push({ provider: provider.name, error: err.message })
      // Existing models for this provider are NOT deleted
    }

  // Upsert all discovered models into model_registry
  for each [provider, models] in results:
    for each model in models:
      model-registry.upsertModel(provider, model)

  // Mark models not in discovery response as deprecated
  for each provider:
    model-registry.markUnseenAsDeprecated(provider, seen_model_ids)

  return { results, errors }
}
```

## Test Adapter Contract

For testing, a mock adapter must:

1. Export `discoverModels` returning a predictable model list
2. Be loadable by the adapter discovery mechanism
3. Not make real network calls

Test adapters use the cassette system (`test/cassette.mjs`) for deterministic responses.
