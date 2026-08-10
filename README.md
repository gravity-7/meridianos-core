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
- [docs/PROVIDERS.md](./docs/PROVIDERS.md) — the provider registry (how built-in providers are defined, how to add one)
- [docs/PRICING.md](./docs/PRICING.md) — pricing source-of-truth and how to refresh it
- [gateway/README.md](./gateway/README.md) — the gateway sidecar (meter → verdict → enforce, key custody, streaming, CLI)

### Quick Start
To boot a standalone gateway without a daemon (for BYO-agent setups), run:
```bash
node gateway/cli.mjs --port 8787 --provider anthropic
```

## Enterprise Multi-Tenant Platform

MeridianOS now includes a multi-tenant supervision and management platform that allows you to run multiple isolated projects on a single control plane. Features include:

### Core Features
- **Multi-Project Management:** Spawn and supervise multiple isolated AIOS projects
- **Authentication & RBAC:** Secure dashboard with JWT (email/password) and API keys. OAuth SSO
  routes for Azure AD/Google/GitHub exist but are not functional end-to-end yet — see
  [KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md).
- **Project Templates:** 7 pre-configured templates for common project types
- **Stripe Billing:** Subscription management, license key generation, and tier enforcement
- **Team Collaboration:** Invitations, role assignment, activity feeds, and task comments
- **Compliance Reporting:** SOC2 audit trails (real data), plus GDPR data flow maps, cost
  allocation, and model usage reports (present in the UI, currently placeholder/mocked data pending
  full wiring — see [security-audit.md](docs/security-audit.md))
- **Kubernetes Deployment:** Production-ready Helm charts with autoscaling and persistence

### Documentation
- [User Guide](docs/user-guide.md) — Getting started with the multi-tenant platform
- [API Reference](docs/multi-tenant-api.md) — Complete API documentation
- [Migration Guide](docs/migration-multi-tenant.md) — Upgrade from single-user to multi-tenant
- [Troubleshooting Guide](docs/troubleshooting-multi-tenant.md) — Common issues and solutions
- [Subscription Setup](docs/subscription-setup.md) — Billing and license configuration

### Quick Start
1. **Initialize the control plane &amp; dashboard** (one process, serves both):
   ```bash
   node dashboard/server.mjs
   ```

2. **Create your first project:**
   ```bash
   curl -X POST http://localhost:4317/api/projects \
     -H "Authorization: Bearer <your-jwt-token>" \
     -H "Content-Type: application/json" \
     -d '{"name":"My Project","template":"saas-web-app"}'
   ```

3. **Start a standalone gateway** (optional — a project's own daemon auto-starts one; run this
   yourself only for the BYO-agent/no-daemon setup above):
   ```bash
   node gateway/server.mjs
   ```

### Architecture
- **Dashboard &amp; Control Plane:** One `node:http` server — serves the web UI, the ~90 legacy
  control-plane routes, and `/api/v1/*` — manages projects, users, and billing (port **4317**,
  `AIOS_DASHBOARD_PORT`)
- **Gateway:** Handles LLM traffic and metering. No fixed default port (ephemeral unless given
  `--port`); **8787** is the conventional port used in this repo's own examples and Docker setup
- **Database:** SQLite-based control plane (`control-plane.db`) with multi-tenant isolation — each
  spawned project gets its own separate state/ledger databases
- Port **4320** is unrelated to either of the above — it's the first port `ProjectManager` hands
  out when allocating a listen port to each *spawned project* process, incrementing from there

### Security
- JWT-based authentication with 30-minute expiration
- Role-based access control (admin/operator/viewer)
- OAuth SSO routes exist for enterprise identity providers; not functional end-to-end yet (see
  [KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md))
- Rate limiting (100 requests per minute per IP; a separate, higher sliding-window limit applies to
  the public `/api/v1/*` API)
- HTTPS support with self-signed certificates

### Deployment
- **Local Development:** Run with Node.js directly
- **Docker:** Multi-stage builds for production
- **Kubernetes:** Helm charts with HPA, PVC, and TLS

For production deployment, see [Kubernetes Deployment Guide](deploy/kubernetes/README.md) and
[docs/diagrams/deployment-infrastructure.md](docs/diagrams/deployment-infrastructure.md) for the
full topology.

## Ecosystem &amp; Distribution

Beyond the web dashboard, MeridianOS ships a packaged binary with OS-native background-service
installation, an Electron desktop app, a VS Code extension, a public REST API
(`/api/v1/*`), a plugin marketplace with 6 pre-built task-intake connectors, and an optional
hybrid cloud control plane for fleet-wide telemetry aggregation across machines. See
[docs/phase-7-ecosystem-distribution.md](docs/phase-7-ecosystem-distribution.md).
