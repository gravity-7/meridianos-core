# Feature Specification: Frontend ES Module Migration

**Feature Branch**: `010-frontend-es-module-migration`

**Created**: 2026-08-07

**Status**: Draft

**Input**: This spec replaces the placeholder version of this file (parked when `009-dashboard-modernization`
shipped, since full Principle VIII compliance was explicitly out of that phase's scope). Drafted now per this
folder's own `HOW-TO-START.md`: confirmed 009 has landed (all 6 user stories / 39 tasks, PR #82, `9b5c65d`),
then re-inventoried `dashboard/index.html` fresh via grep rather than trusting the placeholder's pre-009
description of the gap.

## Context: What Already Exists (not respecced here)

- `009-dashboard-modernization` (landed, PR #82) ported `poll-dispatcher.mjs`, `client-error-log.mjs`,
  `design-tokens.css`, `agent-budget-panel.mjs`, `task-workflow-panel.mjs`, `governance-panel.mjs`, and
  `providers-models-panel.mjs`; it also fully eliminated the `poll = async function(){...}` global-reassignment
  pattern (zero occurrences remain, confirmed by fresh grep). `dashboard/index.html` shrank from ~2,600 lines to
  2,034 as a result.
- One claim in 009's `plan.md` Project Structure did **not** happen: it listed `subscriptions-panel.mjs` as a
  new file, but T034's actual execution notes (ground truth over the plan's pre-implementation sketch) show only
  the card's UI copy changed, in place, in `dashboard/index.html`. `fetchSubscriptions`/`reportBrokenSub` are
  still plain top-level functions in the classic script. This spec closes that gap for real.
- This phase's own fresh re-inventory (grep-based, per `HOW-TO-START.md` step 1) found:
  - `dashboard/index.html` has exactly **one** classic (non-module) `<script>` block, lines 882–2024, plus three
    unmodified third-party vendor `<script src>` includes (uPlot/Muuri/Litegraph — out of scope, matching
    `tests/dashboard-source-quality.test.mjs`'s existing `vendor/` exclusion).
  - That block contains **65 top-level function declarations** (64 unique names) — the core Principle VIII
    violation this phase exists to close.
  - **Zero** remaining `x = async function(...)`-style reassignments of any global (not just `poll`) — Phase 9's
    fix generalizes; nothing left to do on that specific pattern.
  - **25** inline `onclick="..."` HTML attributes wiring markup to these top-level functions as implicit
    `window` globals (see Assumptions for why this phase does not convert them).
  - A genuine latent bug: `formatNumber` is declared **twice** (line 1019, suffix `'k'`; line 1828, suffix
    `'K'`). Classic-script function redeclaration means the second silently wins for every call site in the
    file, including ones textually above line 1828 — the first definition is 100% dead code today. Consolidating
    to one definition (US1) must keep the `'K'` behavior, since that's what actually runs now.
  - Two functional areas — cost-optimization suggestions and IDE/MCP integration — are untouched by 009 and never
    mentioned in any of its docs, yet both already self-register through `poll-dispatcher.mjs`
    (`registerPollHandler(fetchOptimization)`, `registerPollHandler(fetchIdeDetect)`, etc.) — so they already
    comply with 009's US3 dispatcher pattern, they just aren't modules yet.
  - `task-workflow-panel.mjs` (already shipped in 009) independently duplicates six of US1's planned shared
    utilities under local definitions (`escapeHtml`, `relTime`, `fmt`, `shortModel`, `badgeFor`,
    `outcomeBadge`) — not just `esc()` as 009's own tasks.md T027 noted. Three of the six pairs have real
    behavioral discrepancies, not just naming/style differences (see US1).
  - `governance-panel.mjs` (5 sites) and `task-workflow-panel.mjs` (5 sites) — both already-shipped 009
    panels — generate HTML containing `onclick="..."` attributes calling `openSpec`/`unblockEsc`/`skipEsc`/
    `actEsc`/`copySession`/`postAction`, in addition to the 25 sites inside `dashboard/index.html` itself.
    FR-005/SC-004's "every onclick site keeps working" requirement covers all of these, not only the 25 in
    the legacy markup.

## User Scenarios & Testing *(mandatory)*

A developer adding a new dashboard feature today still has two incompatible places to put code: a real
`.mjs` module (registered via `registerPanel()` or the poll dispatcher), or one more top-level function
appended to the 1,150-line classic script. By the end of this phase, the second option no longer exists —
`dashboard/index.html` ships zero inline application logic, and every existing feature has moved into a proper
ES module under `dashboard/static/`, preserving its exact current behavior.

### User Story 1 - Shared Formatting Utilities (Priority: P1)

`esc`, `relTime`, `formatSpend`, `formatNumber`, `shortModel`, `badgeFor`, and `outcomeBadge` — small, pure,
widely-reused formatting helpers — move into one module (`dashboard/static/dashboard-utils.mjs`) that every
other story imports from, instead of each area re-declaring its own copy.

This also resolves `task-workflow-panel.mjs`'s five already-existing local duplicates
(`escapeHtml`/`relTime`/`shortModel`/`badgeFor`/`outcomeBadge`) — not a hypothetical risk, a present-tense one.
`shortModel`/`badgeFor`/`outcomeBadge` are logic-identical to their `dashboard/index.html` counterparts (safe,
mechanical consolidation). Two pairs are **not** identical and need a real decision, not a copy-paste:

- **`esc` vs. `escapeHtml`**: `dashboard/index.html`'s `esc()` escapes `&`/`<`/`>` only; task-workflow-panel's
  `escapeHtml()` also escapes `'`/`"`. Both feed values into `onclick="...('${esc(x)}')"`-style attribute
  strings built with single-quote delimiters — a value containing an unescaped `'` breaks out of the
  attribute. **Decision: consolidate on the quote-escaping (`escapeHtml`) behavior.** This is a latent
  attribute-injection risk in `dashboard/index.html`'s current `esc()`, found during this phase's re-inventory,
  not introduced by it — fixing it during the consolidation this story already requires is the responsible
  call, not a scope violation of "pure refactor" (parallel to FR-004's `formatNumber` precedent: when two
  same-purpose definitions actually differ, ship the correct one, documented).
- **`relTime` (index.html) vs. `relTime` (task-workflow-panel)**: mathematically equivalent bucketing, but
  index.html's clamps a future/negative timestamp to `'0s'` and has no guard against an unparseable `iso`
  (renders the literal string `'NaNs'`); task-workflow-panel's guards `NaN` (returns `'—'`) but has no
  negative clamp (would render e.g. `'-5s'`). **Decision: consolidated version keeps both protections** (NaN
  guard AND negative clamp) — a strict correctness improvement over either original, not a display change for
  any input either version currently handles correctly.
- **`formatNumber` (index.html) vs. `fmt` (task-workflow-panel)**: different names, and a genuine display
  difference (1 decimal place vs. 0: `"12.3k"` vs. `"12k"`) that reads as a deliberate per-panel choice, not a
  bug. **Decision: out of scope for this story** — `fmt` stays as task-workflow-panel.mjs's own local function,
  untouched. Only `formatNumber`'s own within-file duplicate (line 1019 vs. 1828, see Context) is consolidated.

**Why this priority**: Foundation for every other story — US2 through US9 all call at least one of these
helpers.

**Independent Test**: Grep `dashboard/index.html` and `dashboard/static/*.mjs` (excluding `vendor/`) for
duplicate definitions of `esc`/`escapeHtml`/`relTime`/`shortModel`/`badgeFor`/`outcomeBadge` — count must be
zero duplicates, each defined exactly once and imported everywhere else. `formatNumber` within
`dashboard/index.html` specifically must also drop to exactly one definition.

**Acceptance Scenarios**:

1. **Given** any panel or module that previously called the classic script's global `formatNumber`, **When** it
   now imports from `dashboard-utils.mjs`, **Then** output is byte-identical to the current (`'K'`-suffix)
   behavior — not the dead `'k'`-suffix version.
2. **Given** `task-workflow-panel.mjs`'s local `escapeHtml()`, **When** this story lands, **Then** it imports
   the consolidated `esc` from `dashboard-utils.mjs` (quote-escaping behavior) instead of defining its own, and
   every one of its own `onclick`-attribute-building call sites keeps working, verified live.
3. **Given** a value containing a single quote is passed to the consolidated `esc()`, **When** it's interpolated
   into an `onclick="...('${esc(x)}')"` attribute in `dashboard/index.html`'s own markup (e.g. `unblockEsc`'s
   task-id argument), **Then** the quote is escaped and the attribute does not break — this did not hold before
   this story.

---

### User Story 2 - Escalation & Spec-Modal Actions Become a Real Module (Priority: P1)

`postAction`, `actEsc`, `unblockEsc`, `snoozeEsc`, `skipEsc`, `copySession`, `defaultSpecPath`, `openSpec`,
`loadSpecComments`, `closeSpec`, `saveSpec`, `toggleParked`, and `renderParked` move into
`dashboard/static/escalation-actions.mjs`.

**Why this priority**: These aren't hypothetically reused — `governance-panel.mjs` and `task-workflow-panel.mjs`
already call `unblockEsc`/`snoozeEsc`/`skipEsc`/`actEsc`/`openSpec`/`copySession`/`defaultSpecPath` today, as
`window` globals reached from their generated HTML's `onclick` attributes (009's T022/T027 notes document this
directly). Porting this area closes an already-incurred cross-module dependency, not a hypothetical one.

