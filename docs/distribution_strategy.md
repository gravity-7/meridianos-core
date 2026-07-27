# Overcoming the Developer-Tool Bottom Line — MeridianOS Distribution Strategy

> **Context**: MeridianOS's ADR 0001 already defines three deployment levels:  
> L1 — same machine (current, dogfood)  
> L2 — container-per-tenant (sellable unit, "real production isolation")  
> L3 — hosted multi-tenant SaaS (full cloud)  
>  
> The bottom line gap isn't architectural — the architecture already anticipates all three levels.  
> **The gap is packaging and distribution.** The code is there; no one has wrapped it in a way a non-developer can open.

---

## The Five Real Paths

Each path is analyzed against MeridianOS's **specific technical constraints** — not generic advice.

| Path | Who Can Install It | Terminal Required? | Effort | Time to Ship |
|------|--------------------|-------------------|--------|--------------|
| **Path 1: VS Code Extension as Entry Point** | Any developer, many designers | ❌ No | Low | 3–4 weeks |
| **Path 2: Electron Desktop App** | Anyone who can double-click | ❌ No | High | 10–14 weeks |
| **Path 3: Packaged Binary + OS Service** | Comfortable non-devs | ⚠️ Once only | Medium | 5–7 weeks |
| **Path 4: Docker Desktop Extension** | Anyone with Docker Desktop | ❌ No | Medium | 4–6 weeks |
| **Path 5: Cloud-Hosted SaaS (L3)** | Absolute non-technical users | ❌ No | Very High | 6–12 months |

---

## Path 1: VS Code Extension as the Entry Point (The Fastest Win)

### The Insight

Plan B already schedules a VS Code extension in Phase 4. But both plans treat it as a **display layer** — it shows the board after the daemon is already running. The architectural shift is: **make the VS Code extension install and start the daemon itself**.

VS Code is not a developer-only tool anymore. Designers use it (Figma → code), writers use it (Markdown), product managers use it (draw.io, documentation). It has 22+ million monthly active users. It has its own extension marketplace with a GUI installer (click "Install"). It runs on Windows, macOS, and Linux without any terminal.

### How It Works Architecturally

```
User opens VS Code Marketplace → searches "MeridianOS" → clicks Install
     ↓
Extension activates → checks if Node.js ≥ 22 is available
     ↓ (if not) → "Node.js is required. [Install Node.js automatically]" button
     → Uses VS Code's built-in shell to run: npx -y node-installer (or downloads Node binary)
     ↓ (if yes)
Extension downloads meridianos-core package via npm (VS Code ships with npm access)
     ↓
Extension runs the wizard INSIDE VS Code — in a Webview Panel (a full HTML page inside VS Code)
     ↓
Wizard completes → extension starts the daemon as a background process using VS Code's APIs
     ↓
Extension manages the daemon lifecycle: starts on VS Code open, stops on close
     ↓
Dashboard opens in VS Code's Simple Browser panel — no external browser needed
```

### What This Requires from MeridianOS

1. **`npm publish meridianos-core`** — publish the package to npm. Currently the package exists (`package.json` is present) but is presumably not published publicly.
2. **A VS Code extension package** (`vscode-extension/`) — already planned in Plan B Phase 4.2, but needs to be scoped as the **entry point**, not just a view.
3. **The extension's `package.json` extension manifest** must declare:
   - `"activationEvents": ["onStartupFinished"]` — always activates when VS Code opens
   - A "MeridianOS" sidebar view
   - Commands: `meridian.setup`, `meridian.openDashboard`, `meridian.pause`
4. **The Webview wizard** — HTML/JS that runs in VS Code's embedded browser engine. Same technology as the dashboard — no new skills needed.

### The MeridianOS-Specific Constraint

The daemon spawns **agent harnesses** (`claude-code`, `antigravity`, `opencode`). These are **separate CLI tools** that must be installed independently. The VS Code extension can check for them and link to install pages, but cannot install them itself.

**Mitigation**: For non-technical users, the initial value is **monitoring only** — show them what they're spending on agents that technical teammates are running, or monitor their own IDE usage (Claude Code, Copilot). They don't need to run agents themselves to get value from the gateway and dashboard.

### Effort Estimate

- npm publish: 1 day
- VS Code extension shell with Webview wizard: 2–3 weeks
- Daemon lifecycle management from extension: 3–5 days
- Node.js availability check and install prompt: 3–5 days

