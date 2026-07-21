# MeridianOS core

Provider/harness-agnostic autonomous agent-orchestration core with **cost governance**.
Tenant behavior is injected via a `DomainPlugin` — this package carries no product defaults.

## Quickstart: Gateway (standalone)

```sh
export DEEPSEEK_KEY=sk-...
npx meridian-gateway --port 8787 --provider deepseek --model deepseek-v4-flash
# → http://127.0.0.1:8787 — every LLM call metered, costed, enforced inline
```

Point your AI tool's base URL at the gateway. Every call is metered into the ledger.
Set caps in policy to enforce budgets. Dashboard at `localhost:4317`.

See [docs/GATEWAY.md](./docs/GATEWAY.md) for the full request lifecycle.

## Quickstart: Full MeridianOS (daemon + agents)

```sh
npm install @gravity-7/meridianos-core
# Create a DomainPlugin + policy.yaml for your tenant
node scheduler.mjs
```

## Documentation

Full docs live in [`docs/`](./docs/):

- [docs/README.md](./docs/README.md) — overview + architecture
- [docs/GATEWAY.md](./docs/GATEWAY.md) — the gateway sidecar (meter → verdict → enforce, key custody, streaming)
- [docs/PROVIDERS.md](./docs/PROVIDERS.md) — per-provider reference
- [docs/PRICING.md](./docs/PRICING.md) — pricing source-of-truth