**Independent Test**: With this story's functions moved, open the governance panel and the task-workflow panel
live; confirm every escalation action button (Approve/Snooze/Skip/unblock) still works unmodified.

**Acceptance Scenarios**:

1. **Given** `escalation-actions.mjs` exports `unblockEsc`, **When** the module loads, **Then** it also assigns
   `window.unblockEsc = unblockEsc` (and the same for every function in this story still reached via an
   existing `onclick` attribute in legacy markup or in governance-panel.mjs/task-workflow-panel.mjs's generated
   HTML) — so no existing `onclick` wiring breaks.
2. **Given** a parked task's "unskip" button, **When** clicked, **Then** `postAction` still fires the same
   request it does today.

---

### User Story 3 - Spend/Budget/Analytics Legacy Surfaces Become a Real Module (Priority: P2)

`setAnalyticsRange`, `fetchAnalytics`, `exportAnalyticsCSV`, `fetchBudget`, `toggleSpendPause`, `testAlert`,
`renderFounderUsage`, and `renderProviderCost` move into `dashboard/static/spend-budget.mjs`.

**Why this priority**: 009's US1 (T017) already established, by direct code comparison, that "budget
intelligence," "provider spend · last 7d," and `founderUsage` are **not** duplicates of the uPlot observability
panels — they're genuinely unique content that still needs a real home. This story gives it one without
re-litigating that already-settled duplication analysis.

