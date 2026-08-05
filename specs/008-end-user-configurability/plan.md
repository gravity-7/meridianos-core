# Implementation Plan: End-User Configurability

**Branch**: `008-end-user-configurability` | **Date**: 2026-08-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/008-end-user-configurability/spec.md`

## Summary

Deliver the remaining slice of "configurable by non-developers" work originally scoped as Phase 3
(`docs/MASTER-PLAN-CLOSE-GAPS.md`), scoped down against what P2/P6 already shipped incidentally, then scoped
*up* again on 2026-08-05 per an explicit operator direction change: the Settings surface is now a
Grafana-grade panel-grid workspace (drag/resize panels, real charts, a flow-graph routing editor), not a flat
form. Plus named configuration profiles with inheritance, and a browser + CLI setup wizard. Three
independently testable user stories.

**Technical approach**:
- **US2 (Profiles — DONE)**: `profiles.mjs` implementing `resolveProfile(policy, name)` — a deep-merge over
  an `extends:` chain, reusing the same merge pattern `providers.mjs` already uses for its three-source
  provider merge (not a new YAML-anchor dependency) — plus `listProfiles`/`resolveActivePolicy`. CLI via
  `gateway/cli.mjs profile list`.
- **US1 (Settings/Observability workspace)**: Extend `LEVER_PATHS` with new General/Gateway/Integrations/
  Prompts fields; add `GET /api/config/backups` and `POST /api/config/restore/:timestamp` to
  `dashboard/server.mjs`, backed by a new `policy-backups.mjs`. Build the workspace itself on three vendored,
  framework-free frontend libraries (see Constitution Check): a grid-layout library for drag/resize panels, a
  charting library for the observability panels (reading existing `/api/analytics/*` and `/api/ledger/*`
  endpoints — no new backend data model), and a node-graph library for the routing flow-editor (writing
  through the existing `POST /api/policy` → `LEVER_PATHS` → `policy-write.mjs` path — no parallel write code).
- **US3 (Setup wizard)**: `setup-wizard-core.mjs` shared by both a new `/setup` dashboard route and a CLI
  `setup` command, built on P2's existing `autoDetectProviders()` and `provider-conformance.mjs`.

## Technical Context

**Language/Version**: Node.js 24+ (ES modules, `.mjs` extension, `"type": "module"`)

**Primary Dependencies (Node.js/backend)**: `better-sqlite3` (existing sole runtime dependency) + `stripe`
(existing, documented P6 billing exception). **No new Node.js runtime dependency added by this feature** —
see Constitution Check below for why P3-F4's originally-planned `yaml` package swap is out of scope.

**Primary Dependencies (browser/frontend, 2026-08-05 addition)**: three small, MIT-licensed, framework-free
static JS assets, vendored under `dashboard/static/vendor/` (no npm install into the Node.js dependency tree,
no bundler, no build step — loaded via `<script>` tags exactly like the rest of `dashboard/index.html`):
- **uPlot** (`uplot@1.6.32`) — time-series/gauge charting for the observability panels (FR-013). Chosen for
  its size (~45KB) and zero dependencies of its own — it is a rendering library, not a framework.
- **Muuri** (`muuri@0.9.5`) — drag/resize grid layout for the panel workspace (FR-012). Chosen over heavier
  alternatives (e.g. gridstack.js) for being dependency-light and framework-agnostic.
- **Litegraph.js** (`litegraph.js@0.7.18`) — node-graph editor for the routing flow panel (FR-014). Chosen as
  the most mature framework-free node-graph library available; MeridianOS uses only its graph/canvas/node
  primitives, not its execution engine (routing decisions stay in `model-router.mjs`, never in graph nodes).

**Storage**: `.ai/policy.yaml` (existing, surgical writer/reader), `.ai/setup-state.json` (new — wizard resume
state for the CLI `--resume` path), browser `localStorage` (new — wizard resume state for the setup wizard;
also stores panel grid layout positions for the Settings/Observability workspace).

**Testing**: Node.js native test runner (`node --test`) for all backend modules — new test files:
`tests/policy-backups.test.mjs`, `tests/profiles.test.mjs` (done), `tests/setup-wizard-core.test.mjs`. The
panel grid/charts/flow-graph are frontend-only (no `.mjs` module to unit test) and are instead verified live
via the Browser tool against the running dashboard, per SC-005.

**Target Platform**: Same as existing — Node.js daemon (Windows/macOS/Linux), embedded dashboard HTTP server,
CLI (`node gateway/cli.mjs` / `node cli.mjs`).

**Project Type**: Same flat-repo Node.js daemon/orchestrator structure as the rest of the codebase.

**Performance Goals**: Profile resolution: sub-millisecond (in-memory merge over an already-parsed policy
object, no I/O). Backup list: O(number of backup files) directory scan, expected <100 files. Setup wizard
end-to-end (auto-detect → write configs): under 5 seconds excluding the user's own input time.

**Constraints**: Zero new Node.js runtime dependencies (this is the key deviation from the original P3-F4 plan
— see Constitution Check); the three frontend libraries are static browser assets, a separate and explicitly
scoped exception. All ~1240 existing tests must continue to pass. Settings AND routing-flow-graph writes MUST
go through the existing `policy-write.mjs` lock-file-guarded path — no second write mechanism that could race
with it.

**Scale/Scope**: Single-tenant daemon process (multi-tenant/project-scoped settings are P6's concern, already
shipped, out of scope here). Expected profile count: 2-10 per operator (dev/prod/cost-optimized/quality).
Expected backup file count: bounded by operator save frequency, no enforced cap in this pass.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Assessment |
|---|-----------|--------|-----------|
| I | Provider & Model Agnosticism | ✅ PASS | Not touched by this feature — providers/models already fully declarative from P2. |
| II | Gateway as Single Source of Truth | ✅ PASS | Settings/profile/wizard writes all still go through `policy.yaml` via the gateway daemon's existing config-loading path; no new bypass. |
| III | Zero-Dependency Philosophy | ⚠️ PASS with TWO documented exceptions | (1) Backend: the original P3-F4 planned adding the `yaml` npm package for profile inheritance; this plan instead uses an `extends:` key + plain-object deep-merge (same shape as `providers.mjs`'s existing three-source merge) — **no new Node.js dependency**. (2) Frontend: the 2026-08-05 Grafana-parity direction change requires real charting, drag/resize grid layout, and node-graph editing — none of which are reasonably hand-rollable in vanilla JS at production quality. Three small, framework-free, MIT-licensed libraries (uPlot, Muuri, Litegraph.js — see Technical Context) are vendored as **static browser assets**, not npm runtime dependencies of the Node.js process. This is the SECOND documented exception to this principle (the first being Stripe, backend, P6) — justified the same way: prove-it-can't-be-done-with-built-ins is satisfied (canvas-based charting, CSS Grid collision/drag math, and graph-layout algorithms are each genuinely complex, well-trodden problems, not something to re-litigate in a hand-rolled implementation), and each library is inert (adds zero attack surface / zero network calls) until a panel actually uses it. |
| IV | Test-First Discipline | ✅ PASS | Test files planned per module before implementation (see tasks.md). |
| V | Configuration over Code | ✅ PASS | This IS the direct implementation of this principle for the remaining hand-edited fields; profiles are pure YAML data with an `extends` pointer, not code branches. |
| VI | Observability & Auditability | ✅ PASS | Every Settings save and restore continues to produce a timestamped backup (existing `writePolicy` behavior); profile switches are logged the same way scheduler ticks already are. |
| VII | Non-Technical Usability | ✅ PASS | This IS the direct implementation of this principle — Settings tab + setup wizard are exactly "usable within 10 minutes of install." |
| VIII | ES Modules & Modern JavaScript | ✅ PASS | All new modules `.mjs`, `import`/`export`, `node:` prefix. |
| IX | PR Discipline & Code Review | ✅ PASS | Delivered via reviewed PR(s) referencing this spec. |
| X | Spec-Driven Development | ✅ PASS | spec.md → plan.md → tasks.md → implement, same as every other phase in this repo. |

**Gate Result: ALL 10 PRINCIPLES PASS**, with two explicitly documented, narrowly-scoped exceptions to
Principle III (backend: no new dependency, via a design substitution; frontend: three vendored static assets,
via the same justification pattern as the existing Stripe exception). Neither is a silent violation — both
are recorded here and in spec.md's Assumptions, matching how the Stripe exception was documented in P6's
`research.md`.

### Post-Design Re-Check

`profiles.mjs`'s `extends:` merge is structurally identical in shape to `providers.mjs`'s existing
`deepMergeProviders` — direct precedent in this codebase, now shipped and tested (14 passing tests). The
frontend library choices were verified installable from the npm registry (`npm view uplot/muuri/litegraph.js
version` all resolved) before being committed to in this plan.

## Project Structure

### Documentation (this feature)

```text
specs/008-end-user-configurability/
├── plan.md              # This file
├── tasks.md             # Phase 2 output — dependency-ordered task breakdown
└── spec.md              # Feature specification
```

### Source Code (repository root — flat layout, existing convention)

```text
profiles.mjs                  # DONE — resolveProfile/listProfiles/resolveActivePolicy, extends-chain deep merge
policy-backups.mjs            # NEW — list/restore policy.yaml backups
setup-wizard-core.mjs         # NEW — shared step logic for browser + CLI setup wizard
dashboard/
├── server.mjs                # MODIFIED — add /api/config/backups, /api/config/restore/:ts, /setup route (profile activation reuses existing POST /api/policy)
├── index.html                 # MODIFIED — add Settings/Observability workspace nav entry, mount the panel-grid shell
└── static/
    ├── vendor/
    │   ├── uplot.iife.min.js   # NEW — vendored charting library (uPlot 1.6.32)
    │   ├── muuri.min.js        # NEW — vendored grid-layout library (Muuri 0.9.5)
    │   └── litegraph.min.js    # NEW — vendored node-graph library (Litegraph.js 0.7.18)
    ├── settings-workspace.mjs # NEW — panel-grid shell (Muuri), layout persistence (localStorage)
    ├── settings-panels.mjs    # NEW — config panels (General/Gateway/Integrations/Prompts), reuses LEVERS pattern
    ├── observability-panels.mjs # NEW — uPlot-backed cost/usage/spend chart panels over existing analytics APIs
    └── routing-flow-panel.mjs # NEW — Litegraph-based provider→tier routing editor, writes via POST /api/policy
gateway/cli.mjs                # MODIFIED — `profile list` (DONE); `setup` command still to add
policy-write.mjs               # MODIFIED — `active_profile` added (DONE); General/Gateway/Integrations/Prompts fields still to add
tests/
├── profiles.test.mjs          # DONE — 14 tests passing
├── policy-backups.test.mjs   # NEW
└── setup-wizard-core.test.mjs # NEW
```

## Phased Delivery

1. **Profiles** (`profiles.mjs`) — DONE. Pure backend, no UI dependency, shipped independently, lowest risk.
2. **Settings backend** (`policy-backups.mjs` + `dashboard/server.mjs` endpoints + `LEVER_PATHS`
   extension) — backend-only, testable without the UI. Next up.
3. **Panel-grid shell + vendored libraries** — get Muuri/uPlot/Litegraph loading and rendering a minimal
   proof (one draggable panel, one real chart, one two-node graph) verified live in the browser BEFORE
   building out full panel content — de-risks the library integration before investing in every panel.
4. **Full panel set** (config panels + observability panels + routing flow-graph) built on #3's proven shell.
5. **Setup wizard** (`setup-wizard-core.mjs` + CLI + dashboard `/setup` route) — largest remaining UI surface,
   sequenced last so 1-4 land value even if this slips.
