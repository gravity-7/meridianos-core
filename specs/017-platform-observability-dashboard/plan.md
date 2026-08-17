# Implementation Plan: Platform Observability Dashboard & Legacy-Parity Polish

**Branch**: `017-platform-observability-dashboard` | **Date**: 2026-08-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/017-platform-observability-dashboard/spec.md`

## Summary

Create a complete operational landing board at `/` by composing the existing scoped operational read models and chart/table routes, then apply the Founder-approved visual reference: dense Grafana-like dark panel grid, metric/chart/gauge families, threshold-colored circled meters for cost/tokens/budget, and persistent left navigation, with System, Light, and Dark themes. Build a parity inventory against the legacy dashboard before migrating or retiring capabilities. Populate only explicit local demo fixtures with deterministic synthetic telemetry; normal installations remain truthful and empty when no ledger evidence exists. Preserve `/legacy`, `/index.html`, `/setup`, authorization, and the canonical gateway-ledger metering path.

## Technical Context

**Language/Version**: Node.js 24+ and browser ES modules using the repository's existing native JavaScript conventions.

**Primary Dependencies**: Existing `better-sqlite3`; existing vendored uPlot and repository-native CSS/DOM utilities. No new runtime dependency is currently required. A framework may be proposed only if native CSS/DOM cannot satisfy a documented requirement and the constitution is explicitly re-evaluated.

**Storage**: Existing gateway ledger, operational read models, policy/configuration, and disposable fixture roots. Appearance preference uses the existing local browser preference boundary and must never contain secrets.

**Testing**: Node native test runner, focused HTTP/source tests, Playwright Chrome browser tests, manual Founder self-review where available, `git diff --check`, and `$speckit-converge`.

**Target Platform**: Local dashboard on Windows/macOS/Linux with loopback services; desktop and mobile browsers including a 320 CSS-pixel viewport. Chrome is the supported automated reference browser.

**Project Type**: Existing native Node.js dashboard/control-plane web application with a client-side ES-module platform shell and retained legacy HTML dashboard.

**Performance Goals**: Performance is not a product-design veto; usability, polish, responsive behavior, and accessibility take precedence. Existing 2,000-point chart evidence remains a validation target unless the Founder explicitly changes it.

**Constraints**: Gateway remains the single metering path; data is authorization-scoped; no external network/provider/payment/email calls; no real keys; `/legacy` remains usable; synthetic telemetry is fixture-only; no claims for unavailable browser, accessibility, production, canary, or release gates. The project’s zero-dependency constitution still applies; any framework addition requires a written justification and constitution re-check.

**Scale/Scope**: One root board, six primary operational areas, the existing chart/table primitives, all in-scope legacy operational/analytics widgets, three theme modes, two reference viewport classes, and one deterministic demo dataset.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence / plan response |
|---|---|---|
| I. Provider & Model Agnosticism | PASS | Dashboard reads generic gateway/operational evidence and does not add provider-specific behavior. |
| II. Gateway as Single Source of Truth | PASS | Trends and spend remain derived from canonical gateway-ledger/operational read models. |
| III. Zero-Dependency Philosophy | PASS with review point | Native CSS/DOM is the default. A framework is allowed only if native implementation cannot meet a concrete requirement; the exception must be justified before adding it. |
| IV. Test-First Discipline | PASS | Add parity, scope, state, theme, mobile, accessibility, synthetic-isolation, and cleanup tests before/alongside implementation. |
| V. Configuration over Code | PASS | Existing policy and authorization remain authoritative; appearance is a local presentation preference, not a secret/config bypass. |
| VI. Observability & Auditability | PASS | Widgets expose freshness, scope, source meaning, tables, exports, and durable drill-down evidence. |
| VII. Non-Technical Usability | PASS | Root board provides a visual, responsive, themeable operational experience with clear empty/error recovery. |
| VIII. ES Modules & Modern JavaScript | PASS with review point | New browser code remains native `.mjs`; any framework must preserve the module boundary and existing HTML compatibility. |
| IX. PR Discipline & Code Review | PENDING external gate | Local implementation will be review-ready; Antigravity/CI/release decisions remain separate gates and no merge is authorized. |
| X. Spec-Driven Development | PASS | This plan follows the completed specification and will generate ordered tasks before implementation. |

## Phase 0: Research decisions

Research resolves the migration boundary, chart/data composition, theme persistence, responsive layout, and deterministic fixture strategy. Decisions are recorded in [research.md](./research.md).

## Phase 1: Design artifacts

The feature entities and state contracts are in [data-model.md](./data-model.md). User-visible board, widget, theme, scope, and safety contracts are in [contracts/dashboard-observability.md](./contracts/dashboard-observability.md). Runnable validation is in [quickstart.md](./quickstart.md).

## Project Structure

### Documentation

```text
specs/017-platform-observability-dashboard/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/dashboard-observability.md
├── checklists/requirements.md
└── tasks.md
```

### Source and tests

```text
dashboard/
├── app.html                                  # platform shell entry/theme hooks
├── app/routes/overview/index.mjs             # composed root operational board
├── app/routes/observability/{gateway,cost,usage,alerts}.mjs
├── app/shared/{chart-adapter,operational-scope,view-helpers}.mjs
├── static/{app-platform,app-platform.css}.mjs/css
├── ui-platform.mjs                            # route/default policy boundary
└── server.mjs                                 # additive routes and fixture-aware reads

tests/
├── operational-dashboard.test.mjs
├── dashboard-theme.test.mjs
├── dashboard-parity.test.mjs
└── fixtures/{client-demo-fixture,onboarding-fixture}.mjs

browser-tests/
├── operational-overview.spec.mjs
├── dashboard-theme-responsive.spec.mjs
└── client-demo-package.spec.mjs
```

**Structure Decision**: Extend the existing platform shell and operational route modules. Keep legacy HTML and APIs intact, put composition in the platform overview route, centralize visual/theme tokens and the left navigation rail in existing platform CSS/markup, and test fixture-only behavior through the established isolated fixtures. Do not introduce a UI framework unless the native approach fails a documented acceptance criterion; the supplied reference visual fidelity is the acceptance driver.

## Delivery sequence

1. Freeze the legacy parity inventory and add red tests for the root board, theme modes, mobile layout, and fixture data boundary.
2. Add root board composition and shared widget/state primitives over existing data contracts.
3. Add responsive theme/token polish and chart/table visual consistency.
4. Add deterministic demo telemetry and verify normal installations remain empty/data-truthful.
5. Run focused browser/HTTP tests, full regression, convergence, manual local smoke, and the external review gate.

## Complexity Tracking

No constitutional violations are planned. If a UI framework becomes necessary, the task list must include its narrow justification, dependency review, and constitution re-check before adding it.

## Native-stack sufficiency checkpoint (T026)

The existing native CSS/DOM stack satisfies the concrete visual acceptance criteria: the Chrome reference checks render the persistent icon-first rail, dense panel grid, graph/table alternatives, gauge/bar-gauge/heatmap/list families, System/Light/Dark tokens, and the reusable circled meters at desktop and 320px. No framework exception or new runtime dependency is justified by the current evidence.