**Independent Test**: Live-verify the budget-intelligence card, provider-spend-7d card, and founder-usage card
render identically before and after; `render(s)`'s call to `renderFounderUsage`/`renderProviderCost` now
resolves via `import` instead of an ambient global.

**Acceptance Scenarios**:

1. **Given** the analytics range buttons (1d/7d/30d/90d), **When** clicked post-migration, **Then**
   `fetchAnalytics` behaves identically to today.
2. **Given** the "Pause AI Spend" control, **When** toggled, **Then** `toggleSpendPause` behaves identically.

---

### User Story 4 - Cost-Optimization Suggestions Become a Real Module (Priority: P2)

`fetchOptimization`, `applyOpt`, and `dismissOpt` move into `dashboard/static/optimization.mjs`.

**Why this priority**: Fully self-contained — this story's re-inventory found it untouched and unmentioned by
009 entirely. Already registers via `registerPollHandler(fetchOptimization)`; the module registers itself the
same way on import, so this is a low-risk, mechanical port with zero cross-story coupling.

**Independent Test**: Live-verify an optimization suggestion's "Apply"/"Dismiss" buttons still work and still
trigger a re-fetch, matching current behavior exactly.

**Acceptance Scenarios**:

1. **Given** `optimization.mjs` is imported, **When** the module evaluates, **Then** it calls
   `registerPollHandler(fetchOptimization)` itself — no other file needs to know this area exists.

---

### User Story 5 - IDE & MCP Integration Becomes a Real Module (Priority: P2)

`fetchIdeDetect`, `renderIdeCards`, `fetchIdeConfig`, `testIdeConn`, `fetchMcpConfig`, and `fetchIdeStatus` move
into `dashboard/static/ide-integration.mjs`.

**Why this priority**: Like US4, fully self-contained, untouched and unmentioned by 009, and already
dispatcher-registered (`registerPollHandler(fetchIdeDetect)`, `fetchMcpConfig`, `fetchIdeStatus`) — a
mechanical, low-risk port.

