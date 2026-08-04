# Quickstart Validation Guide: Ecosystem, Distribution & Marketplace

**Feature**: Phase 7 - Ecosystem, Distribution & Marketplace
**Purpose**: End-to-end validation scenarios for all Phase 7 features

## Prerequisites

### Development Environment
- Node.js 24+ installed
- Git installed
- PowerShell (Windows) or bash (macOS/Linux)
- GitHub account (for testing cloud control plane)

### Build Tools
- Bun installed: `npm install -g bun`
- Electron installed: `npm install -g electron electron-builder`

### Testing Tools
- curl or Postman for API testing
- Webhook testing service (e.g., webhook.site)

---

## Validation Scenarios

### Scenario 1: Packaged Binary Installation

**Objective**: Verify packaged binary installs correctly and daemon runs as background service

**Steps**:

1. **Build binary**:
   ```bash
   node scripts/build.mjs
   ```
   **Expected**: Creates `dist/meridianos-win-x64.exe` (or `.dmg`/Linux binary)

2. **Run binary**:
   ```bash
   # Windows
   .\dist\meridianos-win-x64.exe
   
   # macOS
   open dist/meridianos-macos-arm64
   
   # Linux
   chmod +x dist/meridianos-linux-x64
   ./dist/meridianos-linux-x64
   ```

3. **Complete setup wizard**:
   - Anthropic API key: `sk-ant-test-key`
   - DeepSeek API key: `sk-test-key`
   - Monthly budget: `100`
   - Install as service: `Y`

4. **Verify daemon running**:
   ```bash
   # Windows
   sc query MeridianOS
   
   # macOS
   launchctl list | grep meridianos
   
   # Linux
   systemctl --user status meridianos
   ```
   **Expected**: Service shows as "RUNNING"

5. **Verify dashboard accessible**:
   ```bash
   curl http://localhost:4317
   ```
   **Expected**: Returns HTML dashboard page

6. **Verify system tray icon**:
   - Check system tray for MeridianOS icon
   - Right-click icon
   **Expected**: Menu shows "Open Dashboard", "Pause All Spend", "Status", "Quit"

7. **Test reboot persistence**:
   - Reboot machine
   - Check service status
   **Expected**: Service auto-starts, dashboard accessible

**Success Criteria**:
- ✅ Binary builds successfully
- ✅ Setup wizard completes without errors
- ✅ Daemon installed as background service
- ✅ Dashboard accessible at localhost:4317
- ✅ System tray icon appears and menu works
- ✅ Service auto-starts after reboot

---

### Scenario 2: Electron Desktop Application

**Objective**: Verify Electron app installs, stores keys in OS keychain, and auto-updates

**Steps**:

1. **Build Electron app**:
   ```bash
   cd desktop
   npm run build
   ```
   **Expected**: Creates installer in `dist/` directory

2. **Install Electron app**:
   ```bash
   # Windows
   .\dist\MeridianOS-Setup.exe
   
   # macOS
   open dist/MeridianOS-1.0.0.dmg
   
   # Linux
   chmod +x dist/meridianos-1.0.0.AppImage
   ./dist/meridianos-1.0.0.AppImage
   ```

3. **Complete GUI wizard**:
   - Enter Anthropic API key: `sk-ant-test-key`
   - Click "Next"
   - Enter DeepSeek API key: `sk-test-key`
   - Click "Next"
   - Set monthly budget: `100`
   - Click "Finish"

4. **Verify key stored in OS keychain**:
   ```bash
   # Windows (PowerShell)
   cmdkey /list | findstr MeridianOS
   
   # macOS
   security find-generic-password -s "meridianos"
   
   # Linux
   secret-tool search meridianos anthropic-api-key
   ```
   **Expected**: Key found in keychain (value not displayed)

5. **Verify daemon starts**:
   - Check Electron app window shows dashboard
   **Expected**: Dashboard loads in app window

6. **Close and reopen app**:
   - Close Electron app
   - Reopen app
   **Expected**: Daemon restarts, API keys retrieved from keychain

7. **Test auto-update** (requires GitHub release):
   - Deploy new version to GitHub Releases
   - Open Electron app
   **Expected**: Update notification appears: "Update available. Restart now?"

**Success Criteria**:
- ✅ Electron app installs successfully
- ✅ GUI wizard completes without errors
- ✅ API keys stored in OS keychain
- ✅ Daemon starts and dashboard loads
- ✅ Keys retrieved from keychain on restart
- ✅ Auto-update notification appears

---

### Scenario 3: REST API Integration

**Objective**: Verify REST API works with authentication, rate limiting, and webhooks

**Steps**:

