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
tenant: pv
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
| `--tenant` | `pv` | labels every ledger event |
| `--policy` | none (empty policy) | path to a `policy.yaml` |
| `--ledger` | `.ai/gateway/ledger.db` | SQLite file |
| `--provider` | none | registers one default run; omit to boot with nothing registered |
| `--model`, `--agent`, `--token` | — | override the default run's attribution / token |

Ctrl+C shuts the sidecar down cleanly. See `docs/GATEWAY.md` for the full request lifecycle,
enforcement semantics, and how this composes with the daemon.
