---
name: "meridianos-core"
description: "Comprehensive knowledge of MeridianOS core system — module map, data flow architecture, design patterns, test conventions, and common development pitfalls"
compatibility: "MeridianOS v0.3.x+"
metadata:
  author: "gravity-7"
  version: "1.0.0"
---

# MeridianOS Core Skill

## Architecture Overview

MeridianOS is a VS Code-first autonomous agent orchestrator with provider/harness-agnostic core and cost governance.
It operates as a daemon (`scheduler.mjs`) that dispatches tasks to AI agents, meters all traffic through a gateway proxy,
and presents a dashboard for cost/spend observability.

## Module Map

| Module | Purpose | Key Exports |
|--------|---------|-------------|
| `scheduler.mjs` | Main daemon loop | `start()`, cadence timer, verifier/runner dispatch |
| `config.mjs` | Policy.yaml loader | `resolveConfig()`, `resolvePaths()` |
| `state.mjs` / `state-store.mjs` | SQLite task board | `.ai/state/aios.db` CRUD |
| `bus.mjs` | Internal event bus | `emit()`, `on()` |
| `launcher.mjs` | Agent spawn orchestration | `buildSpawnPlan()`, `launch()` |
| `runner.mjs` | Agent run lifecycle | Execute task, capture output |
| `verifier.mjs` | Post-run verification | `verify()` against definition-of-ready |
| `budget.mjs` | Cost tracking & enforcement | `currentUsage()`, `checkBudget()` |
| `gateway/server.mjs` | Forward proxy with metering | Anthropic + OpenAI wire translation |
| `gateway/ledger.mjs` | Cost ledger | `.ai/gateway/ledger.db` |
| `dashboard/server.mjs` | Dashboard API (port 4317) | Budget, gateway, license endpoints |
| `escalation-push.mjs` | Webhook + Slack alerts | `push()`, `route()` |
| `azure-devops-source.mjs` | ADO bi-directional sync | Work item import/export |
| `model-router.mjs` | Model selection & fallback | Route requests by capability/cost |

## Data Flow

```
User Task → scheduler.mjs → state-store.mjs (SQLite)
  → launcher.mjs → gateway/server.mjs (meter) → LLM Provider
  → runner.mjs → verifier.mjs → state-store.mjs (update)
  → escalation-push.mjs (alerts) → dashboard/server.mjs (UI)
```

## Key Design Patterns

1. **Zero-dependency philosophy**: Only `better-sqlite3` as external dependency. All else is Node.js built-ins.
2. **ES modules throughout**: `import`/`export` syntax. File extension `.mjs`.
3. **Provider agnosticism**: Harness adapters translate between provider wire protocols.
4. **Gateway as metering proxy**: All LLM traffic routed through local forward proxy for unified cost tracking.
5. **Policy-driven configuration**: Single `policy.yaml` controls all behavior.

## Test Conventions

- Test files: `tests/*.test.mjs` and `gateway/tests/*.test.mjs`
- Run: `npm test` (uses `node --test` native test runner)
- Cassette system: `test/cassette.mjs` records/replays LLM responses
- Mock provider: `test/mock-provider.mjs`

## Common Modifications

- **Adding a new LLM provider**: Create harness adapter → register in `providers.mjs` → add wire translation in gateway
- **Adding a new agent source**: Create source module → register in `intake-registry.mjs`
- **Adding a dashboard endpoint**: Add route in `dashboard/server.mjs` → add UI in `dashboard/index.html`
- **Modifying cost logic**: Update `budget.mjs` and `pricing.mjs` together — they must stay in sync

## Pitfalls

- Scheduler leaves port 4317 occupied; kill stale process before restart
- `dashboard/index.html` is 87KB single-file SPA — split carefully
- `.ai/state/*.db` is gitignored — runtime state, never commit
- `npm publish` requires auth token in `~/.npmrc`
- Node.js 24+ required for `better-sqlite3` ABI compatibility
