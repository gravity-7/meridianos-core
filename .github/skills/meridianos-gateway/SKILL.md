---
name: "meridianos-gateway"
description: "MeridianOS Gateway internals — forward proxy architecture, wire protocol translation, injection layer, ledger schema"
---

# MeridianOS Gateway Skill

## Architecture Overview

The gateway is a Node.js forward proxy that sits between AI agents and LLM providers.
It intercepts API calls, translates between wire protocols (Anthropic ↔ OpenAI),
meters token usage, and records costs in a SQLite ledger.

## Key Files

| File | Purpose |
|------|---------|
| `gateway/server.mjs` | HTTP server — request forwarding, wire translation, metering |
| `gateway/inject.mjs` | Agent configuration injection — rewrites agent configs to route through gateway |
| `gateway/ledger.mjs` | Cost ledger queries — `queryWindow()`, `listEvents()` |
| `gateway/ledger-schema.sql` | SQLite schema for `token_events` table |
| `gateway/token-event.mjs` | Token event creation and validation |
| `gateway/cli.mjs` | Standalone gateway CLI entry point |
| `gateway/index.mjs` | Gateway assembly and lifecycle |
| `gateway/windows.mjs` | Budget window calculations — `null` = no cap, `0` = hard block |
| `gateway/provider-registry.mjs` | Provider registration and lookup |
| `gateway/registry-pull.mjs` | Dynamic provider registry updates |
| `gateway/registry-source.mjs` | Registry data source abstraction |
| `gateway/run-registry.mjs` | Runtime provider registry |

## Wire Protocol Translation

The gateway translates between:
- **Anthropic Wire**: `/v1/messages` — Messages API with Claude-specific format
- **OpenAI Wire**: `/v1/chat/completions` — Chat Completions API

Translation happens in `buildForwardHeaders()` and request body rewriting in `gateway/server.mjs`.

## Injection Layer

`gateway/inject.mjs` rewrites agent configuration files to force all API traffic through the gateway:
- For Anthropic agents: Rewrites `claude.json` base URL and API key
- For OpenAI agents: Rewrites `opencode.json` base URL and API key
- Injection is opt-out: `gateway.disabled: true` in policy

## Ledger Schema

```sql
CREATE TABLE token_events (
  id INTEGER PRIMARY KEY,
  ts TEXT DEFAULT (datetime('now')),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  cost_usd REAL,
  source TEXT DEFAULT 'agent',
  agent_id TEXT,
  task_id TEXT
);
```

## Common Modifications

- **Adding a new wire protocol**: Add translation case in `gateway/server.mjs` + injection in `gateway/inject.mjs`
- **Adding cost dimensions**: Update `token-event.mjs` + `ledger-schema.sql` (migration)
- **Changing budget windows**: Update `gateway/windows.mjs`
