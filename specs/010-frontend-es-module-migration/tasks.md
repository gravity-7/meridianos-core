# Tasks: Frontend ES Module Migration

**Input**: Design documents from `specs/010-frontend-es-module-migration/`

**Prerequisites**: plan.md (required), spec.md (required)

**Tests**: `tests/dashboard-source-quality.test.mjs` gains two new assertions, written and confirmed red in
Phase 1, before Phase 2's `type="module"` flip (Constitution Principle IV). Both stay red through the flip
itself (it moves zero functions) and through every user-story phase after it, confirmed green only in Phase 11
(US9) — the whole phase's completion condition, not any single story's. Each story also gets a plain
dynamic-import smoke test for its new module (mirrors `dashboard-source-quality.test.mjs`'s existing
`client-error-log.mjs`/`poll-dispatcher.mjs` precedent) — a regression guard, expected to pass as soon as
written, not a red-first artifact.

**Organization**: Phase 2 (the `type="module"` flip) is a hard prerequisite for every user story —
**not optional, not skippable, not reorderable** — because it resolves a real sequencing hazard: one-story-
at-a-time deletion from a still-classic script would leave `render(s)`/`poll()` (which don't move until US9)
calling functions no longer defined anywhere reachable, and a `window`-bridge can't rescue that mid-migration
because module `<script>` tags are deferred relative to a non-`defer` classic script (see plan.md Summary).
After Phase 2, every story is pure within-module refactoring. Stories are then sequenced: US1 (shared
utilities, everything else imports it) → US2 (highest-value: already-shipped panels depend on it as globals
today) → US3/US4/US5/US6 (self-contained content areas, any order, grouped together) → US7/US8 (cross-cutting
infrastructure, imported by US9) → US9 (core bootstrap, hard-depends on US2/US3/US7/US8 having left
`render(s)`/`poll()` first).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies between the [P]-marked tasks)
- **[Story]**: US1 (Shared Utilities), US2 (Escalation/Spec-Modal Actions), US3 (Spend/Budget/Analytics), US4
  (Cost-Optimization), US5 (IDE/MCP Integration), US6 (AI Provider Subscriptions), US7 (Command Console), US8
  (Policy Levers), US9 (Core Bootstrap)

---

## Phase 1: Setup (Verification Baseline + Exhaustive Inventory)

