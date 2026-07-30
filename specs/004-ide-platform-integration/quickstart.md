# Quickstart Validation Guide: IDE & Platform Traffic Integration

**Feature**: 004-ide-platform-integration | **Date**: 2026-07-30

This guide provides runnable validation scenarios to verify the feature works end-to-end. It does not include implementation code — see `tasks.md` for implementation details.

## Prerequisites

- Node.js 24+ installed
- MeridianOS daemon with gateway running (`node daemon-entry.mjs`)
- Dashboard accessible at `http://localhost:4317`
- (For extension tests) VS Code 1.85+ installed
- (For MCP tests) Claude Code or Claude Cowork installed
- (For Copilot tests) GitHub Copilot subscription active in VS Code

## Validation Scenarios

### VS-1: IDE Auto-Detection

**Objective**: Verify the system correctly detects installed IDEs on the current machine.

**Steps**:
1. Start the MeridianOS daemon: `node daemon-entry.mjs`
2. Open dashboard: `http://localhost:4317`
3. Navigate to "Connect Your IDE" page
4. Observe the list of detected IDEs

**Expected Result**:
- VS Code shown as "✓ Installed" (if installed) with correct install path
- Other detected IDEs (Cursor, Windsurf, Claude Code, JetBrains) shown with accurate status
- Each IDE has an expandable section with setup instructions

**Command for API-only verification**:
```powershell
Invoke-RestMethod -Uri "http://localhost:4317/api/ide/detect" | ConvertTo-Json -Depth 3
```

---

### VS-2: Proxy Config Snippet Generation

**Objective**: Verify correct proxy configuration snippets are generated for each IDE type.

**Steps**:
1. From the IDE Connect page, expand the VS Code section
2. Observe the generated proxy snippet
3. Verify the gateway URL matches the running gateway port
4. Repeat for Claude Code section (if Claude Code is detected)

**Expected Result**:
- VS Code snippet contains `"http.proxy": "http://127.0.0.1:{port}"` with the correct port
- Claude Code snippet contains `export ANTHROPIC_BASE_URL=http://127.0.0.1:{port}`
- Each snippet includes clear step-by-step instructions

**Command for API-only verification**:
```powershell
Invoke-RestMethod -Uri "http://localhost:4317/api/ide/config/vscode" | ConvertTo-Json -Depth 3
Invoke-RestMethod -Uri "http://localhost:4317/api/ide/config/claude-code" | ConvertTo-Json -Depth 3
```

---

### VS-3: Connectivity Test

**Objective**: Verify the Test Connection probe works for a configured IDE.

**Steps**:
1. Apply the VS Code proxy snippet to VS Code's `settings.json`
2. Return to the IDE Connect page
3. Click "Test Connection" for VS Code
4. Observe the result

**Expected Result**:
- Test returns `ok: true` with latency under 500ms
- If gateway is not running: returns `ok: false` with `errorCode: "CONNECTION_FAILED"`

**Command for API-only verification**:
```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:4317/api/ide/test/vscode" -Body '{}' -ContentType "application/json" | ConvertTo-Json -Depth 3
```

---

### VS-4: VS Code Extension — Sidebar and Status Bar

**Objective**: Verify the VS Code extension displays the task board and spend indicator.

**Steps**:
1. Package the extension: `cd vscode-extension && npx vsce package`
2. Install the `.vsix` in VS Code: `code --install-extension meridianos-0.1.0.vsix`
3. Start the MeridianOS daemon (if not running)
4. Open VS Code
5. Observe the MeridianOS sidebar appearing
6. Observe the spend indicator in the status bar

**Expected Result**:
- Sidebar visible with task board grouped by status
- Status bar shows spend amount with color coding
- Clicking spend indicator opens per-provider breakdown

---

### VS-5: VS Code Extension — Create Task from Selection

**Objective**: Verify task creation from editor selection.