**Total: ~3–4 weeks. This is the fastest path to non-terminal distribution.**

> [!TIP]
> **This is the recommended first move.** It's the lowest-effort path that delivers real non-terminal access, uses infrastructure VS Code already provides (GUI installer, extension marketplace, Webview, background processes), and is already planned in both audit plans. It just needs to be repositioned from "display layer" to "entry point."

---

## Path 2: Electron Desktop App (The Gold Standard)

### What It Is

An Electron app bundles:
- A specific version of Node.js (embedded)
- All of `meridianos-core`'s dependencies
- The dashboard UI (rendered in Chromium, not a browser)
- The daemon (runs as a background process inside the app)
- A native GUI installer (`.exe` with NSIS, `.dmg` with electron-builder)
- Auto-update via electron-updater

The user double-clicks `MeridianOS-Setup.exe` → installs like any Windows application → opens to a GUI wizard → done. No terminal. No Node.js. No npm. No concept of "daemon" visible to the user.

### The Architecture Inside the Electron App

```
┌─── Electron App Process ─────────────────────────────────────────────┐
│  ┌── Main Process (Node.js) ──────────────────────────────────────┐  │
│  │  meridianos-core daemon (embedded)                              │  │
│  │  meridianos gateway (embedded)                                  │  │
│  │  SQLite databases (local app data folder)                       │  │
│  │  Auto-updater                                                   │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌── Renderer Process (Chromium) ─────────────────────────────────┐  │
│  │  Setup wizard (HTML/JS)                                         │  │
│  │  Dashboard (the same dashboard/index.html, loaded locally)      │  │
│  │  System tray integration                                        │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

### The MeridianOS-Specific Hard Problems

#### Problem 1: Agent Harnesses Cannot Be Bundled
`claude-code`, `antigravity`, `opencode` are **third-party CLIs** with their own licenses, binaries, and auth systems. Electron cannot bundle them. They must be installed separately.

**Solution**: The Electron app's first-run wizard checks for each harness and shows a download link with one-click install via the OS's package manager:
- Windows: `winget install Anthropic.ClaudeCode`
- macOS: `brew install claude-code`
- Linux: `apt install claude-code` (if available) or curl script

This is a supervised install — the user still runs the installer, but the Electron app walks them through it.

#### Problem 2: Git Is Required
Worktrees need Git. Same pattern — check if Git is installed, link to `git-scm.com/download` if not.

#### Problem 3: API Keys Are Environment Variables
The current system reads API keys from `process.env`. Electron can expose a secure key storage UI using:
- **Windows**: Windows Credential Manager via `keytar`
- **macOS**: Keychain via `keytar`
- **Linux**: libsecret via `keytar`

The user pastes their API key into the Electron UI → stored in the OS keychain → the daemon reads it from keychain at startup (instead of environment variable).

This is **more secure** than the current .env file approach and **zero terminal interaction**.

#### Problem 4: Binary Size
An Electron app with embedded Node.js is typically 100–200MB. With Chromium, it can reach 300MB. Modern users accept this (Slack is 240MB, VS Code is 200MB), but it's worth flagging.

**Alternative**: Use `neutralinojs` (smaller alternative to Electron, 3–5MB) or `tauri` (Rust-based, ~10MB, uses OS WebView instead of Chromium). Both are production-ready. Tauri would be the architecturally cleanest choice for MeridianOS specifically because the backend (Node.js daemon) and frontend (WebView) can stay separated.

### What the User Sees

```
[Double-click MeridianOS.exe]
   ↓
[Windows: "Do you want to allow this app to make changes?" → Yes]
   ↓
[Installer wizard — like any Windows app]
   → "Welcome to MeridianOS"
   → "Choose install location: C:\Program Files\MeridianOS"
   → "Installing..." [progress bar]
   → "Launch MeridianOS" [checkbox]
   → Finish
   ↓
[MeridianOS opens — System tray icon appears]
   ↓
[Setup wizard opens in the app window]
   → "Which AI providers do you use?" [checkboxes]
   → "Paste your Anthropic API key" [secure password input, validated live with ✓]
   → "What's your monthly budget?" [$___]
   → "Connect your IDE" [VS Code / Cursor / Claude Code toggle]
   → "Done! Monitoring is active." [dashboard opens]