**Independent Test**: Live-verify the IDE cards render, "Test connection" still works, and MCP config status
still displays, matching current behavior exactly.

**Acceptance Scenarios**:

1. **Given** `ide-integration.mjs` is imported, **When** the module evaluates, **Then** it registers all three
   of its poll handlers itself, matching US4's self-registration pattern.

---

### User Story 6 - AI Provider Subscriptions Becomes a Real Module (Priority: P2)

`fetchSubscriptions` and `reportBrokenSub` move into `dashboard/static/subscriptions.mjs` — the module 009's
`plan.md` sketched but never actually created (see Context).

**Why this priority**: Smallest content-bearing area (2 functions), already dispatcher-registered
(`registerPollHandler(fetchSubscriptions)`), lowest risk. Named `subscriptions.mjs` rather than reusing 009's
originally-sketched `subscriptions-panel.mjs`, deliberately — the `-panel.mjs` suffix in this codebase denotes a
`registerPanel()`-registered workspace-grid panel (see Assumptions on why this story doesn't make it one), and
this module isn't that.

**Independent Test**: Live-verify the "AI Provider Subscriptions" card and its "Report broken" button behave
identically.

**Acceptance Scenarios**:

1. **Given** `subscriptions.mjs` is imported, **When** the module evaluates, **Then** it calls
   `registerPollHandler(fetchSubscriptions)` itself.

---

### User Story 7 - Command Console & System Log Become a Real Module (Priority: P3)

`initCmdButtons`, `runCmd`, `clearCmdOutput`, `stopScheduler`, `restartDaemon`, `renderSystemLog`, and
`updateThemeIcon` move into `dashboard/static/daemon-console.mjs`.

**Why this priority**: Medium risk — `initCmdButtons()` currently runs once as a bare top-level statement at
script-load time (not from an event or the poll cycle), and `renderSystemLog` is called directly from
`render(s)` every tick. Sequenced after the fully self-contained stories above so the pattern for "a module
that also needs one piece of load-time initialization" is proven on smaller ground first... though US4/US5
already cover that via self-registration, so this mainly needs `render(s)` to `import { renderSystemLog }` and
call it.

**Independent Test**: Live-verify a Quick Command button still runs its command and streams output; the system
log still updates every poll tick; dark/light theme toggle still updates its icon.

**Acceptance Scenarios**:

1. **Given** `daemon-console.mjs` is imported, **When** the module evaluates, **Then** it calls
   `initCmdButtons()` itself at module-load time, matching the current bare top-level call.
2. **Given** `render(s)` in the new bootstrap module (US9), **When** it runs, **Then** it imports and calls
   `renderSystemLog` exactly where the classic script called it inline today.

---

### User Story 8 - Policy-Lever Batch-Save Mechanism Becomes a Real Module (Priority: P3)

`populateControls`, `collectLevers`, `syncReadouts`, `save`, `setDirty`, `applyKill`, and `toggleKill` move into
`dashboard/static/policy-levers.mjs`, preserving the exact current batch-collect/batch-save/dirty-flag
mechanism.

**Why this priority**: 009's T027 explicitly declined to relocate "work & scheduling" controls off this
mechanism, reasoning that doing so would force a real behavior change (batch save → per-field save), not a
mechanical port. This story respects that same boundary: it moves the mechanism's code into a module without
changing what it does — no field starts saving individually that doesn't today.

**Independent Test**: Live-verify changing a lever still shows the dirty indicator, "Save" still batch-writes
every changed lever in one request, and the kill switch still toggles the same visual/state changes it does
today.

**Acceptance Scenarios**:

1. **Given** two levers are changed before saving, **When** "Save" is clicked, **Then** both are written in the
   same batch request as today — this story does not introduce per-field save.
2. **Given** the kill switch is toggled, **When** it fails to persist server-side, **Then** `toggleKill`'s
   existing rollback-to-`previousKill` behavior is unchanged.

---

### User Story 9 - Core Bootstrap: the Classic Script Is Deleted (Priority: P1, sequenced last)

`render`, `poll`, `startPolling`, `stopPolling`, `renderTaskCategories`, and the six workspace show/toggle
functions (`showSettingsWorkspace`, `toggleSettingsWorkspace`, `showTeamWorkspace`, `toggleTeamWorkspace`,
`showAdminWorkspace`, `toggleAdminWorkspace`) move into `dashboard/static/dashboard-bootstrap.mjs`, which
`import`s the render/registration entry points from every story above to reconstruct the exact current
`render(s)`/top-level execution order. `dashboard/index.html`'s classic `<script>` block (lines 882–2024) is
then deleted outright, replaced by a single `<script type="module" src="static/dashboard-bootstrap.mjs">`.

**Why this priority**: This is the phase's actual finish line — the concrete, namesake goal ("frontend ES
module migration" complete) — but it is mechanically last because `render(s)`/`poll()` still directly call
content from US2/US3/US7/US8 today; those calls must resolve via `import` before the classic script housing
them can be deleted. Every other story is a precondition, not a co-requisite.

**Why this is safe to do last, as one change**: ES modules execute top-to-bottom in document order, same as a
classic script (the only differences are deferred-relative-to-parsing timing, strict mode, and module scoping)
— so reassembling the same top-level call sequence (`initCmdButtons()`-equivalent self-registrations, the
`visibilitychange` listener, `startPolling()`, and finally `showSettingsWorkspace()`) inside one bootstrap
module preserves behavior exactly, including the load-order subtlety already documented in the code around
`showSettingsWorkspace()`'s placement (calling it before `_settingsWorkspaceInitialized`'s `let` declaration
executes throws `ReferenceError` — a live-caught bug from 009 T026 that this story's ordering must not
reintroduce).

