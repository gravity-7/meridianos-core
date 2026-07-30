# Dashboard API Contracts: IDE & Platform Traffic Integration

**Feature**: 004-ide-platform-integration | **Date**: 2026-07-30

All endpoints are served by `dashboard/server.mjs` on the configured dashboard port (default 4317). All responses are JSON. Error responses follow the pattern `{ "error": true, "message": "..." }` with appropriate HTTP status codes.

---

## 1. IDE Detection

### GET /api/ide/detect

Scan the local machine for installed AI-enabled IDEs and return detection results.

**Response** (200):
```json
{
  "ides": [
    {
      "ideName": "vscode",
      "displayName": "Visual Studio Code",
      "installed": true,
      "installPath": "C:\\Users\\HP\\AppData\\Local\\Programs\\Microsoft VS Code",
      "version": "1.92.0",
      "detectionMethod": "standard-path"
    },
    {
      "ideName": "cursor",
      "displayName": "Cursor",
      "installed": false,
      "installPath": null,
      "version": null,
      "detectionMethod": "standard-path"
    },
    {
      "ideName": "claude-code",
      "displayName": "Claude Code",
      "installed": true,
      "installPath": "/usr/local/bin/claude",
      "version": "2.0.0",
      "detectionMethod": "which-command"
    }
  ],
  "detectedCount": 2,
  "totalChecked": 5
}
```

**Error Responses**:
- 500: Filesystem scan failure (rare — permissions issue on a required path)

---

## 2. Proxy Configuration Snippet

### GET /api/ide/config/:ide

Generate a proxy configuration snippet for a specific IDE. The `:ide` parameter is one of: `vscode`, `cursor`, `windsurf`, `claude-code`, `jetbrains`, `generic`.

**Response** (200):
```json
{
  "ideName": "vscode",
  "displayName": "Visual Studio Code",
  "snippetType": "settings-json",
  "content": "\"http.proxy\": \"http://127.0.0.1:8787\",\n\"http.proxyStrictSSL\": false",
  "instructions": "1. Open VS Code\n2. Press Ctrl+Shift+P (Cmd+Shift+P on Mac)\n3. Type 'Preferences: Open User Settings (JSON)'\n4. Add the snippet above to your settings.json file\n5. Save and restart VS Code",
  "gatewayUrl": "http://127.0.0.1:8787",
  "note": "For GitHub Copilot specifically, also run the 'MeridianOS: Route Copilot Through Gateway' command from the VS Code command palette after installing the MeridianOS extension."
}
```

**Error Responses**:
- 400: Unknown IDE name (valid values listed in error message)
- 500: Gateway config not available (gateway not running)

---

## 3. Connectivity Test

### POST /api/ide/test/:ide

Test whether an IDE's proxy configuration is working by sending a probe request through the gateway.

**Request Body** (optional — uses default gateway URL if omitted):
```json
{
  "gatewayUrl": "http://127.0.0.1:8787"
}
```

**Response** (200):
```json
{
  "ideName": "vscode",
  "ok": true,
  "latencyMs": 127,
  "errorCode": null,
  "errorMessage": null,
  "testedAt": "2026-07-30T14:30:00.000Z"
}
```

**Response - Failure** (200 — `ok: false` is a valid result, not an HTTP error):
```json
{
  "ideName": "vscode",
  "ok": false,
  "latencyMs": null,
  "errorCode": "CONNECTION_FAILED",
  "errorMessage": "Could not reach the gateway at http://127.0.0.1:8787. Is the MeridianOS daemon running?",
  "testedAt": "2026-07-30T14:30:05.000Z"
}
```

**Error Codes**:
| Code | Meaning |
|------|---------|
| `CONNECTION_FAILED` | Gateway not reachable at the configured URL |
| `AUTH_FAILED` | Gateway reached but upstream provider auth failed |
| `TIMEOUT` | Probe exceeded 5-second timeout |
| `UNEXPECTED_RESPONSE` | Gateway returned an unexpected response |

---

## 4. IDE Traffic Status

### GET /api/ide/status

Get a summary of IDE traffic recorded in the gateway ledger.

**Query Parameters**:
- `period` (optional): `session`, `day`, `week`, `month` (default: `week`)