```

### Effort Estimate

- electron-builder setup + CI (GitHub Actions builds for Windows/macOS/Linux): 1 week
- Main process: embed daemon + gateway lifecycle: 1–2 weeks
- Renderer: wizard Webview (reuse existing dashboard HTML): 1 week
- OS keychain integration (keytar): 3–5 days
- System tray with pause/status: 3–5 days
- Auto-update infrastructure: 3–5 days
- Code signing (required for Windows/macOS to avoid "unknown publisher" warnings): 3–5 days
- Testing across platforms: 1 week

**Total: 10–14 weeks. The highest-quality path, but the longest.**

> [!NOTE]
> Code signing certificates cost ~$200–$500/year (Windows) and require an Apple Developer account ($99/year). These are non-trivial prerequisites. Without code signing, Windows shows a "Windows protected your PC" SmartScreen warning and macOS shows a Gatekeeper block. Both can be bypassed by the user but create immediate friction and damage trust for non-technical users.

---

## Path 3: Packaged Binary + OS Service (The Pragmatic Middle Ground)

### What It Is

Package the Node.js daemon as a standalone binary that:
1. Requires **no Node.js installation** — the runtime is embedded
2. Installs as an **OS background service** — starts automatically on login, no terminal needed after setup
3. Has a **system tray icon** for status and quick access

### Tools

| Tool | How It Works | Binary Size | Maturity |
|------|-------------|-------------|---------|
| **`pkg`** (Vercel) | Bundles Node.js + app into single exe | ~50–80MB | Stable |
| **`bun compile`** | Bun compiles to native binary | ~15–30MB | Newer, very fast |
| **`ncc`** (Vercel) | Bundles JS only (no runtime) | ~5–15MB | Stable, needs Node |
| **`nexe`** | Similar to pkg | ~50MB | Less maintained |

**Recommended**: `bun compile` — produces the smallest binaries, fastest startup, and Bun is compatible with most Node.js APIs that MeridianOS uses.

### OS Service Installation

After the binary is built, it needs to be registered as a background service:

| Platform | Service System | Tool |
|----------|---------------|------|
| Windows | Task Scheduler or Windows Service | Replace `register-conductor.ps1` with Node equivalent |
| macOS | launchd plist | Write to `~/Library/LaunchAgents/` |
| Linux | systemd unit | Write to `~/.config/systemd/user/` |

Plan A already identifies `register-conductor.ps1` as Windows-only (gap P0-D3). This path requires exactly that fix — and extends it to write OS service registrations on all platforms.

### What the User Experience Looks Like

```
[User downloads meridianOS-v1.0.0-windows.exe from website]
   ↓
[Runs the .exe — UAC prompt on Windows]
   ↓
[A simple wizard runs in the console — just 4 questions]
   → "Anthropic API key? (paste and press Enter):"  ***[hidden input]***
   → "Monthly budget limit? $"  50
   → "Install as a background service? [Y/n]"  Y
   → "Done. Dashboard at http://localhost:4317"
   ↓
[Service is registered — starts now and on every login]
   ↓
[System tray icon appears: "MeridianOS — Active"]
   ↓
[User opens browser to localhost:4317 — dashboard available]
```

After this first setup, the user **never touches the terminal again**. The service runs silently in the background. The tray icon shows status. The browser dashboard is their interface.

### The MeridianOS-Specific Issue

`bun compile` embeds the entire application but **SQLite native modules** may not compile cleanly to a single binary on all platforms. MeridianOS uses `node:sqlite` (Node.js built-in, available since Node 22.5) — this is actually an advantage because it's not a native addon (no `node-gyp` compilation required). Packaging should work cleanly.

### Effort Estimate

- Build script (`bun compile` or `pkg`) + cross-compilation CI: 1 week
- Cross-platform service registration (`scripts/register-conductor.mjs`): 1 week (Plan A already scopes this as P0-D3)
- System tray icon (using `systray` npm package): 3–5 days
- 4-question setup wizard (embedded in the binary): 3–5 days
- Download page on website with platform detection: 3–5 days

**Total: 5–7 weeks. The best balance of effort, quality, and coverage.**

---

## Path 4: Docker Desktop Extension (The DevOps-Adjacent Path)

### What It Is

Docker Desktop has an extension marketplace with a GUI. A Docker Desktop Extension is:
- A Docker Compose stack (MeridianOS gateway + daemon containers)
- A frontend (HTML/JS) rendered inside Docker Desktop's GUI
- A backend API that manages the containers

The user opens Docker Desktop → Extension Marketplace → searches "MeridianOS" → clicks Install → a configuration form appears → clicks "Start" → dashboard opens.

### Who This Reaches

Docker Desktop is not a developer-only tool anymore. It's used by:
- Data scientists (running Jupyter)
- DevOps engineers (testing deployments)
- Startup technical co-founders (not software engineers)
- IT administrators

More importantly, it's **already installed** on many machines alongside VS Code, often by IT policy. For users who already have Docker Desktop, this is a near-zero-friction distribution path.

### How It Maps to MeridianOS's Existing Docker Setup

MeridianOS already has a `Dockerfile` and `docker-compose.yml`. The Docker Desktop extension would:
1. Wrap the existing `docker-compose.yml` in the extension format
2. Add a configuration UI (in Docker Desktop's sidebar) for API keys, budget, and provider selection
3. Expose the dashboard through Docker Desktop's built-in port forwarding

This is the **closest to zero new code** of any path — the Docker infrastructure is 80% there.

### What the User Sees

```
[Docker Desktop → Extensions → MeridianOS → Install]
   ↓
