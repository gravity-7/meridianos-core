# Feature Specification: Dashboard Modernization & Observability Hardening

**Feature Branch**: `009-dashboard-modernization`

**Created**: 2026-08-07

**Status**: Draft

**Input**: A manual, section-by-section critical audit of the AIOS dashboard (`dashboard/index.html` and
`dashboard/static/`), conducted collaboratively across eight content clusters (spend/budget, task/agent
workflow, governance/policy, system/ops, integrations, billing, the panel-grid workspace, and the modular
admin panels), followed by a request to fold in logging/observability hardening as its own concern within the
same phase.

## Context: What Already Exists (not respecced here)

- `specs/008-end-user-configurability` (2026-08-05, all 25 tasks `[X]` complete) already delivered the
  Grafana-grade panel-grid workspace this phase builds on: `dashboard/static/settings-workspace.mjs` (Muuri
  drag/resize grid + `registerPanel(id, title, render)` API + localStorage layout persistence),
  `observability-panels.mjs` (uPlot-based Cost Over Time / Token Usage / Provider Spend Breakdown panels),
  `routing-flow-panel.mjs` (Litegraph provider/model→tier routing editor), `settings-panels.mjs` (Kill
  Switch, General/Gateway, Profiles, Backups config panels), `profiles.mjs`, `policy-backups.mjs`, and the
  `GET /setup` wizard page. None of this is rebuilt here — this phase is about promoting what 008 built from
  a secondary opt-in tab to the dashboard's primary view, retiring the legacy content it duplicates, and
  hardening the failure modes the audit surfaced.
- Four bugs found during the pre-spec audit were fixed directly on `main` (uncommitted, not gated behind this
  phase — see Assumptions): a `render()` `TypeError` from hardcoded `#activeclaude`/`#activeanti` elements no
  longer matching the dynamic agent roster, which silently aborted rendering of ~8 downstream cards because
  the surrounding `catch` block had no logging; a stale-closure bug where `setInterval`/the refresh button
  captured the original unwrapped `poll` function before later code reassigned it, so IDE-Connect/MCP-Connect
  panels never fetched; a `fetch('\api\stop', ...)` / `fetch('\api\restart', ...)` backslash typo that
  silently broke the Quick Commands stop/restart buttons; a dead `<output id="outPtask">` label with no code
  ever setting it; and a duplicate-fetch race where the page-load analytics initializer and the startup poll
  cycle both fired the same three analytics requests within milliseconds of each other.

## Clarifications

### Session 2026-08-06 to 2026-08-07 (dashboard audit dialogue)

- Q: Should this phase absorb the correctness-bug backlog found during the audit? → A: No. Bugs found were
  fixed directly as encountered (listed above) rather than gated behind spec approval. This phase covers
  consolidation, promotion-to-primary, the visual design system, and observability hardening — structural and
  systemic work, not one-off fixes.
- Q: What should the modernized board's charting engine be — keep uPlot, or switch to something more
  visually complete out of the box (e.g. ApexCharts)? → A: Keep uPlot. It's already adopted by 008, it's the
  same engine Grafana itself uses internally for time-series panels (chosen for performance at high point
  counts, relevant to a metering ledger), and it's already a paid-for dependency in this repo. The perceived
  lack of visual richness is a missing theming layer, not a ceiling on the library — address it with a shared
  theme/design-token layer, not a library swap.
- Q: What's the relationship between the legacy fixed-section board and the 008 panel-grid workspace? → A:
  The workspace is promoted from an opt-in secondary tab (behind "⚙ Settings") to the dashboard's default
  view. The legacy board's remaining unique content is ported into workspace panels one section at a time
  (strangler-fig migration); each legacy section is deleted in the same change that ports its replacement —
  never a big-bang rewrite, and never left duplicated in both places past that change.
- Q: Should logging/observability hardening be a separate phase? → A: No — folded into this phase. Directly
  motivated by a real incident during the audit: a thrown `TypeError` was silently swallowed by a bare
  `catch` block with no `console.error`, taking a background agent two full investigation passes to
  root-cause. This is a systemic gap in the codebase's error-handling discipline, not a one-off.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Single Source of Truth for Spend & Budget (Priority: P1)

An operator opens the dashboard and finds exactly one place to look for each spend/budget number — total
spend, per-agent budget usage vs. cap, provider spend breakdown — instead of today's six independently-fetched
surfaces (spend analytics KPIs, budget intelligence, the read-only compute-budget tile grid, the separate
editable budget-&-limits slider grid, provider-spend-last-7d, and Subscription Plans' "Combined monthly"
total) that can silently disagree with each other.