**Steps**:
1. Open any file in the VS Code editor
2. Select some text in the file
3. Open command palette (Ctrl+Shift+P)
4. Run "MeridianOS: Create Task from Selection"
5. Fill in category and priority in the form
6. Submit

**Expected Result**:
- Task creation form opens with title pre-filled from selected text
- Upon submission, task appears on the MeridianOS board
- Task visible in both the VS Code sidebar and the dashboard

---

### VS-6: VS Code Extension — Route Copilot Through Gateway

**Objective**: Verify the one-click Copilot routing command.

**Steps**:
1. Open command palette in VS Code
2. Run "MeridianOS: Route Copilot Through Gateway"
3. Observe the success toast
4. Open VS Code `settings.json` to verify proxy settings were applied
5. Make a Copilot chat request
6. Check the gateway ledger for Copilot traffic

**Expected Result**:
- Success toast: "✓ GitHub Copilot now routing through MeridianOS"
- `settings.json` contains `http.proxy` entry
- Copilot traffic appears in ledger with `source='ide'` and `ide_name='vscode-copilot'`

**Command for ledger verification**:
```powershell
sqlite3 .ai/gateway/ledger.db "SELECT source, ide_name, provider, total_tokens FROM token_events WHERE source='ide' ORDER BY ts DESC LIMIT 5"
```

---

### VS-7: VS Code Extension — Daemon Lifecycle

**Objective**: Verify the extension manages daemon lifecycle.

**Steps**:
1. Ensure daemon is NOT running
2. Open VS Code
3. Observe the notification offering to start the daemon
4. Accept and wait for daemon to start
5. Verify dashboard is accessible
6. Close VS Code
7. Observe the prompt asking whether to stop the daemon

**Expected Result**:
- On VS Code open with no daemon: notification "MeridianOS daemon is not running. Start it?"
- On accept: daemon starts, dashboard becomes accessible
- On VS Code close: prompt "Stop MeridianOS daemon?"

---

### VS-8: MCP Server — Tool Listing

**Objective**: Verify the MCP server starts and registers all tools.

**Steps**:
1. Start the MeridianOS daemon
2. Run the MCP server manually for testing:
   ```powershell
   $env:MCP_DASHBOARD_URL = "http://localhost:4317"
   echo '{"jsonrpc":"2.0","id":0,"method":"tools/list","params":{}}' | node mcp-server.mjs
   ```
3. Observe the response listing available tools

**Expected Result**:
- Response contains 5 tools: `meridian_list_tasks`, `meridian_create_task`, `meridian_get_spend`, `meridian_get_budget`, `meridian_get_board_summary`
- Each tool has a name, description, and inputSchema

---

### VS-9: MCP Server — List Tasks

**Objective**: Verify the MCP server returns actual board tasks.

**Steps**:
1. Ensure the daemon is running with some tasks on the board
2. Run:
   ```powershell
   echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"meridian_list_tasks","arguments":{"limit":5}}}' | node mcp-server.mjs
   ```

**Expected Result**:
- Response contains task list from the board
- Each task has id, title, status fields

---

### VS-10: MCP Server — Create Task

**Objective**: Verify task creation via MCP.

**Steps**:
```powershell
$body = '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"meridian_create_task","arguments":{"title":"MCP test task","category":"test","priority":"low"}}}'
echo $body | node mcp-server.mjs
```

**Expected Result**:
- Response confirms task creation with a task ID
- Task appears on the dashboard board

---

### VS-11: MCP Server — Get Spend

**Objective**: Verify spend query via MCP.

**Steps**:
```powershell
echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"meridian_get_spend","arguments":{"period":"week"}}}' | node mcp-server.mjs
```

**Expected Result**:
- Response contains total cost, total tokens, and per-provider breakdown
- The numbers match the dashboard's spend overview

---

### VS-12: MCP Server — Error Handling

**Objective**: Verify proper error responses for invalid input.