[MeridianOS tab appears in Docker Desktop sidebar]
   ↓
[Configuration form]
   → API Key: [text field]
   → Monthly Budget: $[number]
   → Providers: [checkboxes]
   → [Start MeridianOS] button
   ↓
[Containers start — status shows "Running"]
   → [Open Dashboard] link → browser opens to localhost:4317
```

### Limitation

The agent harnesses (claude-code, antigravity, opencode) run **outside** the Docker containers — they run on the host machine. The gateway in the Docker container intercepts their traffic via `localhost:8787`. This works because the containers use `network_mode: host` on Linux, and Docker Desktop's host networking on Windows/macOS.

**This architecture already exists** in the current `docker-compose.yml` and `Dockerfile`. The extension just adds a GUI front-end to start/stop it.

### Effort Estimate

- Docker Desktop extension structure + manifest: 3–5 days
- Configuration UI (simple HTML form inside extension): 1 week
- Environment variable passing from UI to containers: 3–5 days
- Publication to Docker Desktop extension marketplace: 1 week (approval process)

**Total: 4–6 weeks, but limited to users who have Docker Desktop installed.**

---

## Path 5: Cloud-Hosted SaaS — The L3 Vision (ADR 0001)

### What It Is

ADR 0001 explicitly defines L3: "separate hosts/cloud + control plane." Users create an account at `app.meridianos.com`, connect their API keys through a web UI, and the gateway runs **in the cloud** — routing their IDE traffic through a cloud proxy instead of a local one.

### The Fundamental Security Trade-off

The current BYOK model's core promise is: **"Your API keys never leave your machine."** Cloud hosting breaks this promise.

**Three possible architectures to preserve the promise:**

#### Architecture A: Cloud Control Plane, Local Gateway
```
User's machine:
  └── MeridianOS Gateway (local, tiny binary)
          ↓ reports metering data
Cloud:
  └── MeridianOS Control Plane (dashboard, analytics, billing)
          ↓ pushes policy
  └── MeridianOS Gateway receives config from cloud but keys stay local
```
**Keys never leave the machine. Cloud only sees metadata (token counts, costs, providers used — not actual content or keys).**

This is the right architecture for privacy-conscious enterprise users. The user installs a small local binary (similar to Path 3) that phones home to the cloud for configuration and reporting. Think: Cloudflare Tunnel, Tailscale, or Datadog Agent.

#### Architecture B: Full Cloud (Keys in Cloud)
```
Cloud:
  └── MeridianOS Gateway (cloud-hosted, manages multiple users)
  └── API keys stored encrypted in cloud vault (HashiCorp Vault, AWS Secrets Manager)
  └── Dashboard (web app)
  └── All traffic proxied through cloud gateway