**Independent Test**: Fresh page load in a clean tab; confirm zero console errors, the workspace renders as the
default view, all polling starts, and `document.querySelectorAll('script:not([type="module"])')` (excluding the
three vendor `<script src>` tags) returns empty.

**Acceptance Scenarios**:

1. **Given** every other story has landed, **When** this story removes the classic `<script>` block, **Then**
   `dashboard/index.html` contains only `<script type="module">` tags and the three unmodified vendor
   `<script src>` includes.
2. **Given** a fresh page load, **When** the page finishes loading, **Then** the workspace is the default view
   (unchanged from 009), polling starts automatically, and no `ReferenceError` occurs.
3. **Given** the nav buttons for Team/Admin/Settings workspaces, **When** clicked, **Then**
   `toggleTeamWorkspace`/`toggleAdminWorkspace`/`toggleSettingsWorkspace` behave identically to today, including
   their lazy dynamic-`import()` of `team-bootstrap.mjs`/`admin-bootstrap.mjs`/`settings-workspace-bootstrap.mjs`
   on first open.

---

### Edge Cases

- What happens if a ported module's self-registration (`registerPollHandler(...)` at module-evaluation time)
  runs before `poll-dispatcher.mjs` itself has finished initializing, given `dashboard-bootstrap.mjs` now
  controls import order instead of classic-script source order?
- What happens to the `formatNumber` consolidation (US1) if any existing call site was silently relying on the
  now-dead `'k'`-suffix behavior in a way not caught by the current test suite or a live pass?
- What happens if `dashboard-bootstrap.mjs` (US9) is imported twice (e.g., a future accidental duplicate
  `<script type="module">` tag) — do the `registerPollHandler` self-registrations in US4/US5/US6 double-fire?
- How should a module that both exports for `import` use AND needs `window.foo` for legacy `onclick` compat
  (US2, US7's `runCmd`, US8's `toggleKill`) be structured so the bridge is obvious and grep-auditable, not an
  easy-to-miss side effect buried in the module body?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every one of the 64 uniquely-named top-level functions currently declared in
  `dashboard/index.html`'s classic `<script>` block MUST be moved into an `export`ed function inside a `.mjs`
  module under `dashboard/static/`.
- **FR-002**: `dashboard/index.html`'s classic (non-module) `<script>` block MUST be removed entirely; only
  `<script type="module">` tags and the three pre-existing, unmodified vendor `<script src>` includes MUST
  remain.
- **FR-003**: `esc` (consolidating `dashboard/index.html`'s `esc` and `task-workflow-panel.mjs`'s
  `escapeHtml`), `relTime`, `formatSpend`, `formatNumber`, `shortModel`, `badgeFor`, and `outcomeBadge` MUST be
  defined in exactly one module and imported everywhere else they're used — zero duplicate definitions
  anywhere in `dashboard/static/*.mjs` (excluding `vendor/`) or `dashboard/index.html`. `fmt`
  (task-workflow-panel.mjs) is a deliberately distinct function (different rounding behavior) and is explicitly
  exempt from this consolidation (see US1).
