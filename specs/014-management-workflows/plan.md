# Implementation Plan: Management Workflows

**Branch**: `spec/014-management-workflows` | **Date**: 2026-08-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/014-management-workflows/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Add management workflows to the merged UXF-004 route shell without changing existing REST/v1 behavior: scoped provider/integration administration and test evidence; one-time API-key disclosure, rotation, and revocation; webhook attempt history/replay; role, invitation, and effective-permission management; and billing, security, policy-impact, tenant settings, and audit views. A shared server-side management authorization/audit boundary will be completed before any privileged UI actions. New route/detail modules consume additive management read/mutation contracts; legacy panels remain compatible during migration.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: Node.js 24+; browser-native ES modules (`.mjs`)

**Primary Dependencies**: Node built-ins and existing `better-sqlite3`; no new dependency

**Storage**: Existing SQLite state/control-plane stores and validated policy configuration; no external service is required

**Testing**: Native `node --test`, existing compatibility fixtures, and Playwright browser journeys

**Target Platform**: Local dashboard, cloud control plane, and Electron-hosted dashboard on supported Node/browser platforms

**Project Type**: Node daemon/control plane with browser dashboard

**Performance Goals**: Cursor list/detail reads remain bounded; no management route returns unbounded delivery/audit history; provider test deadline remains at or below the existing 10-second boundary; route interaction uses UXF-004 performance evidence patterns

**Constraints**: Server-side authorization on every management read/mutation; zero durable secret disclosure; complete privileged-action evidence; preserve REST/v1/public API/gateway behavior; policy-controlled operational values; WCAG 2.2 AA interaction expectations

**Scale/Scope**: Six management capability groups, five independently testable user stories, additive API/route contracts, and runbooks for rotation, webhook recovery, invitation, billing support, rollback, and incident response

## Constitution Check

*GATE: Passed before research and re-checked after design.*

| Principle | Status | Assessment |
|---|---|---|
| I. Provider & Model Agnosticism | PASS | Provider capability/testing is registry and policy driven; no provider switch is introduced. |
| II. Gateway as Single Source of Truth | PASS | Management views consume existing operational/billing sources and do not create an LLM bypass or metering path. |
| III. Zero Dependency | PASS | Node/browser primitives and existing modules cover dialogs, crypto, storage, routes, and tests. |
| IV. Test-First | PASS | Authorization and secret-redaction contract tests precede all UI mutation tasks. |
| V. Configuration over Code | PASS | Retention, overlap, reauthentication freshness, confirmation phrases, and retry/timeouts are validated policy values. |
| VI. Observability & Auditability | PASS | Allowed and attempted privileged operations have append-only actor, authorization, intent, outcome, and correlation evidence. |
| VII. Non-Technical Usability | PASS | Detail routes/drawers, persistent feedback, and role explanations make sensitive workflows understandable. |
| VIII. ES Modules | PASS | New source/test files use `.mjs` and ESM only. |
| IX. PR Discipline | PASS | Stage 1 is an isolated draft spec-only PR; implementation needs a separate approved draft PR. |
| X. Spec-Driven Development | PASS | Specification, clarification decisions, research, data model, contracts, quickstart, tasks, analysis, and checklist are required before implementation. |

## Architecture and implementation approach

1. Establish one shared management boundary (`management-authorization`, `management-audit`, `management-secrets`) that derives tenant/project scope from authenticated context, checks policy capability/state, emits a safe response envelope, and appends allow/deny/outcome evidence. No route or DOM condition is an authority.
2. Evolve existing provider, token, webhook, invitation, billing, cloud policy-push, and audit modules through additive adapters. Protect secret material through allowlisted diagnostic/audit serializers and a one-time response/disclosure protocol.
3. Extend `dashboard/server.mjs` and `api/v1/router.mjs` without replacing legacy URLs. Local and cloud endpoints expose an explicit `environment`/`mode` rather than pretending their contracts are identical.
4. Build durable management list/detail route modules under integrations, governance, and administration. Detail routes/drawers use the UXF-004 shared scope/filter, action feedback, focus restoration, and audit-link conventions; no additional nested administration tabs.
5. Add runbooks and threat-model-led tests before UI mutation tasks, then browser, accessibility, API compatibility, authorization-negative, secret-leak, idempotency, audit, and performance evidence.

## Explicit design decisions

