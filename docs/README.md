# MeridianOS Documentation

MeridianOS is a provider/harness-agnostic autonomous agent-orchestration system. At its core is a
per-project loop — intake a task, plan it, route it to a model, spawn a coding agent in an
isolated worktree, meter and enforce spend through a gateway sidecar, verify the result, and merge
it — that a single operator can run standalone. On top of that core, the project has grown a
multi-tenant control plane (auth, billing, team collaboration, compliance reporting, Kubernetes
deployment), a desktop companion app, and a VS Code extension. This page indexes the rest of
`docs/`; start with the diagrams if you want the shape of the system before the prose.

## Diagrams

All five diagrams live under [`diagrams/`](diagrams/) as Mermaid source inside the `.md` files
themselves — GitHub (and most Markdown viewers) render the fenced ` ```mermaid ` blocks natively,
so no separate image export is generated or maintained. If your viewer doesn't render Mermaid,
paste the fenced block into the [Mermaid Live Editor](https://mermaid.live).

- [high-level-architecture.md](diagrams/high-level-architecture.md) — C4 Context: MeridianOS's
  boundary, the people and external systems around it (providers, Stripe, OAuth IdPs, an optional
  cloud aggregation service).
- [component-relationships.md](diagrams/component-relationships.md) — C4 Component: what calls
  what inside the orchestration core, and separately inside the multi-tenant control plane.
- [processing-pipeline.md](diagrams/processing-pipeline.md) — one task's runtime flow end to end,
  from intake through planning, routing, execution, gateway metering, verification, and merge.
- [deployment-infrastructure.md](diagrams/deployment-infrastructure.md) — how it's actually run:
  Docker Compose, the Kubernetes Helm chart, and where desktop/IDE clients and the optional cloud
  service fit relative to those.
- [data-model.md](diagrams/data-model.md) — the SQLite databases and git-tracked config files,
  per-project and control-plane/cloud.

## Gateway &amp; providers

- [../gateway/README.md](../gateway/README.md) — the gateway sidecar: meter → verdict → enforce,
  key custody, streaming, the standalone CLI and its subcommands, and the two ways it runs
  (standalone, or auto-started by the daemon).
- [PROVIDERS.md](PROVIDERS.md) — the provider registry: what's built in, and how to add a provider
  or a wire protocol without touching core code.
- [PRICING.md](PRICING.md) — where per-model USD rates come from and how to refresh them.

## Multi-tenant platform

- [user-guide.md](user-guide.md) — feature-oriented guide for operators and team members.
- [multi-tenant-api.md](multi-tenant-api.md) — the full control-plane HTTP API reference.
- [migration-multi-tenant.md](migration-multi-tenant.md) — upgrading an existing single-user
  install to the multi-tenant platform.
- [troubleshooting-multi-tenant.md](troubleshooting-multi-tenant.md) — common issues and fixes.
- [subscription-setup.md](subscription-setup.md) — routing subscription-plan traffic (Claude Pro,
  GitHub Copilot, Anti-Gravity) through the gateway alongside BYO-key API traffic.
- [security-audit.md](security-audit.md) — the multi-tenant platform's security review, plus a
  dated addendum for issues found since.

## Configuration

- [migration-guide.md](migration-guide.md) — moving agent-roster config from the legacy
  `.ai/tenant.yaml` into the unified `policy.yaml`.

## Quality assurance

- [quality-assurance/README.md](quality-assurance/README.md) — persona journeys, safe fixture
  rules, client-ready workflow runbooks, AI-agent procedure, and release evidence model. The
  reviewed runbooks are versioned here; raw browser/CI evidence remains transient under
  `artifacts/qa/`.

## Ecosystem &amp; distribution

- [phase-7-ecosystem-distribution.md](phase-7-ecosystem-distribution.md) — the packaged binary,
  the Electron desktop app, the public REST API (`/api/v1/*`), the plugin marketplace, and the
  optional hybrid cloud control plane.
- [plugin-development.md](plugin-development.md) — writing an IntakeSource or WireAdapter plugin.

## Known issues &amp; history

- [KNOWN-ISSUES.md](KNOWN-ISSUES.md) — operator-facing gotchas that don't have a clean fix yet.
- [CHANGELOG.md](../CHANGELOG.md) — the real changelog lives at the repo root.
- `COMPLETION-PLAN.md` and `MASTER-PLAN-CLOSE-GAPS.md` are archived planning documents (see the
  banner at the top of each) — kept for provenance since every numbered spec under `specs/` cites
  one of them as its origin, but no longer a guide to current or upcoming work. Use `specs/` and
  `CHANGELOG.md` for that.
