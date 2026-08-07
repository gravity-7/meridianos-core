# Gateway — standalone

The gateway is a local forward-proxy that meters and enforces spend for every agent→provider LLM
call. This package ships a **standalone CLI** (`gateway/cli.mjs`, bin name `meridian-gateway`) that
runs it as ONE command — no tenant, no daemon loop, no `DomainPlugin`.

## Quickstart

```sh
# from a checkout of this repo
node gateway/cli.mjs --port 8787 --provider deepseek --model deepseek-chat
# or, once published: npx meridian-gateway --port 8787 --provider deepseek --model deepseek-chat
```

Set the provider's key env var first (never pass a key as a flag):

```sh
export DEEPSEEK_KEY=sk-...
```

The CLI prints the bound URL, tenant, ledger path, and — because `--provider` was given — a minted
gateway token:

```
meridian-gateway listening at http://127.0.0.1:8787
tenant: default
ledger: .ai/gateway/ledger.db
default run registered: agent=cli provider=deepseek model=deepseek-chat
gateway token (send as x-gateway-token, x-api-key, or Authorization: Bearer): <token>
```

Point your agent's base URL at the printed URL and send the token on `x-gateway-token` (or
`x-api-key` / `Authorization: Bearer`, whichever your client already sends). Every request is
metered into the ledger and enforced against `policy.agent_budget` caps (`--policy path/to/policy.yaml`).

## Flags

| Flag | Default | Notes |
|---|---|---|
| `--port` | `0` (ephemeral) | |
| `--tenant` | `default` | labels every ledger event |
| `--policy` | none (empty policy) | path to a `policy.yaml` |
| `--ledger` | `.ai/gateway/ledger.db` | SQLite file |
| `--provider` | none | registers one default run; omit to boot with nothing registered |
| `--model`, `--agent`, `--token` | — | override the default run's attribution / token |

Ctrl+C shuts the sidecar down cleanly.

## The other way this runs: auto-started by the daemon

The CLI above is for BYO-agent setups with no daemon. The default, more common path is different:
`scheduler.mjs`'s `maybeStartGateway()` auto-starts this same gateway for every project unless
`policy.gateway.disabled: true` (Constitution Principle II — gateway is default-on). Every spawned
agent run then gets its spawn plan rewritten (`gateway/inject.mjs`, called from `launcher.mjs`) to
point at the gateway URL with a per-run minted token — the agent process never sees a real
provider API key, only that token. **This injection is currently scoped to the anthropic and
openai wires only** — a provider routed on `google-ai` or `generic-http` has no daemon-side
auto-injection path yet, so routing a provider on one of those wires means it bypasses gateway
metering unless you wire injection for it yourself.

## Request lifecycle

Despite the "meter → verdict → enforce" shorthand used elsewhere in this repo, the actual order
per request is: **verdict** check → **enforce** (403 + emit a token event, and stop, if denied) →
**forward** upstream → **meter** (extract usage, emit a token event, update the per-provider
circuit breaker). Streaming responses are piped to the client immediately while usage is parsed
incrementally from the SSE frames as they pass through, emitting exactly one token event at stream
end (or stream error) with whatever usage was captured by then. Cross-wire translation
(`route.translate`, e.g. serving an Anthropic-shaped request from an OpenAI-shaped upstream) is
explicitly non-streaming — a streaming request through a translate-enabled route silently drops
`stream: true` server-side.

## CLI subcommands

Beyond the bare invocation above, `gateway/cli.mjs` also has:

| Subcommand | What it does |
|---|---|
| `provider test <name>` / `add [--auto]` / `list` | conformance-test, register, or list configured providers — see [../docs/PROVIDERS.md](../docs/PROVIDERS.md) |
| `models refresh` / `list [--provider] [--tier]` | model auto-discovery |
| `pricing refresh` / `show [--provider]` | refresh/inspect the pricing catalog — see [../docs/PRICING.md](../docs/PRICING.md) |
| `profile list` | list config profiles |
| `setup [--init\|interactive] [--agents] [--providers] [--budget] [--resume] [--force]` | the CLI setup wizard — shares its planning logic with the dashboard's browser wizard at `GET /setup` |
| `project list/create/start/stop/restart/delete/health` | multi-project control-plane commands, backed by `control-plane.mjs`'s `ProjectManager` — adjacent to the gateway rather than really part of it |

## Key custody

The harness process never sees a real provider API key — only the minted gateway token above. The
real key (resolved from `keyEnv`, always an environment variable *name*, never a literal secret in
config) is looked up and injected into the outbound request entirely inside the gateway process.