```
**Pros**: Zero install for end users. Works from any device. Full SaaS model.  
**Cons**: Users must trust MeridianOS with their API keys. Requires SOC2 compliance, data residency compliance, breach liability. This is a business and legal decision, not just technical.

#### Architecture C: Client-Side Encryption (BYOK in Cloud)
Keys are encrypted **client-side** (in the user's browser) before being sent to the cloud. The cloud stores the encrypted blob but cannot decrypt it — only the user's browser can.

This is the architecture used by 1Password, Bitwarden, and similar tools. Technically complex but preserves the security promise.

### Effort Estimate

- Architecture A (hybrid): 3–5 months (preferred)
- Architecture B (full cloud): 6–12 months + legal/compliance overhead
- Architecture C (client-side encryption): 8–14 months

> [!WARNING]
> **Cloud SaaS is not a quick fix for the non-technical user problem. It's a 6–12 month product initiative.** It should be planned alongside the other paths, not instead of them. The recommended approach is: Path 1 (VS Code Extension) immediately, Path 3 (Packaged Binary) in parallel, Path 5 Architecture A (hybrid cloud) as the long-term product evolution.

---

## The Agent Harness Problem — The Hidden Dependency That No Path Solves Fully

Every distribution path encounters the same wall: **MeridianOS can be installed without a terminal, but the agent harnesses that do the actual work (`claude-code`, `antigravity`, `opencode`) cannot.**

These are third-party CLIs that:
- Have their own installers
- Have their own authentication (separate from the API keys MeridianOS manages)
- Have their own update cycles
- Cannot be bundled in a binary (licensing, size, update frequency)

**This means there's a ceiling on non-technical usability for the full autonomous agent loop.**

However: **a non-technical user can get significant value from MeridianOS even without running agents**:

```
Use case 1: "I use Claude Code interactively. Show me what I'm spending."
  → Requires: MeridianOS gateway + VS Code extension
  → Does NOT require: Running autonomous agents

Use case 2: "My dev team runs agents. I want to see the cost dashboard."
  → Requires: MeridianOS dashboard (remote access)
  → Does NOT require: Installing anything on the non-tech user's machine

Use case 3: "I use GitHub Copilot. Show me what it costs per week."
  → Requires: VS Code extension + Copilot proxy config
  → Does NOT require: Any agent harnesses
```

> [!IMPORTANT]
> **The non-technical user's value is as a consumer of data, not as an operator of agents.** Reframe the product: non-technical users use the **dashboard and alerts**; technical users install and run the agents. This is the same split in any SaaS tool (Datadog: DevOps installs the agent, executives view the dashboards).

This reframing means the non-technical distribution problem has a **much shorter path**:

1. Technical user (developer) installs MeridianOS locally via Path 3 (packaged binary)
2. Enables remote access (Plan B Phase 6 / Plan A Phase 8)
3. Shares the dashboard URL with their non-technical manager/founder
4. Non-technical user bookmarks the URL, views spend on their phone

No distribution problem. No installer. The non-tech user never touches MeridianOS directly.

---

## Recommended Execution Sequence

```
Week 1-3:   Path 1 — VS Code Extension as entry point
            └── npm publish meridianos-core
            └── Extension with Webview wizard
            └── Daemon lifecycle management from extension
            └── IMMEDIATE: technical users can install without terminal

Week 4-10:  Path 3 — Packaged binary + OS service (parallel with other work)
            └── bun compile → .exe, .dmg, Linux binary
            └── OS service registration (replaces register-conductor.ps1)
            └── System tray icon
            └── Download page with platform detection
            └── REACH: technical-adjacent users can install

Week 6-10:  Remote Dashboard Access (Plan B Phase 6)
            └── Authentication + HTTPS
            └── IMMEDIATE IMPACT: non-technical users can VIEW dashboards
            └── No install required for viewers

Month 3-6:  Path 5 Architecture A — Cloud Control Plane
            └── Light local binary phones home for config and reporting
            └── Zero terminal for end-users in orgs where IT deploys the binary
            └── Centralized dashboard for managers/founders

Month 6-12: Path 5 Architecture B — Full Cloud SaaS (optional)
            └── Requires SOC2, legal review, key custody decision
            └── Maximum addressable market but maximum complexity
```

---

## One-Line Answers to the Bottom Line

| "How do non-technical users access it?" | Via a shared dashboard URL after a technical user installs it |
|---|---|
| **"What if there's no technical user?"** | VS Code Extension (3–4 weeks to ship) |
| **"What if they don't use VS Code?"** | Packaged binary installer (5–7 weeks to ship) |
| **"What about zero-install, any device?"** | Cloud Control Plane (3–5 months, Architecture A) |
| **"What about the safest path first?"** | Remote dashboard access — no new distribution needed, just HTTPS + auth |

---

*The bottom line is not a fundamental architectural limitation. It is a packaging and distribution gap that can be closed in phases, starting with the VS Code Extension as the fastest credible path to non-terminal installation.*
