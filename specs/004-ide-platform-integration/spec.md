# Feature Specification: IDE & Platform Traffic Integration

**Feature Branch**: `004-ide-platform-integration`

**Created**: 2026-07-30

**Status**: Draft

**Input**: User description: "Start P4 — Integrate All Major IDE and Platform Traffic Sources Through Automatic Proxy Configuration, a VS Code Extension Entry Point, MCP Server Integration, GitHub Copilot Monitoring, and Subscription Plan Support"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - IDE Proxy Configuration Generator (Priority: P1)

As a MeridianOS operator, I want the system to auto-detect which AI-enabled IDEs I have installed and generate the correct proxy configuration for each one, so that I can route all my IDE traffic through the gateway with a single copy-paste instead of manually researching proxy settings for every tool.

**Why this priority**: Without IDE proxy detection and config generation, operators must manually configure each IDE's proxy settings — a tedious, error-prone process that blocks all other IDE integration features. This is the foundational building block for all traffic capture.

**Independent Test**: Open the dashboard's "Connect Your IDE" page — see which IDEs are detected on the system. Copy the generated proxy snippet for VS Code, paste it into `settings.json`, and verify that Copilot traffic appears in the gateway ledger with `source='ide'`. Delivers immediate value by enabling one-click IDE proxy setup before any extension or MCP work is done.

**Acceptance Scenarios**:

1. **Given** VS Code and Claude Code are installed on the user's machine, **When** the operator navigates to the "Connect Your IDE" dashboard page, **Then** both IDEs are listed with "✓ Installed" status, and each has an expandable section showing the exact proxy configuration snippet to copy.
2. **Given** Cursor (a VS Code fork) is installed, **When** the system detects installed IDEs, **Then** Cursor is detected and receives a VS Code-compatible proxy configuration snippet.
3. **Given** an IDE's proxy snippet has been applied, **When** the operator clicks "Test Connection" for that IDE, **Then** the system sends a lightweight probe through the gateway and displays `{ ok: true, latencyMs: < 500 }` or a specific error message if connectivity fails.
4. **Given** no supported IDEs are detected on the machine, **When** the operator visits the IDE Connect page, **Then** the dashboard shows a "No IDEs Detected" message with a generic proxy configuration (HTTP_PROXY/HTTPS_PROXY environment variables) and links to manual setup documentation.
5. **Given** an IDE is detected but its proxy settings format changes in a newer version, **When** the config generator runs, **Then** it generates the config for the latest known version and includes a "Not working? Try manual setup" fallback link.

---

### User Story 2 - VS Code Extension with Sidebar, Spend Indicator, and One-Click Copilot Routing (Priority: P1)

As a developer using VS Code as my primary editor, I want a MeridianOS extension that shows my task board in the sidebar, displays my current AI spend in the status bar, and lets me route GitHub Copilot through the MeridianOS gateway with a single click, so that I never leave my editor to manage AI tasks, monitor costs, or ensure my Copilot usage is metered.

**Why this priority**: VS Code is the primary distribution entry point (22M+ monthly active users). The extension makes MeridianOS visible and actionable within the editor where developers already spend their time. Combined with P4-F1 (proxy config), it creates the "one-click setup" experience that is the product's strategic wedge.

**Independent Test**: Install the `.vsix` extension file in VS Code. The MeridianOS sidebar appears showing the task board. The status bar shows current spend. Select code in the editor, run "MeridianOS: Create Task from Selection" — a task appears on the board. Run "Route Copilot Through Gateway" — Copilot traffic routes through the gateway and appears in the ledger. Delivers standalone value as an editor-integrated MeridianOS client even without other P4 features.

**Acceptance Scenarios**:

