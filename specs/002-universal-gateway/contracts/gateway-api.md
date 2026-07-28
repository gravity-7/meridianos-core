# Gateway API Endpoints

**Version**: 1.0.0 | **Feature**: Universal Gateway (002)

## Management Endpoints

These endpoints are served by the gateway HTTP server on its configured port (default ephemeral, dashboard-visible).

### GET /api/wire-adapters

List all registered WireAdapters.

**Response** (200):
```json
{
  "adapters": [
    {
      "name": "anthropic",
      "wire": "anthropic",
      "hasInjectAuth": true,
      "hasSSEExtraction": true,
      "hasFormatDenial": true,
      "hasNormalizeModel": false
    },
    {
      "name": "openai",
      "wire": "openai",
      "hasInjectAuth": true,
      "hasSSEExtraction": true,
      "hasFormatDenial": true,
      "hasNormalizeModel": false
    },
    {
      "name": "generic-http",
      "wire": "generic-http",
      "hasInjectAuth": true,
      "hasSSEExtraction": false,
      "hasFormatDenial": false,
      "hasNormalizeModel": false
    }
  ]
}
```

### GET /api/providers

List all configured provider routes.

**Response** (200):
```json
{
  "providers": [
    {
      "provider": "anthropic",
      "wire": "anthropic",
      "baseUrl": "https://api.anthropic.com",
      "keyCount": 3,
      "translateEnabled": false
    }
  ]
}
```

### POST /api/gateway/replay/:requestId

Replay a previously logged request against the current provider configuration.

**Response** (200):
```json
{
  "originalRequestId": "uuid",
  "statusCode": 200,
  "latencyMs": 342,
  "body": { "...": "upstream response" },
  "usage": {
    "inputTokens": 150,
    "outputTokens": 80,
    "totalTokens": 230
  }
}
```

**Error** (404): Request ID not found in logs.

### GET /api/gateway/logs

List recent request log entries (paginated).

**Query params**:
- `limit` (default 50, max 500)
- `offset` (default 0)
- `provider` (optional filter)
- `since` (ISO-8601, optional)

**Response** (200):
```json
{
  "logs": [
    {
      "id": "uuid",
      "ts": "2026-07-28T10:30:00.000Z",
      "provider": "anthropic",
      "model": "claude-sonnet-4-20250514",
      "method": "POST",
      "statusCode": 200,
      "latencyMs": 342
    }
  ],
  "total": 142
}
```

### GET /api/gateway/logs/:id

Get a single request log entry with full request/response bodies.

**Response** (200): Full RequestLogEntry object with redacted headers.

## Proxy Endpoint

### ALL /v1/* (and any path)

The gateway proxies all requests to the resolved upstream provider. The path is preserved as-is.

**Headers forwarded**: All client headers except hop-by-hop headers (`host`, `connection`, `authorization`, `x-api-key`, `x-gateway-token`, `content-length`, `transfer-encoding`).

**Headers injected**: Auth headers per the WireAdapter's `injectAuth`, plus `accept-encoding: identity` (forces uncompressed response for metering).

**Translation**: If `route.translate` is `true`:
1. Request body is translated from client format to upstream format
2. Response body is translated from upstream format back to client format
3. Usage is extracted from the UPSTREAM (translated) response

## Startup Output Contract

When the gateway boots successfully, it MUST print to stdout:

```
MeridianOS Gateway v<version>
Listening on http://127.0.0.1:<port>
<N> provider(s) auto-detected: <provider-list>
Dashboard: http://127.0.0.1:4317
```

When no providers are auto-detected:
```
MeridianOS Gateway v<version>
Listening on http://127.0.0.1:<port>
No API keys detected. Run with --init to generate a starter config, or set provider API keys in your environment.
Dashboard: http://127.0.0.1:4317
```

When request logging is enabled:
```
⚠ Logging is ENABLED. Request/response data will be stored for debugging.
  Authorization headers are automatically redacted, but request bodies
  may contain sensitive information. Disable via gateway.logging.enabled: false
```
