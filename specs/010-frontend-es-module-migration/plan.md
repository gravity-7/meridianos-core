# Implementation Plan: Frontend ES Module Migration

**Branch**: `010-frontend-es-module-migration` | **Date**: 2026-08-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/010-frontend-es-module-migration/spec.md`

## Summary

Move all 64 uniquely-named top-level functions out of `dashboard/index.html`'s single remaining classic
`<script>` block (lines 882–2024) into nine real ES modules under `dashboard/static/`, then delete the classic
script entirely, closing Constitution Principle VIII's `⚠️ PARTIAL` status for good. Pure structural migration —
no behavior, layout, or feature change. Along the way, this phase fixes two latent bugs its own re-inventory
found (a shadowed duplicate `formatNumber` definition, and an `esc()`/`escapeHtml()` quote-escaping gap that is
a minor attribute-injection risk) — both documented as explicit, reasoned exceptions to "preserve current
behavior," not scope creep.

**A sequencing hazard, resolved upfront (Phase 0, before US1)**: a naive one-story-at-a-time deletion — remove
each story's functions from the classic script as its own module lands — creates a real transient-breakage
window. `render(s)`/`poll()` don't move until US9, so any function they call directly (US3's
`renderFounderUsage`, US7's `renderSystemLog`, etc.) would, mid-migration, be called by still-classic-script
code that no longer defines it anywhere reachable. A `window`-bridge doesn't rescue this: `<script
type="module">` tags are deferred relative to a non-`defer` classic script, so the module setting
`window.renderFounderUsage` would not yet have run by the time the classic script's own synchronous top-level
code (`startPolling()`'s immediate first `poll()` call) needs it — confirmed against the HTML spec's script
deferral rules, not assumed. The fix: **flip `dashboard/index.html`'s script tag to `type="module"` once,
upfront, before any function moves anywhere** (Phase 0). This is a small, self-contained, fully-live-verified
change (module scope no longer auto-exposes top-level declarations on `window`, so this step alone must add
explicit `window.foo = foo` for all 35 existing `onclick`/`onchange`-reached functions at once, and confirm no
strict-mode incompatibility — module scope is strict by default). After Phase 0, every story (US1–US9) is pure
within-module refactoring — moving a function from the (now-module) `dashboard/index.html` into its own file
and adding an `import` back — with no classic/module execution-order boundary ever in play again. Confirmed
safe against the vendored scripts too: `uPlot`/`Muuri`/`LiteGraph` appear only in comments in the classic
script, never as live code references, so reversing their relative load order (a `type="module"` consequence,
since the vendor `<script src>` tags stay classic/non-deferred) carries no dependency risk.

**Technical approach**:
- **US1 (Shared utilities) — built first, everything else depends on it**: new `dashboard-utils.mjs` exports
  `esc`, `relTime`, `formatSpend`, `formatNumber`, `shortModel`, `badgeFor`, `outcomeBadge`. Also fixes
  `task-workflow-panel.mjs`'s five pre-existing local duplicates (found during this phase's re-inventory, not
  by 009) — three of which required picking a correct behavior rather than a blind merge (see spec.md US1).
  `fmt` (task-workflow-panel.mjs) stays local — different rounding convention, not a duplicate.
- **US2 (Escalation & spec-modal actions)**: new `escalation-actions.mjs` exports `postAction`, `actEsc`,
  `unblockEsc`, `snoozeEsc`, `skipEsc`, `copySession`, `defaultSpecPath`, `openSpec`, `loadSpecComments`,
  `closeSpec`, `saveSpec`, `toggleParked`, `renderParked`. Every export already reached via an `onclick`
  attribute (in `dashboard/index.html`'s own markup, or in already-shipped `governance-panel.mjs`/
  `task-workflow-panel.mjs` generated HTML) also gets a `window.foo = foo` assignment in the same module.
- **US3 (Spend/budget/analytics)**: new `spend-budget.mjs` exports `setAnalyticsRange`, `fetchAnalytics`,
  `exportAnalyticsCSV`, `fetchBudget`, `toggleSpendPause`, `testAlert`, `renderFounderUsage`,
  `renderProviderCost`. `renderFounderUsage`/`renderProviderCost` are imported by US9's bootstrap module for
  `render(s)`'s call chain; the rest are `onclick`-reached (`window` bridge) or self-contained.
- **US4 (Cost-optimization)**: new `optimization.mjs` exports `fetchOptimization`, `applyOpt`, `dismissOpt`;
  calls `registerPollHandler(fetchOptimization)` itself at module-evaluation time, matching current behavior.
  Zero coupling to any other story.
- **US5 (IDE/MCP integration)**: new `ide-integration.mjs` exports `fetchIdeDetect`, `renderIdeCards`,
  `fetchIdeConfig`, `testIdeConn`, `fetchMcpConfig`, `fetchIdeStatus`; self-registers three poll handlers.
  Zero coupling to any other story.
- **US6 (AI Provider Subscriptions)**: new `subscriptions.mjs` (not `subscriptions-panel.mjs` — see spec.md's
  naming rationale) exports `fetchSubscriptions`, `reportBrokenSub`; self-registers one poll handler.
- **US7 (Command console & system log)**: new `daemon-console.mjs` exports `initCmdButtons`, `runCmd`,
  `clearCmdOutput`, `stopScheduler`, `restartDaemon`, `renderSystemLog`, `updateThemeIcon`; calls
  `initCmdButtons()` itself at module-evaluation time (matching the current bare top-level call at line 1505).
  `renderSystemLog` is imported by US9's bootstrap for `render(s)`'s call chain.
- **US8 (Policy levers & kill switch)**: new `policy-levers.mjs` exports `populateControls`, `collectLevers`,
  `syncReadouts`, `save`, `setDirty`, `applyKill`, `toggleKill` — exact current batch-save/dirty-flag mechanism,
  unchanged (009's T027 precedent: relocating this mechanism's architecture is out of scope). `populateControls`
  is imported by US9's bootstrap for `render(s)`'s `controlsInit`-guarded call.
- **US9 (Core bootstrap) — built last, depends on US2/US3/US7/US8 having left `render(s)`/`poll()` first**: new
  `dashboard-bootstrap.mjs` imports from every other story's module and reassembles, in the same order,
  `render(s)`, `poll()`, `startPolling`/`stopPolling`, `renderTaskCategories`, and the six workspace show/toggle
  functions (`showSettingsWorkspace`, etc. — each keeps its existing lazy dynamic-`import()` of
  `settings-workspace-bootstrap.mjs`/`team-bootstrap.mjs`/`admin-bootstrap.mjs`, unchanged). Loaded via the
  page's only remaining non-vendor `<script>` tag: `<script type="module" src="static/dashboard-bootstrap.mjs">`.
  The classic `<script>` block is deleted in this same change — not before, since everything it contains must
  resolve via `import` first.

## Technical Context

**Language/Version**: Node.js 24+ (ES modules, `.mjs` extension, `"type": "module"`) — unchanged. This phase
extends the same convention to the browser-side code that was the one remaining holdout.

**Primary Dependencies (frontend)**: None added. Zero new vendored libraries, zero new backend dependencies.
`poll-dispatcher.mjs`, `client-error-log.mjs`, and every 008/009-delivered panel module are reused unmodified
except where a story explicitly touches them (US1's fix to `task-workflow-panel.mjs`'s five local duplicates).

**Storage**: None touched. No new storage engine, no schema change.

**Testing**: Node.js native test runner (`node --test`), matching 008/009:
- `tests/dashboard-source-quality.test.mjs` gains two new assertions (FR-010): zero top-level
  `function`/`async function` declarations remain in `dashboard/index.html`, and zero non-module, non-vendor
  `<script>` tags remain. Both written and confirmed failing (red) in Phase 0, before any function moves —
  the first stays red through Phase 0 itself (the tag flip alone doesn't remove any function), both confirmed
  passing (green) only once US9 lands. This pass condition is the whole phase's completion condition, not one
  story's.
- Each story's own module gets a plain dynamic-import smoke test (mirroring
  `dashboard-source-quality.test.mjs`'s existing `client-error-log.mjs`/`poll-dispatcher.mjs` precedent) —
  cheap insurance against the exact "silent syntax error only caught live in-browser" class of bug 009 hit
  once already (a JSDoc `/* ... */` substring truncating a file mid-parse).
- No new unit tests for ported function *behavior* — this is a structural migration of already-tested (or
  already-only-live-verified) code, not new functionality. Each story's Independent Test in spec.md remains a
  live-browser check, matching 008/009's own precedent for frontend-only work with no `.mjs` module boundary to
  unit-test around DOM rendering.
- Full existing suite (`npm test`) must continue to pass with zero regressions (spec.md SC-005), checked after
  every story, not just at the end — matching this phase's own "each change independently revertible"
  constraint below.

**Target Platform**: Unchanged — Node.js daemon (Windows/macOS/Linux), embedded dashboard HTTP server.

**Project Type**: Same flat-repo Node.js daemon/orchestrator structure as the rest of the codebase.

**Performance Goals**: None — this phase changes where code lives, not what it does or when it runs. ES
modules load with `defer` semantics (same as the classic script's actual parse-then-run timing); no new
network request beyond nine additional `<script type="module">`-triggered file fetches, cached identically to
the existing `dashboard/static/*.mjs` panel files.

**Constraints**:
- Zero new runtime dependencies, zero new vendored frontend libraries.
- Pure refactor: no behavior, layout, or visual change, except the two explicitly-documented latent-bug fixes
  (`formatNumber` de-duplication, `esc`/`escapeHtml` consolidation — see spec.md US1 and Assumptions).
- Every existing `onclick`/`onchange` attribute (35 sites total: 25 in `dashboard/index.html`, 10 in
  already-shipped panel-generated HTML) MUST keep working via an explicit `window.foo = foo` bridge — no
  `addEventListener` rewrite in this phase (spec.md Assumptions). All 35 bridges are established in Phase 0
  (the `type="module"` tag flip), not spread across later stories, since that flip is what stops auto-exposing
  top-level declarations on `window` in the first place.
- No content is promoted from the fixed legacy-board layout into the `registerPanel()` workspace grid — that's
  a layout change, out of scope (spec.md Assumptions).
- **Phase 0 must land before US1**: flipping `dashboard/index.html`'s script tag to `type="module"` is the
  prerequisite that makes every later story safe as pure within-module refactoring (see Summary). Without it,
  one-story-at-a-time deletion from a still-classic script creates a transient window where `render(s)`/`poll()`
  (which don't move until US9) call a function no longer defined anywhere reachable.
- US9 still lands last within the module world: `render(s)`/`poll()` directly call into US2/US3/US7/US8
  content today; each of those stories must resolve its own piece via `import` before US9 can remove the
  now-empty inline `<script type="module">` block that currently still houses them.
- Migration proceeds one story at a time after Phase 0, each independently reviewable and independently
  revertible — same strangler-fig discipline as 009, not a single big-bang diff.

**Scale/Scope**: 64 unique top-level functions (65 declarations, one duplicate), ~1,150 lines of classic-script
content, across 9 new modules. Six of `task-workflow-panel.mjs`'s existing local functions are touched (US1's
consolidation) — the only already-shipped file this phase modifies beyond `dashboard/index.html` itself.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Assessment |
|---|-----------|--------|-----------|
| I | Provider & Model Agnosticism | ✅ PASS, not applicable | Not touched — no provider/model logic changes, only where existing display code lives. |
| II | Gateway as Single Source of Truth | ✅ PASS | No read/write path around the gateway changes; every ported function keeps calling the exact same existing endpoints. |
| III | Zero-Dependency Philosophy | ✅ PASS, no exception needed | Zero new dependencies, zero new vendored assets — this phase only reorganizes existing first-party code. |
| IV | Test-First Discipline | ✅ PASS | `tests/dashboard-source-quality.test.mjs`'s new assertion (FR-010) is written and confirmed red before US1 starts; confirmed green only after US9 lands, per Red-Green-Refactor. |
| V | Configuration over Code | ✅ PASS, not applicable | No new configurable behavior — pure code organization. |
| VI | Observability & Auditability | ✅ PASS, reinforced | US4/US5/US6's self-registering `registerPollHandler()` calls (already the current behavior) are preserved exactly, keeping 009's per-panel error isolation intact for every ported area. |
| VII | Non-Technical Usability | ✅ PASS, not applicable | Zero visible/behavioral change for an operator using the dashboard — this is entirely a maintainer-facing code-organization phase. |
| VIII | ES Modules & Modern JavaScript | ✅ **PASS — this phase closes 009's flagged `⚠️ PARTIAL`** | Zero top-level function declarations remain in `dashboard/index.html`; zero classic (non-vendor) `<script>` tags remain; `import`/`export` used exclusively. The `window.foo = foo` bridges (FR-005) are `export`ed functions *additionally* exposed for HTML-attribute compatibility — the module itself is fully ESM-compliant; see spec.md Assumptions for why this bridge doesn't violate the principle's literal text (module syntax vs. event-wiring style are separate concerns). |
| IX | PR Discipline & Code Review | ✅ PASS | Delivered as one independently-reviewable, independently-revertible change per user story (9 total), matching this phase's own Constraints and 009's precedent. |
| X | Spec-Driven Development | ✅ PASS | spec.md → plan.md → tasks.md → implement, following `HOW-TO-START.md`'s explicit instructions for this phase. |

**Gate Result: ALL 10 PRINCIPLES PASS.** Unlike 009, this phase carries no partial/deferred principle forward —
closing Principle VIII's `⚠️ PARTIAL` status is the entire point of this phase, not a side effect of it.

### Post-Design Re-Check

The `window.foo = foo` bridge pattern (FR-005) is not a new architectural idea — 009's own
`governance-panel.mjs`/`task-workflow-panel.mjs` already rely on the *inverse* of this exact bridge today
(calling classic-script globals from module-generated HTML). This phase completes the pattern symmetrically:
after US2/US3/US7/US8 land, the functions being called are `export`ed from real modules that *also* set the
`window` property, rather than being bare classic-script globals that happen to be reachable. No consumer-side
change is needed in `governance-panel.mjs`/`task-workflow-panel.mjs` for this to keep working.

`dashboard-bootstrap.mjs`'s dependency on eight other modules (US1–US8) is a plain `import` graph, not a new
registration mechanism — consistent with `registerPanel()`/`registerPollHandler()`'s existing "explicit
function call, not a magic global" convention.

## Project Structure

### Documentation (this feature)

```text
specs/010-frontend-es-module-migration/
├── HOW-TO-START.md      # Pre-existing — how this spec came to be drafted
├── plan.md              # This file
├── tasks.md             # Phase 2 output — dependency-ordered task breakdown
└── spec.md              # Feature specification
```

Following 008/009's lighter three-file convention (spec/plan/tasks only, plus this phase's pre-existing
`HOW-TO-START.md`) — no new data model or public API contract, so `data-model.md`/`contracts/` would be empty
scaffolding.

### Source Code (repository root — flat layout, existing convention)

```text
dashboard/
├── index.html                    # MODIFIED — Phase 0: remaining <script> gains type="module" (+35 window
│                                  #   bridges, same file, same functions); US1-US8: functions move out one
│                                  #   story at a time; US9: the now-empty inline <script type="module"> block
│                                  #   is removed, replaced by <script type="module" src="static/dashboard-bootstrap.mjs">
└── static/
    ├── dashboard-utils.mjs       # NEW (US1) — esc, relTime, formatSpend, formatNumber, shortModel, badgeFor,
    │                              #   outcomeBadge
    ├── escalation-actions.mjs    # NEW (US2) — postAction, actEsc, unblockEsc, snoozeEsc, skipEsc, copySession,
    │                              #   defaultSpecPath, openSpec, loadSpecComments, closeSpec, saveSpec,
    │                              #   toggleParked, renderParked
    ├── spend-budget.mjs          # NEW (US3) — setAnalyticsRange, fetchAnalytics, exportAnalyticsCSV,
    │                              #   fetchBudget, toggleSpendPause, testAlert, renderFounderUsage,
    │                              #   renderProviderCost
    ├── optimization.mjs          # NEW (US4) — fetchOptimization, applyOpt, dismissOpt
    ├── ide-integration.mjs       # NEW (US5) — fetchIdeDetect, renderIdeCards, fetchIdeConfig, testIdeConn,
    │                              #   fetchMcpConfig, fetchIdeStatus
    ├── subscriptions.mjs         # NEW (US6) — fetchSubscriptions, reportBrokenSub
    ├── daemon-console.mjs        # NEW (US7) — initCmdButtons, runCmd, clearCmdOutput, stopScheduler,
    │                              #   restartDaemon, renderSystemLog, updateThemeIcon
    ├── policy-levers.mjs         # NEW (US8) — populateControls, collectLevers, syncReadouts, save, setDirty,
    │                              #   applyKill, toggleKill
    ├── dashboard-bootstrap.mjs   # NEW (US9) — render, poll, startPolling, stopPolling, renderTaskCategories,
    │                              #   showSettingsWorkspace/toggleSettingsWorkspace/showTeamWorkspace/
    │                              #   toggleTeamWorkspace/showAdminWorkspace/toggleAdminWorkspace; imports
    │                              #   every module above
    └── task-workflow-panel.mjs   # MODIFIED (009-owned, US1 only) — five local duplicate utilities removed,
                                   #   imports from dashboard-utils.mjs instead; fmt() stays local (unchanged)
tests/
└── dashboard-source-quality.test.mjs # MODIFIED — new assertion: zero top-level function declarations remain
                                       #   in dashboard/index.html (FR-010)
```

## Phased Delivery

0. **Prerequisite: flip to `type="module"`** (no user story — a structural precondition every story after it
   depends on). `dashboard/index.html`'s remaining `<script>` tag gains `type="module"`; all 35
   `onclick`/`onchange`-reached functions gain explicit `window.foo = foo` assignments in the same change (the
   flip alone would otherwise silently break every one of them); any strict-mode-incompatible pattern found is
   fixed; live-verified that vendor script order reversal (confirmed safe — see Summary) doesn't break
   anything in practice, not just in theory. Zero function relocation happens in this step — same 64 functions,
   same file, only the tag and the `window` bridges change.
1. **Shared utilities** (US1) — `dashboard-utils.mjs`, plus the `task-workflow-panel.mjs` de-duplication. Built
   first because every other story imports from it; lowest risk in isolation, but touches an already-shipped
   file, so its own live-verification (governance/task-workflow panels still render correctly) matters more
   than its size suggests.
2. **Escalation & spec-modal actions** (US2) — `escalation-actions.mjs`. Highest-value early port: closes an
   already-incurred cross-module dependency (governance-panel.mjs/task-workflow-panel.mjs already call these as
   globals).
3. **Self-contained content areas** (US3, US4, US5, US6) — `spend-budget.mjs`, `optimization.mjs`,
   `ide-integration.mjs`, `subscriptions.mjs`. Independent of each other, safe to build in any order or in
   parallel; grouped together here because none depends on or blocks any other story in this group.
4. **Cross-cutting infrastructure** (US7, US8) — `daemon-console.mjs`, `policy-levers.mjs`. Sequenced after the
   content areas above because both are imported by US9's bootstrap (`renderSystemLog`, `populateControls`) and
   benefit from the module-with-self-initialization pattern being proven on US4/US5/US6's simpler ground first.
5. **Core bootstrap + classic script deletion** (US9) — `dashboard-bootstrap.mjs`. Last, by hard dependency:
   `render(s)`/`poll()` must resolve every other story's content via `import` before the classic script
   defining them as bare globals can be deleted. This step is the phase's actual completion condition
   (FR-010/SC-001/SC-002).
