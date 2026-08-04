# Research: Ecosystem, Distribution & Marketplace

**Feature**: Phase 7 - Ecosystem, Distribution & Marketplace
**Date**: 2026-08-03
**Status**: Complete

## Research Topics & Decisions

### 1. Bun Compile Binary Packaging

**Decision**: Use `bun compile` with `--target` for cross-platform builds

**Rationale**:
- Bun produces smallest binaries compared to pkg and nexe
- Built-in Node.js runtime embedding
- Supports SQLite native modules via better-sqlite3
- Cross-platform compilation from single machine

**Implementation Details**:
```bash
bun compile --target bun-windows-x64 --outfile dist/meridianos-win-x64.exe daemon-entry.mjs
bun compile --target bun-darwin-arm64 --outfile dist/meridianos-macos-arm64 daemon-entry.mjs
bun compile --target bun-linux-x64 --outfile dist/meridianos-linux-x64 daemon-entry.mjs
```

**Alternatives Considered**:
- `pkg` (Vercel): Larger binaries, slower compilation
- `nexe`: Less active maintenance, larger output
- `node-packer`: Experimental, limited platform support

**Risk Mitigation**: Test SQLite compatibility early on all 3 platforms; fallback to pkg if bun compile has issues

---

### 2. OS Service Registration

**Decision**: Platform-specific commands via child_process.exec

**Rationale**:
- No cross-platform npm package needed (zero-dependency philosophy)
- Native OS commands are reliable and well-documented
- Minimal code complexity

**Implementation Details**:
- **Windows**: `sc.exe create MeridianOS binPath= "{path}" start= auto`
- **macOS**: Write plist to `~/Library/LaunchAgents/com.meridianos.daemon.plist`, then `launchctl load`
- **Linux**: Write systemd unit to `~/.config/systemd/user/meridianos.service`, then `systemctl --user enable`

**Alternatives Considered**:
- `node-windows` package: Windows-only, adds dependency
- `pm2`: Overkill for single daemon, adds dependency
- `systemd-service` npm package: Linux-only

---

### 3. System Tray Icon Implementation

**Decision**: Use `systray` npm package (third exception to zero-dependency)

**Rationale**:
- No Node.js built-in for system tray access
- Cross-platform support (Windows, macOS, Linux)
- Lightweight, well-maintained
- Justified as essential desktop integration feature

**Implementation Details**:
```javascript
import Systray from 'systray';

Systray({
  menu: {
    icon: Buffer.from(iconData),
    items: [
      { title: 'Open Dashboard', tooltip: 'Open Dashboard', checked: false, enabled: true },
      { title: 'Pause All Spend', tooltip: 'Pause All Spend', checked: false, enabled: true },
      { title: 'Status', tooltip: 'Status', checked: false, enabled: true },
      { title: 'Quit', tooltip: 'Quit', checked: false, enabled: true }
    ]
  }
});
```

**Alternatives Considered**:
- `node-notifier`: Notification-focused, not tray
- Custom native modules: Too complex, maintenance burden

---

### 4. Electron App with OS Keychain Integration

**Decision**: Use Electron with `keytar` npm package for keychain access

**Rationale**:
- Electron is de facto standard for cross-platform desktop apps
- `keytar` provides unified API for Windows Credential Manager, macOS Keychain, Linux libsecret
- No Node.js built-in alternative for secure credential storage
- `electron-updater` for seamless background updates

**Implementation Details**:
- **Main process** (`desktop/main.js`): Spawns daemon, manages system tray, handles auto-updater
- **Preload script** (`desktop/preload.js`): Secure IPC bridge via `contextBridge`
- **Renderer**: Load existing `dashboard/index.html` in BrowserWindow
- **Keychain**: `keytar.setPassword('meridianos', 'anthropic-api-key', key)`

**Alternatives Considered**:
- Tauri: Rust-based, steeper learning curve
- Neutralino.js: Less mature, smaller ecosystem
- Custom native modules: Too complex, security risk

---

### 5. Electron Auto-Update Configuration

**Decision**: Use `electron-updater` with GitHub Releases

**Rationale**:
- Industry standard for Electron auto-updates
- Supports Windows, macOS, Linux
- Background download with user prompt
- Code signing support for SmartScreen/Gatekeeper

**Implementation Details**:
```javascript
import { autoUpdater } from 'electron-updater';

autoUpdater.setFeedURL({
  provider: 'github',
  owner: 'gravity-7',
  repo: 'meridianos-core'
});

autoUpdater.on('update-available', () => {
  // Show "Update available. Restart now?" dialog
});
```

**Alternatives Considered**:
- Custom update server: More control, more maintenance
- `electron-simple-updater`: Less feature-rich

---

### 6. REST API Rate Limiting

**Decision**: In-memory sliding window rate limiter using Map

**Rationale**:
- Zero external dependencies (no Redis needed for scale of 100 concurrent users)
- Simple implementation with Node.js built-ins
- Sliding window provides smooth rate limiting

**Implementation Details**:
```javascript
const rateLimits = new Map(); // apiKey -> [{timestamp, count}]

function checkRateLimit(apiKey, limit = 100, windowMs = 60000) {
  const now = Date.now();
  const requests = rateLimits.get(apiKey) || [];
  
  // Remove requests outside window
  const validRequests = requests.filter(r => now - r.timestamp < windowMs);
  
  if (validRequests.length >= limit) {
    return { allowed: false, retryAfter: Math.ceil((validRequests[0].timestamp + windowMs - now) / 1000) };
  }
  
  validRequests.push({ timestamp: now, count: validRequests.length + 1 });
  rateLimits.set(apiKey, validRequests);
  return { allowed: false, retryAfter: 0 };
}
```

