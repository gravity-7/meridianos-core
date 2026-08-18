# Implementation Plan: Client-Ready Demo Package

**Branch**: `spec/016-client-ready-demo-package` | **Date**: 2026-08-16 | **Spec**: [spec.md](spec.md)

## Summary

Create a local-only presentation package that retains the existing headed onboarding launcher and adds a separately launched, deterministic cloud-control-plane walkthrough. Supply presenter-facing runbooks, checkpoints, an evidence/capture contract, a visual-shot brief, and recovery guidance. The Founder-approved early-stage local dashboard now serves the platform shell at `/`, with the retained legacy dashboard at `/legacy` as a rollback boundary. The implementation must make no production claim and must never exercise external providers, payment, email, or customer data.

## Technical Context

**Language/Version**: Node.js 24+; source and test files use ES modules with `.mjs` extension.

**Primary Dependencies**: Existing repository dependencies only, including the existing Playwright installation and `better-sqlite3`; no new dependency.

**Storage**: Existing temporary filesystem fixtures, ignored `artifacts/qa/<run-id>/` safe evidence, and an ephemeral cloud control-plane SQLite database. No persistent customer or presenter data.

**Testing**: Node native test runner, existing Playwright browser tooling, source/contract tests, and a manual headed-browser smoke run. Tests and demo fixtures must be deterministic and hermetic.

**Target Platform**: A local Windows/macOS/Linux developer or presenter workstation with Node.js, installed project dependencies, a headed Chrome-capable browser, and loopback networking. This is not a production or hosted deployment plan.

**Project Type**: Native Node.js local dashboard/control-plane demonstration tooling and Markdown presentation documentation.

**Performance Goals**: The presenter can reach onboarding completion within 10 minutes and the client-operations completion/cleanup path within 8 minutes. No runtime performance approval is implied or produced by this feature.

**Constraints**: Loopback-only services; synthetic data only; no real keys; no external network request; no live provider/purchase/email flow; no screenshots, recordings, or other capture assets in an ordinary demo run; no modification of UXF-006 or Spec 014/015 artifacts; the Founder-approved local dashboard default is the platform shell at `/` with the retained dashboard at `/legacy`; `/setup` is the onboarding route; `/app/setup` is redirect-only; the cloud static test URL is not a live demo route.

**Scale/Scope**: Two scripted local walkthroughs, one deterministic fixture data set per walkthrough, one optional capture brief, one evidence index, and focused test coverage. No customer tenancy or multi-presenter coordination.

## Global Constraints

- Node.js 24+ and ES-module `.mjs` conventions are mandatory.
- Preserve the gateway as the single metering path; this feature must not generate LLM traffic at all.
- Do not add runtime dependencies beyond `better-sqlite3` or expose configuration/secrets through source, browser storage, logs, artifacts, or documentation.
- Use synthetic, disposable, loopback-only data and services. Reject or avoid any real provider key and never issue a network request to DeepSeek, Z.ai GLM, payment, email, or another external provider.
- `/setup` is the only presented onboarding destination. `/app/setup` remains a redirect and must not be presented as implemented.
- The supported cloud live-demo route is the root route served by `cloud/cloud-server.mjs`; `/cloud/dashboard/index.html` is a browser-test static-server route and must not be a presenter destination.
- Do not modify UXF-006 or Spec 014/015 specification/release-gate artifacts. The bounded default `/` and retained `/legacy` route implementation is founder-approved early-stage work. Do not create commits, pushes, PRs, recordings, screenshots, demo assets, or capture outputs during specification/planning.
- Do not claim Safari/macOS, NVDA/VoiceOver, Electron, runtime performance, visual approval, canary approval, release approval, or production/client readiness without new explicit evidence and named human approval.
- The Founder is the sole named owner for product, UX/design, testing, demo, security/privacy, and release decisions. Record these decisions as founder self-review; do not imply independent review or manufacture unavailable environment evidence.

## Constitution Check

| Principle | Status | Rationale |
|---|---|---|
| Provider & Model Agnosticism | PASS | The demo uses no provider request or hardcoded live model path. |
| Gateway as Single Source of Truth | PASS | The package generates no LLM traffic and cannot introduce a bypass. |
| Zero-Dependency Philosophy | PASS | The plan uses built-ins and existing repository dependencies only. |
| Test-First Discipline | PASS | Contract and fixture tests precede launcher/runbook behavior. |
| Configuration over Code | PASS | Synthetic inputs are version-controlled fixture definitions, not environment-supplied provider configuration. |
| Observability & Auditability | PASS | Only redacted safe evidence and explicit cleanup outcomes are retained. |
| Non-Technical Usability | PASS | The runbook is presenter-oriented, visibly paced, and supports recovery. |
| ES Modules & Modern JavaScript | PASS | New executable files are `.mjs` ES modules on Node 24+. |
| PR Discipline & Code Review | PASS | Future implementation remains PR-reviewed; no commit or PR is created in this planning session. |
| Spec-Driven Development | PASS | This plan, supporting design artifacts, tasks, and review gates precede implementation. |

**Post-design re-check**: PASS. The data model and interface contract preserve all global constraints and introduce no unresolved technical decision.