**Steps**:
```powershell
# Missing required field
echo '{"jsonrpc":"2.0","id":99,"method":"tools/call","params":{"name":"meridian_create_task","arguments":{}}}' | node mcp-server.mjs

# Unknown tool
echo '{"jsonrpc":"2.0","id":100,"method":"tools/call","params":{"name":"nonexistent_tool","arguments":{}}}' | node mcp-server.mjs
```

**Expected Result**:
- Missing required field: error code -32602 with validation message
- Unknown tool: error code -32601 "Method not found"

---

### VS-13: Copilot Traffic Monitoring

**Objective**: Verify Copilot traffic is recorded in the gateway ledger.

**Steps**:
1. Ensure VS Code proxy is configured (from VS-6)
2. Make several Copilot chat requests in VS Code
3. Check ledger:
   ```powershell
   sqlite3 .ai/gateway/ledger.db "SELECT ts, ide_name, provider, total_tokens, cost_usd FROM token_events WHERE source='ide' ORDER BY ts DESC LIMIT 10"
   ```
4. Check dashboard IDE traffic status:
   ```powershell
   Invoke-RestMethod -Uri "http://localhost:4317/api/ide/status?period=day" | ConvertTo-Json -Depth 3
   ```

**Expected Result**:
- Ledger shows entries with `source='ide'` and `ide_name='vscode-copilot'`
- Dashboard IDE status shows Copilot as a traffic source with cost and token counts
- If Copilot doesn't respect proxy: dashboard shows `copilotStatus: "unavailable"` with a note

---

### VS-14: Subscription Plan Setup

**Objective**: Verify subscription plan configuration and combined cost display.

**Steps**:
1. Navigate to Dashboard → Subscription Setup
2. Select "Claude Pro" plan type
3. Observe the legal disclaimer and check the acceptance box
4. Enter `CLAUDE_PRO_SESSION_TOKEN` as the environment variable name
5. Set the token: `$env:CLAUDE_PRO_SESSION_TOKEN = "test-token"`
6. Save configuration
7. View the spend overview page

**Expected Result**:
- Legal disclaimer displayed before save is allowed
- Subscription appears as "Claude Pro — Active — $20/month"
- Combined total shows subscription + API key costs
- Attempting to save without accepting legal: 400 error

**Command for API verification**:
```powershell
# View subscriptions
Invoke-RestMethod -Uri "http://localhost:4317/api/subscriptions" | ConvertTo-Json -Depth 3

# Attempt save without legal (should fail)
Invoke-RestMethod -Method POST -Uri "http://localhost:4317/api/subscriptions" -Body '{"providerName":"test","keyEnv":"TEST_TOKEN","legalAccepted":false}' -ContentType "application/json"
```

---

### VS-15: Full Test Suite

**Objective**: Verify zero regressions in existing functionality.

**Steps**:
```powershell
npm test
```

**Expected Result**:
- All existing 915+ tests pass
- New test files pass (ide-proxy, mcp-server, ide-tokens, subscription-auth)
- 0 new failures, 0 new skipped tests (beyond existing 9 skipped)

---

## Manual Checklist

Use this checklist when demonstrating the feature to stakeholders:

- [ ] Dashboard "Connect Your IDE" page loads and detects installed IDEs
- [ ] Proxy config snippet for VS Code contains correct gateway URL
- [ ] "Test Connection" returns `ok: true` for a properly configured IDE
- [ ] VS Code extension sidebar shows task board
- [ ] Status bar spend indicator shows correct color (green/yellow/red)
- [ ] "Create Task from Selection" creates a task on the board
- [ ] "Route Copilot Through Gateway" updates VS Code settings
- [ ] Extension offers to start/stop daemon with VS Code lifecycle
- [ ] MCP server returns 5 tools when queried
- [ ] `meridian_list_tasks` returns actual board tasks
- [ ] `meridian_get_budget` returns accurate budget status
- [ ] Copilot traffic appears in ledger with correct source attribution
- [ ] Subscription setup shows legal disclaimer
- [ ] Combined subscription + API key spend shown in dashboard
- [ ] Full test suite passes with 0 regressions