**Alternatives Considered**:
- `express-rate-limit`: Adds dependency, Express-specific
- Redis-based: Overkill for current scale

---

### 7. OpenAPI 3.0 Specification

**Decision**: Manual YAML specification with Swagger UI for documentation

**Rationale**:
- OpenAPI 3.0 is industry standard
- Manual specification gives full control
- Swagger UI provides interactive documentation
- Can be served statically

**Implementation Details**:
- File: `api/openapi.yaml`
- Endpoints: `/api/v1/tasks`, `/api/v1/costs`, `/api/v1/providers`, `/api/v1/models`, `/api/v1/config`, `/api/v1/webhooks`
- Serve at `/api/v1/openapi.yaml` and `/api/v1/docs` (Swagger UI)

**Alternatives Considered**:
- `swagger-jsdoc`: Auto-generate from JSDoc, less control
- `openapi-typescript-codegen`: TypeScript-focused

---

### 8. Webhook Delivery with Exponential Backoff

**Decision**: Async queue with retry logic using setTimeout

**Rationale**:
- Simple implementation with Node.js built-ins
- Exponential backoff: 1s, 2s, 4s (max 3 retries)
- Event-driven architecture fits existing system

**Implementation Details**:
```javascript
async function deliverWebhook(url, payload, attempt = 0) {
  const maxRetries = 3;
  const initialDelay = 1000;
  const multiplier = 2;
  const maxDelay = 60000;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { success: true };
  } catch (error) {
    if (attempt >= maxRetries) return { success: false, error };
    
    const delay = Math.min(initialDelay * Math.pow(multiplier, attempt), maxDelay);
    await new Promise(resolve => setTimeout(resolve, delay));
    return deliverWebhook(url, payload, attempt + 1);
  }
}
```

**Alternatives Considered**:
- `bull` queue: Adds dependency, overkill for current scale
- `agenda`: MongoDB-based, adds dependency

---

### 9. Plugin Contract Validation

**Decision**: Runtime interface validation using duck typing

**Rationale**:
- JavaScript doesn't have compile-time interfaces
- Duck typing is idiomatic in Node.js
- Simple and flexible

**Implementation Details**:
```javascript
function validateIntakeSource(plugin) {
  const requiredMethods = ['fetchTasks', 'createTask', 'updateTask', 'handleWebhook'];
  
  for (const method of requiredMethods) {
    if (typeof plugin[method] !== 'function') {
      throw new Error(`Plugin missing required method: ${method}`);
    }
  }
  
  return true;
}
```

**Static Analysis**: Basic AST scan for dangerous patterns:
- `eval()` calls
- `require()` / `import` of non-allowed modules
- File system access outside plugin directory
- Network requests to non-configured endpoints

**Alternatives Considered**:
- TypeScript interfaces: Requires TypeScript build step
- `ajv` JSON Schema validation: Overkill for simple contracts

---

### 10. Plugin Scaffolding CLI

**Decision**: Template-based generation with inquirer-style prompts

**Rationale**:
- Simple implementation with Node.js built-ins
- Template files in `templates/plugin/`
- Interactive prompts for plugin metadata

**Implementation Details**:
```javascript
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rl = readline.createInterface({ input, output });

const pluginName = await rl.question('Plugin name: ');
const pluginType = await rl.question('Plugin type (intake-source/wire-adapter): ');
const author = await rl.question('Author: ');

// Generate plugin directory with template files
```

**Alternatives Considered**:
- `yeoman-generator`: Adds dependency, overkill
- `plop`: Adds dependency, similar complexity

---

### 11. Cloudflare Workers + D1 Architecture

**Decision**: Serverless architecture with Cloudflare Workers (compute) and D1 (SQLite database)

**Rationale**:
- Minimal operational burden
- Auto-scaling
- 90-day data retention with automatic deletion via D1 TTL
- Cost-effective for current scale (50 connected machines)

**Implementation Details**:
- **Workers**: Handle API requests, authentication, policy push
- **D1**: Store metadata (token counts, costs, provider health)
- **Cron Triggers**: Delete data older than 90 days
- **Authentication**: Per-machine API keys, distinct from provider keys

**Data Schema** (D1):
```sql
CREATE TABLE machines (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT,
  last_seen INTEGER,
  status TEXT
);

CREATE TABLE metadata (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  provider TEXT,
  model TEXT,
  tokens INTEGER,
  cost REAL,
  FOREIGN KEY (machine_id) REFERENCES machines(id)
);

CREATE INDEX idx_metadata_timestamp ON metadata(timestamp);
```

**Alternatives Considered**:
- AWS Lambda + DynamoDB: More complex, higher cost
- Vercel Edge Functions: Less mature database options
- Self-hosted: Higher operational burden

---

### 12. 90-Day Data Retention Implementation

**Decision**: D1 Cron Triggers with DELETE query

**Rationale**:
- Cloudflare D1 supports scheduled tasks
- Simple SQL DELETE with timestamp filter
- Automatic execution, no manual intervention

**Implementation Details**:
```javascript
// Cloudflare Worker cron trigger
export default {
  async scheduled(event, env, ctx) {
    const cutoffDate = Date.now() - (90 * 24 * 60 * 60 * 1000);
    await env.DB.prepare(
      'DELETE FROM metadata WHERE timestamp < ?'
    ).bind(cutoffDate).run();
  }
};
```

**Alternatives Considered**:
- Application-level cleanup: Requires running process
- TTL indexes: Not supported in D1

---

## Summary

All research topics resolved with clear decisions aligned to:
- Zero-dependency philosophy (3 justified exceptions: better-sqlite3, keytar, systray)
- ES modules and Node.js 24+
- Configuration over code
- Non-technical usability
- Test-first discipline

**Next Phase**: Generate data-model.md, contracts/, and quickstart.md