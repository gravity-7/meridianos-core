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

### Quick Start
To boot a standalone gateway without a daemon (for BYO-agent setups), run:
```bash
node gateway/cli.mjs --port 8080 --provider anthropic
```

## Enterprise Multi-Tenant Platform
MeridianOS now includes a multi-tenant supervision and management platform that allows you to run multiple isolated projects on a single control plane. Features include:
- **Multi-Project Management:** Spawn and supervise multiple isolated AIOS projects.
- **Authentication & RBAC:** Secure dashboard with JWT and role-based access.
- **Project Templates:** Rapidly bootstrap new environments.
- **Compliance Reporting:** Export SOC2, GDPR, and Cost Allocation reports.
- **Team Collaboration:** Invite members, assign tasks, and track activity.

For more details, see the [User Guide](docs/user-guide.md) and [API Reference](docs/api-reference.md).
