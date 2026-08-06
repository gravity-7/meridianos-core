# Tasks: Dashboard Modernization & Observability Hardening

**Input**: Design documents from `specs/009-dashboard-modernization/`

**Prerequisites**: plan.md (required), spec.md (required)

**Tests**: Test tasks included per Constitution Principle IV (Test-First Discipline) — the source-scan
regression test (T007) is written before the code that makes it pass (T008/T009), matching Red-Green-Refactor.

**Organization**: Grouped by user story per plan.md's Phased Delivery order — US3 (observability/dispatcher
foundation) first since every later story builds on it, then US5's foundation slice (design tokens applied to
the panels that already exist), then US1 (spend/budget consolidation), then US4 (falls out of US1, extends to
governance/scheduler), then US2 (the largest remaining surface, sequenced once the foundation is proven), then
US6 (smallest, no dependencies, sequenced last to match spec.md's own priority).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 (Spend/Budget), US2 (Workspace Promotion), US3 (Observability), US4 (Status/Controls
  Co-location), US5 (Design Tokens), US6 (Naming/Model-List)

---

## Phase 1: Setup (Verification Baseline)

- [ ] T001 Run full test suite to establish baseline: `npm test` — confirm current pass count, 0 failures
- [ ] T002 [P] Inventory every `catch` block in `dashboard/index.html` and `dashboard/static/*.mjs`, marking
  each empty/no-op vs. already-logging; inventory every `poll = async function(...)` reassignment site — this
  is the exact scope T007/T008/T009 work against, not a re-guess at implementation time

---

## Phase 2: User Story 3 — Observability & Error-Visibility Hardening (Priority: P1, built first)

**Goal**: No dashboard error is ever silently discarded; recurring behavior registers through a stable
dispatcher instead of reassigning the global `poll` function.

**Independent Test**: Grep the dashboard source for empty/no-op `catch` blocks (must be zero). Deliberately
throw inside one panel's render path and confirm it surfaces in-UI, is logged, and doesn't affect siblings.

- [ ] T003 [US3] Create `tests/client-error-endpoint.test.mjs` — covers: valid payload forwarded to
  `daemon-logger.mjs`, missing/malformed payload rejected with a clear error, no crash on logger failure
- [ ] T004 [US3] Implement `POST /api/client-error` in `dashboard/server.mjs` — validates
  `{source, message, stack?, timestamp}`, forwards to the existing `daemon-logger.mjs` structured-logging path
- [ ] T005 [US3] [P] Create `dashboard/static/client-error-log.mjs` — `reportError(source, error)`: sets the
  calling panel's visible error state in the DOM, then `fetch('/api/client-error', ...).catch(()=>{})` — the
  *reporting* transport is the only place a failure is allowed to be silent, never the original error
- [ ] T006 [US3] [P] Create `dashboard/static/poll-dispatcher.mjs` — `registerPollHandler(fn)` appends to a
  subscriber list; `runPollHandlers()` invokes each registered handler once per tick, wrapping each in its own
  try/catch that reports via `client-error-log.mjs` — one handler throwing must not stop the others (mirrors
  panel isolation, FR-005)
- [ ] T007 [US3] Create `tests/dashboard-source-quality.test.mjs` — asserts zero empty/no-op `catch` blocks
  and zero `poll = async function` reassignment patterns remain in `dashboard/index.html`. **Expected to FAIL
  until T008/T009 land** — write and confirm it fails first (red), per Constitution Principle IV
- [ ] T008 [US3] Replace the three-layer `poll = async function(){...}` reassignment chain in
  `dashboard/index.html` with `registerPollHandler()` calls against `poll-dispatcher.mjs`
- [ ] T009 [US3] Replace every empty/no-op `catch` block identified in T002 (across `dashboard/index.html` and
  `dashboard/static/*.mjs`) with a call to `client-error-log.mjs`'s `reportError()`
