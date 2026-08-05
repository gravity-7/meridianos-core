# Feature Specification: End-User Configurability

**Feature Branch**: `008-end-user-configurability`

**Created**: 2026-08-05

**Status**: Draft

**Input**: `docs/MASTER-PLAN-CLOSE-GAPS.md` Phase 3 (P3-F1..F4), scoped down against current repo state — a
large fraction of P3-F1's originally-planned backend (lever-based policy writes, providers/models tables)
already shipped incidentally as part of P2 and P6. This spec covers only what remains undelivered.

## Context: What Already Exists (not respecced here)

- `POST /api/policy` + `LEVER_PATHS` (`policy-write.mjs`) — scalar-level whitelisted writes to `policy.yaml`,
  with byte-preserving surgical edit, lock-file concurrency guard, and `validatePolicy` gating.
- `dashboard/index.html` already renders agent budget tiles, quiet-hours, work-concurrency, and governance
  levers inline (scattered across the single page, not grouped under a dedicated tab).
- `renderProviders` / `renderModels` (dashboard/index.html) + `GET/POST /api/providers`, `GET /api/models` —
  provider and model tables already visible and editable (P2's wizard, T078).
- `config-hot-reload.mjs` (T198) — hot-reload plumbing for non-critical settings already exists.
- CLI provider wizard (`gateway/cli.mjs provider add`) and dashboard provider wizard (P2 US8) already cover
  "add a provider" without a code change.

None of the above is re-built here. This spec covers the genuine remaining gaps only.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Unified Settings & Observability Workspace (Priority: P1)

An operator opens the dashboard and finds a Grafana-grade workspace: a drag/resize panel grid (not a flat
form) hosting both configuration panels (general, gateway, integrations, prompt-governance — the fields that
today only exist by editing `policy.yaml` directly) and real observability panels (time-series cost/usage
charts, gauges) built on the existing analytics data. Provider→tier→agent routing is additionally editable as
a connectable node graph, not just a dropdown table.

**Why this priority**: Without this, "configurable" still means "know which YAML key to edit," and
"observable" still means reading plain numbers off a tile. This is the highest-visibility slice — it's the
first thing an operator sees, and it's the one explicitly upgraded to match Grafana's UX bar (2026-08-05
direction: panel grid + real charting + flow-based routing editor, not just a restyled form).

**Independent Test**: Open the dashboard, drag a Settings panel to a new grid position and resize it, confirm
the layout persists across reload; change the gateway port field in a config panel, Save, confirm
`policy.yaml` is updated and a timestamped backup exists; open a cost-over-time chart panel and confirm it
renders real ledger data as a time series, not a static number.

**Acceptance Scenarios**:

1. **Given** the dashboard is open, **When** the operator opens the Settings/Observability workspace,
   **Then** a panel grid is shown with draggable, resizable panels covering General, Gateway, Integrations,
   Prompts (config) and Cost-over-time, Token usage, Provider spend breakdown (observability) — panel
   positions/sizes persist per-browser across reloads.
2. **Given** a config panel's field is changed to an invalid value (e.g. a non-numeric port), **When** the
   operator attempts to save, **Then** the field shows a validation error and the save is rejected before any
   write.
3. **Given** a valid config change is saved, **When** the write completes, **Then** a
   `policy.backup.{timestamp}.yaml` file exists and `GET /api/config/backups` lists it.
4. **Given** at least one backup exists, **When** the operator calls `POST /api/config/restore/:timestamp`,
   **Then** `policy.yaml` is replaced with that backup's content and a new backup of the pre-restore state is
   taken first (restore never destroys the state it replaces).
5. **Given** the routing flow-graph panel is open, **When** the operator drags a connection from a model node
   to a tier node, **Then** `model_routing.<agent>.<tier>` is updated to include that model as a candidate,
   through the same `policy-write.mjs` path as every other lever (no parallel write mechanism).
6. **Given** a cost/usage chart panel is open, **When** new token events land in the ledger, **Then** the
   chart reflects them on its next refresh without a full page reload.

---

### User Story 2 - Config Profiles with Inheritance (Priority: P2)

An operator defines named configuration profiles (e.g. `dev`, `prod`) that inherit from a shared base and
override only what differs, and switches between them via CLI flag or dashboard dropdown without hand-editing
every field for each environment.

**Why this priority**: Directly requested in the completion plan (P3-F3); depended on by nothing else in this
spec, so it can ship independently of User Story 1.

**Independent Test**: Define a `profiles.base` block and a `profiles.dev` block that sets `extends: base` plus
one override; call `resolveProfile(policy, 'dev')`; confirm the resolved object contains the base's fields
with the override applied.

**Acceptance Scenarios**:

1. **Given** `policy.yaml` defines `profiles.base` and `profiles.dev` with `extends: base`, **When** the
   `dev` profile is resolved, **Then** every field from `base` is present unless `dev` overrides it.
2. **Given** a profile chain `prod extends base`, **When** `node cli.mjs start --profile prod` runs, **Then**
   the daemon boots using the resolved `prod` configuration.
3. **Given** an unknown profile name, **When** resolution is attempted, **Then** a clear error names the
   missing profile rather than silently falling back to defaults.
4. **Given** a profile `extends` itself directly or transitively, **When** resolution is attempted, **Then**
   a clear "circular profile inheritance" error is raised instead of an infinite loop or stack overflow.

---

### User Story 3 - Browser Setup Wizard (Priority: P3)

A brand-new, non-technical user opens `localhost:4317/setup`, walks through a short guided flow (provider
detection, API key entry, budget in dollars, agent roster), and ends with a working, bootstrapped
installation — without ever opening `policy.yaml`.

**Why this priority**: Highest end-user-facing value but the largest, riskiest build (new UI surface,
touches init flow); sequenced last so Stories 1-2 ship value even if this slips.

**Independent Test**: Run the wizard's non-interactive CLI equivalent
(`node cli.mjs setup --init --providers deepseek --budget 50`) and confirm `policy.yaml` and `.env` are
written with no prompts, matching what the interactive path would produce.

**Acceptance Scenarios**:

1. **Given** a fresh checkout with no `.ai/policy.yaml`, **When** the operator completes the wizard (browser
   or `--init` CLI equivalent), **Then** `policy.yaml`, `.env`, and `.ai/providers.yaml` exist and are valid.
2. **Given** `ANTHROPIC_API_KEY` is set in the environment, **When** the wizard reaches the Providers step,
   **Then** Anthropic is pre-detected and shown as already configured.
3. **Given** the operator enters a monthly dollar budget, **When** the review step renders, **Then** the
   equivalent weekly/daily/per-agent token caps are shown, computed from that dollar figure.
4. **Given** the wizard is mid-flow, **When** the browser tab is closed and reopened, **Then** the wizard
   resumes at the last completed step (state persisted client-side).

---

### Edge Cases

- Two dashboard requests save Settings concurrently → the existing `policy-write.mjs` lock file serializes
  them; the loser's write must not silently discard the winner's fields (already covered by existing
  `writePolicy` locking — this spec's Settings tab must go through that same path, not a parallel one).
- A profile's `extends` target is deleted from `policy.yaml` after being referenced → resolution fails with a
  named error rather than crashing the daemon boot.
- The setup wizard runs against a repo that already has a `policy.yaml` → wizard must detect this and offer
  "reconfigure" rather than silently overwriting an operator's existing production config.
- Restoring a backup that was written by an older schema version → `policy-validate.mjs` still gates the
  restored content before it's swapped in; an invalid restore target is rejected with the same error surface
  as an invalid Save.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The dashboard MUST expose a single "Settings" navigation entry hosting a drag/resize panel grid
  covering General, Gateway, Integrations, and Prompts config categories (today's biggest gap) alongside
  observability panels (FR-012+).
- **FR-002**: Settings writes MUST go through the existing `policy-write.mjs` / `LEVER_PATHS` mechanism
  (extended with new paths as needed) — no second, parallel policy-write path.
- **FR-003**: The system MUST expose `GET /api/config/backups` (list existing `policy.backup.*.yaml` files
  with timestamp) and `POST /api/config/restore/:timestamp` (restore a specific backup, itself backing up the
  pre-restore state first).
- **FR-004**: The system MUST support named configuration profiles under a `profiles:` top-level key in
  `policy.yaml`, each profile optionally declaring `extends: <profile-name>` for inheritance.
- **FR-005**: Profile resolution MUST deep-merge the extended profile's fields with the child's overrides
  (child wins), detect circular `extends` chains, and error clearly on an unknown `extends` target.
- **FR-006**: The active profile (`policy.active_profile`) MUST take effect on the daemon's boot sequence and
  subsequent scheduler ticks (not just be reported by a CLI listing) — this is `scheduler.mjs` calling
  `resolveActivePolicy` after its own `loadPolicy` calls, tracked in tasks.md as a US2 follow-up.
- **FR-007**: The dashboard MUST provide a profile selector that lists all defined profiles and the
  currently-active one.
- **FR-008**: The system MUST provide a browser-accessible setup wizard at `/setup` covering: provider
  auto-detection (reusing P2's `autoDetectProviders()`), API key entry (written to `.env`, never to
  `policy.yaml`), a dollar-denominated budget prompt that computes per-agent token caps, and a review step
  before writing any file.
- **FR-009**: The wizard MUST have a non-interactive CLI equivalent that produces the same `policy.yaml`/`.env`
  shape as the interactive path, for CI/automation use.
- **FR-010**: The wizard MUST detect an existing `policy.yaml` and require explicit confirmation before
  overwriting it.
- **FR-011**: Wizard progress MUST persist client-side (`localStorage`) so a closed/reopened browser tab
  resumes at the last completed step.
- **FR-012** *(2026-08-05 addition — Grafana-parity direction)*: The Settings/Observability workspace MUST
  render panels in a drag/resize grid (not a fixed vertical form) whose layout (panel positions and sizes)
  persists per-browser across reloads.
- **FR-013**: The workspace MUST include at least three observability panels backed by real ledger data
  rendered as actual charts, not restyled numeric tiles: cost-over-time (time series), token usage (time
  series or bar), and provider spend breakdown (pie/bar/gauge).
- **FR-014**: The workspace MUST include a flow-graph panel where provider/model nodes connect to tier nodes
  to express `model_routing.<agent>.<tier>` candidates, editable by dragging connections, and MUST write
  through the same `policy-write.mjs` path as every other lever (FR-002) — no parallel routing-write code path.
- **FR-015**: Frontend charting/grid/graph libraries introduced for FR-012-014 MUST be vendored as static
  browser assets (no bundler, no build step, no framework rewrite) consistent with the existing single-HTML
  dashboard, and MUST be the second documented, justified exception to the zero-dependency principle (the
  first being Stripe) — see plan.md's Constitution Check.

### Key Entities

- **Profile**: a named, inheritable configuration overlay (`profiles.<name>` in `policy.yaml`), resolved at
  boot or on-demand into a flat merged policy object. Has a name, an optional `extends` parent, and arbitrary
  policy-shaped override fields.
- **Backup**: an immutable, timestamped snapshot of `policy.yaml` created on every Settings save and every
  restore, named `policy.backup.{ISO-timestamp}.yaml`.
- **Panel**: one grid cell in the Settings/Observability workspace — either a config panel (form fields bound
  to `LEVER_PATHS`) or an observability panel (a chart bound to an existing analytics/ledger endpoint) or the
  routing flow-graph panel. Has a grid position/size persisted client-side.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A non-technical user can go from a fresh checkout to a bootstrapped, running installation via
  the setup wizard in under 5 minutes, with zero direct `policy.yaml` edits.
- **SC-002**: Every scalar currently only reachable by hand-editing `policy.yaml` is reachable from the
  dashboard Settings tab.
- **SC-003**: Switching profiles (CLI or dashboard) takes effect on the next scheduler tick without a full
  daemon restart, for every field `config-hot-reload.mjs` already classifies as non-critical.
- **SC-004**: `npm test` continues to pass at 0 failures with this feature's tests added; zero new Node.js
  runtime dependencies beyond the existing `better-sqlite3` + `stripe` exceptions (profile inheritance is
  implemented via `extends:` + existing merge patterns, not a new YAML-anchor-parsing dependency). The three
  frontend charting/grid/graph libraries (FR-015) are a separate, browser-only exception, vendored as static
  assets — not npm runtime dependencies of the Node.js process — see plan.md.
- **SC-005**: The panel grid, charts, and flow-graph render correctly and remain usable (drag, resize, connect)
  in a live browser session — verified via the Browser tool against the running dashboard dev server, not
  just unit tests, before this user story is reported complete.

## Assumptions

- The originally-planned P3-F4 (replace `yaml-lite.mjs` with the `yaml` npm package solely to gain
  anchor/alias syntax for profiles) is **not required** to deliver profile inheritance: an explicit
  `extends: <name>` key resolved by a deep-merge function (the same pattern `providers.mjs` already uses for
  its three-source provider merge) delivers the same operator-facing value without a new runtime dependency
  or the risk of subtly changing how every existing `policy.yaml` in production parses. This is a deliberate
  scope reduction from the original plan, recorded as an architectural decision in plan.md.
- "Agents / Providers / Models / Budget" settings categories from the original P3-F1 plan already have
  dashboard UI (scattered, pre-existing) and are explicitly out of scope for net-new work here beyond linking
  them from the new workspace. Routing is the one exception — FR-014 upgrades it to the flow-graph panel.
- IDE proxy configuration (originally bundled under a P3-adjacent plan) already shipped under P4 and is not
  touched here.
- **2026-08-05 direction change**: the operator explicitly asked for Grafana-parity UX (panel grid + real
  charts + flow-based routing editor) rather than the originally-planned flat form. This is a genuine scope
  increase over the original P3-F1, accepted with an explicit, scoped exception to the zero-dependency
  principle for three small, framework-free frontend libraries (chosen 2026-08-05): a charting library for
  time-series/gauges, a grid-layout library for drag/resize panels, and a node-graph library for the routing
  editor. See plan.md's Constitution Check for the specific libraries and why each was chosen.