## Design Decisions

1. **Keep onboarding as an adopted baseline.** Reuse `scripts/run-visible-onboarding.mjs` unchanged and write documentation/checkpoints around its already-verified synthetic fixture, rather than replacing or extending UXF-006/Spec 014 work.
2. **Use a new local cloud-demo launcher.** The future launcher will build an ephemeral cloud-control-plane database, seed deterministic synthetic records through existing supported control-plane functions, start `createCloudServer`, open a headed browser to the server's root route, write redacted safe evidence, and clean all temporary state. This is the supported local route; it is intentionally distinct from the static browser-test mapping at `/cloud/dashboard/index.html`.
3. **Make policy confirmation a narrated checkpoint.** The presenter may show the preview and confirmation boundary. The default documented walkthrough stops before confirmation; an explicitly labeled optional synthetic confirmation segment may run only when its fixture supports deterministic outcomes and the runbook announces it. No claim of real remote policy effect is permitted.
4. **Treat visual capture as opt-in human work.** Implementation creates only a capture brief and validation rules. It never creates screenshots or recordings automatically; a named human owns any later capture and approval.
5. **Separate evidence classes.** Existing ignored `artifacts/qa/<run-id>/` remains for redacted runtime evidence. Proposed client-demo evidence receives a distinct ignored namespace and only contains manifests/results/triage until an approved human capture is attached by reference.
6. **Default to the platform with a retained rollback route.** Serve `dashboard/app.html` at `/` when no `ui_platform` override is present; keep `dashboard/index.html` at `/legacy` and `/index.html`. An explicit `ui_platform.enabled: false` returns `/` to the retained dashboard and redirects direct `/app` requests to `/legacy`. This lets the Founder exercise the newer workflow immediately while preserving a simple local fallback.

## Data Model

See [data-model.md](data-model.md). The package models only disposable synthetic session state, presentation checkpoints, safe evidence, and capture instructions. The cloud database remains an implementation detail of the transient fixture and contains fictional records only.

## Interface Contracts

See [contracts/demo-package.md](contracts/demo-package.md). The contract defines the future launcher command, local route boundary, deterministic data labels, safe evidence shape, checkpoint protocol, and capture/approval interfaces. It is intentionally an internal UI/CLI contract, not a public production API.

## Project Structure

### Documentation

```text
specs/016-client-ready-demo-package/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── contracts/demo-package.md
├── quickstart.md
├── checklists/requirements.md
└── tasks.md
```

### Future source and test files

```text
scripts/
├── run-visible-onboarding.mjs          # existing baseline; documentation-only use
└── run-visible-client-demo.mjs         # new headed cloud-control-plane demo launcher

dashboard/
├── server.mjs                           # founder-approved `/` platform default and `/legacy` fallback
└── ui-platform.mjs                      # policy default and explicit opt-out eligibility

tests/fixtures/
└── client-demo-fixture.mjs             # deterministic local cloud fixture, seed, evidence, cleanup

tests/
├── client-demo-package.test.mjs        # fixture, redaction, cleanup, route, and contract tests
└── server.test.mjs                     # platform-default, legacy-fallback, and opt-out route tests

browser-tests/
└── client-demo-package.spec.mjs         # headed-equivalent browser workflow and checkpoint coverage

docs/
├── client-demo-presenter-runbook.md     # founder narrative, walkthrough, recovery, evidence index
└── client-demo-capture-brief.md         # shot list and optional recording requirements only
```

**Structure Decision**: Put executable demo orchestration under `scripts/`, the deterministic cloud fixture under `tests/fixtures/`, automated assertions beside existing tests, and presenter/capture content in `docs/`. Existing onboarding, cloud-control-plane, and UXF-006 files remain unmodified.

## Implementation Sequence

1. Add contract tests for synthetic-only data, blocked external requests, route separation, redaction, and cleanup before creating the launcher.
2. Build the client-demo fixture around the existing cloud server/control-plane APIs and an ephemeral database; seed fictional organization, administrator, two machines, aggregate health inputs, and one policy-preview example.
3. Implement the new headed client-demo launcher with a printed root URL, stop handlers, safe evidence writing, redaction scan, and guaranteed temporary-state removal.
4. Add browser coverage for sign-in, machine/health display, preview, confirmation boundary, safe failure/recovery, viewport, and no test-only route presentation.
5. Write presenter runbook and capture brief; reference existing onboarding command rather than changing it.
6. Make the platform shell the local `/` default with `/legacy` fallback and an explicit policy opt-out; add focused route tests before the change.
7. Run focused tests and manual headed smoke checks; record only safe local evidence and explicitly label missing external release evidence as unavailable or unresolved.

## Founder ownership decision

At this pre-customer stage, the Founder owns product, UX/design, testing, demo, security/privacy, and release decisions. A founder self-review is sufficient to choose the early-stage default route and evaluate local test results. It does not substitute for independent review, manual assistive-technology evidence, or platform evidence that is unavailable; those remain accurately recorded as unavailable rather than blocked on a nonexistent team.

## Complexity Tracking

No constitution violations require justification.