1. **Given** the MeridianOS VS Code extension is installed and the daemon is running, **When** VS Code opens, **Then** the MeridianOS sidebar appears showing the task board grouped by status (Todo/In Progress/Review/Done) with agent avatars and priority indicators.
2. **Given** the extension is active, **When** the user looks at the VS Code status bar, **Then** a spend indicator shows current weekly spend (e.g., "$4.72 this week") with color coding: green (<50% budget), yellow (50-80%), red (>80%).
3. **Given** the user has code selected in the editor, **When** they run the "MeridianOS: Create Task from Selection" command, **Then** a task creation form opens with the title pre-filled from the selected text, and upon submission the task appears on the board.
4. **Given** the user runs the "MeridianOS: Route Copilot Through Gateway" command, **When** the command completes, **Then** VS Code's proxy settings are automatically updated, a success toast appears ("✓ GitHub Copilot now routing through MeridianOS"), and subsequent Copilot usage appears in the gateway ledger.
5. **Given** the daemon is not running when VS Code opens, **When** the extension activates, **Then** it detects the daemon is down and offers to start it with a notification. On VS Code close, it offers to stop the daemon.
6. **Given** the user clicks the spend indicator in the status bar, **When** the quick-pick opens, **Then** it shows a per-provider breakdown of spend for the current period.

---

### User Story 3 - VS Code Extension Daemon Lifecycle Management (Priority: P2)

As a developer who installed MeridianOS through the VS Code extension, I want the extension to automatically check for Node.js, download and install the MeridianOS daemon, run the setup wizard inside VS Code, and manage the daemon's start/stop lifecycle tied to my editor, so that I never need to open a terminal to set up or manage MeridianOS.

**Why this priority**: This is the "non-technical user onboarding" story. It ensures someone who only knows VS Code can get MeridianOS running without touching a terminal. It depends on P4-F2.1 (the extension shell) being built first.

**Independent Test**: On a machine with VS Code but without MeridianOS installed, install the extension. The extension checks Node.js availability, downloads the daemon package, launches the setup wizard in a Webview Panel, and starts the daemon. Close VS Code — daemon stops. Reopen VS Code — daemon starts. Delivers the complete zero-terminal onboarding experience.

**Acceptance Scenarios**:

1. **Given** the extension is installed on a machine without MeridianOS, **When** the extension activates, **Then** it checks for Node.js ≥ 22, and if missing, shows a notification with a direct download link.
2. **Given** Node.js is available, **When** the extension proceeds with setup, **Then** it downloads the MeridianOS package, launches the setup wizard inside a VS Code Webview Panel, and starts the daemon upon wizard completion.
3. **Given** the daemon is running and the user closes VS Code, **When** the editor shutdown sequence triggers, **Then** the extension prompts "Stop MeridianOS daemon?" and upon confirmation sends a graceful shutdown signal.
4. **Given** the daemon was stopped on last VS Code close, **When** VS Code reopens, **Then** the extension detects the daemon is not running, starts it automatically, and the dashboard becomes accessible within a few seconds.

---

### User Story 4 - MCP Server for Claude Cowork and Claude Code Integration (Priority: P2)

As a developer who uses Claude Code or Claude Cowork as my AI coding assistant, I want to connect Claude to MeridianOS via MCP (Model Context Protocol) so that I can ask Claude about my task board, create tasks, and check AI spend directly within my Claude conversation — without switching to the dashboard.

**Why this priority**: MCP integration makes MeridianOS a natural part of the agentic development workflow. Developers using Claude as their coding agent can interact with MeridianOS board state and budget without context-switching. This is a standalone server process, independent of IDE proxy and VS Code extension work.

**Independent Test**: Add the MCP server config to Claude Code's `.mcp.json`. Restart Claude. Type "list my MeridianOS tasks" — Claude calls `meridian_list_tasks` and returns actual board tasks. Type "what's my AI spend this week?" — Claude returns accurate spend from the dashboard API. Delivers standalone value as a natural-language interface to MeridianOS.

**Acceptance Scenarios**:

1. **Given** the MCP server is configured in Claude Code's `.mcp.json`, **When** the user asks "list my MeridianOS tasks", **Then** Claude calls the `meridian_list_tasks` tool and returns the current board tasks with status, agent, and priority.
2. **Given** the user asks Claude "create a task to refactor the auth module with high priority", **When** Claude processes this request, **Then** it calls `meridian_create_task` with the appropriate parameters and the task appears on the MeridianOS board.
3. **Given** the user asks "what's my AI spend this month?", **When** Claude calls `meridian_get_spend`, **Then** it returns total cost, total tokens, and a per-provider breakdown from the gateway ledger.
4. **Given** the user asks "am I close to my budget cap?", **When** Claude calls `meridian_get_budget`, **Then** it returns the monthly cap, current spend percentage, projected overage, and days until the cap is reached.
5. **Given** Claude's API calls are routed through the MeridianOS gateway (via `ANTHROPIC_BASE_URL` pointing to the gateway), **When** a Claude session makes API requests, **Then** those requests appear in the token events ledger with `source='ide'` and `ide_name='claude-code'`.

---

### User Story 5 - GitHub Copilot Traffic Monitoring (Priority: P3)

As a MeridianOS operator whose team uses GitHub Copilot alongside MeridianOS agents, I want Copilot's API traffic to route through the MeridianOS gateway so that Copilot usage appears in the same cost dashboard as agent traffic, giving me a unified view of all AI spend.

**Why this priority**: Copilot is the most widely used AI coding tool. Capturing its traffic in the MeridianOS ledger completes the "single pane of glass" for AI spend visibility. This depends on the proxy configuration system (P4-F1) being in place first.

**Independent Test**: Apply the VS Code proxy snippet from P4-F1. Make a Copilot chat request. Query the gateway ledger — a new token event appears with `source='ide'` and `ide_name='vscode-copilot'`. The dashboard's IDE traffic breakdown shows Copilot spend as a separate line item. Delivers value as the final piece of the IDE traffic puzzle.

**Acceptance Scenarios**:

1. **Given** the VS Code proxy is configured to route through the gateway, **When** the user makes a GitHub Copilot chat request, **Then** the gateway records a token event with `source='ide'` and `ide_name='vscode-copilot'` in the ledger.
2. **Given** Copilot traffic is flowing through the gateway, **When** the operator views the dashboard's IDE traffic panel, **Then** Copilot spend appears as a separate row in the per-IDE cost breakdown.
3. **Given** Copilot's HTTP client does not respect the configured proxy settings (a known limitation), **When** this is detected, **Then** the dashboard shows "⚠️ Partial — Copilot proxy detection limited" with a link to documentation explaining the limitation and alternative monitoring approaches.
4. **Given** request logging is enabled and Copilot traffic routes through the gateway, **When** the operator views gateway logs, **Then** a privacy notice warns that "Copilot code context is visible in gateway logs" and provides a link to disable request logging for sensitive workflows.

---

### User Story 6 - Subscription Plan Support (Priority: P3)

As a MeridianOS operator who has a Claude Pro, GitHub Copilot, or Anti-Gravity subscription, I want to route my subscription-plan traffic through the MeridianOS gateway alongside my BYO-key API traffic, so that I see a combined total of all my AI spend — subscriptions plus API usage — in one unified dashboard view.

**Why this priority**: Many developers have both subscriptions (Claude Pro, Copilot) and API keys. Providing unified cost visibility across both models is a key differentiator. This is a backend-only feature with no dependencies on other P4 stories.

**Independent Test**: Configure a Claude Pro session token in the gateway settings. Route Claude Code traffic through the gateway. The dashboard's spend overview shows "Claude Pro — Active — $20/month" alongside "Anthropic API Key — Active — $45.67 this month" with a combined total. Delivers standalone value for operators with mixed subscription + BYO-key setups.

**Acceptance Scenarios**:

