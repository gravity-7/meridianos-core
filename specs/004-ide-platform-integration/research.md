# Research & Decisions: IDE & Platform Traffic Integration

**Feature**: IDE & Platform Traffic Integration (004) | **Date**: 2026-07-30
**Source**: spec.md + MASTER-PLAN-CLOSE-GAPS.md + existing codebase analysis

## Research Topics

### R1: IDE Detection Strategy Across Operating Systems

**Decision**: Filesystem-based detection checking standard installation paths per OS. Use `node:fs` and `node:os` to check known paths. Return structured detection records with `installed` (boolean), `installPath` (string|null), and `version` (string|null) for each IDE. Support 5 IDE families: VS Code, Cursor, Windsurf, Claude Code, JetBrains.

**Rationale**:
- VS Code, Cursor, and Windsurf all use Electron and install to predictable paths per OS: Windows (`%LOCALAPPDATA%\Programs\Microsoft VS Code`), macOS (`/Applications/Visual Studio Code.app`), Linux (`/usr/share/code`). Cursor and Windsurf follow the same pattern with different directory names.
- Claude Code is a CLI tool — detected via `which claude` (Unix) or checking `%LOCALAPPDATA%\claude` (Windows). The npm global install path is also checked.
- JetBrains IDEs use `%APPDATA%\JetBrains` (Windows) or `~/.local/share/JetBrains` (Linux). Detection checks for the toolbox directory and enumerates installed IDE variants.
- Filesystem checks are fast (<500ms for all IDEs) and have zero network dependency. The detection runs on-demand when the dashboard's IDE Connect page loads, not at boot.
- Detection paths are configurable in `policy.yaml` under `ide_detection.paths` so operators can add custom paths or override defaults.

**Alternatives considered**:
- **Process scanning (check running processes)**: Rejected — only detects currently running IDEs, not installed ones. An operator installing MeridianOS for the first time may not have any IDE open.
- **Registry scanning (Windows)**: Rejected — not cross-platform. Filesystem paths work consistently.
- **Package manager query (winget, brew, apt)**: Rejected — requires the package manager to be the install method. Many users install IDEs via direct download.
- **Static config (operator manually lists IDEs)**: Rejected — defeats the purpose of auto-detection for non-technical users.

---

### R2: Proxy Configuration Snippet Generation

**Decision**: Template-based generation returning IDE-specific configuration snippets. Each IDE family has a template function that takes `gatewayUrl` and `token` parameters. Output is a plain-text snippet the operator copies into their IDE settings. For VS Code-based IDEs, generate `settings.json` snippet with `http.proxy`. For CLI tools (Claude Code), generate environment variable exports. Generic fallback: `HTTP_PROXY`/`HTTPS_PROXY` environment variables.

**Rationale**:
- VS Code, Cursor, Windsurf share the same settings schema — a single template serves all three with only the IDE name differing in instructions.
- Claude Code uses `ANTHROPIC_BASE_URL` and `ANTHROPIC_API_KEY` environment variables — the snippet is a shell export command.
- Generic `HTTP_PROXY`/`HTTPS_PROXY` snippet works for any tool that respects standard proxy environment variables.
- The gateway port is read from the live gateway config (`config.gateway.port`), not hardcoded to 8787. If the gateway is on a custom port, snippets automatically use the correct port.
- The "Test Connection" button works by having the dashboard send a probe request through the gateway to a known-healthy endpoint (e.g., `GET /api/health` on the gateway itself, which verifies the gateway is reachable at the configured proxy URL).

**Alternatives considered**:
- **Auto-apply (write directly to IDE settings files)**: Rejected — too invasive. IDEs may be running, settings format may vary by version, and writing to user config files without explicit consent is bad practice. Copy-paste is safer and more transparent.
- **Downloadable config files**: Rejected — adds unnecessary complexity. A copy-paste snippet is simpler and works for all IDEs.
- **IDE-specific plugins for proxy config**: Rejected — building a plugin for every IDE is unsustainable. The proxy config approach works universally.

---

### R3: VS Code Extension Architecture — Activation, Sidebar, and Daemon Lifecycle

**Decision**: Single extension with TreeView sidebar provider, StatusBarItem for spend, and a daemon-manager module for lifecycle. Extension activates on `onStartupFinished` (not `*` — avoids slowing VS Code startup). Sidebar fetches board state from `localhost:4317/api/state` every 30 seconds with incremental refresh. Status bar refreshes spend every 30 seconds. Daemon manager uses `node:child_process` to spawn/manage the MeridianOS daemon as a detached child process.