1. **Generate API key**:
   ```bash
   curl -X POST http://localhost:4317/api/v1/api-keys \
     -H "Content-Type: application/json" \
     -d '{"name":"Test Key","scopes":"tasks:read,costs:read"}'
   ```
   **Expected**: Returns `{"id":"mk-...","name":"Test Key","scopes":"tasks:read,costs:read"}`

2. **Test authentication**:
   ```bash
   curl http://localhost:4317/api/v1/tasks
   ```
   **Expected**: Returns `401 Unauthorized`

3. **Test authenticated request**:
   ```bash
   curl http://localhost:4317/api/v1/tasks \
     -H "Authorization: Bearer mk-{apiKey}"
   ```
   **Expected**: Returns task list

4. **Test scope enforcement**:
   ```bash
   curl -X POST http://localhost:4317/api/v1/tasks \
     -H "Authorization: Bearer mk-{apiKey}" \
     -H "Content-Type: application/json" \
     -d '{"title":"Test Task"}'
   ```
   **Expected**: Returns `403 Forbidden` (key lacks `tasks:write` scope)

5. **Test rate limiting**:
   ```bash
   # Send 101 requests rapidly
   for i in {1..101}; do
     curl http://localhost:4317/api/v1/tasks \
       -H "Authorization: Bearer mk-{apiKey}" &
   done
   wait
   ```
   **Expected**: Request 101 returns `429 Too Many Requests` with `Retry-After` header

6. **Test OpenAPI docs**:
   ```bash
   curl http://localhost:4317/api/v1/openapi.yaml
   ```
   **Expected**: Returns OpenAPI 3.0 YAML specification

7. **Test Swagger UI**:
   - Open browser to `http://localhost:4317/api/v1/docs`
   **Expected**: Swagger UI loads with all endpoints

8. **Test webhook registration**:
   ```bash
   curl -X POST http://localhost:4317/api/v1/webhooks \
     -H "Authorization: Bearer mk-{apiKey}" \
     -H "Content-Type: application/json" \
     -d '{"url":"https://webhook.site/test","events":["task.created"]}'
   ```
   **Expected**: Returns webhook ID

9. **Test webhook delivery**:
   - Create a task via dashboard
   - Check webhook.site for incoming payload
   **Expected**: Webhook receives `task.created` event within 5 seconds

**Success Criteria**:
- ✅ API key generation works
- ✅ Authentication required and enforced
- ✅ Scope permissions enforced
- ✅ Rate limiting blocks excess requests
- ✅ OpenAPI spec and Swagger UI accessible
- ✅ Webhook registration works
- ✅ Webhook delivers events within 5 seconds

---

### Scenario 4: Plugin Marketplace Installation

**Objective**: Verify plugin marketplace works and Jira plugin imports tasks

**Steps**:

1. **Open dashboard**:
   - Navigate to `http://localhost:4317`
   - Click "Marketplace" tab

2. **Verify plugins listed**:
   **Expected**: Shows 6 plugins (Jira, Linear, Notion, GitHub Issues, Microsoft Teams, Generic Webhook)

3. **Install Jira plugin**:
   - Click "Install" on Jira plugin
   **Expected**: Plugin installs, shows "Configure" button

4. **Configure Jira plugin**:
   - Click "Configure"
   - Enter Jira URL: `https://test.atlassian.net`
   - Enter API token: `test-token`
   - Enter email: `test@test.com`
   - Enter project key: `TEST`
   - Click "Test Connection"
   **Expected**: Shows "Connection successful"

5. **Save configuration**:
   - Click "Save"
   **Expected**: Configuration saved, tasks imported

6. **Verify tasks imported**:
   - Navigate to "Tasks" tab
   **Expected**: Shows Jira issues as MeridianOS tasks

7. **Test webhook integration**:
   - Create/update issue in Jira
   - Check MeridianOS tasks
   **Expected**: Task updated within 60 seconds

8. **Test generic webhook plugin**:
   - Install "Generic Webhook" plugin
   - Configure field mappings
   - Send test JSON to webhook URL
   **Expected**: Task created with mapped fields

**Success Criteria**:
- ✅ Marketplace displays 6 plugins
- ✅ Plugin installation works
- ✅ Plugin configuration saves
- - ✅ Jira connection test succeeds
- ✅ Jira issues imported as tasks
- ✅ Webhook updates tasks
- ✅ Generic webhook plugin works

---

### Scenario 5: Community Plugin Development

**Objective**: Verify plugin scaffolding CLI and publishing workflow

**Steps**:

1. **Scaffold new plugin**:
   ```bash
   node cli.mjs plugin create
   ```
   - Plugin name: `custom-source`
   - Type: `intake-source`
   - Author: `Test Developer`

2. **Verify scaffold created**:
   ```bash
   ls custom-source/
   ```
   **Expected**: Shows `plugin.json`, `index.mjs`, `test.mjs`, `README.md`

