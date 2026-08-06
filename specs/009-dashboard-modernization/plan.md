# Implementation Plan: Dashboard Modernization & Observability Hardening

**Branch**: `009-dashboard-modernization` | **Date**: 2026-08-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/009-dashboard-modernization/spec.md`

## Summary

Consolidate the dashboard's duplicated spend/budget surfaces down to one each, promote the panel-grid
workspace delivered in `specs/008-end-user-configurability` from a secondary opt-in tab to the primary board,
retire the legacy monolithic `dashboard/index.html` sections it replaces one at a time (strangler-fig, never a
big-bang rewrite), and close a systemic error-handling gap — silently-swallowed exceptions — that turned this
phase's own root-cause audit into a two-pass investigation. A visual design-token layer (uPlot theming,
Tabler-inspired chrome) ties the result together. Six independently testable user stories.

**Technical approach**:
- **US3 (Observability & error-visibility hardening) — built first, everything else depends on it**: replace
  every dashboard `catch` block that currently discards its error with one that (a) sets a per-panel visible
  error state and (b) reports the error through a new, small client-error-logging path. Replace the
  `poll = async function(){...}` global-reassignment chain (found stacked three deep, the direct mechanism
  behind two of the four bugs fixed during the pre-spec audit) with a stable subscriber-list dispatcher —
  `registerPollHandler(fn)` — that every feature registers against once, instead of monkey-patching a shared
  global.
- **US1 (Single source of truth for spend/budget)**: delete the legacy hand-rolled `LineChart`/`DonutChart`
  canvas classes and the duplicate compute-budget/provider-spend sections in `dashboard/index.html`; the
  existing 008-delivered uPlot observability panels (`Cost Over Time`, `Token Usage`, `Provider Spend
  Breakdown`) become the only rendering path for those metrics. Agent budget status and its editable controls
  merge into one panel (currently two separate roster-driven grids, `budgetGrid` and `agentBudgetTiles`).
- **US2 (Promote workspace to primary)**: flip the panel-grid workspace from `display:none` behind
  "⚙ Settings" to the default view rendered on page load; each remaining legacy section (task/agent workflow
  status, governance, providers/models) is ported into a new `registerPanel()`-based module and deleted from
  legacy markup in the same change — following 008's own precedent of proving the shell before building every
  panel.
- **US4 (Status/controls co-location)**: a direct consequence of US1's agent-budget merge and US2's panel
  migration — scheduler status merges with scheduler controls, governance/escalation status merges with
  governance controls, as each is ported.
- **US5 (uPlot + Tabler visual system)**: a shared `design-tokens.css` (palette, typography, spacing, card
  chrome) authored by hand-porting the specific Tabler token *values* MeridianOS wants — colors, spacing
  scale, font stack — not by vendoring Tabler itself. uPlot panels apply a shared `buildUplotTheme()` helper
  reading those same CSS custom properties, so chart styling and page chrome can never drift apart.
- **US6 (Naming & model-list cleanup)**: rename the "Subscription Plans" card's user-facing copy to "AI
  Provider Subscriptions" (code identifiers unchanged, UI copy only); add a client-side filter/sort control to
  the existing models panel over the already-loaded `/api/models` response — no new endpoint.

## Technical Context

**Language/Version**: Node.js 24+ (ES modules, `.mjs` extension, `"type": "module"`) — unchanged.

**Primary Dependencies (backend)**: None added. This phase does not touch `better-sqlite3`/`stripe` or add a
new runtime dependency. One small backend addition: `POST /api/client-error` on `dashboard/server.mjs`,
forwarding to the existing `daemon-logger.mjs` structured-logging path (Constitution Principle VI) — no new
storage engine, reuses what already logs scheduler/gateway events.

**Primary Dependencies (frontend)**: None added — this is a deliberate contrast with 008. uPlot (already
vendored under `dashboard/static/vendor/` from 008) is reused, not replaced. **Tabler is referenced, not
vendored**: its published design-token *values* (color scale, spacing scale, font stack) are hand-copied into
a new `dashboard/static/design-tokens.css`, and Tabler's own CSS/JS bundle is never imported. This keeps
Principle III's Zero-Dependency gate clean — no new exception needed, unlike 008's two documented exceptions.

**Storage**: No new storage engine. Reuses 008's `localStorage` panel-layout key
(`meridian.settingsWorkspace.layout.v1`) — extended to tolerate panels appearing in a saved layout that didn't
exist when it was last written (new panels append to the end of the grid rather than erroring, per spec.md's
Edge Cases). Client error reports are NOT persisted client-side; they're forwarded to the backend's existing
logging path via `POST /api/client-error` so they survive a reload and don't require devtools to be open to be
seen.

**Testing**: Node.js native test runner (`node --test`), matching 008's approach for frontend-adjacent work:
- New: `tests/dashboard-source-quality.test.mjs` — a source-scan regression test asserting zero empty/no-op
  `catch` blocks and zero `poll = async function` reassignments remain in `dashboard/index.html` (directly
  enforces SC-004/SC-005; cheap, fast, prevents the exact anti-patterns this phase removes from creeping back).
- New: a unit test for the `POST /api/client-error` handler (payload validation, forwarding to
  `daemon-logger.mjs`).
- Panel content, theming, and the workspace-promotion itself remain frontend-only (no `.mjs` module boundary
  to unit test around DOM rendering) and are verified live via the Browser tool against the running dashboard,
  same as 008's SC-005 precedent — each user story's Independent Test in spec.md is the acceptance bar.
- Full existing suite (`npm test`) must continue to pass with zero regressions (spec.md SC-009); baseline
  count captured as a Phase 1 setup task, matching 008's own T001.

**Target Platform**: Unchanged — Node.js daemon (Windows/macOS/Linux), embedded dashboard HTTP server.

**Project Type**: Same flat-repo Node.js daemon/orchestrator structure as the rest of the codebase.

**Performance Goals**: Panel isolation (US3/FR-005) must not add measurable render overhead — errors are
caught at the existing per-panel `render()` call boundary, not via new polling or wrapping. Client-error
reporting is fire-and-forget (`fetch(...).catch(()=>{})` at the transport level only — the error being
*reported* is never itself silently swallowed the way the bug it's fixing was) and must not block panel
rendering.

**Constraints**: Zero new Node.js runtime dependencies and zero new vendored frontend libraries (stricter than
008 — no exception requested). Migration is incremental: each legacy section's removal ships in the same
change as its panel replacement, independently revertible, never batched into one large diff. All existing
tests continue to pass throughout, not just at the end.

**Scale/Scope**: Same single dashboard, single-tenant daemon process. No change to the number of panels a
typical operator would have open (~8-12), just where their content lives and how reliably it renders.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Assessment |
|---|-----------|--------|-----------|
| I | Provider & Model Agnosticism | ✅ PASS | Not touched — this phase only changes how existing provider/model data is *displayed* (US6's model-list filter is client-side over the existing `/api/models` response). |
| II | Gateway as Single Source of Truth | ✅ PASS | No new write/read path around the gateway; consolidated spend surfaces still read from the existing `/api/analytics/*` and ledger endpoints, just from one code path instead of several. |
| III | Zero-Dependency Philosophy | ✅ PASS, no exception needed | Zero new Node.js dependencies and zero new vendored frontend libraries — uPlot is reused from 008, Tabler is referenced for token *values* only and never imported as an asset. This is a stricter bar than 008 (which needed two documented exceptions) and doesn't request a new one. |
| IV | Test-First Discipline | ✅ PASS | `tests/dashboard-source-quality.test.mjs` and the `/api/client-error` unit test are written before/alongside their implementation; panel/visual work follows 008's established frontend-only verification precedent (live Browser-tool checks against each story's Independent Test). |
| V | Configuration over Code | ✅ PASS, not applicable | This phase doesn't add new `policy.yaml`-governed behavior — it's a client-rendering consolidation, not a new configurable capability. |
| VI | Observability & Auditability | ✅ PASS — this phase directly implements it | US3 is this principle applied to the dashboard's own client-side code: every caught error becomes traceable (structured, forwarded to `daemon-logger.mjs`) instead of silently discarded. This closes the exact gap that let this phase's own precursor bug hide for two investigation passes. |
| VII | Non-Technical Usability | ✅ PASS | Not the primary target of this phase, but reinforced: one spend number instead of six disagreeing ones, and visible error states instead of permanently-blank cards, are both directly in service of "usable without reading source." |
| VIII | ES Modules & Modern JavaScript | ⚠️ PARTIAL, improves incrementally | The legacy `dashboard/index.html` inline `<script>` block predates and violates this principle (no `import`/`export`, global function reassignment) — a pre-existing condition, not introduced by this phase. Every legacy section this phase ports lands as a proper `.mjs` module (matching 008's panels), and the dispatcher pattern (US3) directly replaces the worst offender (`poll = async function` reassignment). Full compliance requires porting every remaining legacy section, which spec.md's Assumptions describe as an incremental, multi-release effort — `tasks.md` will scope how much lands in this phase's first pass versus follow-up. |
| IX | PR Discipline & Code Review | ✅ PASS | Delivered as a sequence of small, independently reviewed PRs (one per migrated section/story), not one large diff — directly required by this phase's own Constraints. |
| X | Spec-Driven Development | ✅ PASS | spec.md → plan.md → tasks.md → implement, same as every other phase, building explicitly on 008's precedent rather than re-litigating it. |

**Gate Result: ALL 10 PRINCIPLES PASS**, with one honestly-flagged partial (VIII) that is a pre-existing
condition this phase improves but does not fully resolve in one pass — recorded here rather than silently
claimed as complete, matching how 008 documented its own exceptions rather than glossing over them.

### Post-Design Re-Check

The `registerPollHandler(fn)` dispatcher is structurally the same pattern 008 already proved with
`registerPanel(id, title, render)` — a registry + lookup, not a new architectural idea introduced by this
phase. The design-token approach was checked against `dashboard/index.html`'s existing `<style>` block: it
already uses CSS custom properties (`var(--text-primary)`, `var(--surface-1)`, etc.) throughout, so
`design-tokens.css` extends an existing convention rather than introducing a new one.

## Project Structure

### Documentation (this feature)

```text
specs/009-dashboard-modernization/
├── plan.md              # This file
├── tasks.md             # Phase 2 output — dependency-ordered task breakdown
└── spec.md              # Feature specification
```

Following 008's lighter three-file convention (spec/plan/tasks only) rather than 006/007's fuller convention
(+research/data-model/quickstart/checklists/contracts) — this phase introduces no new data model or public
API contract, so those documents would be empty scaffolding, not real content.

### Source Code (repository root — flat layout, existing convention)

```text
dashboard/
├── server.mjs                    # MODIFIED — add POST /api/client-error (forwards to daemon-logger.mjs)
├── index.html                    # MODIFIED — legacy sections removed as each is ported; poll dispatcher
│                                  #   replaces the poll = async function(...) reassignment chain; workspace
│                                  #   becomes the default view instead of display:none
└── static/
    ├── design-tokens.css         # NEW — shared palette/typography/spacing values (Tabler-referenced, not
    │                              #   vendored), consumed by both dashboard chrome and uPlot theming
    ├── poll-dispatcher.mjs        # NEW — registerPollHandler(fn) subscriber-list, replaces global poll
    │                              #   reassignment
    ├── client-error-log.mjs      # NEW — reportError(source, error) helper: sets panel error state +
    │                              #   POSTs to /api/client-error
    ├── observability-panels.mjs  # MODIFIED (008-owned) — apply shared uPlot theme via design-tokens.css
    ├── settings-workspace.mjs    # MODIFIED (008-owned) — tolerate new panels absent from a saved layout
    ├── agent-budget-panel.mjs    # NEW — merges compute-budget display + budget-&-limits controls (US1/US4)
    ├── task-workflow-panel.mjs   # NEW — active-now/queue/runs/health/runner/verifier/planner, ported from
    │                              #   legacy markup (US2)
    ├── governance-panel.mjs      # NEW — safety & governance controls + "needs you" status, co-located (US4)
    ├── providers-models-panel.mjs # NEW — ports legacy providers/models sections; models list gains
    │                              #   filter/sort (US6)
    └── subscriptions-panel.mjs   # MODIFIED — "Subscription Plans" → "AI Provider Subscriptions" copy (US6)
daemon-logger.mjs                 # REUSED, unmodified — existing structured-logging sink
tests/
├── dashboard-source-quality.test.mjs # NEW — source-scan: zero empty catch blocks, zero poll reassignment
└── client-error-endpoint.test.mjs    # NEW — POST /api/client-error validation + forwarding
```

## Phased Delivery

1. **Observability/dispatcher foundation** (US3) — `poll-dispatcher.mjs`, `client-error-log.mjs`,
   `POST /api/client-error`, and the source-scan regression test. Built first because every later panel
   migration should be built on the dispatcher and error-reporting pattern from day one, not retrofitted.
   Lowest risk: isolated, doesn't touch layout or visible content.
2. **Design tokens + uPlot theming** (US5, foundation slice) — `design-tokens.css` and `buildUplotTheme()`,
   applied to the three existing 008 observability panels first (smallest surface, immediately visible
   result) before any new panel is built on top of it — so every panel from step 3 onward lands pre-themed.
3. **Spend/budget consolidation** (US1) — delete `LineChart`/`DonutChart`, merge the two agent-budget grids
   into `agent-budget-panel.mjs`. Highest-value duplication removal, and it's the natural first consumer of
   both steps 1 and 2.
4. **Status/controls co-location** (US4) — falls out of step 3 for agent budget; extends the same pattern to
   `governance-panel.mjs` and the scheduler portion of `task-workflow-panel.mjs`.
5. **Full workspace promotion + remaining legacy migration** (US2) — flip the default view, port
   `task-workflow-panel.mjs`, `governance-panel.mjs`, `providers-models-panel.mjs`; delete each legacy section
   in the same change as its replacement. Sequenced last among the structural work because it's the largest
   remaining surface — mirrors 008's own "prove the shell before building every panel" ordering, except here
   the shell is already proven (008 built it); what's left is porting content into it.
6. **Naming + model-list filter cleanup** (US6) — smallest, no dependencies on anything above, safe to slot
   in whenever convenient; listed last to match spec.md's own priority ordering (P3).
