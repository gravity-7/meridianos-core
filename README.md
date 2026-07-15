# MeridianOS core

Provider/harness-agnostic autonomous agent-orchestration core. Tenant behavior
(agents, prompts, guardrails, board title, risk taxonomy, budget meter, default
models, agent harness, task categories) is injected via a `DomainPlugin` passed
to `createAios`/`resolvePaths` in `config.mjs` — this package contains no
product-specific defaults.

Extracted from the `propertyverdict` monorepo (`packages/aios-core/`) at source
commit `8586747`.

## Documentation

Full docs live in [`docs/`](./docs/):

- [docs/README.md](./docs/README.md) — overview + architecture (the subsystems and how they fit)
- [docs/PROVIDERS.md](./docs/PROVIDERS.md) — per-provider reference (endpoints, auth, models, pricing, quirks, doc links)
- [docs/PRICING.md](./docs/PRICING.md) — pricing source-of-truth + the `aios:pricing:refresh` mechanism
- [docs/GATEWAY.md](./docs/GATEWAY.md) — the gateway sidecar (meter → verdict → enforce, key custody, streaming)