**Why this priority**: The most duplicated, most bug-prone surface found in the audit — six independent code
paths computing overlapping numbers is both a correctness risk and the reason a user can't trust the board at
a glance. It's also a precondition for the charting consolidation in this same story, since the legacy
hand-rolled charts and the 008-delivered uPlot panels currently both read overlapping spend data.

**Independent Test**: Count distinct on-screen surfaces displaying "total spend" and "per-agent budget"
before and after; confirm every remaining surface traces to exactly one fetch/render path.

**Acceptance Scenarios**:

1. **Given** the dashboard is open, **When** the operator looks for total spend, **Then** there is exactly one
   KPI surface showing it, not one in spend analytics and another in budget intelligence or subscriptions.
2. **Given** an agent's budget cap and current usage, **When** shown anywhere on the board, **Then** it is
   rendered by exactly one component — not a read-only tile grid and a separately-maintained editable-slider
   grid showing the same roster.
3. **Given** the operator edits an agent's budget cap, **When** the change is saved, **Then** the same panel
   reflects both the control and the resulting usage-vs-cap display without navigating elsewhere.
4. **Given** the legacy hand-rolled `LineChart`/`DonutChart` canvas classes are removed, **When** the operator
   views spend-over-time or provider-spend-breakdown, **Then** it renders via the existing uPlot-based
   observability panels from 008, not a second implementation.

---

### User Story 2 - Promote the Panel-Grid Workspace to the Primary Board (Priority: P1)

The Settings/Observability workspace delivered in 008 becomes the dashboard's default view instead of a
secondary tab behind "⚙ Settings." The legacy fixed-section board's remaining unique content — task/agent
workflow status (active now, queue, runs, health, runner, verifier, planner), governance controls, and
providers/models management — is ported into workspace panels one section at a time. Each legacy section is
deleted in the same change that ports its panel equivalent.

**Why this priority**: The structural precondition for a "Grafana-level" experience, and it directly reduces
the failure mode that caused the audit's headline bug — a single 2,600+ line monolithic script where one
throw silently killed eight unrelated cards, versus isolated panels that fail independently.

**Independent Test**: After each migration step, the ported section exists only in the workspace, is fully
removed from legacy markup, and both the existing `node:test` suite and a live-browser check pass.

**Acceptance Scenarios**:

1. **Given** a fresh page load, **When** the dashboard opens, **Then** the panel-grid workspace is the default
   view, not a hidden overlay requiring a nav click to reach.
2. **Given** a legacy section has been ported to a workspace panel, **When** the operator views the board,
   **Then** that section's markup no longer exists in `dashboard/index.html`'s legacy portion.
3. **Given** a panel throws during render, **When** it fails, **Then** only that panel shows an error state —
   no sibling panel is affected.
4. **Given** the migration is in progress, **When** any single section is ported, **Then** it ships as its own
   independently reviewable change, never bundled with unrelated sections.

---

### User Story 3 - Observability & Error-Visibility Hardening (Priority: P1)

When a client-side error occurs anywhere on the dashboard, it is never silently discarded. Every `catch`
block either surfaces a visible in-UI error state for the affected panel, produces a structured client-side
log entry, or both. The fragile "reassign the global `poll` function" extension pattern — found stacked three
layers deep in the legacy board, and the direct mechanism behind two of the four bugs fixed during the audit
— is replaced with a stable panel-registration/dispatcher model, consistent with the `registerPanel()`
pattern 008 already established.

**Why this priority**: This exact gap is what turned the audit's primary bug into a two-pass investigation —
a `TypeError` was thrown, caught, and discarded with zero trace, silently killing eight cards with nothing in
the console to point at it. It's a systemic discipline gap, not a one-off bug.

**Independent Test**: Grep the dashboard source for `catch` blocks with empty or no-op bodies — count must be
zero on completion. Deliberately throw inside one panel's render path and confirm the error surfaces in-UI
and is logged, with no effect on sibling panels.

**Acceptance Scenarios**:

1. **Given** any dashboard fetch or render call fails, **When** the failure occurs, **Then** the affected
   panel shows a visible error state instead of a blank or permanently-"loading" card.
2. **Given** a client-side error is caught, **When** it's logged, **Then** the entry includes enough context
   (source, panel/function, message, timestamp) to diagnose without adding new instrumentation after the
   fact.
3. **Given** a new feature needs to run on every poll tick, **When** it's added, **Then** it registers against
   a stable dispatcher rather than reassigning the global `poll` function.
4. **Given** this phase is complete, **When** the codebase is inspected, **Then** no `poll = async
   function(){...}` reassignment remains.

---

### User Story 4 - Status/Controls Co-location (Priority: P2)

