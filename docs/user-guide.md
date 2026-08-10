# MeridianOS Multi-Tenant Platform — User Guide

This is the feature-oriented guide for operators and team members using the multi-tenant
platform day to day. It covers what each feature does and how to use it from the Dashboard.

For API details see [`multi-tenant-api.md`](multi-tenant-api.md); for upgrading an existing
single-user install see [`migration-multi-tenant.md`](migration-multi-tenant.md); if something
isn't working see [`troubleshooting-multi-tenant.md`](troubleshooting-multi-tenant.md).

## Contents

- [Getting started](#getting-started)
- [Unified first-run setup](#unified-first-run-setup)
- [Managing projects](#managing-projects)
- [Project templates](#project-templates)
- [Accounts, roles, and authentication](#accounts-roles-and-authentication)
- [Team collaboration](#team-collaboration)
- [Billing and license tiers](#billing-and-license-tiers)
- [Kubernetes deployment](#kubernetes-deployment)
- [Compliance and reporting](#compliance-and-reporting)
- [Live configuration (hot-reload)](#live-configuration-hot-reload)
- [Backup and restore](#backup-and-restore)
- [Usage telemetry (opt-in)](#usage-telemetry-opt-in)

## Getting started

The Dashboard is the control surface for everything below. By default it binds to
`127.0.0.1` (loopback only); for remote access, configure HTTPS and authentication first — see
the **Accounts, roles, and authentication** section and `troubleshooting-multi-tenant.md` for TLS
setup. Every `/api/*` request requires a Bearer JWT (from logging in) or an API key.

## Unified first-run setup

Open `/app/setup` for a guided first-run configuration. The stepper records only the installation
name, agent roster, chosen provider, budget, and a sanitized validation outcome, so it can resume
after a refresh without retaining a provider credential. A refresh or Back to the provider step
always requires entering the credential again.

The browser sends a credential only to the local, authenticated provider-validation/final-commit
boundary. It is never placed in browser storage, a URL, the review, telemetry, or an error. On an
explicit successful browser commit MeridianOS writes the environment secret file with restrictive
permissions where the host supports them. The review names files and settings but never displays
their secret contents.

If validation is invalid, unreachable, or timed out, correct the credential/network issue and
retry; the non-secret choices remain available. If storage is unavailable, complete the current
session normally but do not expect resume after closing the browser. An existing `.ai` setup or
`.env` is never overwritten: `/app/setup` displays a recovery state and the existing Dashboard
and legacy `/setup` remain available during the compatibility release.

The Electron application renders the same `/app/setup` steps. Its credential crosses only the
context-isolated onboarding bridge into the OS keychain; Electron never writes a `.env` fallback.
If the keychain is locked or unavailable, unlock/configure it and retry—do not copy the secret into
the browser draft. The previous Electron wizard remains available for one release by starting the
desktop app with `MERIDIANOS_LEGACY_SETUP=1`.

After commit, `/app/setup/complete` provides a stable handoff to the existing task workspace. The
run link is intentionally unavailable until that first task has created a run.

## Managing projects

A **project** is an isolated MeridianOS environment — its own agents, its own state database, its
own configuration, and its own worktree. Projects never share mutable state with each other.

1. Click **Create Project** in the Dashboard.
2. Choose a **Template** (see below) or start from **Blank**.
3. The platform provisions the project's workspace, applies the template's agent roster and task
   categories, and creates its `policy.yaml`.
4. Click **Start** to launch the project's agents; **Stop** to shut them down gracefully;
   **Restart** to cycle it.

Each project reports its own health (`healthy` / `degraded` / `down`) based on an HTTP heartbeat
plus resource metrics (CPU, memory). A crashed project auto-restarts, rate-limited to 3 restarts
per hour to avoid a crash-loop from silently burning resources — after that it's marked `error`
and needs a manual restart once the underlying issue is fixed.

## Project templates

Templates are pre-built agent rosters + task-category sets for common project shapes:

| Template | Agents | Use case |
|---|---|---|
| `saas-web-app` | Builder, reviewer, designer | Full-stack SaaS product |
| `mobile-app` | React Native builder/reviewer/designer | Mobile apps |
| `cli-tool` | Node.js builder/reviewer | Command-line tools |
| `library-sdk` | TypeScript builder/reviewer | Publishable libraries |
| `documentation-site` | Markdown/MDX writer/reviewer | Docs sites |
| `data-pipeline` | Python/ETL builder/reviewer | Data/ETL pipelines |
| `blank` | One agent, minimal categories | Anything else — start minimal and customize |

Browse them under **Templates** in the Dashboard, or `GET /api/projects/templates` for the full
list with agent/category counts.

## Accounts, roles, and authentication

Three roles govern what a signed-in user can do:

- **admin** — full control: users, billing, all projects.
- **operator** — manage projects and tasks, cannot manage users or billing.
- **viewer** — read-only.

Sign in with email/password to get a JWT (expires after 30 minutes of inactivity; the Dashboard
refreshes it automatically while you're active). For automation (CI, scripts), generate an **API
key** scoped to a role instead of using a personal login.

Single sign-on (Azure AD, Google Workspace, GitHub OAuth) has UI and route stubs under
**Settings → SSO**, but the authorize→callback flow is not functional end-to-end yet (see
[KNOWN-ISSUES.md](KNOWN-ISSUES.md)) — use email/password or an API key for now.

## Team collaboration

1. Open a project's **Team** tab.
2. **Invite Member** — enter their email and a role; an invitation link is generated (and emailed,
   if SMTP is configured). They accept it and set a password to join.
3. Every member action (task created/completed, config changed, comment added) appears in the
   project's **Activity Feed**, attributed to who did it.
4. Leave feedback on a task directly via **Task Comments**, visible to every project member.
5. When a PR is opened, a reviewer is auto-assigned round-robin from the project's team roster.

## Billing and license tiers

- **Free** — single agent, capped usage, no team features.
- **Pro** — multiple agents, team collaboration, remote dashboard access.
- **Enterprise** — everything in Pro plus SSO, Kubernetes deployment, and compliance reporting.

Upgrade from **Settings → Billing**, which opens a Stripe-hosted checkout. Your license key is
delivered and applied automatically after checkout completes; the gateway unlocks the new tier's
features without a restart. If a subscription lapses, the platform keeps full functionality for a
72-hour grace period before degrading back to Free-tier limits — enough time to fix a failed
payment without an outage. Manage your subscription (view invoices, upgrade/downgrade, update
payment method) any time from the same **Billing** page, which opens the Stripe customer portal.

## Kubernetes deployment

For production, multi-node deployments, install the Helm chart under `deploy/kubernetes/helm/meridianos`:

```bash
helm install meridianos deploy/kubernetes/helm/meridianos -f your-values.yaml
```

This deploys the gateway (with horizontal pod autoscaling), the daemon as a StatefulSet (so it
keeps its persistent volume across restarts), health/readiness probes on every pod, and — if
enabled — the dashboard with its own autoscaler and TLS-terminating ingress. See
`deploy/kubernetes/README.md` for the full prerequisites and configuration reference; that Helm
chart's own test suite is what to run after `helm install` to confirm the cluster is healthy.

## Compliance and reporting

Enterprise-tier accounts can generate reports from the **Compliance** panel:

- **SOC2** — access logs, change logs, and auth logs with per-user attribution, for the last N
  days. Backed by real audit-trail data (`compliance_log`/`activity_log`).
- **GDPR** — data flows: which providers/regions process your data and for how long it's
  retained.
- **Cost allocation** — spend broken down by department/project.
- **Model usage** — which models were used per task category, their success rates, and cost
  efficiency.

Only SOC2 is backed by real data today — GDPR, cost allocation, and model usage reports render
from placeholder/mocked figures (a fixed sample data-flow list, and randomly-generated cost
numbers, respectively) pending full wiring to the real ledger and provider config. Treat their
numbers as illustrative of the report *shape*, not real spend, until this is fixed — see
[security-audit.md](security-audit.md) for the detail. Every report exports as CSV or JSON.

## Live configuration (hot-reload)

A subset of a running project's `policy.yaml` settings apply live, without restarting the
project's process: parallelism/WIP limits (`work.*`), budget warning thresholds
(`agent_budget.*`), quiet hours, schedule cadence, and the PR auto-merge mode. Edit
`policy.yaml` (directly, or via the Dashboard's policy editor) while a project is running and
those settings take effect within a second or two.

Anything not in that list — auth secrets, ports, the project's tenant label — is intentionally
**not** hot-reloaded; those require a restart, so an accidental or malicious edit to `policy.yaml`
can never silently reconfigure something security-sensitive on a running project. An invalid edit
(a YAML typo, an unknown cadence value) is simply ignored — the project keeps running on its last
known-good settings until the file is fixed.

## Backup and restore

The control-plane database (project registry, users, licenses, activity log) can be backed up and
restored without taking the platform offline:

```bash
node scripts/backup-db.mjs backup            # writes a timestamped snapshot under .ai/backups/
node scripts/backup-db.mjs restore <path>     # restores from a specific backup file
```

Restoring keeps a timestamped copy of whatever was there immediately before the restore
(`<db>.pre-restore.<timestamp>`), so a restore is itself always recoverable. Schedule regular
backups (e.g. via cron/Task Scheduler) before any upgrade or risky configuration change.

## Usage telemetry (opt-in)

MeridianOS collects **no usage data by default**. An operator can opt a deployment in to local,
anonymous usage counters (project/report/template activity — never task content, prompts, or
credentials) by setting `MERIDIAN_TELEMETRY=1` in the environment. Collected data stays entirely
local, in the control-plane database — nothing is ever transmitted off the machine by the
platform itself. Turn it off again by unsetting the variable; no data is retroactively deleted,
but no new events are recorded.
