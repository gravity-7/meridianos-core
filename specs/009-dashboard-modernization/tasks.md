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

- [X] T001 Run full test suite to establish baseline: `npm test` — confirm current pass count, 0 failures
- [X] T002 [P] Inventory every `catch` block in `dashboard/index.html` and `dashboard/static/*.mjs`, marking
  each empty/no-op vs. already-logging; inventory every `poll = async function(...)` reassignment site — this
  is the exact scope T007/T008/T009 work against, not a re-guess at implementation time

---

## Phase 2: User Story 3 — Observability & Error-Visibility Hardening (Priority: P1, built first)

**Goal**: No dashboard error is ever silently discarded; recurring behavior registers through a stable
dispatcher instead of reassigning the global `poll` function.

**Independent Test**: Grep the dashboard source for empty/no-op `catch` blocks (must be zero). Deliberately
throw inside one panel's render path and confirm it surfaces in-UI, is logged, and doesn't affect siblings.

- [X] T003 [US3] Create `tests/client-error-endpoint.test.mjs` — covers: valid payload forwarded to
  `daemon-logger.mjs`, missing/malformed payload rejected with a clear error, no crash on logger failure
- [X] T004 [US3] Implement `POST /api/client-error` in `dashboard/server.mjs` — validates
  `{source, message, stack?, timestamp}`, forwards to the existing `daemon-logger.mjs` structured-logging path
- [X] T005 [US3] [P] Create `dashboard/static/client-error-log.mjs` — `reportError(source, error)`: sets the
  calling panel's visible error state in the DOM, then `fetch('/api/client-error', ...).catch(()=>{})` — the
  *reporting* transport is the only place a failure is allowed to be silent, never the original error
- [X] T006 [US3] [P] Create `dashboard/static/poll-dispatcher.mjs` — `registerPollHandler(fn)` appends to a
  subscriber list; `runPollHandlers()` invokes each registered handler once per tick, wrapping each in its own
  try/catch that reports via `client-error-log.mjs` — one handler throwing must not stop the others (mirrors
  panel isolation, FR-005)
- [X] T007 [US3] Create `tests/dashboard-source-quality.test.mjs` — asserts zero empty/no-op `catch` blocks
  and zero `poll = async function` reassignment patterns remain in `dashboard/index.html`. **Expected to FAIL
  until T008/T009 land** — write and confirm it fails first (red), per Constitution Principle IV. Also gained a
  fourth check beyond the original scope: a plain dynamic-import smoke test for client-error-log.mjs/
  poll-dispatcher.mjs, after a JSDoc comment containing a literal `/* ... */` substring silently truncated one
  of them mid-file — invisible to every regex-based check, only caught live in the browser (see T011).
- [X] T008 [US3] Replace the three-layer `poll = async function(){...}` reassignment chain in
  `dashboard/index.html` with `registerPollHandler()` calls against `poll-dispatcher.mjs`
- [X] T009 [US3] Replace every empty/no-op `catch` block identified in T002 (across `dashboard/index.html` and
  `dashboard/static/*.mjs`) with a call to `client-error-log.mjs`'s `reportError()`
- [X] T010 [US3] Confirm T007's source-scan test now passes (green)
- [X] T011 [US3] Verify live in browser: deliberately throw inside one panel's render path; confirm only that
  panel shows an error state, no sibling panel is affected, and the error reaches
  `POST /api/client-error`/`daemon-logger.mjs` output

---

## Phase 3: User Story 5 — Design Tokens + uPlot Theming, foundation slice (Priority: P2, sequenced early)

**Goal**: A shared `design-tokens.css`, applied first to the three existing 008 observability panels, so every
panel built from Phase 4 onward lands pre-themed rather than needing rework later.

**Independent Test**: Visual review against the defined token palette; confirm no panel uses ad hoc inline
colors/spacing outside the token set; confirm correct rendering in both light and dark themes.