3. **Implement IntakeSource contract**:
   - Edit `custom-source/index.mjs`
   - Implement `fetchTasks()`, `createTask()`, `updateTask()`, `handleWebhook()`

4. **Run tests**:
   ```bash
   cd custom-source
   node test.mjs
   ```
   **Expected**: All contract validation tests pass

5. **Publish plugin**:
   ```bash
   npm publish --access public
   ```
   **Expected**: Plugin published to npm as `@meridian-plugins/custom-source`

6. **Verify plugin in registry**:
   - Open dashboard
   - Navigate to "Marketplace" → "Community Plugins"
   **Expected**: Shows `custom-source` plugin with metadata

7. **Install from another instance**:
   - Click "Install" on `custom-source`
   **Expected**: Plugin installs and works

**Success Criteria**:
- ✅ Plugin scaffolding creates correct files
- ✅ Contract validation tests pass
- ✅ Plugin publishes to npm
- ✅ Plugin appears in community registry
- ✅ Plugin installs and works from registry

---

### Scenario 6: Hybrid Cloud Control Plane

**Objective**: Verify cloud control plane receives metadata and pushes configuration

**Steps**:

1. **Start local cloud agent**:
   ```bash
   node cloud/local-agent.mjs
   ```
   **Expected**: Agent starts, connects to cloud

2. **Verify connection in dashboard**:
   - Open local dashboard
   **Expected**: Shows "Connected to cloud control plane"

3. **Make API call locally**:
   ```bash
   curl http://localhost:4317/api/v1/tasks \
     -H "Authorization: Bearer mk-{apiKey}"
   ```

4. **Check cloud dashboard**:
   - Open cloud dashboard (e.g., `https://cloud.meridianos.com`)
   - Navigate to "Machines"
   **Expected**: Shows machine with updated metadata within 60 seconds

5. **Verify metadata privacy**:
   - Check cloud database
   **Expected**: Only anonymized metadata (tokens, costs, provider names), no API keys or content

6. **Test policy push**:
   - In cloud dashboard, update budget limit
   - Click "Push to all machines"
   - Wait 120 seconds
   - Check local `policy.yaml`
   **Expected**: Budget limit updated

7. **Test reporting interval**:
   - Edit local config: `reporting_interval: 30`
   - Restart agent
   - Make API call
   - Check cloud dashboard
   **Expected**: Metadata appears within 30 seconds

8. **Test 90-day retention**:
   - Wait 90 days (or simulate with cron trigger)
   - Check cloud database
   **Expected**: Data older than 90 days deleted

**Success Criteria**:
- ✅ Local agent connects to cloud
- ✅ Dashboard shows connection status
- ✅ Metadata appears in cloud within 60 seconds
- ✅ Only anonymized metadata stored
- ✅ Policy changes pushed and applied
- ✅ Reporting interval configurable
- ✅ 90-day data retention enforced

---

## Test Commands

### Run all tests
```bash
npm test
```

### Run specific test suites
```bash
# REST API tests
npm test -- tests/api-v1.test.mjs

# Plugin system tests
npm test -- tests/plugin-loader.test.mjs

# Cloud agent tests
npm test -- tests/cloud-agent.test.mjs

# Integration tests
npm test -- tests/integration/binary-install.test.mjs
npm test -- tests/integration/electron-app.test.mjs
npm test -- tests/integration/webhook-delivery.test.mjs
```

### Run tests with coverage
```bash
npm test -- --coverage
```

---

## Expected Outcomes Summary

| Scenario | Key Metrics |
|----------|-------------|
| Packaged Binary | Install time <5min, service auto-starts |
| Electron App | Keys stored in keychain, auto-updates work |
| REST API | Response <200ms, rate limiting enforced |
| Plugin Marketplace | Install time <3min, 6 plugins available |
| Community Plugin | Scaffold time <5min, contract tests pass |
| Cloud Control Plane | Metadata update <60s, 90-day retention |

---

## Troubleshooting

### Binary Installation Issues
- **Problem**: Service fails to start
- **Solution**: Check logs in `.ai/daemon.log`, verify permissions

### Electron App Issues
- **Problem**: Keys not stored in keychain
- **Solution**: Verify OS keychain is accessible, check Electron app permissions

### REST API Issues
- **Problem**: 401 Unauthorized
- **Solution**: Verify API key format `mk-{32 chars}`, check key is active

### Plugin Issues
- **Problem**: Plugin fails to load
- **Solution**: Check contract compliance, run `node test.mjs` in plugin directory

### Cloud Control Plane Issues
- **Problem**: Agent cannot connect
- **Solution**: Verify machine API key, check network connectivity, review cloud logs

---

## References

- [REST API Contract](contracts/rest-api-v1.md)
- [IntakeSource Plugin Contract](contracts/intake-source-plugin.md)
- [Data Model](data-model.md)
- [Research Findings](research.md)