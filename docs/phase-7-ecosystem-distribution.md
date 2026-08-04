# Phase 7: Ecosystem, Distribution & Marketplace

Phase 7 turns MeridianOS from a developer tool into a broadly accessible product: packaged
binaries and an Electron desktop app for non-technical users, a public REST API for third-party
integrations, a plugin marketplace with 6 pre-built connectors and a community publishing
workflow, and a hybrid cloud control plane for multi-machine enterprise management.

See [spec.md](../specs/007-ecosystem-distribution/spec.md) for the full feature specification and
[plan.md](../specs/007-ecosystem-distribution/plan.md) for the technical design.

## Overview

| User Story | What it delivers | Key files |
|---|---|---|
| US1 — Packaged Binary | `bun compile` standalone executable, console setup wizard, OS service registration, system tray | `scripts/build.mjs`, `scripts/setup-wizard-minimal.mjs`, `scripts/install-service.mjs`, `daemon-entry.mjs`, `tray-status.mjs`, `tray-icons.mjs` |
| US2 — Electron Desktop App | GUI wizard, OS keychain credential storage, auto-updates | `desktop/main.js`, `desktop/preload.js`, `desktop/renderer/`, `desktop/keychain.mjs`, `desktop/daemon-manager.mjs` |
| US3 — Public REST API | Scoped `mk-` API keys, rate limiting, webhooks, OpenAPI spec + Swagger UI | `api/v1/*.mjs`, `api/rate-limiter.mjs`, `api/webhooks.mjs`, `auth/api-tokens.mjs` |
| US4 — Plugin Marketplace | 6 pre-built connectors, install/configure/test UI | `intake-adapters/*.mjs`, `plugin-loader.mjs`, `plugin-registry.mjs`, `dashboard/static/marketplace-panel.mjs` |
| US5 — Community Plugins | Scaffolding CLI, publishing workflow, ratings | `plugin-scaffold.mjs`, `cli.mjs`, `templates/plugin/`, `dashboard/static/community-plugins.mjs` |
| US6 — Cloud Control Plane | Multi-machine metadata reporting, policy push, aggregate analytics | `cloud/local-agent.mjs`, `cloud/cloud-control-plane.mjs`, `cloud/cloud-server.mjs`, `cloud/dashboard/` |

## Installation

### Packaged binary (non-technical users)

```bash
node scripts/build.mjs               # builds for the current OS; see the file for cross-compile flags
```

Run the resulting binary — it launches a 4-question console wizard (Anthropic API key, DeepSeek
API key, monthly budget, install as background service?), then installs MeridianOS as a real OS
service (Windows Service via `sc.exe`, macOS launchd, or Linux systemd) and starts the dashboard
at `http://localhost:4317` with a system tray icon.

### Electron desktop app

```bash
cd desktop && npm run build           # electron-builder — produces an installer per OS
```

The GUI wizard stores API keys in the OS keychain (Windows Credential Manager / macOS Keychain /
Linux libsecret via `keytar`) rather than a plaintext file, and the app auto-updates via
`electron-updater` against GitHub Releases.

## Using the REST API

```bash
# Generate a scoped API key (requires the dashboard's own per-boot token — see the dashboard page source)
curl -X POST http://localhost:4317/api/v1/api-keys \
  -H "x-aios-token: <token from the dashboard page>" \
  -d '{"name":"my-integration","scopes":["tasks:read","costs:read"]}'

# Use it
curl http://localhost:4317/api/v1/tasks -H "Authorization: Bearer mk-{key}"
```

Full endpoint reference: `http://localhost:4317/api/v1/docs` (Swagger UI) or
[contracts/rest-api-v1.md](../specs/007-ecosystem-distribution/contracts/rest-api-v1.md).

## Plugin marketplace

Open the dashboard → "Marketplace" tab to browse and install Jira, Linear, Notion, GitHub Issues,
Microsoft Teams, and Generic Webhook connectors. See
[docs/plugin-development.md](plugin-development.md) to build and publish your own.

## Hybrid cloud control plane

```bash
node cloud/local-agent.mjs   # requires AIOS_CLOUD_URL and AIOS_CLOUD_MACHINE_KEY env vars
```

Reports anonymized usage metadata (token counts, costs, provider health — never API keys or
prompt/response content) to a cloud control plane every 30-300 seconds (configurable), and applies
any policy changes an operator pushes down. See
[data-model.md](../specs/007-ecosystem-distribution/data-model.md) for the full privacy model.

## Troubleshooting

| Symptom | Where to look |
|---|---|
| Service fails to start | `.ai/logs/daemon.log` (all Phase 7 components log here via `daemon-logger.mjs`) |
| Electron app can't reach OS keychain | Check `keytar` is installed for your platform's keychain backend (libsecret on Linux) |
| `401 Unauthorized` from the REST API | Confirm the key is `mk-{32 hex chars}` and still active (`GET /api/v1/api-keys` with the dashboard token) |
| Plugin fails to load | Run `node <plugin-dir>/test.mjs`; check for static-analysis rejections (`eval`, `child_process`, `fs`, `process.env`) |
| Cloud agent shows "not connected" | Check `.ai/cloud-agent-status.json` and the agent's own log output for `lastError` |

## Testing

```bash
npm test -- tests/integration/binary-install.test.mjs      # US1
npm test -- tests/integration/electron-app.test.mjs        # US2
npm test -- tests/api-v1.test.mjs tests/integration/webhook-delivery.test.mjs  # US3
npm test -- tests/plugin-loader.test.mjs                   # US4 + US5
npm test -- tests/cloud-agent.test.mjs                      # US6
```

Or the whole suite: `npm test`.