**Rationale**:
- `onStartupFinished` activation ensures the extension doesn't block VS Code's startup. The sidebar appears a moment after the editor is ready, which is acceptable UX.
- TreeView is VS Code's standard sidebar pattern — used by Git, Explorer, Extensions, etc. Operators already understand this interaction model.
- Polling at 30-second intervals is a pragmatic choice: the MeridianOS dashboard API has no WebSocket/push mechanism (by design — keeps the stack simple). 30s is frequent enough for task board updates without excessive load.
- Daemon lifecycle management via `child_process.spawn` with `detached: true` and `stdio: 'ignore'` ensures the daemon survives VS Code restart. The extension checks daemon health via `GET /api/health` on the dashboard port.
- The daemon-manager uses `which` / `where` to locate Node.js, falling back to common install paths. If Node.js is missing, it shows a VS Code notification with an OS-appropriate download link.

**Alternatives considered**:
- **Webview-based sidebar instead of TreeView**: Rejected — TreeView is native, accessible, and themable. Webview would require bundling an HTML renderer, adding complexity and potential security concerns.
- **FileSystemWatcher on state database**: Rejected — SQLite WAL mode means the file changes frequently. Parsing SQLite from the extension is unnecessary complexity. HTTP polling is simpler.
- **Extension as daemon launcher only (no sidebar)**: Rejected — misses the strategic value. The sidebar keeps MeridianOS visible and actionable within the editor.

---

### R4: MCP Server Implementation — Protocol Compliance and Tool Registration

**Decision**: Implement MCP protocol version `2024-11-05` (the current stable spec) over stdio transport using JSON-RPC 2.0 message framing. The server reads JSON-RPC requests line-by-line from stdin and writes responses to stdout. Five tools registered: `meridian_list_tasks`, `meridian_create_task`, `meridian_get_spend`, `meridian_get_budget`, `meridian_get_board_summary`. Each tool handler makes HTTP requests to the dashboard API (`localhost:4317`) and transforms responses into MCP tool result format.

**Rationale**:
- MCP over stdio is the standard transport for Claude Code integration. Claude Code launches the MCP server as a child process and communicates via stdin/stdout. No network ports needed — simpler security model.
- JSON-RPC 2.0 is the MCP protocol's message format. Each message is a single line of JSON (newline-delimited). `node:readline` provides a clean async interface for line-by-line processing.
- The MCP server is stateless — each tool call makes a fresh HTTP request to the dashboard API. This means the MCP server doesn't need its own database connection or configuration loading. It just needs the dashboard URL (default `http://localhost:4317`, configurable via `MCP_DASHBOARD_URL` env var).
- Tool parameter schemas use JSON Schema (same format as the MCP spec requires). Parameters are validated before making API calls, with clear error messages for invalid input.
- The MCP server is designed to be configured in Claude Code's `.mcp.json` or Claude Cowork's equivalent config. A setup guide in the dashboard provides the exact JSON config block to copy.

**Alternatives considered**:
- **MCP over HTTP/SSE instead of stdio**: Rejected — stdio is simpler, requires no port management, and is the primary transport Claude Code uses. Adding HTTP transport would mean managing another port.
- **Direct database access from MCP server**: Rejected — bypasses the dashboard API, creating a second access path to data. Violates the single-API-surface principle. Dashboard API already handles auth, formatting, error handling.
- **Embedding MCP server in the daemon process**: Rejected — MCP is launched by Claude Code as a child process. It needs to be a standalone executable. The daemon is a long-running process — MCP server is ephemeral (one per Claude session).

---

### R5: GitHub Copilot Proxy Behavior — Feasibility and Fallback Strategy

**Decision**: Research and document Copilot's actual proxy behavior. If Copilot respects `http.proxy` VS Code setting, traffic routes automatically when the proxy snippet is applied. If not, provide a documented workaround via OS-level proxy or acknowledge the limitation. The gateway already handles generic HTTP proxy traffic (from P1 universal gateway work) — Copilot's OpenAI-compatible API format is parsed by the existing OpenAI WireAdapter.

**Rationale**:
- GitHub Copilot uses an OpenAI-compatible API format behind the scenes. If traffic reaches the gateway, the existing OpenAI WireAdapter can parse and meter it — no new translation layer needed.
- Copilot's HTTP client implementation is not publicly documented by GitHub. The research phase (8h estimated in master plan) involves empirical testing: configure proxy → make Copilot request → inspect gateway logs.
- VS Code's `http.proxy` setting is documented to affect extensions that use VS Code's built-in HTTP client (`vscode.env.openExternal`, etc.). Whether Copilot uses this or a custom HTTP client determines proxy feasibility.
- If Copilot doesn't respect proxy settings, a system-level proxy (Windows: `netsh winhttp set proxy`, macOS: network preferences, Linux: `HTTP_PROXY` env var) is the documented fallback. The dashboard shows a status indicator: ✓ Working / ⚠️ Partial / ✗ Unavailable.
- This is explicitly marked as best-effort in the spec. The feature doesn't block on Copilot proxy support — the VS Code extension, IDE proxy generator, MCP server, and subscription support all deliver value independently.

