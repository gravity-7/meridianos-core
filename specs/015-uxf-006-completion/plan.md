# Implementation Plan: UXF-006 Responsive, Accessible, and Release-Gated Migration Completion

**Branch**: `015-uxf-006-completion` | **Date**: 2026-08-12 | **Spec**: [spec.md](./spec.md)

## Summary

Close the autonomous remainder of the UI/UX revamp using the existing native ES-module dashboard platform. Add an authorization- and scope-aware operational search endpoint and keyboard palette, harden the local/cloud shells for the master-plan viewport and accessibility matrix, make visual/performance/privacy gates executable, document and test the existing SSE reconnect/polling pilot, and create the parity/rollout/rollback evidence needed to keep legacy behavior safely available. No React, TypeScript, component library, or new runtime dependency is introduced.

Human decisions are represented as explicit blocked gates: owner assignment, final IA/terminology/scorecard review, architecture/dependency ADR, approved legacy-use threshold, accessibility/performance exception authority, canary cohort, manual AT evidence where unavailable, and two consecutive release-candidate approvals. The implementation must never mark those gates complete by inference.

## Technical Context

**Language/Version**: Node.js 24+, browser-native ES modules, HTML/CSS; no transpilation required.

**Primary Dependencies**: Existing `better-sqlite3` and already-approved development tooling only. No new dependency.

**Storage**: Existing scoped operational SQLite/project stores and local event log; no schema change is required for the search projection or evidence documents.

**Testing**: Node native test runner, existing Playwright browser suite, source-quality tests, focused contract/authorization/secret tests, and deterministic browser-gate scripts. Safari/Electron remain evidence jobs where their host environment is available.

**Target Platform**: Local dashboard, Electron-hosted dashboard, cloud control-plane dashboard, latest Chrome/Edge/Firefox/Safari where available, and supported Node.js environments.

**Project Type**: Provider/harness-agnostic Node.js daemon with native ES-module local/cloud dashboards.

**Performance Goals**: Enforce the master-plan thresholds: initial shell/critical JS ≤220 KB gzip; local LCP p75 ≤2.5 s; cloud LCP p75 ≤3.5 s; interaction p95 ≤100 ms after data arrival; 1,000-row filter/sort ≤100 ms; 2,000-point chart render ≤500 ms; summary refresh-to-render p95 ≤1 s; no initial interaction long task >200 ms.

**Constraints**: Preserve `/api/*`, `/api/v1/*`, auth and project/tenant scope, gateway-only metering, public API compatibility, secrets, and legacy routes. Avoid broad removal or irreversible migration. Configuration remains policy-driven; no hardcoded dashboard port.

**Scale/Scope**: Existing local/cloud routes and all legacy dashboard panels/modules named in the parity ledger; seven target viewports; five browser families/hosts; release evidence and support documentation.

## Constitution Check

| Principle | Status | Assessment |
|---|---|---|
| I. Provider & Model Agnosticism | PASS | Search and UX telemetry use provider/model labels only as safe projections; no provider routing changes. |
| II. Gateway as Single Source of Truth | PASS | No LLM request path changes; operational reads remain read-only projections and metering remains in the gateway. |
| III. Zero-Dependency Philosophy | PASS | Native ES modules and existing dependencies only; no React/TypeScript/component library. |
| IV. Test-First Discipline | PASS with evidence | New search, telemetry, cloud, responsive, and gate tests are specified before implementation; environment blockers are recorded rather than hidden. |
| V. Configuration over Code | PASS | Feature/realtime behavior remains policy/flag controlled; performance thresholds are documented gate inputs. |
| VI. Observability & Auditability | PASS | Telemetry is allowlisted/privacy-safe; status/realtime state remains visible; rollback/parity evidence is durable documentation. |
| VII. Non-Technical Usability | PASS | User-facing search, responsive behavior, recovery copy, and cloud parity are in scope. |
| VIII. ES Modules & Modern JavaScript | PASS | New browser code is `.mjs` and uses `import`/`export`; existing HTML entry points remain compatible. |
| IX. PR Discipline & Code Review | PENDING external gate | Draft PR only; CI and Antigravity approval are required after push and no merge is authorized. |
| X. Spec-Driven Development | PASS | UXF-006 spec, plan, tasks, analysis, implementation, convergence, and quickstart artifacts are maintained. |

**Gate result:** implementation may proceed; the external approval/release gates remain open and are called out in the quickstart and parity ledger.

## Research Decisions

See [research.md](./research.md). Key decisions are: use a bounded native search adapter over existing scoped operational data; extend the current opt-in SSE coordinator rather than replacing polling; use deterministic source/runtime gates because Playwright is already present but no new runner is allowed; and align the cloud page with shared semantic CSS without changing cloud API/auth contracts.

## Data and Contract Design

See [data-model.md](./data-model.md) and [contracts/uxf-006.md](./contracts/uxf-006.md). Search returns safe projections only. UXF telemetry is an allowlisted envelope. Parity/release evidence is documentation-first and removal is a guarded state transition, not a cleanup script.

## Project Structure

```text
dashboard/
├── search.mjs                          # bounded scoped search projection
├── operations-api.mjs                  # additive search dispatch
├── static/app-platform.mjs             # local app shell integration
├── static/app-platform.css             # responsive, forced-colors, reduced-motion hardening
├── server.mjs                          # additive /api/operations/search dispatch
└── uxf-telemetry.mjs                   # privacy-safe local UXF event envelope
cloud/dashboard/{index.html,app.js}     # semantic, responsive cloud shell and policy preview
tests/{uxf-006-search,uxf-006-telemetry,uxf-006-quality,uxf-006-gates}.test.mjs
tests/operational-api.test.mjs          # search contract/authorization compatibility
browser-tests/uxf-006.spec.mjs          # viewport, keyboard, focus, and palette evidence
scripts/uxf-006-gates.mjs              # deterministic visual/performance/privacy gate checks
docs/{legacy-parity-ledger,uxf-006-rollout,uxf-006-migration}.md
specs/015-uxf-006-completion/{research,data-model,contracts,quickstart,tasks}.md
```

## Implementation Phases

1. **Foundation and tests**: freeze current API/legacy behavior, add search/telemetry contracts and red tests, add the parity ledger/evidence schema, and keep all human gates unresolved.
2. **Authorized search and palette**: implement scoped route/entity projections, safe command execution checks, palette keyboard/focus behavior, and negative tests.
3. **Responsive/cloud hardening**: update shared native CSS/markup and cloud dashboard states; add viewport, reduced-motion, forced-colors, zoom, keyboard, focus, and cloud tests.
4. **Quality gates and evidence**: implement deterministic performance/visual/privacy checks, extend CI workflow jobs, document SSE reconnect/polling fallback, and generate the quickstart/evidence format.
5. **Convergence and handoff**: run focused tests, browser evidence where available, full `npm test`, `git diff --check`, converge until clean, and report external gates without claiming them complete.

## Rollback and Compatibility

- Search and palette are additive and may be disabled by the shell feature flag; existing route navigation remains.
- Cloud changes preserve existing REST paths and bearer behavior; failed preview/confirmation leaves the existing policy form available.
- SSE remains opt-in with polling/manual refresh fallback; disabling realtime returns the coordinator to polling.
- No legacy module or route is deleted. The parity ledger and retained tagged asset/branch are the rollback boundary.
- New telemetry is opt-in/local-only and drops disallowed fields before persistence; disabling it is safe and does not affect product behavior.