- [ ] T010 [US3] Confirm T007's source-scan test now passes (green)
- [ ] T011 [US3] Verify live in browser: deliberately throw inside one panel's render path; confirm only that
  panel shows an error state, no sibling panel is affected, and the error reaches
  `POST /api/client-error`/`daemon-logger.mjs` output

---

## Phase 3: User Story 5 — Design Tokens + uPlot Theming, foundation slice (Priority: P2, sequenced early)

**Goal**: A shared `design-tokens.css`, applied first to the three existing 008 observability panels, so every
panel built from Phase 4 onward lands pre-themed rather than needing rework later.

**Independent Test**: Visual review against the defined token palette; confirm no panel uses ad hoc inline
colors/spacing outside the token set; confirm correct rendering in both light and dark themes.

- [ ] T012 [US5] [P] Create `dashboard/static/design-tokens.css` — hand-port the specific Tabler token
  *values* wanted (color scale, spacing scale, font stack) as CSS custom properties, extending
  `dashboard/index.html`'s existing `var(--text-primary)`/`var(--surface-1)` convention rather than replacing
  it. Tabler itself is referenced, never vendored (Constitution Principle III stays a clean PASS)
- [ ] T013 [US5] Create `buildUplotTheme()` (in `dashboard/static/observability-panels.mjs` or a new shared
  module) reading `design-tokens.css`'s custom properties into a uPlot options object: axis colors, gridlines,
  series palette, tooltip/legend styling
- [ ] T014 [US5] Apply `buildUplotTheme()` to the three existing 008 panels: Cost Over Time, Token Usage,
  Provider Spend Breakdown
- [ ] T015 [US5] Verify live in browser: toggle light/dark theme, confirm all three panels render correctly in
  both; confirm no inline ad hoc colors remain in those three panels' source

---

## Phase 4: User Story 1 — Single Source of Truth for Spend & Budget (Priority: P1)

**Goal**: Exactly one on-screen surface per spend/budget metric.

**Independent Test**: Count distinct surfaces showing "total spend" and "per-agent budget" before/after;
confirm each remaining surface traces to exactly one fetch/render path.

- [ ] T016 [US1] Remove the hand-rolled `LineChart`/`DonutChart` canvas classes from `dashboard/index.html`
- [ ] T017 [US1] Remove the legacy "spend analytics" KPI/chart section, "budget intelligence" spend-to-date/
  forecast tiles, and "provider spend · last 7d" section from `dashboard/index.html` — content is now fully
  served by the (now themed, per Phase 3) 008 observability panels
- [ ] T018 [US1] [P] Create `dashboard/static/agent-budget-panel.mjs` — merges the read-only compute-budget
  tile grid (`budgetGrid`/`renderBudgetCards`) and the editable budget-&-limits slider grid
  (`agentBudgetTiles`/`renderAgentBudgetControls`) into one `registerPanel()`-based module; writes continue
  through the existing `POST /api/policy` → `LEVER_PATHS` → `policy-write.mjs` path, no new write mechanism
- [ ] T019 [US1] Remove the now-duplicate legacy "compute budget" and "budget & limits" sections from
  `dashboard/index.html` in the same change as T018
- [ ] T020 [US1] Verify live in browser: editing a cap in the merged panel updates the usage-vs-cap display in
  that same panel without navigating elsewhere (spec.md US1 Acceptance Scenario 3)
- [ ] T021 [US1] Run full test suite — confirm zero regressions

---

## Phase 5: User Story 4 — Status/Controls Co-location (Priority: P2)

**Goal**: Governance and scheduler status render next to their controls (agent budget already solved by US1).

**Independent Test**: For each pairing, confirm status and controls render inside the same panel.

- [ ] T022 [US4] [P] Create `dashboard/static/governance-panel.mjs` — merges "needs you · action required"
  (escalation status) with "safety & governance" (policy levers) into one panel
- [ ] T023 [US4] Remove the legacy "needs you" and "safety & governance" sections from `dashboard/index.html`
  in the same change as T022
