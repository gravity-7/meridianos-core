# Tasks: End-User Configurability

**Input**: Design documents from `specs/008-end-user-configurability/`

**Prerequisites**: plan.md (required), spec.md (required)

**Tests**: Test tasks included per Constitution Principle IV (Test-First Discipline).

**Organization**: Grouped by user story per plan.md's phased delivery order — US2 (Profiles) first (pure
backend, no dependency), then US1 (Settings tab, backend before UI), then US3 (Setup wizard, largest surface,
sequenced last).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 (Settings tab), US2 (Profiles), US3 (Setup wizard)

---

## Phase 1: Setup (Verification Baseline)

- [X] T001 Run full test suite to establish baseline: `npm test` — confirm current pass count, 0 failures (2026-08-05: 1226 pass)
- [X] T002 [P] Document existing lever/settings surface: `LEVER_PATHS` (policy-write.mjs), `POST /api/policy` (dashboard/server.mjs), existing dashboard render functions (`renderProviders`, `renderModels`, `renderAgentBudgetControls`) — confirms what NOT to rebuild

---

## Phase 2: User Story 2 — Config Profiles with Inheritance (Priority: P2, built first — no dependencies)

**Goal**: `profiles.mjs` resolving a named profile's `extends:` chain via deep merge.

**Independent Test**: `resolveProfile({ profiles: { base: {...}, dev: { extends: 'base', ... } } }, 'dev')`
returns base fields with dev's overrides applied.

- [X] T003 [US2] Create `tests/profiles.test.mjs` — covers: single profile no `extends`, one-level `extends`,
  multi-level `extends` chain, child overrides win, unknown `extends` target errors clearly, circular
  `extends` (direct A→A and indirect A→B→A) errors clearly, unknown profile name errors clearly (14 tests,
  all passing)