**Response** (200):
```json
{
  "period": "week",
  "totalCostUsd": 12.47,
  "totalTokens": 145000,
  "byIde": [
    {
      "ideName": "vscode-copilot",
      "displayName": "GitHub Copilot",
      "costUsd": 8.23,
      "tokens": 98000,
      "requestCount": 47,
      "lastSeen": "2026-07-30T14:25:00.000Z"
    },
    {
      "ideName": "claude-code",
      "displayName": "Claude Code",
      "costUsd": 4.24,
      "tokens": 47000,
      "requestCount": 12,
      "lastSeen": "2026-07-30T13:50:00.000Z"
    }
  ],
  "copilotStatus": "working",
  "copilotStatusNote": null
}
```

**Copilot Status Values**:
| Value | Meaning |
|-------|---------|
| `working` | Copilot traffic detected in ledger |
| `partial` | Some Copilot traffic detected but proxy coverage may be incomplete |
| `unavailable` | No Copilot traffic detected — proxy may not be working |
| `unknown` | Copilot monitoring not yet configured |

---

## 5. Subscription Plans

### GET /api/subscriptions

List configured subscription plans.

**Response** (200):
```json
{
  "subscriptions": [
    {
      "providerName": "anthropic-claude-pro",
      "planName": "Claude Pro",
      "mode": "subscription",
      "monthlyCostUsd": 20,
      "active": true,
      "lastVerified": "2026-07-28",
      "tokenEnv": "CLAUDE_PRO_SESSION_TOKEN",
      "usageThisMonth": {
        "tokens": 1234000,
        "costIncluded": 20.00,
        "costOverage": 0.00
      }
    }
  ],
  "apiKeys": [
    {
      "providerName": "anthropic",
      "planName": null,
      "mode": "api_key",
      "active": true,
      "usageThisMonth": {
        "tokens": 567000,
        "costUsd": 45.67
      }
    }
  ],
  "combinedMonthlyTotal": 65.67
}
```

### POST /api/subscriptions

Save a subscription plan configuration.

**Request Body**:
```json
{
  "providerName": "anthropic-claude-pro",
  "planName": "Claude Pro",
  "keyEnv": "CLAUDE_PRO_SESSION_TOKEN",
  "monthlyCostUsd": 20,
  "wire": "anthropic",
  "baseUrl": "https://api.anthropic.com",
  "legalAccepted": true
}
```

**Response** (201):
```json
{
  "ok": true,
  "message": "Subscription configured. Set the CLAUDE_PRO_SESSION_TOKEN environment variable and restart the daemon.",
  "providerName": "anthropic-claude-pro"
}
```

**Error Responses**:
- 400: `legal_accepted` is false or missing — "You must accept the legal disclaimer before saving."
- 400: Missing required fields (`providerName`, `keyEnv`)
- 409: Provider with this name already exists — use a different name or delete the existing one first

---

## 6. MCP Server Configuration

### GET /api/mcp/config

Return the MCP server configuration JSON block for copy-paste into Claude Code's `.mcp.json` or Claude Cowork's config.

**Response** (200):
```json
{
  "config": {
    "mcpServers": {
      "meridianos": {
        "command": "node",
        "args": ["mcp-server.mjs"],
        "cwd": "/path/to/meridianos-core",
        "env": {
          "MCP_DASHBOARD_URL": "http://localhost:4317"
        }
      }
    }
  },
  "instructions": "Add the above 'meridianos' entry to your .mcp.json file's 'mcpServers' object. If you already have other MCP servers configured, merge the 'meridianos' entry alongside them. Restart Claude Code after saving.",
  "prerequisites": [
    "Node.js 22+ installed",
    "MeridianOS daemon running (dashboard accessible at localhost:4317)",
    "Claude Code or Claude Cowork installed"
  ],
  "toolsAvailable": [
    "meridian_list_tasks",
    "meridian_create_task",
    "meridian_get_spend",
    "meridian_get_budget",
    "meridian_get_board_summary"
  ]
}
```

**Note**: The `cwd` field is dynamically set to the MeridianOS installation directory. The `MCP_DASHBOARD_URL` env var uses the actual dashboard port from the running config.