**Alternatives considered**:
- **MITM proxy (intercept TLS)**: Rejected — requires installing a custom CA certificate, which is a security risk and terrible UX for non-technical users.
- **Copilot-specific API wrapper**: Rejected — Copilot's API is not a public, documented interface. Reverse-engineering it would be fragile and potentially violate GitHub's terms of service.
- **Skip Copilot monitoring entirely**: Rejected — Copilot is the most widely used AI coding tool. Even partial/best-effort support provides value and differentiates MeridianOS.

---

### R6: Subscription Plan Token Handling — Auth Mode, Storage, and Security

**Decision**: Extend the provider registry's `auth` configuration with a `mode: 'subscription'` option. Subscription tokens (Claude Pro session token, Copilot token, Anti-Gravity auth) are referenced via `keyEnv` like API keys — the operator sets the token as an environment variable and references it by name. The gateway uses the token as a bearer token when proxying requests for that provider. Legal disclaimer displayed in dashboard before subscription setup can be completed.

**Rationale**:
- Reusing the existing `keyEnv` pattern (from P1 multi-key system) avoids building a separate credential store. Operators already understand "set env var → reference in config."
- Subscription tokens are bearer tokens — the gateway simply forwards them as `Authorization: Bearer {token}`. No OAuth flow, no refresh token logic. This is the simplest integration that covers the use case.
- Legal disclaimer ("I confirm my subscription terms allow this usage") is a required checkbox in the dashboard before saving subscription config. This protects MeridianOS from liability while enabling the feature.
- Token expiration handling: when a proxied request returns 401/403, the gateway returns a specific error ("Subscription token expired — please re-extract and update") rather than a generic auth failure. The dashboard shows "Last verified: [date]" for each subscription.
- `billing_type` column on token_events: `'subscription'` for subscription-routed traffic, `'api_key'` for BYO-key traffic. The dashboard's spend overview groups by billing_type for combined display.

**Alternatives considered**:
- **Automated token extraction**: Rejected — (a) would need to parse provider-specific auth storage formats (brittle), (b) ethical concern — extracting tokens without explicit user action, (c) legal risk — could violate computer fraud laws. Manual token provision by the operator is the correct approach.
- **Separate subscription manager module**: Rejected — over-engineered. The provider registry already handles auth configuration. Adding a `mode` field is the minimal change.
- **OAuth flow for subscriptions**: Rejected — Claude Pro, Copilot, and Anti-Gravity don't expose OAuth endpoints for third-party token exchange. Bearer token passthrough is the only viable approach.

---

### R7: Dashboard API Design for IDE Features

**Decision**: Seven new dashboard API endpoints, all under existing path conventions:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/ide/detect` | GET | Returns list of detected IDEs with install status |
| `/api/ide/config/:ide` | GET | Returns proxy config snippet for a specific IDE |
| `/api/ide/test/:ide` | POST | Runs connectivity test for a specific IDE |
| `/api/ide/status` | GET | Returns IDE traffic summary from ledger (source='ide') |
| `/api/subscriptions` | GET | Returns configured subscription plans with status |
| `/api/subscriptions` | POST | Saves subscription configuration (with legal acceptance) |
| `/api/mcp/config` | GET | Returns MCP server configuration JSON for copy-paste |

All endpoints follow existing patterns: JSON request/response, standard HTTP status codes, error responses with `{ error: true, message: "..." }`.

**Rationale**:
- RESTful design consistent with existing dashboard API endpoints (`/api/state`, `/api/budget`, `/api/providers`).
- IDE detection is a GET because it's a pure read operation — no side effects.
- Config snippet endpoint uses path parameter `:ide` for clean REST semantics.
- Test endpoint is POST because it triggers a side effect (network probe).
- MCP config endpoint returns the exact JSON block to paste into `.mcp.json` — reduces friction for Claude Code setup.
- Subscription POST includes a `legal_accepted: true` field that must be present for the request to succeed.

**Alternatives considered**:
- **WebSocket for real-time IDE status**: Rejected — adds complexity (WebSocket server, connection management). Polling at page load + manual refresh is sufficient for IDE status which changes rarely.
- **GraphQL**: Rejected — adds a dependency. The existing REST API serves the dashboard well. Seven new endpoints is a manageable addition.

---

## Summary of Decisions

| # | Decision | Key Rationale |
|---|----------|---------------|
| R1 | Filesystem-based IDE detection with configurable paths | Fast (<500ms), cross-platform, zero network dependency |
| R2 | Template-based proxy config snippets with copy-paste UX | Safe (no filesystem writes), universal across IDEs |
| R3 | TreeView sidebar + StatusBarItem + child_process daemon manager | Native VS Code patterns, no framework dependency |
| R4 | MCP over stdio with JSON-RPC 2.0, stateless tool handlers | Standard protocol, simple security, no port management |
| R5 | Best-effort Copilot proxy with documented fallback | Honest about limitations, doesn't block other features |
| R6 | keyEnv-based subscription token passthrough with legal disclaimer | Reuses existing pattern, minimal code, protects liability |
| R7 | Seven REST endpoints following existing dashboard API conventions | Consistent, simple, no new dependencies |
