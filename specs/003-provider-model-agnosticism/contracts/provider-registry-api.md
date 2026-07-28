# Provider Registry API Contract

**Feature**: Provider &amp; Model Agnosticism (003) | **Date**: 2026-07-28

## Overview

The provider registry API exposes providers, model discovery, and pricing data through the dashboard HTTP server. All endpoints are served from the dashboard (`localhost:4317`) and the gateway CLI.

## Dashboard API Endpoints

### `GET /api/providers`

Returns all resolved providers with health status.

**Response** (200):
```json
{
  "providers": [
    {
      "name": "anthropic",
      "displayName": "Anthropic",
      "wire": "anthropic",
      "baseUrl": "https://api.anthropic.com",
      "keyEnv": "ANTHROPIC_API_KEY",
      "features": {
        "supportsStreaming": true,
        "supportsToolUse": true,
        "supportsVision": true,
        "supportsCaching": true
      },
      "health": {
        "status": "ok",
        "latencyMs": 45,
        "lastChecked": "2026-07-28T10:30:00Z"
      },
      "source": "default",
      "overrides": []
    }
  ],
  "count": 5,
  "healthyCount": 4,
  "degradedCount": 1,
  "downCount": 0
}
```

### `POST /api/providers/test`

Runs a conformance test against a provider.

**Request**:
```json
{
  "provider": "groq"
}
```

**Response** (200):
```json
{
  "ok": true,
  "provider": "groq",
  "latencyMs": 120,
  "modelsFound": 12,
  "features": {
    "supportsStreaming": true,
    "supportsToolUse": true
  },
  "testedAt": "2026-07-28T10:31:00Z"
}
```

**Response** (200, failure):
```json
{
  "ok": false,
  "provider": "groq",
  "errorCode": "AUTH_FAILED",
  "errorMessage": "Authentication failed: API key is invalid or expired. Check GROQ_API_KEY.",
  "latencyMs": 85,
  "testedAt": "2026-07-28T10:31:00Z"
}
```

**Error codes**: `AUTH_FAILED`, `CONNECTION_FAILED`, `TIMEOUT`, `UNEXPECTED_RESPONSE`

### `POST /api/providers`

Adds or updates a provider via the wizard (programmatic interface).

**Request**:
```json
{
  "name": "groq",
  "keyEnv": "GROQ_API_KEY",
  "apiKey": "gsk_...",
  "source": "dashboard"
}
```

If `name` matches a known provider, all other fields are pre-filled from `known-providers.json`. If `name` is not known, `wire` and `baseUrl` are required.

**Response** (201):
```json
{
  "ok": true,
  "provider": {
    "name": "groq",
    "displayName": "Groq",
    "wire": "openai",
    "baseUrl": "https://api.groq.com/openai/v1",
    "keyEnv": "GROQ_API_KEY"
  },
  "writtenTo": "policy.yaml",
  "backupCreated": "policy.backup.20260728-103200.yaml"
}
```

**Response** (409, conflict):
```json
{
  "ok": false,
  "errorCode": "CONCURRENT_MODIFICATION",
  "errorMessage": "policy.yaml was modified since it was read. Your changes were not saved to avoid overwriting. Reload and try again."
}
```

### `GET /api/models`

Returns all models in the registry with optional filters.

**Query parameters**:
- `provider` (string): Filter by provider name
- `tier` (string): Filter by assigned tier
- `deprecated` (boolean): Include deprecated models (default: false)
- `search` (string): Free-text search on model_id and display_name

**Response** (200):
```json
{
  "models": [
    {
      "id": "anthropic:claude-sonnet-4-20250514",
      "provider": "anthropic",
      "modelId": "claude-sonnet-4-20250514",
      "displayName": "Claude Sonnet 4",
      "contextWindow": 200000,
      "maxOutputTokens": 64000,
      "features": {
        "vision": true,
        "toolUse": true,
        "streaming": true,
        "caching": true,
        "thinking": true
      },
      "pricing": {
        "inputPerM": 3.00,
        "cachedInputPerM": 0.30,
        "outputPerM": 15.00,
        "source": "provider-native",
        "refreshed": "2026-07-28T00:00:00Z"
      },
      "deprecated": false,
      "tierAssigned": "medium",
      "lastSeen": "2026-07-28T06:00:00Z"
    }
  ],
  "count": 42,
  "refreshedAt": "2026-07-28T06:00:00Z"
}
```

### `POST /api/models/refresh`

Triggers an immediate model discovery refresh across all providers.

**Response** (202):
```json
{
  "ok": true,
  "message": "Model discovery started for 5 providers",
  "providers": ["anthropic", "deepseek", "openrouter", "ollama", "groq"],
  "estimatedDurationMs": 45000
}
```

### `GET /api/models/refresh/status`

Returns the status of the most recent refresh operation.

**Response** (200):
```json
{
  "status": "running",
  "providersTotal": 5,
  "providersComplete": 3,
  "modelsDiscovered": 28,
  "modelsDeprecated": 2,
  "startedAt": "2026-07-28T10:32:00Z",
  "errors": []
}
```

### `GET /api/pricing`

Returns current pricing for all models.

**Response** (200):
```json
{
  "pricing": [
    {
      "modelId": "anthropic:claude-sonnet-4-20250514",
      "inputPerM": 3.00,
      "cachedInputPerM": 0.30,
      "outputPerM": 15.00,
      "source": "provider-native",
      "refreshed": "2026-07-28T00:00:00Z",
      "stale": false
    }
  ],
  "refreshedAt": "2026-07-28T00:05:00Z",
  "sourcesUsed": ["provider-native", "openrouter"],
  "staleCount": 0,
  "warnings": []
}
```

### `POST /api/pricing/refresh`

Triggers an immediate pricing refresh.

**Response** (202):
```json
{
  "ok": true,
  "message": "Pricing refresh started",
  "estimatedDurationMs": 20000
}
```

## CLI Commands

### `node gateway/cli.mjs provider list`

Lists all registered providers with health status.

**Output**:
```
Providers (5 total, 4 healthy, 1 degraded):

  anthropic        Anthropic        anthropic    ok        45ms
  deepseek         DeepSeek         openai       ok        120ms
  openrouter       OpenRouter       openai       ok        200ms
  ollama           Ollama           openai       degraded  5001ms
  groq             Groq             openai       ok        85ms
```

### `node gateway/cli.mjs provider add`

Interactive wizard for adding a provider.

### `node gateway/cli.mjs provider add --auto`

Auto-detects providers from environment variables.

### `node gateway/cli.mjs provider add --name groq --wire openai --base-url https://api.groq.com/openai/v1 --key-env GROQ_API_KEY`

Non-interactive provider addition.

### `node gateway/cli.mjs provider test <name>`

Runs a conformance test against the named provider.

**Output (success)**:
```
Testing groq... ✓ OK (120ms, 12 models found)
  Features: streaming, tool-use
```

**Output (failure)**:
```
Testing groq... ✗ AUTH_FAILED (85ms)
  Authentication failed: API key is invalid or expired. Check GROQ_API_KEY.
```

### `node gateway/cli.mjs models list`

Lists all models in the registry.

### `node gateway/cli.mjs models refresh`

Triggers model discovery and displays progress.

### `node gateway/cli.mjs pricing show`

Shows current pricing for all models.

### `node gateway/cli.mjs pricing refresh`

Triggers pricing refresh and displays results.