Every subsystem's live status renders next to the controls that affect it — agent budget usage next to its
cap sliders, scheduler status next to its concurrency/cadence controls, pending escalations next to the
governance levers that gate them — instead of split across distant sections of the board.

**Why this priority**: A recurring pattern identified across three separate subsystems during the audit; a
real usability cost (forces scrolling to see the effect of a change just made) but lower severity than US1–3's
correctness and structural work.

**Independent Test**: For each of the three pairings, confirm status and controls render inside the same
panel/card.

**Acceptance Scenarios**:

1. **Given** the agent budget panel, **When** the operator adjusts a cap, **Then** the usage-vs-cap display in
   that same panel updates.
2. **Given** the scheduler panel, **When** the operator changes concurrency or cadence, **Then** current
   run/queue status is visible in that same panel.
3. **Given** the governance panel, **When** a lever is set to "block & ask," **Then** any items currently
   blocked on that decision are visible in that same panel.

---

### User Story 5 - Visual Design System: uPlot + Tabler (Priority: P2)

All dashboard charts render through uPlot, themed with a consistent set of design tokens (palette, typography,
spacing, card chrome) inspired by Tabler, applied uniformly across every panel — not a from-scratch redesign
and not a swap to a heavier out-of-the-box charting library.

**Why this priority**: Cosmetic relative to US1–3's correctness/structural work, but it's the visible "does
this look world-class" outcome the rest of the phase is in service of.

**Independent Test**: Visual review against a defined token palette; confirm no panel uses ad hoc inline
colors or spacing outside the shared token set.

**Acceptance Scenarios**:

1. **Given** any chart panel, **When** rendered, **Then** it uses uPlot with the shared theme configuration
   (palette, fonts, tooltip/legend styling), not uPlot's default unstyled output.
2. **Given** dashboard chrome (cards, buttons, nav) across different panels, **When** compared, **Then**
   spacing, color, and typography are drawn from one shared token set.
3. **Given** the user's OS/browser is in dark or light mode, **When** the dashboard loads, **Then** the theme
   adapts correctly in both.

---

### User Story 6 - Naming & Model-List Usability Cleanup (Priority: P3)