| Area | Decision |
|---|---|
| Role source | `admin`, `operator`, and `viewer` remain canonical names. The policy-backed server decision is authoritative; an effective-permission response is explanatory only. |
| Tenant/project scope | Authenticated tenant is mandatory; project may only narrow scope. Missing, foreign, or revoked targets receive a non-disclosing denial. |
| Provider tests | Use the existing <=10-second `AbortSignal` deadline, one explicit operator retry after a terminal result, a bounded server retry policy, safe categories, correlation, and allowlisted authorized diagnostics. |
| API keys | Material exists only in the create/rotate response and a short-lived in-memory disclosure. Default overlap, reauthentication freshness, and destructive phrase are policy values; default phrase is `REVOKE <key name>` and default reauthentication window is 15 minutes. Lost values are replaced, never recovered. |
| Webhooks | Retain existing 30-day attempt retention by default, make it policy configurable, cursor-page attempts, and replay only retained failed terminal attempts. A `(delivery_id, replay_generation)` idempotency record blocks duplicate outbound calls. |
| Invitations | Preserve existing 24-hour expiry as a policy default. Resend supersedes the prior pending token; cancellation and role change are versioned, scoped, and audited. |
| Billing | Present existing local/cloud contract sources explicitly with `normal`, `read_only`, `degraded`, or `unavailable` mode. Billing mutations remain limited to existing supported contracts. |
| Policy push | Preview affected scope and diff before confirmation, record a versioned rollback boundary, and report per-target outcome. Rollback cannot claim to undo external irreversible effects. |
| Audit and retention | Every privileged request produces an append-only safe event. Delivery history uses its existing 30-day policy; management audit uses a policy-configured default of 365 days and does not shorten unrelated ledger/log retention. |

## Project Structure

### Documentation (this feature)

```text
specs/014-management-workflows/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── contracts/
│   └── management-workflows.md
├── quickstart.md
├── checklists/
│   ├── requirements.md
│   └── security.md
└── tasks.md
```

### Source Code (repository root)

```text
dashboard/
├── server.mjs                         # additive management endpoint dispatcher
├── management-authorization.mjs       # new shared server-side scope/capability boundary
├── management-audit.mjs               # new append-only safe management evidence adapter
├── management-secrets.mjs             # new one-time disclosure/redaction protocol
├── management-integrations.mjs        # new provider/integration test/read model
├── management-webhooks.mjs            # new attempt paging/replay eligibility/idempotency
├── management-access.mjs              # new membership/invitation/effective-permission adapter
├── management-billing.mjs             # new environment/mode/limit/security aggregation
├── app/routes/
│   ├── integrations/{providers,provider-detail,api-keys,webhooks,webhook-detail}.mjs
│   ├── governance/{billing,security,audit}.mjs
│   └── administration/{members,member-detail,tenant-settings}.mjs
└── static/{admin-bootstrap,api-keys-panel}.mjs # compatibility bridges only
api/v1/
├── router.mjs                         # additive management/version compatibility dispatch
└── webhooks.mjs                       # preserved delivery contract plus additive safe reads
auth/{auth,user-store,api-tokens}.mjs  # existing role, invitation, and key primitives evolved compatibly
cloud/{cloud-control-plane,cloud-server}.mjs # explicit policy-impact/cloud contracts
tests/
├── management-authorization.test.mjs
├── management-secrets.test.mjs
├── management-integrations.test.mjs
├── management-webhooks.test.mjs
├── management-access.test.mjs
├── management-billing.test.mjs
├── management-audit.test.mjs
└── dashboard-api-compatibility.test.mjs
browser-tests/management-workflows.spec.mjs
docs/{key-rotation,webhook-recovery,invitation-management,billing-support,policy-rollback,management-incident-response}.md
```

**Structure Decision**: Keep the merged UXF-004 browser-native route shell and its server/static asset mapping. Management domain modules centralize safety rules; route files remain thin consumers of server-authorized data and action responses.

## Complexity Tracking

No constitution violation requires additional complexity justification.

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
# [REMOVE IF UNUSED] Option 1: Single project (DEFAULT)
src/
├── models/
├── services/
├── cli/
└── lib/

tests/
├── contract/
├── integration/
└── unit/

# [REMOVE IF UNUSED] Option 2: Web application (when "frontend" + "backend" detected)
backend/
├── src/
│   ├── models/
│   ├── services/
│   └── api/
└── tests/

frontend/
├── src/
│   ├── components/
│   ├── pages/
│   └── services/
└── tests/

# [REMOVE IF UNUSED] Option 3: Mobile + API (when "iOS/Android" detected)
api/
└── [same as backend above]

ios/ or android/
└── [platform-specific structure: feature modules, UI flows, platform tests]
```

**Structure Decision**: [Document the selected structure and reference the real
directories captured above]

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