1. **Given** the operator provides a Claude Pro session token in the gateway subscription settings, **When** Claude Code traffic routes through the gateway, **Then** token events are recorded with `billing_type='subscription'` and the dashboard shows the subscription plan as "Active" with its monthly cost.
2. **Given** both a subscription plan and a BYO-key are configured, **When** the operator views the spend overview, **Then** the dashboard shows subscription costs separate from API usage costs with a combined total (e.g., "$65.67 total AI spend this month ($20 subscriptions + $45.67 API)").
3. **Given** a subscription token has expired or been revoked, **When** the gateway attempts to use it, **Then** the operator receives a clear error message ("Claude Pro token expired — please re-extract and update") rather than a cryptic authentication failure.
4. **Given** the operator is setting up subscription-based routing for the first time, **When** they navigate to the subscription setup page, **Then** a legal disclaimer is displayed requiring the operator to confirm: "I confirm my subscription terms allow this usage. MeridianOS does not bypass or circumvent any provider's authentication."
5. **Given** a provider changes its authentication token storage format, **When** the documented extraction procedure no longer works, **Then** the dashboard shows a "Last verified: [date]" notice next to each subscription setup guide and a "Report broken" button that links to GitHub Issues.

---

### Edge Cases

- What happens when an IDE is installed in a non-standard location that the detector doesn't check? The system reports "Not found" for that IDE and provides a manual configuration path with generic proxy settings.
- What happens when the gateway is on a non-default port (not 8787)? The proxy config generator reads the actual port from the running gateway configuration, ensuring generated snippets always point to the correct endpoint.
- What happens when a user has both VS Code and Cursor installed — do proxy settings conflict? No — each IDE has its own settings file. The generator produces independent snippets for each.
- What happens when the MCP server process crashes mid-conversation? Claude Code detects the tool failure and reports it to the user. The operator can restart the MCP server from the dashboard.
- What happens when a subscription provider's token extraction method stops working due to an app update? The dashboard displays the "Last verified" date prominently. Operators can use the "Report broken" button to flag outdated documentation.
- What happens when Copilot's HTTP implementation changes and no longer respects proxy settings? The dashboard shows a "⚠️ Partial" status for Copilot monitoring with an explanation and alternative setup guidance.
- What happens when the VS Code extension is installed but Node.js is not available? The extension shows a clear notification with a download link rather than failing silently.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST automatically detect installed AI-enabled IDEs (VS Code, Cursor, Windsurf, Claude Code, JetBrains) on the user's machine by checking standard installation paths for each operating system.
- **FR-002**: System MUST generate correct, copy-paste-ready proxy configuration snippets for each detected IDE that route all HTTP/HTTPS traffic through the MeridianOS gateway.
- **FR-003**: System MUST provide a "Test Connection" capability that sends a lightweight probe through the configured proxy to verify end-to-end IDE-to-gateway-to-provider connectivity.
- **FR-004**: The VS Code extension MUST display the MeridianOS task board in a sidebar TreeView grouped by status (Todo, In Progress, Review, Done) with agent avatars and priority indicators.
- **FR-005**: The VS Code extension MUST show current AI spend in the status bar with color-coded budget utilization (green <50%, yellow 50-80%, red >80%), refreshing every 30 seconds.
- **FR-006**: The VS Code extension MUST provide a "Route Copilot Through Gateway" command that automatically configures VS Code's proxy settings to route GitHub Copilot traffic through the MeridianOS gateway.
- **FR-007**: The VS Code extension MUST manage the MeridianOS daemon lifecycle — detecting its running state on activation, offering to start it if stopped, and offering to stop it on VS Code close.
- **FR-008**: The VS Code extension MUST support zero-terminal onboarding: checking Node.js availability, downloading the MeridianOS package, running the setup wizard in a VS Code Webview Panel, and starting the daemon.
- **FR-009**: System MUST expose an MCP (Model Context Protocol) server over stdio that provides tools for listing board tasks, creating tasks, querying spend, checking budget status, and getting board summaries.
- **FR-010**: The MCP server MUST support filtering tasks by status, agent, category, and limit parameters on the list tool.
- **FR-011**: System MUST record Copilot traffic in the gateway ledger with `source='ide'` and `ide_name='vscode-copilot'` when proxy routing is correctly configured.
- **FR-012**: System MUST support subscription-based authentication modes (OAuth/session tokens) for Claude Pro, GitHub Copilot, and Anti-Gravity alongside existing API-key-based authentication.
- **FR-013**: System MUST classify token events by billing type (`subscription` vs `api_key`) and display combined subscription + BYO-key spend totals in the dashboard.
- **FR-014**: System MUST display a legal disclaimer during subscription setup requiring explicit user confirmation that their subscription terms permit token-based proxy usage.
- **FR-015**: System MUST show "Last verified: [date]" notices on subscription setup documentation and provide a "Report broken" mechanism for outdated extraction procedures.

