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

### Core Features
- **Multi-Project Management:** Spawn and supervise multiple isolated AIOS projects
- **Authentication & RBAC:** Secure dashboard with JWT and OAuth SSO (Azure AD, Google, GitHub)
- **Project Templates:** 7 pre-configured templates for common project types
- **Stripe Billing:** Subscription management, license key generation, and tier enforcement
- **Team Collaboration:** Invitations, role assignment, activity feeds, and task comments
- **Compliance Reporting:** SOC2 audit trails, GDPR data flow maps, cost allocation, and model usage reports
- **Kubernetes Deployment:** Production-ready Helm charts with autoscaling and persistence

### Documentation
- [User Guide](docs/user-guide.md) — Getting started with the multi-tenant platform
- [API Reference](docs/api-reference.md) — Complete API documentation
- [Migration Guide](docs/migration-multi-tenant.md) — Upgrade from single-user to multi-tenant
- [Troubleshooting Guide](docs/troubleshooting-multi-tenant.md) — Common issues and solutions
- [Subscription Setup](docs/subscription-setup.md) — Billing and license configuration

### Quick Start
1. **Initialize the control plane:**
   ```bash
   node dashboard/server.mjs
   ```

2. **Create your first project:**
   ```bash
   curl -X POST http://localhost:4320/api/projects \
     -H "Authorization: Bearer <your-jwt-token>" \
     -H "Content-Type: application/json" \
     -d '{"name":"My Project","template":"saas-web-app"}'
   ```

3. **Start the gateway:**
   ```bash
   node gateway/server.mjs
   ```

### Architecture
- **Control Plane:** Manages projects, users, and billing (port 4320)
- **Gateway:** Handles LLM traffic and metering (port 8080)
- **Dashboard:** Web interface for project management (port 4320)
- **Database:** SQLite-based control plane with multi-tenant isolation

### Security
- JWT-based authentication with 30-minute expiration
- Role-based access control (admin/operator/viewer)
- OAuth SSO support for enterprise identity providers
- Rate limiting (100 requests per minute per IP)
- HTTPS support with self-signed certificates

### Deployment
- **Local Development:** Run with Node.js directly
- **Docker:** Multi-stage builds for production
- **Kubernetes:** Helm charts with HPA, PVC, and TLS

For production deployment, see [Kubernetes Deployment Guide](deploy/kubernetes/README.md).