- [X] T012 [US5] [P] Create `dashboard/static/design-tokens.css` — used the dataviz skill's validated
  reference categorical palette (8 slots) rather than hand-picking colors; re-validated against THIS
  dashboard's actual card surfaces (light `#ffffff`, dark `#1e293b`) via `validate_palette.js`, not the
  skill's generic defaults — both passed every hard gate. No sequential/diverging ramp added (nothing in the
  current panel set needs one yet). Chrome/status tokens are NOT duplicated — this file only adds the
  categorical slots that were genuinely missing.
- [X] T013 [US5] Create `buildUplotTheme()`-equivalent helpers (`cssVar()`, `categoricalColor()`,
  `uplotAxisTheme()`) directly in `dashboard/static/observability-panels.mjs` reading `design-tokens.css`'s
  custom properties. `categoricalColor()` assigns by first-seen order (cached), never by sort position — a
  provider keeps its color across re-renders even as cost-sorted order shifts (dataviz skill: "color follows
  the entity, never its rank").
- [X] T014 [US5] Applied to all three existing 008 panels: Cost Over Time and Token Usage each get one
  categorical slot (slots 1/2, per the skill's "second sequential context takes the next categorical slot"
  guidance) instead of borrowing the semantically-unrelated `--text-accent`/`--text-success` tokens; Provider
  Spend Breakdown's bars use `categoricalColor(provider)` instead of one shared accent color for every bar.
- [X] T015 [US5] Verified live: `design-tokens.css` linked into `dashboard/index.html`'s `<head>`; toggled
  dark mode and confirmed `--chart-series-1`/`--chart-series-2` resolve to the exact validated dark-mode hexes
  against the real `--surface-2`; zero console errors on a clean tab.

---

## Phase 4: User Story 1 — Single Source of Truth for Spend & Budget (Priority: P1)

**Goal**: Exactly one on-screen surface per spend/budget metric.

**Independent Test**: Count distinct surfaces showing "total spend" and "per-agent budget" before/after;
confirm each remaining surface traces to exactly one fetch/render path.

- [X] T016 [US1] Remove the hand-rolled `LineChart`/`DonutChart` canvas classes from `dashboard/index.html`
- [X] T017 [US1] **Revised from the original task wording** — a direct code comparison (not just the earlier
  audit's visual read) showed "budget intelligence" (spend-to-date/forecast/burn-rate/pause-button) and
  "provider spend · last 7d" (per-provider cost **+ token count + run count**, from `/api/status`, not
  `/api/ledger/*`) are NOT duplicates of the observability panels — deleting them would be a real feature
  regression, not cleanup. Only the two canvas chart visualizations ("Spend Over Time", "By Provider") inside
  "spend analytics" are genuinely superseded by the now-themed Cost Over Time / Provider Spend Breakdown uPlot
  panels. Scope narrowed to: remove those two `<canvas>` elements + their `new LineChart()`/`new DonutChart()`
  calls from `fetchAnalytics()`, while KEEPING the 6 KPI tiles (Total Spend, vs Prev Period, Total Tokens, API
  Calls, Top Provider, Top Model) in place — they're not duplicated anywhere else either. Budget intelligence
  and provider-spend-7d are untouched by this task.
- [X] T018 [US1] [P] Create `dashboard/static/agent-budget-panel.mjs` — merges the read-only compute-budget
  tile grid (`budgetGrid`/`renderBudgetCards`) and the editable budget-&-limits slider grid
  (`agentBudgetTiles`/`renderAgentBudgetControls`) into one `registerPanel()`-based module; writes continue
  through the existing `POST /api/policy` → `LEVER_PATHS` → `policy-write.mjs` path, no new write mechanism.
  **Real bug found and fixed while building this**: `policy-write.mjs`'s `LEVER_PATHS` hardcoded
  `claude`/`antigravity` as the only writable agent-budget/model/routing paths — never updated when the
  roster went dynamic. Every budget save for this repo's actual current roster (`builder`/`reviewer`) was
  silently rejected server-side (`path not allowed: agent_budget.builder.per_5h_tokens`) despite the sliders
  rendering normally. Added `isAgentLeverPath(path, agents)` (checked against the real configured roster,
  never an unchecked wildcard) and wired it into `applyPolicyUpdates` alongside the static `ALLOWED` set — 5
  new tests, verified live end-to-end (dragged a slider, confirmed the write persisted to `.ai/policy.yaml`).
- [X] T019 [US1] Remove the now-duplicate legacy "compute budget" and "budget & limits" sections from
  `dashboard/index.html` in the same change as T018 — `founderUsage` (genuinely unique) and the global
  warn/per-task-cap/downgrade/attribution controls (not per-agent, not duplicated) stayed in place.
- [X] T020 [US1] Verified live in browser: dragging a cap slider updates both its own output label instantly
  and, on save, the usage-vs-cap display in that same merged card — no navigation required (spec.md US1
  Acceptance Scenario 3).
- [X] T021 [US1] Full test suite: 1518 tests, 1506 pass (1501 clean baseline + 5 new `isAgentLeverPath` tests),
  same 2 pre-existing unrelated failures as the Phase 1 baseline — zero new regressions.

---

## Phase 5: User Story 4 — Status/Controls Co-location (Priority: P2)

**Goal**: Governance and scheduler status render next to their controls (agent budget already solved by US1).

**Independent Test**: For each pairing, confirm status and controls render inside the same panel.

- [X] T022 [US4] [P] Create `dashboard/static/governance-panel.mjs` — merges "needs you · action required"
  (escalation status) with "safety & governance" (policy levers) into one panel. Escalation action buttons
  (Approve/Snooze/Skip/Open task/Dismiss) reuse `openSpec`/`unblockEsc`/`snoozeEsc`/`skipEsc`/`actEsc` from
  `dashboard/index.html`'s classic script via plain `onclick` attributes (top-level `function` declarations
  in a classic script are `window` properties, reachable from any module's generated HTML) rather than
  reimplementing that task-modal-coupled logic. Governance levers save via the established `saveLever()`
  pattern.
- [X] T023 [US4] Remove the legacy "needs you" and "safety & governance" sections from `dashboard/index.html`
  in the same change as T022 — also removed their now-dead `renderEscalations()` function, 7 stale `LEVERS`
  entries, and (found live, not caught by any static check) a `['ctrls','work','gov'].forEach(...)`
  listener-attachment loop that null-derefed on `$('gov')` and broke the entire page on load — exactly the
  failure class Phase 2's US3 work exists to catch; fixed and reverified before moving on.
- [X] T024 [US4] Design requirement carried into Phase 6/T027: `task-workflow-panel.mjs` must co-locate
  "runner & schedule" status with "work & scheduling" controls in one panel, not two — no separate
  implementation task here, enforced when T027 is built
- [X] T025 [US4] Verified live in browser: the merged panel shows "Kill switch is ON"/escalation entries at
  the top and the 6 governance-lever selects + work-stealing checkbox below; changed `sensitive_actions.deploy`
  and confirmed the write actually persisted to `.ai/policy.yaml`.

---

## Phase 6: User Story 2 — Full Workspace Promotion + Remaining Legacy Migration (Priority: P1)

**Goal**: The panel-grid workspace becomes the default view; all remaining unique legacy content is ported;
each legacy section is deleted in the same change as its replacement.

**Independent Test**: After each migration step, the ported section exists only in the workspace, is fully
removed from legacy markup, and both `node:test` and a live-browser check pass.

- [X] T026 [US2] Flip `#settingsPanel` from `display:none`/toggle-only to the dashboard's default rendered
  view on page load; keep the "⚙ Settings" nav button as a direct-navigation shortcut only (FR-003). Placed
  the `showSettingsWorkspace()` call at the true end of the script (not near `startPolling()`) after a live
  `ReferenceError: Cannot access '_settingsWorkspaceInitialized' before initialization` — calling a hoisted
  function early is safe, but its body read a `let` binding still in its temporal dead zone; only caught live.
- [X] T027 [US2] Create `dashboard/static/task-workflow-panel.mjs` — ports active-now, next-in-queue,
  recent-runs, system-health, verification-queue, and planner-&-backlog. **Scope correction (T024 revisited)**:
  "work & scheduling" controls did NOT get merged with runner status as originally worded — they're wired to
  the legacy page's shared `LEVERS`/`dirty`/`save()` batch-save mechanism, whose listener-attachment
  (`['ctrls','work'].forEach(...)`) runs unconditionally at page load, before this lazily-rendered panel would
  even exist in the DOM. Moving them would either break that eager attachment (the same null-deref class fixed
  in T023) or force a real behavior change (batch save → per-field immediate save). Runner status (read-only,
  no LEVERS coupling) moved here; its controls stay in the legacy "work & scheduling" card. Live-refreshes via
  `registerPollHandler()` (US3) rather than a second timer. Reuses `openSpec`/`copySession`/`postAction`/
  `defaultSpecPath` from the classic script as globals, same pattern as governance-panel.mjs.
- [X] T028 [US2] Removed the corresponding legacy sections, their now-dead render functions
  (`renderActiveList`/`activeRowHtml`/`renderQueue`/`renderRuns`/`renderHealth`/`renderRunner`/
  `renderVerifier`/`renderPlanner`), and — found live, not by any static check — a second null-deref
  (`$('qtoggle').addEventListener(...)` on the now-gone `#qtoggle` button) plus the already-covered `'gov'`
  entry pattern recurring in spirit; both fixed and reverified.
- [X] T029 [US2] [P] Create `dashboard/static/providers-models-panel.mjs` — ports the legacy capability
  matrix, providers list (+ add-provider form + connection test), and models list (+ refresh). Lower-risk than
  T027: `fetchProviders`/`fetchModels` were already self-contained (own fetch, not part of the `s`/poll object),
  so this was a mechanical port, not an architecture negotiation. Task categories intentionally NOT included
  (out of this task's stated scope) — stays in the legacy board.
- [X] T030 [US2] Removed the corresponding legacy sections (`capMatrixCard`/`providersCard`/`modelsCard`) and
  their now-dead functions/call-sites (`fetchProviders`/`renderProviders`/`testProvider`/`KNOWN_PROVIDERS`/
  `populateProviderSelect`/`toggleAddProvider`/`submitAddProvider`/`fetchModels`/`renderModels`/
  `refreshModels`/`renderCapabilityMatrix`), including their call sites in `poll()` and `render(s)`.
- [X] T031 [US2] No code change needed — `settings-workspace.mjs`'s existing `initWorkspace()` already
  appends unregistered/new panel ids after the saved-layout order (`orderedIds = [...order.filter(id =>
  registry.has(id)), ...ids.filter(id => !order.includes(id))]`), exactly satisfying this requirement.
  Confirmed empirically: all 4 new panels (agent-budget, governance, task-workflow, providers-models) mounted
  correctly alongside the 8 pre-existing ones with zero errors, on a workspace whose saved layout predates them.
- [X] T032 [US2] Verified live in browser (fresh tab each time, to avoid stale cross-navigation console/network
  history): fresh page load renders the workspace as the default view immediately; 12 panels total, zero
  legacy duplicates (`capMatrixCard`/`providersCard`/`modelsCard`/`activeList`/`queueList`/`runsList`/
  `healthList`/`runnerList`/`verifierList`/`plannerList` all confirmed absent from the DOM); "active now" text
  appears exactly once on the page; real data confirmed in every ported panel; interactive elements
  (add-provider toggle) confirmed working.
- [X] T033 [US2] Full test suite: 1518 tests, 1506 pass, same 2 pre-existing unrelated failures — zero new
  regressions across both migrations.

---

## Phase 7: User Story 6 — Naming & Model-List Usability Cleanup (Priority: P3, sequenced last)

**Goal**: No "Subscription"/"Billing" naming collision; models list is filterable.

**Independent Test**: Grep UI copy for the remaining ambiguous collision (should be none); type a
provider/price filter into the models panel and confirm the result set narrows without a page reload.

- [X] T034 [US6] [P] Renamed "Subscription Plans" card copy to "AI Provider Subscriptions" — stayed in
  `dashboard/index.html` (that card was intentionally not part of T029's providers-models-panel.mjs scope).
  UI copy only, no identifier renames. Verified no remaining "Subscription Plans" string in any user-facing
  UI copy (one internal code-comment occurrence in `dashboard/server.mjs` left as-is — not user-visible).
- [X] T035 [US6] [P] Added filter controls (provider/model-id text, max $/M input price, min context window in
  k) to `providers-models-panel.mjs`'s models list — pure client-side (`filterModels()`) over the already-fetched
  `/api/models` response cached on the panel root (`root._pmModelsRaw`), no new endpoint, no re-fetch per
  keystroke. Models with unknown pricing/context pass a price/context filter rather than being excluded
  (can't judge what you don't know).
- [X] T036 [US6] Verified live: typing "deepseek" narrowed 415 rows to 15 (2 native + 13 openrouter-branded)
  instantly, no page reload; clearing the filter restored the full 411-model list across all 4 providers;
  price filter (max $0.5/M) correctly narrowed further while passing through models with unknown pricing;
  zero console errors.

---

## Phase 8: Polish & Cross-Cutting Verification

- [X] T037 Full source-scan pass — all grep-verifiable success criteria hold: SC-001 (`kvTotalSpend` appears
  exactly once as a real element, id+usage), SC-002 (zero real `LineChart`/`DonutChart` — only 2 explanatory
  comments mentioning the removed classes by name), SC-003 (`showSettingsWorkspace();` called unconditionally
  at load), SC-004/SC-005 (`dashboard-source-quality.test.mjs`, 4/4 pass), SC-008 (models list filter verified
  live in T036).
- [X] T038 Final full `npm test` run: 1518 tests, same 2 pre-existing unrelated failures (`gateway/tests/
  cli.test.mjs`'s 14 subtests + 1 tray-icon subtest, confirmed via isolated runs earlier in this phase to be
  environment/fixture issues unrelated to anything touched in this spec) — zero regressions introduced by
  Phase 9 (SC-009).
- [X] T039 Added a new **P8** row to `docs/MASTER-PLAN-CLOSE-GAPS.md`'s Phase Structure Overview table,
  explicitly marked `*(unplanned — audit-driven)*` since this phase was never part of the original plan —
  referencing `specs/009-dashboard-modernization/` and summarizing the live bugs found and fixed along the
  way, matching 008's own closing-task precedent (T025) without pretending this was planned in advance.

### Known issue found during this phase, NOT fixed (flagged, out of scope)

Repeatedly observed during Phase 9 development: running the full `npm test` suite reliably deletes the real
`.ai/policy.yaml` from this local checkout (reproduced 5+ times across this session — confirmed NOT caused by
`tests/cloud-chaos.test.mjs`, the one file whose `rmSync('.ai', ...)` pattern matched a grep for the
mechanism, since that test operates on an isolated `mkdtempSync` root, not the real repo). The actual culprit
was not identified — a real, separate, pre-existing test-isolation bug worth a dedicated investigation, not
something this dashboard-modernization phase should absorb. Workaround used throughout this phase: manually
reconstructed `.ai/policy.yaml` after each full-suite run, before live-verifying in the browser.