- [X] T001 Run full test suite to establish baseline: `npm test` — confirm current pass count, 0 new failures
- [X] T002 [P] Exhaustive inventory, not a re-guess at implementation time: every `onclick=`/`onchange=` site
  across `dashboard/index.html` **and all 21 files** in `dashboard/static/*.mjs` (this spec's own drafting
  spot-checked only `governance-panel.mjs`/`task-workflow-panel.mjs`/`providers-models-panel.mjs`/
  `agent-budget-panel.mjs` — confirm the remaining 17 files, e.g. `task-comments.mjs`/`settings-panels.mjs`,
  don't also call one of the 64 functions being migrated); every near-duplicate definition of
  `esc`/`relTime`/`formatSpend`/`formatNumber`/`shortModel`/`badgeFor`/`outcomeBadge` (or a differently-named
  equivalent, e.g. `escapeHtml`/`fmt`) across the same file set. This is the exact scope Phase 2's `window`
  bridges and US1's consolidation work against.
- [X] T003 [P] Add two new assertions to `tests/dashboard-source-quality.test.mjs`: (a) zero top-level
  `function`/`async function` declarations remain in `dashboard/index.html`; (b) zero `<script>` tags without
  `type="module"` remain in `dashboard/index.html`, excluding the three vendor `<script src>` includes. Confirm
  both FAIL (red) — 65 declarations and 1 classic script currently exist.

---

## Phase 2: Prerequisite — Flip `dashboard/index.html` to `type="module"` (blocks every user story)

**Goal**: Resolve the sequencing hazard described in plan.md Summary, once, upfront — zero function
relocation in this phase, same 64 functions in the same file, only the script tag and `window` exposure
change.

**Independent Test**: Fresh page load in a clean tab; zero console errors; every one of T002's inventoried
`onclick`/`onchange` sites still fires correctly; vendor scripts (now loading before the now-deferred main
script, a reversal from today) still initialize correctly.

- [X] T004 Add `type="module"` to `dashboard/index.html`'s remaining `<script>` tag (line 882) — no other
  change in this task.
- [X] T005 Using T002's inventory, add `window.foo = foo` immediately after every one of the 64 function
  declarations that is reached via an `onclick`/`onchange` attribute anywhere (in `dashboard/index.html`'s own
  markup or in already-shipped panel-generated HTML) — module scope stops auto-exposing top-level declarations
  on `window`, so this is what keeps all 35 sites working through the entire migration, not just through this
  one change.
- [X] T006 Fix any strict-mode-incompatible pattern the flip surfaces (module scope is strict by default) —
  expected to be none or near-none based on this phase's design-time read of the script, but confirm rather
  than assume.
- [X] T007 Verify live in a clean browser tab: zero console errors on load; spot-check at least one
  `onclick` site from each of dashboard/index.html's own markup, governance-panel.mjs's generated HTML, and
  task-workflow-panel.mjs's generated HTML; confirm uPlot/Muuri/LiteGraph-dependent panels
  (observability-panels.mjs, the workspace grid) still render correctly under the reversed vendor-script order.
- [X] T008 Full test suite: confirm zero regressions from this structural-only change before any story starts.

---

## Phase 3: User Story 1 - Shared Formatting Utilities (Priority: P1, built first)

**Goal**: One definition each of `esc`, `relTime`, `formatSpend`, `formatNumber`, `shortModel`, `badgeFor`,
`outcomeBadge` — every other story imports from here.

**Independent Test**: Grep for duplicate definitions of these names (or `escapeHtml`/`fmt`-style equivalents)
across `dashboard/index.html` and `dashboard/static/*.mjs` — zero duplicates, `formatNumber` drops from two
definitions to one.

- [X] T009 [US1] Create `dashboard/static/dashboard-utils.mjs`, exporting `esc` (consolidated: quote-escaping
  behavior, i.e. `task-workflow-panel.mjs`'s current `escapeHtml`, not `dashboard/index.html`'s weaker `esc` —
  see spec.md US1 for why), `relTime` (consolidated: NaN-guard **and** negative-timestamp clamp, combining both
  source versions' protections), `formatSpend`, `formatNumber` (single definition, `'K'`-suffix behavior — the
  one that already silently wins today, not the dead `'k'`-suffix version), `shortModel`, `badgeFor`,
  `outcomeBadge` (these three are logic-identical between sources — mechanical port).
- [X] T010 [US1] [P] Add a dynamic-import smoke test for `dashboard-utils.mjs` to
  `tests/dashboard-source-quality.test.mjs`, asserting each of the seven exports is the expected type.
- [X] T011 [US1] In `dashboard/index.html`: delete the 8 now-redundant declarations (7 names, including both
  `formatNumber` definitions), add `import { esc, relTime, formatSpend, formatNumber, shortModel, badgeFor,
  outcomeBadge } from './static/dashboard-utils.mjs'`.
- [X] T012 [US1] In `dashboard/static/task-workflow-panel.mjs`: delete its five local duplicates
  (`escapeHtml`, `relTime`, `shortModel`, `badgeFor`, `outcomeBadge`), import the consolidated versions from
  `dashboard-utils.mjs` instead (aliasing `esc` back to `escapeHtml` at the import site is acceptable to
  minimize call-site churn in an otherwise-untouched file). `fmt()` stays local, untouched — deliberately
  distinct rounding behavior, not a duplicate (see spec.md US1).
- [X] T013 [US1] Verify live: governance panel and task-workflow panel render and behave identically; confirm
  a task ID or session string containing a single quote no longer breaks its `onclick` attribute (the
  `esc`/`escapeHtml` consolidation's actual fix).
- [X] T014 [US1] Full test suite: zero regressions.

---

## Phase 4: User Story 2 - Escalation & Spec-Modal Actions Become a Real Module (Priority: P1)

**Goal**: `governance-panel.mjs`/`task-workflow-panel.mjs`'s existing dependency on these as `window` globals
gets a real module behind it instead of a classic-script coincidence.

**Independent Test**: Live-verify every escalation action button (Approve/Snooze/Skip/Open task/Dismiss) in
both panels, plus parked-task unskip/unsnooze and the spec modal's open/comment/save/close flow.

- [X] T015 [US2] Create `dashboard/static/escalation-actions.mjs`, exporting `postAction`, `actEsc`,
  `unblockEsc`, `snoozeEsc`, `skipEsc`, `copySession`, `defaultSpecPath`, `openSpec`, `loadSpecComments`,
  `closeSpec`, `saveSpec`, `toggleParked`, `renderParked`. Per T002's inventory, add `window.foo = foo` for
  every export reached via an existing `onclick` attribute (at minimum: `postAction`, `unblockEsc`, `openSpec`,
  `copySession`, `defaultSpecPath`, `actEsc`, `skipEsc`, `toggleParked` — confirm the complete set against
  T002 rather than this list alone).
- [X] T016 [US2] [P] Add a dynamic-import smoke test for `escalation-actions.mjs`.
- [X] T017 [US2] In `dashboard/index.html`: delete these 13 now-redundant declarations, add the corresponding
  `import`; update `render(s)`'s `renderParked(s.parked||[])` call site to use the imported version (`render`
  itself stays in `dashboard/index.html` until US9 — only this one call site's resolution changes).
- [X] T018 [US2] Verify live: every escalation action button in governance-panel.mjs and task-workflow-panel.mjs;
  parked-task unskip/unsnooze; spec modal open/comment/save/close.
- [X] T019 [US2] Full test suite: zero regressions.

---

## Phase 5: User Story 3 - Spend/Budget/Analytics Legacy Surfaces Become a Real Module (Priority: P2)

**Goal**: Give `founderUsage`/`provider-spend-7d`/budget-intelligence — already confirmed non-duplicate content
by 009's T017 — a real module home.

**Independent Test**: Live-verify the analytics range buttons, CSV export, budget-intelligence card,
provider-spend-7d card, and founder-usage card all render and behave identically to pre-migration.

- [X] T020 [US3] Create `dashboard/static/spend-budget.mjs`, exporting `setAnalyticsRange`, `fetchAnalytics`,
  `exportAnalyticsCSV`, `fetchBudget`, `toggleSpendPause`, `testAlert`, `renderFounderUsage`,
  `renderProviderCost`. Add `window.foo = foo` for `onclick`-reached exports per T002 (at minimum
  `setAnalyticsRange`, `exportAnalyticsCSV`, `toggleSpendPause`, `testAlert`).
- [X] T021 [US3] [P] Add a dynamic-import smoke test for `spend-budget.mjs`.
- [X] T022 [US3] In `dashboard/index.html`: delete these 8 now-redundant declarations, add the corresponding
  `import`; update `render(s)`'s `renderFounderUsage(s.budget)`/`renderProviderCost(...)` call sites.
- [X] T023 [US3] Verify live: analytics range buttons (1d/7d/30d/90d), CSV export, budget-intelligence card,
  provider-spend-7d card, founder-usage card, pause-spend toggle, test-alert button.
- [X] T024 [US3] Full test suite: zero regressions.

---

## Phase 6: User Story 4 - Cost-Optimization Suggestions Become a Real Module (Priority: P2)

**Goal**: Close a gap 009 never touched or documented — fully self-contained, already dispatcher-registered.

**Independent Test**: Live-verify a suggestion's Apply/Dismiss buttons still work and still trigger a re-fetch.

- [X] T025 [US4] Create `dashboard/static/optimization.mjs`, exporting `fetchOptimization`, `applyOpt`,
  `dismissOpt`; calls `registerPollHandler(fetchOptimization)` itself at module-evaluation time. Add
  `window.foo = foo` for `applyOpt`/`dismissOpt` (both `onclick`-reached).
- [X] T026 [US4] [P] Add a dynamic-import smoke test for `optimization.mjs`.
- [X] T027 [US4] In `dashboard/index.html`: delete these 3 declarations and the now-redundant
  `registerPollHandler(fetchOptimization)` call (the module's own import triggers self-registration); add the
  `import`.
- [X] T028 [US4] Verify live: optimization suggestions list renders; Apply/Dismiss buttons work and re-fetch.
- [X] T029 [US4] Full test suite: zero regressions.

---

## Phase 7: User Story 5 - IDE & MCP Integration Becomes a Real Module (Priority: P2)

**Goal**: Close another gap 009 never touched or documented — fully self-contained, already
dispatcher-registered.

**Independent Test**: Live-verify IDE cards render, "Test connection" works, MCP config status displays.

- [X] T030 [US5] Create `dashboard/static/ide-integration.mjs`, exporting `fetchIdeDetect`, `renderIdeCards`,
  `fetchIdeConfig`, `testIdeConn`, `fetchMcpConfig`, `fetchIdeStatus`; calls
  `registerPollHandler(fetchIdeDetect)`, `registerPollHandler(fetchMcpConfig)`,
  `registerPollHandler(fetchIdeStatus)` itself at module-evaluation time. Add `window.foo = foo` for
  `fetchIdeConfig`/`testIdeConn` (both `onclick`-reached).
- [X] T031 [US5] [P] Add a dynamic-import smoke test for `ide-integration.mjs`.
- [X] T032 [US5] In `dashboard/index.html`: delete these 6 declarations and the 3 now-redundant
  `registerPollHandler(...)` calls; add the `import`.
- [X] T033 [US5] Verify live: IDE cards render; "Test connection" button; MCP config status.
- [X] T034 [US5] Full test suite: zero regressions.

---

## Phase 8: User Story 6 - AI Provider Subscriptions Becomes a Real Module (Priority: P2)

**Goal**: Create the module 009's `plan.md` sketched but never actually delivered (see spec.md Context).

**Independent Test**: Live-verify the "AI Provider Subscriptions" card and its "Report broken" button.

- [X] T035 [US6] Create `dashboard/static/subscriptions.mjs`, exporting `fetchSubscriptions`,
  `reportBrokenSub`; calls `registerPollHandler(fetchSubscriptions)` itself at module-evaluation time. Add
  `window.reportBrokenSub = reportBrokenSub` (`onclick`-reached).
- [X] T036 [US6] [P] Add a dynamic-import smoke test for `subscriptions.mjs`.
- [X] T037 [US6] In `dashboard/index.html`: delete these 2 declarations and the now-redundant
  `registerPollHandler(fetchSubscriptions)` call; add the `import`.
- [X] T038 [US6] Verify live: "AI Provider Subscriptions" card renders; "Report broken" button works.
- [X] T039 [US6] Full test suite: zero regressions.

---

## Phase 9: User Story 7 - Command Console & System Log Become a Real Module (Priority: P3)

**Goal**: Port the daemon-control surface, including the one piece of load-time initialization
(`initCmdButtons()`) that isn't dispatcher- or `onclick`-triggered.

**Independent Test**: Live-verify a Quick Command button runs and streams output, the system log updates every
poll tick, and the theme toggle still updates its icon.

- [X] T040 [US7] Create `dashboard/static/daemon-console.mjs`, exporting `initCmdButtons`, `runCmd`,
  `clearCmdOutput`, `stopScheduler`, `restartDaemon`, `renderSystemLog`, `updateThemeIcon`; calls
  `initCmdButtons()` itself at module-evaluation time (matching the current bare top-level call at line 1505).
  Add `window.foo = foo` for `onclick`-reached exports per T002 (at minimum `clearCmdOutput`, `stopScheduler`,
  `restartDaemon`; `runCmd` is called from dynamically-generated command-button HTML — confirm against T002).
- [X] T041 [US7] [P] Add a dynamic-import smoke test for `daemon-console.mjs`.
- [X] T042 [US7] In `dashboard/index.html`: delete these 7 declarations and the now-redundant bare
  `initCmdButtons();` call; add the `import`; update `render(s)`'s `renderSystemLog(s.systemLog||[])` call site.
- [X] T043 [US7] Verify live: Quick Command buttons run and stream output; Stop/Restart scheduler; system log
  updates every tick; theme toggle icon updates on click.
- [X] T044 [US7] Full test suite: zero regressions.

---

## Phase 10: User Story 8 - Policy-Lever Batch-Save Mechanism Becomes a Real Module (Priority: P3)

**Goal**: Move the mechanism 009's T027 explicitly declined to restructure, without restructuring it here
either — same batch-save/dirty-flag semantics, just in a module.

**Independent Test**: Live-verify two levers changed before saving are written in one batch request; kill
switch toggles and rolls back on failure exactly as today.

- [X] T045 [US8] Create `dashboard/static/policy-levers.mjs`, exporting `populateControls`, `collectLevers`,
  `syncReadouts`, `save`, `setDirty`, `applyKill`, `toggleKill` — exact current batch-collect/batch-save/
  dirty-flag/kill-switch-rollback mechanism, unchanged. Add `window.foo = foo` for `onclick`-reached exports
  per T002 (at minimum `toggleKill`, `save` if directly wired).
- [X] T046 [US8] [P] Add a dynamic-import smoke test for `policy-levers.mjs`.
- [X] T047 [US8] In `dashboard/index.html`: delete these 7 declarations, add the `import`; update `render(s)`'s
  `controlsInit`-guarded `populateControls(s.policy||{})` call site.
- [X] T048 [US8] Verify live: changing a lever shows the dirty indicator; Save batch-writes every changed
  lever in one request; kill switch toggles and rolls back to `previousKill` on a simulated save failure.
- [X] T049 [US8] Full test suite: zero regressions.

---

## Phase 11: User Story 9 - Core Bootstrap: the Inline Script Is Deleted (Priority: P1, sequenced last)

**Goal**: The phase's actual finish line — `dashboard/index.html` ships zero inline application logic.

**Independent Test**: Fresh page load in a clean tab; zero console errors; workspace renders as the default
view; polling starts automatically; `tests/dashboard-source-quality.test.mjs`'s two Phase 1 assertions both
pass green.

- [X] T050 [US9] Create `dashboard/static/dashboard-bootstrap.mjs`, exporting/running `render`, `poll`,
  `startPolling`, `stopPolling`, `renderTaskCategories`, `showSettingsWorkspace`, `toggleSettingsWorkspace`,
  `showTeamWorkspace`, `toggleTeamWorkspace`, `showAdminWorkspace`, `toggleAdminWorkspace`. Imports from all
  eight prior modules to reproduce `render(s)`'s exact call sequence (FR-008: `renderFounderUsage` →
  `renderProviderCost` → clock/kill-switch inline updates → `renderParked` → `renderTaskCategories` →
  `renderSystemLog` → `controlsInit`-guarded `populateControls`) and the top-level init sequence (FR-009: the
  `visibilitychange` listener, `startPolling()`, and finally `showSettingsWorkspace()` — in that order,
  preserving the documented TDZ-avoidance ordering at `dashboard/index.html:2016-2020`). Add
  `window.foo = foo` for the six workspace show/toggle functions (all `onclick`-reached from nav buttons).
- [X] T051 [US9] [P] Add a dynamic-import smoke test for `dashboard-bootstrap.mjs`.
- [X] T052 [US9] In `dashboard/index.html`: remove the now-empty inline `<script type="module">` block (lines
  882–2024's remaining content) entirely; replace with
  `<script type="module" src="static/dashboard-bootstrap.mjs"></script>`.
- [X] T053 [US9] Confirm both of T003's source-scan assertions now pass (green) — zero top-level function
  declarations, zero non-module non-vendor `<script>` tags.
- [X] T054 [US9] Verify live in a fresh, clean browser tab: zero console errors; workspace is the default view;
  polling starts automatically; Team/Admin/Settings nav buttons still lazy-load their respective
  `-bootstrap.mjs` modules on first open, exactly as before.
- [X] T055 [US9] Full test suite: zero regressions.

---

## Phase 12: Polish & Cross-Cutting Verification

- [X] T056 Full source-scan pass — confirm every grep-verifiable success criterion holds: SC-001 (zero
  top-level function declarations), SC-002 (zero non-module non-vendor `<script>` tags), SC-003 (zero
  duplicate utility definitions), SC-007 (`dashboard-source-quality.test.mjs`'s full assertion set, existing 4
  + this phase's 2, all green).
- [X] T057 Final full `npm test` run: confirm zero regressions against the Phase 1 (T001) baseline.
- [X] T058 Confirm the archived Phase Structure Overview records the frontend ES-module migration (listed as P9 in that document's historical numbering), referencing `specs/010-frontend-es-module-migration/` and summarizing the latent bugs found and fixed along the way.
  referencing `specs/010-frontend-es-module-migration/` and summarizing the two latent bugs found and fixed
  along the way (`formatNumber` shadowing, `esc`/`escapeHtml` quote-escaping gap) — matching 008/009's own
  closing-task precedent.