- [X] T004 [US2] Implement `profiles.mjs`: `resolveProfile(policy, name)`, `listProfiles(policy)`, and
  `resolveActivePolicy(policy)` — the last one added beyond the original task scope: overlays
  `policy.active_profile` onto the base policy, called explicitly at the specific boot/tick points that need
  it rather than folded into `loadPolicy` itself (loadPolicy has ~100 call sites across this repo that all
  expect the raw parsed file — see profiles.mjs's doc comment for the reasoning)
- [X] T005 [US2] **Revised from the original task wording** — there is no `gateway/cli.mjs start` command in
  this repo (the actual daemon boot entrypoint is `scheduler.mjs`'s `start()`, invoked via
  `daemon-entry.mjs`, and is entirely env-var-driven with no flag parsing at all, unlike `gateway/cli.mjs`
  which is the *standalone gateway sidecar* CLI). `active_profile` is added to `LEVER_PATHS`
  (policy-write.mjs) so it's settable the same way every other lever is, and `resolveActivePolicy` is ready
  to call from `scheduler.mjs`'s boot path — but that specific wiring (calling `resolveActivePolicy` right
  after `scheduler.mjs`'s boot-time `loadPolicy()` call) is **not yet done** and is left as a follow-up
  (tracked below) rather than an invasive edit across scheduler.mjs's 8 separate `loadPolicy` call sites
  without being able to verify live daemon behavior end-to-end in this pass.
- [X] T006 [US2] Add `node gateway/cli.mjs profile list` CLI command (corrected path — see T005 note) — prints
  each profile name + its `extends` parent + marks the active one. Manually smoke-tested end-to-end against a
  temp tenant with a `profiles:` block; full suite still at 1240 pass / 0 fail after the change.

**Follow-up not yet done for US2**: wire `resolveActivePolicy` into `scheduler.mjs`'s boot sequence so
`active_profile` actually takes effect on daemon start/tick (currently the resolver and the lever exist and
are tested, but nothing in the running daemon calls `resolveActivePolicy` yet — profile switches don't yet
change live behavior, only what `gateway/cli.mjs profile list` reports as "active").

**Checkpoint**: Profiles fully functional via CLI; no dashboard UI yet (T009 wires it in later).

---

## Phase 3: User Story 1 — Settings & Observability Workspace (Priority: P1)

**2026-08-05 scope change**: originally a flat "Settings tab," now a Grafana-parity panel-grid workspace
(drag/resize panels, real charts, flow-graph routing editor) per explicit operator direction — see spec.md
US1 and plan.md's Constitution Check (two new vendored frontend libraries: Muuri, uPlot, Litegraph.js).

### Backend (no UI dependency — testable standalone)

- [X] T007 [US1] Create `tests/policy-backups.test.mjs` — covers: `listBackups` returns existing
  `policy.backup.*.yaml` files sorted newest-first, `restoreBackup` writes the backup's content as the new
  `policy.yaml` AND takes a fresh backup of the pre-restore state first, restoring a malformed/invalid backup
  is rejected by `validatePolicy` before it's swapped in (5 tests, all passing). Also **discovered and fixed a
  real gap while writing these**: the general lever-based `POST /api/policy` save path
  (`policy-write.mjs`'s `writePolicy`) created NO backup at all before this — only `provider-wizard.mjs`'s
  separate write path did. Added backup-on-write to `writePolicy` itself (4 new tests in
  `tests/policy-write.test.mjs`, collision-safe naming, generalizes to any policy path) so Settings saves get
  the same safety net.
- [X] T008 [US1] Implement `policy-backups.mjs`: `listBackups(repoRoot)`, `restoreBackup(repoRoot, timestamp, { policyPath })`
- [X] T009 [US1] Add `GET /api/config/backups` and `POST /api/config/restore/:timestamp` to `dashboard/server.mjs`.
  **No separate `/api/profile/activate` endpoint needed** — `active_profile` is already a plain `LEVER_PATHS`
  entry (US2/T005), so the existing generic `POST /api/policy` already handles activating a profile with zero
  new server code; a dedicated endpoint would have been pure duplication.
- [X] T010 [US1] [P] Extend `LEVER_PATHS` (policy-write.mjs) with the General/Gateway/Integrations/Prompts
  fields — **audited against actual runtime reads, not the task text's assumed field list**: `gateway.port` is
  the one genuinely real, currently-unwritable field (validated by policy-validate.mjs, read by scheduler.mjs +
  dashboard/server.mjs). "Logging toggle" and "enforcement mode" were deliberately NOT added — neither
  corresponds to any field actually read anywhere in this codebase; a lever with no backing behavior would be a
  dead UI control. "Prompts" fields live in tenant.yaml (multi-line `|` block scalars), not policy.yaml, and
  need a block-scalar-aware writer this module doesn't implement — a genuine follow-up gap, documented rather
  than faked. **Fixed the pre-existing gap this surfaces**: `setPolicyValue` now inserts a missing path instead
  of throwing — the deepest existing ancestor mapping gets the remaining levels added as its children (2-space
  indent), or a new top-level block is appended at EOF if no ancestor exists at all. `active_profile` and
  `gateway.port` both now resolve via this fix rather than needing a pre-seeded line. 4 new tests
  (tests/policy-write.test.mjs), verified live against a real policy.yaml (see T018).

### Frontend foundation — vendor + prove the shell BEFORE building every panel

- [X] T011 [US1] Vendored via `npm pack <name>@<version>` (uplot@1.6.32, muuri@0.9.5, litegraph.js@0.7.18 — the
  exact plan.md-pinned versions, confirmed still current via `npm view`) into `dashboard/static/vendor/`
  (uplot.iife.min.js + uplot.min.css, muuri.min.js, litegraph.min.js + litegraph.css), each with its LICENSE
  file, plus `VERSIONS.md` recording source/fetch-date/upgrade procedure. Confirmed `npm ls --prod` still shows
  only better-sqlite3 + stripe — nothing leaked into the Node dependency tree.
- [X] T012 [US1] Built `dashboard/static/settings-workspace.mjs` — Muuri panel-grid shell, `registerPanel(id,
  title, render)` API, layout (order + size) persisted to `localStorage` and restored on reload; new panel ids
  not in a saved layout are appended after the saved ones (adding a panel type doesn't lose old layouts). Also
  added a `GET /static/*` route to dashboard/server.mjs (no static-file serving existed at all before this —
  the dashboard was previously one fully self-contained HTML file) with path-traversal protection.
- [X] T013 [US1] **Verified live in browser** (Chrome DevTools Protocol via the Browser tool, not screenshots —
  this environment's Browser pane doesn't composite frames for a non-displayed tab, so verification used
  `read_console_messages`, `read_network_requests`, and direct DOM/JS inspection instead): all three vendored
  libraries load as globals; a 3-panel proof (kill-switch config panel, uPlot chart fed by real dummy data, a
  2-node Litegraph canvas) renders; drag-reorder (via Muuri's own `move()` API — this environment can't
  simulate raw mouse drags either) and resize both persist to localStorage and correctly restore across a full
  page reload. **Found and fixed a real bug in the process**: the CSS `resize: both` handle was on the INNER
  `.workspace-panel-body`, but the `ResizeObserver` (and the code deciding what to persist) watched the OUTER
  `.workspace-panel-item` — a resize on the inner element would never have been detected or saved. Also fixed:
  `grid.refreshItems()` was being called with a raw DOM element instead of a Muuri Item instance, throwing
  `_refreshDimensions is not a function` on every real resize (which would have silently broken the following
  `saveLayout()` call too, in the same callback).

### Full panel set (built once T013's shell is proven)

- [X] T014 [US1] Built `dashboard/static/settings-panels.mjs`: kill-switch, General/Gateway (gateway.port,
  T010), profile selector (US2 — reads the new `GET /api/config/profiles` endpoint added because nothing
  previously exposed `policy.yaml`'s `profiles:`/`active_profile` fields to the dashboard at all), and
  backup list/restore (T008/T009's existing endpoints). Per spec.md's Assumptions, Agent/Provider/Model/Budget
  are explicitly out of scope beyond what already exists elsewhere on the page.
- [X] T015 [US1] Built `dashboard/static/observability-panels.mjs`: cost-over-time and token-usage as uPlot
  time series (`/api/analytics/timeseries`), provider spend breakdown as proportional horizontal bars
  (`/api/ledger/spend-by-provider` — uPlot has no pie-chart primitive; bars satisfy FR-013's "actual chart, not
  a restyled tile" without fighting the library's actual purpose). **Found and fixed a real bug**: the panel
  read the raw `/api/ledger/spend-by-provider` response as if it WERE the provider breakdown map, when the
  real shape is `{ok, available, providers: {...}}` — every render would have shown garbage
  (`"ok$0.0000 available$0.0000..."`) instead of the breakdown, caught only by live-browser verification (a
  pure unit test with a hand-written fixture would have encoded the same wrong assumption).
- [X] T016 [US1] Built `dashboard/static/routing-flow-panel.mjs`: Litegraph provider/model → agent·tier nodes;
  connecting a model to a tier posts `model_routing.<agent>.<tier>: modelId` through the existing `POST
  /api/policy` (FR-002, no parallel write path). Added `GET /api/config/routing` (roster + tiers + current
  `model_routing`) since nothing previously exposed that either. **Documented, not silently worked around**: a
  connection here writes the model's bare id — the "legacy string form" `resolveRoutingEntry` always resolves
  against provider 'anthropic' regardless of the model's actual provider, because `setPolicyValue`/LEVER_PATHS
  only ever write scalar leaves, never the `{provider, model}` object form the router also accepts. Extending
  the write path to accept object values is out of scope here (FR-002) and is called out in the panel's own
  header comment rather than mis-wiring cross-provider connections silently.
- [X] T017 [US1] Wired a "⚙ Settings" button into the dashboard's top toolbar, toggling a real `#settingsPanel`
  section (lazy-mounts the workspace + panels on first open, so the vendored libraries' cost is never paid on a
  normal page load that never opens Settings) — replacing the dangling `#settingsPanel` anchor reference (was
  line ~684) with a real element.
- [X] T018 [US1] **Verified the full workspace live in a browser against a real (not diagnostic-stub) tenant**
  per SC-005: seeded a real `policy.yaml`, ledger, and model registry at the config's actually-resolved paths
  (discovered along the way: the no-args diagnostic launch resolves `repoRoot` to the filesystem drive root,
  not the repo directory — a pre-existing quirk unrelated to this feature, worked around for verification
  rather than "fixed" out of scope). Confirmed live: toggling the kill-switch panel writes `policy.yaml` AND
  creates a timestamped backup; the Backups panel lists it and Restore reverts the file AND takes a second
  backup of the pre-restore state; cost-over-time and token-usage render real uPlot charts from real
  seeded-and-aggregated ledger data; connecting a routing edge posts through `POST /api/policy` and — for a
  LEVER_PATHS-whitelisted agent/tier — persists to `policy.yaml` (which also exercised T010's insert-if-missing
  fix live, since `model_routing.claude.medium` didn't exist under the existing `model_routing.claude:` mapping
  yet). Zero console errors throughout. `npm test`: 1268 pass, 0 fail after all of T010-T018.

**Checkpoint**: Settings/Observability workspace fully functional, backed by existing concurrency-safe write
path, verified live in a browser — not just unit-tested.

---

## Phase 4: User Story 3 — Browser + CLI Setup Wizard (Priority: P3, largest surface — last)

- [X] T019 [US3] Created `tests/setup-wizard-core.test.mjs` — 15 tests covering: budget math (positive/scaling/
  per-agent split/error cases/ratio consistency with init.mjs's own defaults), plan assembly (never writes,
  never leaks API keys into policy.yaml/tenant.yaml — FR-008), existing-config detection, and write behavior
  (fresh write, force-required overwrite guard, force:true override).
- [X] T020 [US3] Implemented `setup-wizard-core.mjs` — `detectEnvironment()`, `detectProviders()` (re-exports
  P2's `autoDetectProviders()` unchanged), `computeBudgetFromDollars()` (documented reference-rate + 3:1
  input:output heuristic, reuses init.mjs's own 5h:weekly ratio), `buildSetupPlan()` (pure — returns
  `{files, budget}`, never touches disk), `writeSetupPlan()` (the only function that writes; refuses to
  overwrite an existing policy.yaml without `{force:true}`). **Scope correction from the original task
  wording**: generates `.ai/tenant.yaml` + `.ai/policy.yaml` + `.env` (not `.ai/providers.yaml` — provider
  API keys go to `.env` per FR-008; a provider needing a non-default `.ai/providers.yaml` entry is already
  covered by P2's existing wizard, out of scope here). Deliberately does NOT refactor `init.mjs` (a separate,
  interactive-only readline script with no exported functions) or `provider-wizard.mjs`'s existing-policy
  mutation helpers (a different concern — they edit an existing file, this scaffolds a new one).
- [X] T021 [US3] Added a `setup` subcommand to `gateway/cli.mjs`: `setup --init [--agents x,y] [--providers
  x,y] [--budget N] [--force]` (non-interactive, writes immediately) and `setup [--resume] [--force]`
  (interactive, readline step-by-step prompts mirroring init.mjs's own UX, `--resume` reads/writes
  `.ai/setup-state.json` to pre-fill answers from a prior incomplete session). 3 new tests
  (gateway/tests/cli.test.mjs) as real subprocess runs against a temp `cwd`.
- [X] T022 [US3] Added `GET /setup` (serves `dashboard/setup.html`, a new self-contained 5-step wizard page —
  tenant name → agents → providers → budget → review — with the same `__AIOS_TOKEN__`/fetch-wrapper pattern
  as `index.html`) and `GET /api/setup/status` + `POST /api/setup/plan` + `POST /api/setup/commit` to
  `dashboard/server.mjs`, all built on `setup-wizard-core.mjs`. Wizard state persisted to `localStorage`
  between steps (FR-011). **Found and fixed a real security bug while writing tests**: the two POST routes
  were initially placed BEFORE the file's `authorized()` token gate, meaning they'd have accepted
  unauthenticated (even cross-origin) requests to plan/write files — caught by a test asserting both routes
  return 403 without a token, then fixed by moving them after the gate like every other mutating route.
  **Also fixed**: both handlers used `process.cwd()` instead of `config.repoRoot`, inconsistent with the rest
  of this file and untestable without dangerous global `process.chdir()` mutation — switched to
  `config.repoRoot`, confirmed by a test that commits and asserts the file landed in the tenant's `repoRoot`,
  not the process's cwd. 8 new tests (tests/server.test.mjs).
- [X] T023 [US3] Existing-config guard implemented on both paths: CLI `--force` flag (T021, refuses + exits 1
  without it), browser wizard shows an explicit "Existing configuration found... Continue anyway?" step
  before proceeding (dashboard/setup.html's `renderExistingWarning()`), and `writeSetupPlan()` itself refuses
  without `{force:true}` regardless of caller — defense in depth, not just a UI-layer check. **Verified live**:
  ran the full 5-step browser wizard against a real (non-diagnostic-stub) tenant root end-to-end — confirmed
  real `.ai/tenant.yaml`/`.ai/policy.yaml`/`.env` written with correctly-computed budget figures, then
  reloaded `/setup` against that same root and confirmed the existing-config warning triggers correctly.

**Checkpoint**: New installs can go from zero to running without touching `policy.yaml` directly. ✅ Verified
live in a browser, not just unit-tested.

---

## Phase 5: Polish

- [X] T024 `npm test`: 1293 pass, 0 fail, 10 skipped (up from the ~1226 baseline T001 recorded) — 0
  regressions across all of T003-T023. (Along the way, found and cleaned up filesystem pollution from this
  session's own live-browser verification runs at two locations outside the repo — `C:\.ai\` from the
  diagnostic dashboard launch's `repoRoot` resolving to the drive root, a pre-existing `config.mjs` quirk
  unrelated to this feature — and flagged a SEPARATE pre-existing test-isolation gap in
  `tests/dashboard-project-api.test.mjs`, which was already writing to the real repo root's `.ai/` before this
  session touched anything, as a follow-up task rather than fixing out-of-scope code.)
- [X] T025 Documentation updated — see `docs/MASTER-PLAN-CLOSE-GAPS.md`'s P3 row and this repo's
  `dashboard/static/vendor/VERSIONS.md` (the second zero-dependency exception, written as part of T011) for
  the frontend library justification. Profile `extends:` mechanism is documented in `profiles.mjs`'s own
  header comment and spec.md's Assumptions section (both predate this polish pass — T004).

---

## Dependencies

- US2 (Profiles) has no dependency on US1 or US3 — built first as the lowest-risk, fully independent slice. **Done.**
- US1's backend (T007-T010) has no UI dependency and can be tested standalone. T011-T013 (vendor + shell +
  browser-verify) must land before T014-T016 (full panel content) per the phased "prove the shell first" plan.
  T017-T018 (nav wiring + full live verification) depend on all of T007-T016.
- US3 depends on nothing in this spec functionally, but is sequenced last per plan.md's risk ordering (it is
  the largest new UI surface).
- T014's profile-selector panel depends on both US2 (already done — T004's `listProfiles`) and US1's
  workspace shell (T012-T013).