### Key Entities

- **IDE Detection Record**: Represents a detected IDE on the user's machine — includes IDE name, install path, detection status (installed/not found), and the generated proxy configuration snippet.
- **IDE Proxy Configuration**: A generated settings snippet specific to an IDE type — contains the HTTP proxy URL, any IDE-specific settings keys, and instructions for applying the configuration.
- **VS Code Extension State**: The runtime state of the MeridianOS VS Code extension — includes daemon connection status, sidebar data freshness, and spend indicator last-refresh timestamp.
- **MCP Tool Definition**: A tool exposed by the MeridianOS MCP server to connected clients — includes tool name, parameter schema, description, and the dashboard API endpoint it wraps.
- **Subscription Plan Connection**: A record of a connected subscription plan — includes provider name, plan type (Pro/Copilot/Anti-Gravity), auth mode, token last-verified date, and monthly plan cost.
- **Billing Type**: A classification on token events distinguishing `subscription` traffic (flat monthly fee) from `api_key` traffic (per-token billing) for unified cost attribution.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator can configure IDE proxy routing for a detected IDE in under 2 minutes from opening the dashboard to seeing the first `source='ide'` event in the ledger.
- **SC-002**: The VS Code extension installs and displays the task board within 3 seconds of VS Code opening on a machine with the daemon already running.
- **SC-003**: The "Route Copilot Through Gateway" command completes and shows a success indicator within 5 seconds of invocation.
- **SC-004**: 100% of IDE-detectable installations (VS Code, Cursor, Windsurf, Claude Code) on Windows, macOS, and Linux are correctly identified by the auto-detection system.
- **SC-005**: The MCP server responds to tool calls within 2 seconds for standard queries (list tasks, get spend) when the dashboard API is healthy.
- **SC-006**: Operators can view combined subscription + BYO-key AI spend in a single dashboard view without manual calculation.
- **SC-007**: The zero-terminal onboarding flow (extension install → wizard completion → daemon running) completes in under 10 minutes on a machine with Node.js pre-installed.
- **SC-008**: 95% of "Test Connection" probes return results (success or specific error) within 5 seconds.

## Assumptions

- The universal gateway (Phase 1) is complete and can accept arbitrary HTTP proxy traffic from IDE sources.
- The configurability dashboard (Phase 3) is complete, providing the UI surface for IDE Connect pages, subscription setup, and settings management.
- The gateway runs on `localhost:8787` by default (configurable via policy).
- VS Code, Cursor, and Windsurf share the same proxy configuration mechanism (they are all VS Code-based).
- Claude Code supports MCP via `.mcp.json` configuration and can launch MCP servers as child processes over stdio.
- GitHub Copilot's HTTP client respects VS Code's `http.proxy` setting — if not, this limitation is documented as a known issue.
- Subscription token extraction is a manual, user-performed step — MeridianOS does not automate extraction of session tokens from provider applications.
- Node.js 22+ is the runtime requirement, consistent with the rest of the MeridianOS system.
- IDE install paths follow standard OS conventions (Windows: `%LOCALAPPDATA%`, macOS: `/Applications`, Linux: `~/.local/share`).