- [ ] T024 [US4] Design requirement carried into Phase 6/T027: `task-workflow-panel.mjs` must co-locate
  "runner & schedule" status with "work & scheduling" controls in one panel, not two — no separate
  implementation task here, enforced when T027 is built
- [ ] T025 [US4] Verify live in browser: a blocked escalation item is visible in the same panel as the
  governance lever gating it

---

## Phase 6: User Story 2 — Full Workspace Promotion + Remaining Legacy Migration (Priority: P1)

**Goal**: The panel-grid workspace becomes the default view; all remaining unique legacy content is ported;
each legacy section is deleted in the same change as its replacement.

**Independent Test**: After each migration step, the ported section exists only in the workspace, is fully
removed from legacy markup, and both `node:test` and a live-browser check pass.

- [ ] T026 [US2] Flip `#settingsPanel` from `display:none`/toggle-only to the dashboard's default rendered
  view on page load; keep the "⚙ Settings" nav button as a direct-navigation shortcut only (FR-003)
- [ ] T027 [US2] Create `dashboard/static/task-workflow-panel.mjs` — ports active-now, next-in-queue,
  recent-runs, system-health, verification-queue, planner-&-backlog, and (per T024) runner-&-schedule status
  merged with work-&-scheduling controls into workspace panels
- [ ] T028 [US2] Remove the corresponding legacy sections from `dashboard/index.html` in the same change as
  T027
- [ ] T029 [US2] [P] Create `dashboard/static/providers-models-panel.mjs` — ports the legacy capability
  matrix, providers list, and models list into a workspace panel
- [ ] T030 [US2] Remove the corresponding legacy sections from `dashboard/index.html` in the same change as
  T029
- [ ] T031 [US2] Extend `settings-workspace.mjs`'s `loadLayout()` to tolerate panels absent from a saved
  `localStorage` layout — new panels append to the grid rather than erroring (spec.md Edge Cases)
- [ ] T032 [US2] Verify live in browser: fresh page load renders the workspace as the default view with no
  navigation required; each ported section's markup no longer exists in the legacy portion of
  `dashboard/index.html`
- [ ] T033 [US2] Run full test suite — confirm zero regressions

---

## Phase 7: User Story 6 — Naming & Model-List Usability Cleanup (Priority: P3, sequenced last)

**Goal**: No "Subscription"/"Billing" naming collision; models list is filterable.

**Independent Test**: Grep UI copy for the remaining ambiguous collision (should be none); type a
provider/price filter into the models panel and confirm the result set narrows without a page reload.

- [ ] T034 [US6] [P] Rename "Subscription Plans" card copy to "AI Provider Subscriptions" (in
  `providers-models-panel.mjs` if T029 has landed, otherwise `dashboard/index.html`) — UI copy only, no
  identifier renames
- [ ] T035 [US6] [P] Add client-side filter/sort controls (provider, max price, min context window) to
  `providers-models-panel.mjs`'s models list, operating on the already-loaded `/api/models` response — no new
  endpoint
- [ ] T036 [US6] Verify live in browser: typing a provider or price filter narrows the ~400-row list with no
  page reload

---

## Phase 8: Polish & Cross-Cutting Verification

- [ ] T037 Full source-scan pass confirming the grep-verifiable success criteria all hold: SC-001 (1 surface
  per spend metric), SC-002 (zero `LineChart`/`DonutChart` occurrences), SC-003 (workspace is default view),
  SC-004 (zero empty `catch` blocks), SC-005 (zero `poll` reassignment pattern), SC-008 (models list filters)
- [ ] T038 Full `npm test` run — confirm SC-009 (zero regressions across the existing test suite)
- [ ] T039 Update `docs/MASTER-PLAN-CLOSE-GAPS.md`'s relevant row (or equivalent tracking doc) to reflect
  Phase 9 completion, matching 008's own closing task (T025)
