# Implementation Plan: Persona Testing Blueprint

**Branch**: `013-persona-test-blueprint` | **Date**: 2026-08-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/013-persona-test-blueprint/spec.md`

## Summary

Create a source-controlled quality blueprint that makes MeridianOS easier to test, demonstrate,
and explain. The first delivery supplies the authoritative assets: a structured catalog of seven
personas and fifteen journeys, a safe-fixture design, P1 founder/client runbooks, evidence and
release-scorecard rules, and a bounded AI-agent test playbook. It deliberately establishes the
contract for later fixture helpers and browser automation rather than prematurely attempting a
large end-to-end suite.

## Technical Context

**Language/Version**: Markdown and YAML quality assets; Node.js 24+ for the existing test infrastructure.

**Primary Dependencies**: None added. Existing Node.js native tests and the repository's Playwright browser runner are downstream consumers.

**Storage**: Version-controlled documentation and catalog files; runtime screenshots, traces, logs, and reports stay in ignored `artifacts/` paths.

**Testing**: A focused no-network source-quality test validates the catalog inventory and P1 runbook links. Existing browser CI is the future automation target; no live provider, payment, email, subscription, or production-system action is allowed in standard fixtures.

**Target Platform**: Local Windows/macOS/Linux development, GitHub Actions browser CI, Docker-hosted dashboard, and the Electron desktop application.

**Project Type**: Documentation-led quality-system foundation spanning the Node control plane, web dashboard, gateway, and desktop client.

**Performance Goals**: A tester can identify and begin any P1 journey in five minutes or less; a founder can explain an approved P1 workflow in ten minutes or less.

**Constraints**:

- The catalog must be human-readable and deterministic enough for AI agents to consume.
- Standard fixtures use synthetic data only and default to no live external effect.
- Simulated AI traffic must still traverse the gateway/metering boundary.
- Client-ready material must be reviewed and must exclude secrets, personal data, internal hostnames, and unsupported claims.
- The design extends existing temporary-root fixture patterns and adds no runtime dependency.

**Scale/Scope**: Seven personas, fifteen journeys, eight P1 runbooks, six reusable fixture profiles, a dependency-scenario matrix, and templates for evidence, triage, canaries, and release readiness.

## Global Constraints

- Node.js 24+ and the repository's native test runner remain the validation baseline.
- No new runtime or development dependency is added for this feature.
- All proposed implementation helpers use `.mjs` and ES module syntax.
- Standard fixtures use only synthetic identities, data, keys, and dependency responses.
- Any simulated LLM request passes through the test gateway/metering boundary.
- No standard test may create a charge, use a real subscription/session token, send a real invitation, alter production data, or launch uncontrolled agent work.
- Client-ready runbooks need founder review and must disclose simulated/planned/live-canary status.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| # | Principle | Status | Assessment |
|---|-----------|--------|------------|
| I | Provider & Model Agnosticism | PASS | Provider paths are catalogued without treating any configured provider/model as universally live-certified. |
| II | Gateway as Single Source of Truth | PASS | Fixture design requires simulated AI traffic to use the test gateway/metering boundary. |
| III | Zero-Dependency Philosophy | PASS | Only documents, catalog data, and a small existing-runner test are added. |
| IV | Test-First Discipline | PASS | Each journey records expected outcomes, variants, and verification lane before automation. |
| V | Configuration over Code | PASS | Fixture profiles describe configuration/policy states rather than production code branches. |
| VI | Observability & Auditability | PASS | Evidence bundles, triage records, canary approvals, and scorecards preserve decisions. |
| VII | Non-Technical Usability | PASS | P1 runbooks explain customer value, action, outcome, and recovery in plain language. |
| VIII | ES Modules & Modern JavaScript | PASS | No production implementation is changed; later helpers follow the ESM convention. |
| IX | PR Discipline & Code Review | PASS | Client-ready material has an explicit review state. |
| X | Spec-Driven Development | PASS | This design is derived from the approved feature specification. |

**Gate Result: ALL PRINCIPLES PASS.**

## Research Decisions

| Decision | Rationale | Alternatives considered |
|----------|-----------|-------------------------|
| One YAML catalog plus Markdown runbooks | Agents need consistent fields while people need readable explanations. Stable IDs connect tests, evidence, bugs, and demonstrations. | Markdown-only catalogs are hard to validate; test code alone is not client-friendly. |
| Reuse temporary roots and the neutral domain fixture | `scripts/start-ui-platform-test-server.mjs` already starts a real dashboard in an isolated temporary root. | A live developer dashboard risks state/secret leakage; static mock pages do not prove integration. |
| Simulate dependencies by default | Controlled provider, payment, email, webhook, and subscription responses allow safe success/failure/timeout checks. | Always-live testing is costly, brittle, and unsafe for autonomous agents. |
| Live verification is a named, human-approved canary | Existing DeepSeek and Ollama tests are opt-in, establishing the right pattern for real integration proofs. | Declaring unrecorded catalog entries "live tested" would overstate readiness. |
| Raw evidence is transient; reviewed illustrations are versioned | `artifacts/` and `.playwright-mcp/` are ignored, while prospect material needs privacy review and stability. | Committing all traces risks data leakage; retaining nothing removes diagnostic value. |
| P1 browser automation follows a journey-first order | The current browser test proves the `/app` shell only, not legacy dashboard, role, setup, or desktop journeys. | A single giant scenario obscures failures and does not create reusable demos. |

## Implementation Approach

1. Add a `docs/quality-assurance/` home and link it from the documentation index.
2. Add `journey-catalog.yaml` as the canonical structured inventory of personas, fixtures, dependency variants, journeys, runbooks, and evidence state.
3. Document six safe fixture profiles, controlled dependency variants, gateway boundary, reset rules, prohibited actions, and named live-canary approval process.
4. Add eight P1 runbooks plus templates for future workflows, evidence bundles, triage records, and canary approvals.
5. Add the AI-agent playbook, including allowed environment, stop conditions, browser-exploration evidence, and regression-test promotion rules.
6. Add the evidence/release model and a current P1 scorecard baseline.
7. Add a no-network source-quality test that guards inventory, P1 fields, and runbook links. Subsequent work implements the catalogued fixture helpers and browser suites.

## Project Structure

### Documentation (this feature)

```text
specs/013-persona-test-blueprint/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── journey-catalog-contract.md
└── tasks.md                         # Generated next
```

### Source Code (repository root)

```text
docs/
├── README.md                         # MODIFIED — links quality assurance material
└── quality-assurance/
    ├── README.md                     # NEW — orientation and founder entry point
    ├── journey-catalog.yaml          # NEW — source of truth for personas/journeys
    ├── safe-fixture-design.md        # NEW — fixture and canary rules
    ├── evidence-and-release-model.md # NEW — visual, evidence, triage, scorecard rules
    ├── ai-test-agent-playbook.md     # NEW — bounded agent instructions
    ├── release-scorecard.md          # NEW — P1 readiness baseline
    ├── templates/
    │   ├── workflow-runbook.md
    │   ├── evidence-bundle.md
    │   ├── triage-record.md
    │   └── live-canary-approval.md
    └── runbooks/
        ├── JRN-001-first-value-byok.md
        ├── JRN-003-budget-safety.md
        ├── JRN-005-project-team.md
        ├── JRN-007-operator-recovery.md
        ├── JRN-008-viewer-boundaries.md
        ├── JRN-009-provider-recovery.md
        ├── JRN-013-docker-dashboard.md
        └── JRN-014-desktop-first-run.md
tests/
└── quality-assurance-blueprint.test.mjs # NEW — no-network catalog/runbook validation

artifacts/qa/<run-id>/                # Runtime-only evidence; already gitignored
```

**Structure Decision**: Quality assets live in `docs/quality-assurance/` because founders and client-facing reviewers need them to be discoverable. The YAML catalog is the agent/automation source of truth; reviewed Markdown runbooks are the learning and demonstration surface. The lightweight test prevents catalog/runbook drift without starting browsers or services.