The "Subscription Plans" card (AI subscriptions — Claude Pro/Copilot — proxied through the gateway) and
platform "Billing" (`billing-panel.mjs` — the SaaS product's own license tier) get distinct, non-colliding
names. The models panel (currently ~400 unfiltered OpenRouter rows) gains search/filter/sort by provider,
price, and context window.

**Why this priority**: Real but narrow usability gaps found in clusters E/C; block nothing else, safe to do
last.

**Independent Test**: Grep UI copy for the remaining ambiguous "Subscription"/"Billing" collision (should be
none); type a provider or price filter into the models panel and confirm the result set narrows without a
page reload.

**Acceptance Scenarios**:

1. **Given** the dashboard, **When** the operator looks at AI-subscription tracking vs. platform billing,
   **Then** they carry distinct labels (e.g. "AI Provider Subscriptions" vs. "Platform Billing").
2. **Given** the models panel's ~400 rows, **When** the operator types a provider name or sets a max price,
   **Then** the list filters accordingly.

---

### Edge Cases

- What happens to a user's persisted Muuri layout (`localStorage`) when a legacy section is newly ported in
  as a panel that didn't exist when their layout was last saved?
- What happens if a panel's own error-rendering path throws while rendering the error state?
- How is a section handled if it ships mid-migration — partially represented in the workspace and partially
  still in the legacy board — across more than one release?
- The board currently has three separate "stop everything" surfaces (header kill switch, "Pause AI Spend,"
  workspace Kill Switch panel) — do these consolidate into one, or do they represent genuinely distinct
  actions (halt agents vs. pause spend) that should stay separate but be clearly, distinctly labeled?
- How does uPlot theming behave when the browser/OS reports no explicit light/dark preference?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Dashboard MUST present exactly one on-screen surface per spend/budget metric (total spend,
  per-agent budget usage-vs-cap, provider spend breakdown) — no metric MUST be independently computed or
  rendered by more than one code path.
- **FR-002**: System MUST remove the hand-rolled `LineChart`/`DonutChart` canvas classes from
  `dashboard/index.html` once their content is fully served by the existing uPlot-based observability panels.
- **FR-003**: The panel-grid workspace delivered in 008 MUST become the dashboard's default view on page
  load; a direct-navigation entry point MAY remain but MUST NOT be required to reach the primary board.
- **FR-004**: Each legacy board section ported to a workspace panel MUST be removed from
  `dashboard/index.html`'s legacy markup in the same change that adds its panel equivalent — no section MUST
  exist in both places simultaneously past that change.
- **FR-005**: Every panel's render/fetch logic MUST isolate failures — an exception in one panel MUST NOT
  prevent any other panel from rendering.
- **FR-006**: No `catch` block in dashboard client code MUST have an empty or no-op body; every caught error
  MUST either update a visible error state, produce a structured log entry, or both.
- **FR-007**: Client-side error log entries MUST capture at minimum: timestamp, source (panel/function), and
  error message/stack — sufficient to diagnose without adding new instrumentation after the fact.
- **FR-008**: New recurring dashboard behavior MUST register through a stable, single dispatcher instead of
  reassigning the global `poll` function; the existing `poll = async function(){...}` reassignment chain MUST
  be removed as part of this phase.
- **FR-009**: Agent budget status and its editable controls MUST render in the same panel; the same
  requirement applies to scheduler status/controls and governance/escalation status/controls.
- **FR-010**: All dashboard charts MUST render via uPlot using a shared theme configuration (palette,
  typography, tooltip/legend styling) rather than per-panel ad hoc styling.
- **FR-011**: Dashboard chrome (cards, buttons, spacing, typography) MUST draw from one shared design-token
  set and MUST render correctly in both light and dark OS/browser themes.
- **FR-012**: The "Subscription Plans" (AI-subscription proxying) and platform billing (`billing-panel.mjs`)
  concepts MUST use distinct, non-colliding labels in all UI copy.
- **FR-013**: The models panel MUST support filtering/sorting the provider model list by provider, price, and
  context window.
- **FR-014**: The three existing "stop everything" surfaces (header kill switch, spend-pause, workspace
  kill-switch panel) MUST be reconciled into either one control or clearly, distinctly labeled separate
  controls — not left as three unlabeled duplicates.

### Key Entities *(include if feature involves data)*

- **Panel**: a workspace grid item per 008's `registerPanel(id, title, render)` model — the unit every
  migrated subsystem is rendered as, replacing ad hoc legacy `<div class="card">` sections.
- **Metric Surface**: the single rendering path responsible for a given spend/budget number, traceable to one
  data fetch.
- **Client Error Log Entry**: a structured record of a caught client-side error (timestamp, source, message).
- **Design Token Set**: the shared palette/typography/spacing values applied across panel chrome and uPlot
  theming.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The number of distinct on-screen surfaces displaying "total spend" is reduced from 6 to 1.
- **SC-002**: Zero occurrences of the hand-rolled `LineChart`/`DonutChart` classes remain in
  `dashboard/index.html`.
- **SC-003**: The panel-grid workspace is the first thing rendered on a fresh page load, with no navigation
  required to reach it.
- **SC-004**: Zero empty/no-op `catch` blocks remain in dashboard client code (verified by source scan).
- **SC-005**: Zero occurrences of the `poll = async function` global-reassignment pattern remain.
- **SC-006**: A deliberately-thrown error in one panel's render path does not prevent any sibling panel from
  rendering (verified by a targeted test).
- **SC-007**: All chart panels visually share one palette/typography/tooltip style, verified against the
  defined design-token set.
- **SC-008**: The models panel filters its ~400-row list to a matching subset within one interaction, no page
  reload required.
- **SC-009**: The existing `node:test` suite (500+ files) continues to pass with zero regressions introduced
  by this phase.

## Assumptions

- Tabler is used as a design-token/visual reference (palette, spacing, typography conventions), not imported
  wholesale as a CSS/JS framework dependency — this repo has no frontend build step, and the dashboard is
  server-rendered vanilla JS/HTML.
- uPlot remains the sole charting engine; no new charting library is introduced.
- Migration proceeds incrementally, section by section (strangler-fig), each shipped as an independently
  reviewable, independently revertible change — never a single big-bang rewrite.
- The four bugs found and fixed during the pre-spec audit (see Context above) are already resolved on `main`
  (uncommitted) and are prerequisites already satisfied, not part of this phase's task list.
- Backend API endpoints (`/api/analytics/*`, `/api/status`, `/api/providers`, `/api/models`, etc.) are stable
  and are not being redesigned by this phase — only how the client consolidates and renders calls to them
  changes.

## Out of Scope *(optional)*

- Any rework of `specs/008-end-user-configurability`'s already-delivered backend (profiles, backups,
  policy-write levers) — this phase only touches how existing legacy board content migrates into that system.
- Full Electron/system-tray UI redesign.
- Mobile/responsive redesign, unless later requested.
- Backend API redesign or new endpoints — this is a client-side consolidation and hardening effort.
- The separate end-to-end QA/test-automation initiative discussed earlier (Playwright/BDD/contract testing
  strategy) — tracked independently, not part of this spec.
- Replacing vanilla JS with a frontend framework (React/Vue/etc.) — out of scope unless explicitly revisited.
