# UXF-006 Legacy Parity Ledger

This ledger is the release boundary for the UI revamp. It records the retained legacy surface, its native application destination, evidence, and the conditions required before removal. A `blocked` row is intentional: no legacy module is removed by UXF-006, and no human approval is inferred.

| Legacy surface | Target/native destination | Current evidence | Owner | Removal gate | Rollback asset | Status |
|---|---|---|---|---|---|---|
| `dashboard/index.html` and `dashboard/static/dashboard-bootstrap.mjs` | `/app` overview route | `browser-tests/operational-overview.spec.mjs`, `tests/app-route-registry.test.mjs` | TBD | Two release candidates with route, API, visual, a11y, and performance parity | Tagged legacy asset + feature flag | blocked |
| `settings-panels.mjs`, `settings-workspace.mjs`, `settings-workspace-bootstrap.mjs` | `/app/setup`, `/app/governance/*` | `tests/app-route-registry.test.mjs`, existing management tests | TBD | Settings save/backup/restore and policy boundary parity signed off | Retained modules and policy backups | blocked |
| `admin-bootstrap.mjs`, `team-bootstrap.mjs`, `team-panel.mjs` | `/app/administration/members` | `browser-tests/management-workflows.spec.mjs`, `tests/management-access.test.mjs` | TBD | Auth-negative, cross-tenant, invite, and activity parity evidence | Retained admin/team entry points | blocked |
| `api-keys-panel.mjs` | `/app/integrations/providers` | Existing provider/API-key tests and `dashboard/server.mjs` auth boundary | TBD | Secret redaction and key-rotation parity reviewed by security owner | Existing key panel + rotation runbook | blocked |
| `providers-models-panel.mjs`, `projects-panel.mjs`, `templates-panel.mjs` | `/app/integrations/*`, `/app/setup` | `tests/provider*.test.mjs`, onboarding browser evidence | TBD | Provider/project/template CRUD and tenancy parity | Existing modules and API contracts | blocked |
| `observability-panels.mjs`, `spend-budget.mjs`, `optimization.mjs` | `/app/observability/*` | `browser-tests/operational-overview.spec.mjs`, operational API tests | TBD | Metric definitions, retention disclosures, visual and performance parity | Existing panels and read-only APIs | blocked |
| `task-workflow-panel.mjs`, `task-comments.mjs` | `/app/operations/tasks` | `tests/operational-api.test.mjs`, operational browser evidence | TBD | Task mutation, recovery, scope, and audit parity | Existing workflow module | blocked |
| `daemon-console.mjs`, `ide-integration.mjs` | `/app/observability/gateway`, integrations | Existing gateway and integration route tests | TBD | Gateway-only metering and external integration behavior verified | Existing console/integration modules | blocked |
| `governance-panel.mjs`, `billing-panel.mjs`, `compliance-panel.mjs` | `/app/governance/*` | Existing governance/API tests and route registry | TBD | Billing, compliance, audit, and permission parity | Existing governance modules | blocked |
| `marketplace-panel.mjs`, `subscriptions.mjs`, `escalation-actions.mjs` | `/app/integrations/*`, `/app/governance/*` | Existing marketplace/subscription tests | TBD | Public API compatibility, entitlement, and escalation parity | Existing modules and API contracts | blocked |
| `policy-levers.mjs`, `agent-budget-panel.mjs`, `routing-flow-panel.mjs` | `/app/setup`, `/app/governance/billing` | Existing policy/config tests; `docs/policy-rollback.md` | TBD | Policy migration, backup, rollback, and privacy review | Policy backups + documented rollback boundary | blocked |
| `cloud/dashboard/index.html` and `cloud/dashboard/app.js` | Cloud control-plane shell | `tests/cloud-agent.test.mjs`; cloud server endpoints | TBD | Cloud login, machine health, preview/confirm/rollback and responsive parity | Cloud static bundle and API compatibility | blocked |

## Evidence rules

- `current evidence` is a pointer to reproducible tests or source contracts; it is not a user sign-off.
- Removal requires a named owner, an approved usage threshold, parity evidence at all supported viewports/hosts, passing contract/auth/privacy gates, two release-candidate approvals, and a rehearsed rollback. The threshold and approval authority are still human decisions.
- The preferred rollback is a feature-flag disable or tagged asset restoration. No broad deletion, route alias removal, or data cleanup is authorized by this ledger.
- The ledger must be updated with exact run IDs, commit IDs, viewport/browser results, and reviewer identities before any row changes from `blocked`.