- **FR-004**: The consolidated `formatNumber` MUST preserve the `'K'`-suffix behavior currently in effect (line
  1828's definition, which silently shadows line 1019's `'k'`-suffix version today) — not the dead version. The
  consolidated `esc` MUST use the quote-escaping behavior (`escapeHtml`'s current behavior, not `esc`'s) — a
  latent attribute-injection fix, not a preserved-behavior requirement (see US1). The consolidated `relTime`
  MUST combine both source versions' protections (NaN guard and negative-timestamp clamp).
- **FR-005**: Every function already reached via an existing `onclick="..."`/`onchange="..."` HTML attribute —
  the 25 sites in `dashboard/index.html`'s own markup, plus the 10 in already-shipped `governance-panel.mjs`
  (5) and `task-workflow-panel.mjs` (5) generated HTML — MUST remain reachable the same way after its owning
  function's port: its module MUST assign it to `window` alongside its `export`. Introducing new
  `addEventListener`-based wiring to replace existing `onclick`/`onchange` attributes is explicitly out of
  scope for this phase (see Assumptions).
- **FR-006**: Every ported function MUST preserve its exact current runtime behavior — this phase is a
  structural/syntax migration only; it MUST NOT change what any feature does, only how its code is organized.
  The `formatNumber` consolidation (FR-004) is a behavior-preservation fix, not an exception to this rule (it
  makes the file's actual behavior match what one clear definition says, instead of an unlabeled
  first-shadows-second footgun).
- **FR-007**: Content that already self-registers via `registerPollHandler()` (US4's cost-optimization, US5's
  IDE/MCP integration, US6's subscriptions) MUST continue to self-register from within its own module at
  import time — the bootstrap module (US9) MUST NOT need to know these areas exist beyond importing them once.
- **FR-008**: `render(s)`'s call sequence (currently: `renderFounderUsage`, `renderProviderCost`,
  clock/kill-switch inline updates, `renderParked`, `renderTaskCategories`, `renderSystemLog`,
  `populateControls` guarded by `controlsInit`) MUST be reproduced exactly, in the same order, inside the
  bootstrap module (US9), resolving each call via `import` instead of an ambient global.
- **FR-009**: The top-level executable statements currently scattered through the classic script (each
  story's module-specific setup, the `visibilitychange` listener, `startPolling()`, and finally
  `showSettingsWorkspace()`) MUST execute in the same relative order inside the bootstrap module — in
  particular, `showSettingsWorkspace()` MUST still run after every `let` binding it depends on has initialized,
  preserving the fix for the `ReferenceError` documented at `dashboard/index.html:2016-2020`.
- **FR-010**: `tests/dashboard-source-quality.test.mjs` MUST gain a new assertion: zero top-level
  `function`/`async function` declarations remain in `dashboard/index.html` (i.e., no classic script survives).
  Per Constitution Principle IV, this assertion MUST be written and confirmed failing (red) before the
  functions it counts are moved, then confirmed passing (green) once US9 lands.
- **FR-011**: The existing `npm test` suite MUST continue to pass with zero regressions introduced by this
  phase (same bar as 009's SC-009).
- **FR-012**: This phase MUST NOT relocate any ported content's visual position — a function currently rendered
  in `dashboard/index.html`'s fixed legacy-board layout MUST still render there (now via a module import)
  after this phase; it MUST NOT be additionally promoted into the `registerPanel()`-based settings-workspace
  grid as part of this migration (see Out of Scope).

### Key Entities *(include if feature involves data)*

- **Legacy Function**: one of the 64 top-level functions currently declared in `dashboard/index.html`'s classic
  `<script>` block — the unit this phase migrates, one-for-one, into a module export.
- **Feature Module**: a `.mjs` file under `dashboard/static/` that owns one functional area's exports (US1–US8);
  distinct from a **Panel Module** (the pre-existing `registerPanel()`-based convention from 008/009) — this
  phase creates feature modules, not new workspace panels.
- **Bootstrap Module**: `dashboard-bootstrap.mjs` (US9) — the single remaining entry point, loaded via
  `<script type="module">`, that imports every feature module and reconstructs the classic script's exact
  render/poll/init call sequence.
- **Global Bridge**: a `window.foo = foo` assignment a feature module makes alongside its `export`, solely to
  keep an existing `onclick`/`onchange` HTML attribute working unmodified (FR-005).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero top-level `function`/`async function` declarations remain in `dashboard/index.html`
  (verified by the `tests/dashboard-source-quality.test.mjs` extension, FR-010).
- **SC-002**: `dashboard/index.html` contains zero classic (non-module, non-vendor) `<script>` tags.
- **SC-003**: Zero duplicate definitions of `esc`/`relTime`/`formatSpend`/`shortModel`/`badgeFor`/
  `outcomeBadge` remain across `dashboard/static/*.mjs` (excluding `vendor/`) and `dashboard/index.html`
  combined; `formatNumber` drops from two definitions to one within `dashboard/index.html`.
- **SC-004**: Every one of the 35 existing `onclick`/`onchange` attribute sites (25 in `dashboard/index.html`,
  5 in governance-panel.mjs, 5 in task-workflow-panel.mjs) continues to work, verified live in-browser, with
  zero new `addEventListener`-based replacements introduced.
- **SC-005**: The existing `node:test` suite continues to pass with zero regressions.
- **SC-006**: A fresh page load produces zero console errors and the workspace renders as the default view
  (unchanged from 009), verified live in a clean browser tab.
- **SC-007**: `tests/dashboard-source-quality.test.mjs`'s full assertion set (existing 4 + this phase's new
  ones) passes green.

## Assumptions

- This is a pure structural/syntax refactor: no behavior change, no new features, no new backend endpoints, no
  visual/layout change. Matches `HOW-TO-START.md`'s framing and this repo's own precedent (009's T017/T024
  scope corrections) of treating "would this change what the feature does or where it lives" as the line
  between in-scope cleanup and out-of-scope redesign.
- **Inline `onclick`/`onchange` HTML-attribute event wiring is explicitly out of scope.** Constitution Principle
  VIII's literal text ("`import`/`export` exclusively — no `require()` or `module.exports`") governs module
  syntax, not event-wiring style. Converting all 25 sites to `addEventListener` would roughly double this
  phase's blast radius — touching already-shipped Phase 9 panel-generated HTML (governance-panel.mjs,
  task-workflow-panel.mjs) in addition to legacy markup — for no marginal Principle VIII compliance gain.
  Ported functions keep a `window.foo = foo` bridge (FR-005) specifically to preserve this wiring unchanged.
  This is a deliberate, reasoned call per `HOW-TO-START.md`'s own instruction that this needs "its own call,
  not an assumption" — recorded here rather than silently decided.
- The three vendor `<script src>` includes (uPlot/Muuri/Litegraph) stay as classic scripts — third-party code,
  out of scope, matching `dashboard-source-quality.test.mjs`'s existing `vendor/` exclusion precedent.
- Backend API endpoints are untouched — this is client-side code organization only.
- **Content keeps its current visual location.** Legacy-board content ported to a feature module (US3–US8)
  stays part of the fixed legacy-board layout; it is not additionally promoted into the workspace grid as part
  of this phase. Doing so would be a layout/UX change (draggable, resizable, user-repositionable) layered on
  top of a syntax migration — a natural candidate for a future phase, not this one.
- US9 must land last: `render(s)`/`poll()` in the classic script directly call content from US2 (`renderParked`),
  US3 (`renderFounderUsage`/`renderProviderCost`), US7 (`renderSystemLog`), and US8 (`populateControls`) today;
  those stories must land first so US9 can resolve the same calls via `import`.

## Out of Scope *(optional)*

- Converting `onclick=`/`onchange=` HTML attributes to `addEventListener`-based wiring (see Assumptions) —
  tracked as a known, explicitly-deferred follow-on, not silently dropped.
- Promoting any remaining fixed-legacy-board content into the `registerPanel()`-based workspace grid — a
  layout/UX change, not a module-syntax migration (see Assumptions).
- Changing the LEVERS batch-save mechanism to per-field save — 009's T027 already declined this; US8 preserves
  exact current batch-save semantics.
- Any behavior or visual change to any ported area — pure structural migration.
- Vendor library modularization (uPlot/Muuri/Litegraph stay as classic `<script src>` includes).
- New panels, new functionality, or anything not already present in `dashboard/index.html`'s legacy script today.
