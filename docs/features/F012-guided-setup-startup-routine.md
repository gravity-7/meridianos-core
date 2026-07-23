# F012 — Guided Setup & Startup Routine

## Status
designing

## Complexity
3

## Owner
both

## Risk tags
[]

---

## Summary

Today, setting up a new AIOS tenant requires manually creating `.ai/` directories, writing
board.json + policy.yaml from scratch (or copying — and editing — from another tenant), and
writing a DomainPlugin `.mjs` module. The scheduler's `start()` silently crashes when the DB is
absent or the directory structure is incomplete, yielding stack traces instead of actionable
guidance. This is death for self-service adoption.

F012 delivers **two things** over one module boundary:

1. **A guided first-run setup wizard** (`setup.mjs`) that interactively collects the minimum
   configuration a tenant needs, creates the `.ai/` skeleton, and validates it — all without
   requiring the founder to write a single line of JavaScript.

2. **A hardened startup routine** that validates prerequisites at every boot, detects first run,
   surfaces colour-coded diagnostics with remediation steps, and gracefully hands off to the
   production daemon.

The **design target** is a founder who has never used AIOS before and just cloned a project:
`node tools/aios/cli.mjs setup` → answer 3–5 questions → daemon is up and running.

---

## Architecture

### Component diagram

```
┌──────────────────────────────────────────────────┐
│                   CLI entry                      │
│  node tools/aios/cli.mjs setup [--check|--init]  │
│  node tools/aios/cli.mjs boot-check              │
└──────────────┬───────────────────────────────────┘
               │
   ┌───────────▼───────────┐
   │     setup.mjs          │
   │  guidedSetup(config)   │  ── the wizard engine
   │  detectFirstRun()      │  ── discover mode
   │  validatePrereqs()     │  ── node/git/repo/env
   │  initStructure()       │  ── .ai/ skeleton
   │  initPolicy()          │  ── starter policy.yaml
   │  initBoard()           │  ── starter board.json
   └───────────┬───────────┘
               │
   ┌───────────▼───────────┐
   │   boot-check.mjs       │
   │  startupCheck(config)  │  ── every-boot validation
   │  checkDatabase()       │  ── DB exists + ready
   │  healthReport()        │  ── human-readable summary
   └───────────┬───────────┘
               │
   ┌───────────▼───────────┐
   │   scheduler.mjs        │
   │  start()               │  ── calls startupCheck first
   │   · first-run gate      │  ── detects absent DB
   │   · boot diagnostics    │  ── reports every check
   └────────────────────────┘
```

### Design decisions

**D1 — The setup wizard is a core module, not a tenant concern.**
`setup.mjs` lives IN the core (`meridianos-core`) because every tenant needs it, and its
prerequisite checks are identical regardless of domain. It walks the founder through supplying
the values that ultimately become a `DomainPlugin` — roster, board title, risk taxonomy,
budget caps — then writes a starter policy.yaml and seeds the DB. The tenant's own CLI
(`tools/aios/cli.mjs`) wires `setup` as a subcommand with zero additional core changes.

**D2 — Interactive mode vs. non-interactive (`--init`).**
The wizard has two modes: interactive (guided, asks questions on the terminal) and
non-interactive (`--init`, takes sensible defaults). Both produce identical file output; the
non-interactive path is the automation/CI entry point. The interactive path asks:

1. What is your project/board title?
2. Which agents will work this project? (multi-select from the DOMAIN_AGENTS registry or free-form)
3. How often should the runner fire? (hourly / off)
4. Budget caps? (weekly dollar limit, per-agent 5h window)

**D3 — Policy.yaml is the single written config artifact.**
The wizard does NOT write a DomainPlugin `.mjs` file — that stays the code-level seam it is
today, and tenants that need bespoke guardrails or custom prompts still write one. The wizard
writes a **policy.yaml** covering EVERYTHING a declarative first-time setup needs: cadence,
budget window, agent roster, model routing, leverable knobs.

**D4 — First-run detection is cheap and stateless.**
`detectFirstRun(config)` checks whether `config.dbPath` (the canonical DB file) exists on
disk. No flag file, no annotation in the DB itself, no env var — the DB's absence IS the
signal. This is immune to stale flags and works identically after a fresh checkout.

**D5 — Boot diagnostics never block startup (only first-run does).**
`startupCheck()` reports all findings; missing/incorrect prerequisites are logged as
`warnings`/`errors` to the event log AND the rotating daemon log, but the daemon STARTS
regardless (it already has crash-resilience guards). The ONLY hard-stop is first-run
detection: when the DB is absent, the scheduler prints the setup command and exits with a
clear message instead of proceeding to a cascade of SQL errors.

---

## API contracts

### `setup.mjs`

```js
/**
 * Run the guided setup wizard.
 *
 * @param {object} opts
 * @param {object} opts.config        the partially-resolved AiosConfig (root + policy path
 *                                    are needed; domain may be absent/minimal)
 * @param {boolean} [opts.interactive=true]  false ⇒ non-interactive defaults (--init)
 * @returns {Promise<SetupResult>}
 */
export async function guidedSetup({ config, interactive = true })

/**
 * Does a first-run installation already exist on disk?  Checks config.dbPath.
 * @returns boolean — true when the DB file exists (already set up).
 */
export function detectFirstRun(config)

/**
 * Validate runtime prerequisites: node version, git, repo-ness.
 * Returns structured result; never throws — a missing prereq is a failed check, not a crash.
 */
export function validatePrerequisites(config)

/**
 * Create the `.ai/` directory skeleton.  Idempotent — re-running against an existing
 * directory does not overwrite anything.
 * @returns {ok, created: string[]} — `created` lists every directory that was made.
 */
export function initDirectoryStructure(config)

/**
 * Write a starter `.ai/policy.yaml` if one doesn't exist.
 * `overrides` is the interactive wizard's collected answers layered over defaults.
 */
export function initPolicy(config, overrides)

/**
 * Seed a minimal starter board.json → DB that defines only the necessary
 * infrastructure tasks (if any).  A tenant with zero tasks is fine — the
 * planner can promote from intake.
 */
export function initBoard(config)
```

**Type shapes:**

```ts
interface SetupResult {
  ok: boolean;
  steps: SetupStep[];
  warnings: string[];
  /** Next-step prose, e.g. "Run: node tools/aios/cli.mjs render" */
  nextSteps: string[];
}

interface SetupStep {
  step: string;        // 'prerequisites' | 'directory' | 'policy' | 'board' | 'validate'
  ok: boolean;
  detail: string;      // human summary of what was done or what failed
  path?: string;       // filesystem path created/modified, when applicable
}

interface PrerequisiteResult {
  ok: boolean;
  node:  { installed: boolean; version: string; meetsMinimum: boolean };
  git:   { installed: boolean; version: string };
  repo:  { isGitRepo: boolean; hasRemote: boolean; branch: string | null };
  env:   { missing: string[]; warnings: string[] };
  paths: { aiDirExists: boolean; policyExists: boolean; boardExists: boolean };
}

interface PolicyOverrides {
  cadence?: string;            // 'hourly' | 'off'
  budget?: {
    weeklyUsd?: number;
    perAgentWindowH?: number;
  };
  agents?: string[];           // roster from interactive selection
  boardTitle?: string;
  modelRouting?: object;       // thin layer over policy.model_routing
}
```

### `boot-check.mjs`

```js
/**
 * Every-boot health check.  Called by the scheduler's start() before any
 * subsystem is wired.  Returns structured diagnostics; the scheduler logs
 * them and exits ONLY on first-run (dbNotReady).
 */
export function startupCheck(config)

/** Focused check: does the DB exist, is the schema current, how many tasks? */
export function checkDatabase(config)

/** Render the startup check result as a colour-coded human-readable block. */
export function healthReport(result)
```

**Type shapes:**

```ts
interface StartupCheckResult {
  ok: boolean;
  firstRun: boolean;          // DB does not exist → guide user to setup
  checks: {
    node:        { pass: boolean; detail: string };
    git:         { pass: boolean; detail: string };
    directory:   { pass: boolean; detail: string };
    policy:      { pass: boolean; detail: string };
    database:    { pass: boolean; detail: string; schemaVersion?: number; taskCount?: number };
  };
  errors:   string[];         // fatal issues (only first-run is fatal today)
  warnings: string[];         // non-fatal issues with remediation hints
}

interface DatabaseCheckResult {
  ok: boolean;
  exists: boolean;
  schemaVersion: number | null;
  taskCount: number;
  error?: string;
}
```

---

## Data models

### Starter policy.yaml schema

The wizard writes a policy.yaml with these top-level keys (same shape `policy-validate.mjs`
already accepts — zero new policy schema):

```yaml
# Written by `aios setup`; edit freely or use the dashboard levers.
schedule:
  cadence: hourly          # hourly | off

budget:
  kill_switch: false
  weekly_limit_usd: 10     # default cap; founder raises it later
  per_agent_window_hours: 5

agents:
  - claude
  - antigravity

agent_models:
  claude:
    default: claude-sonnet-4-6
  antigravity:
    default: claude-sonnet-4-6
```

The wizard never writes `model_routing`, `capability_matrix`, `work_stealing`,
`gateway`, or `escalation` — those are advanced levers the founder adds through the
dashboard or by hand-editing the file later. The starter is deliberately minimal.

### Starter board.json

Zero tasks by default. The planner's intake pipeline (`inbox-source.mjs` +
`planner.mjs`) is the way work enters; the wizard does not pre-populate tasks.
A tenant who already has a board.json checked into their repo skips `initBoard`
entirely (it only writes when the file is absent).

When the board.json IS absent, the wizard writes a minimal skeleton:

```json
{
  "$generated": "GENERATED — see .ai/features/F012/spec.md",
  "schema_version": 2,
  "pis": [],
  "sprints": [],
  "tasks": [],
  "milestones": [],
  "founder_actions": []
}
```

### Startup health report format (human-readable)

`healthReport(startupCheckResult)` returns a plain-text block the
daemon logger prints at boot:

```
AIOS v0.3.0  startup check
  node    PASS  v24.11.0 (>=22.5 required)
  git     PASS  2.47.1
  .ai/    PASS  directory structure ok
  policy  PASS  .ai/policy.yaml parsed (cadence=hourly)
  db      PASS  14 tasks · schema v1
All checks passed — starting daemon.
```

When a check fails:
```
  policy  FAIL  .ai/policy.yaml missing — run: node tools/aios/cli.mjs setup
```

The `healthReport` function is a pure renderer (no side effects) and is exported
so the CLI `boot-check` subcommand can print the same output.

---

## Integration: changes to `scheduler.mjs` start()

The scheduler's `start()` is the call site that wires the new checks into the
production boot sequence.  The change is additive and small:

```
Before (today):                       After:
────────────────────────────────────  ──────────────────────────────────────
createAios({domain})                  createAios({domain})
logger = ...                          logger = ...
loadEnvFile                           loadEnvFile

                                      ┌─ NEW: startupCheck(config)
                                      │  if firstRun:
                                      │    print setup instructions
                                      │    process.exit(1)  ← hard stop
                                      │  log health report
                                      │  log warnings to event log
                                      └─

openDb                                openDb
createProjectStore                    createProjectStore
                                      ...
```

The scheduler itself does NOT call `guidedSetup()` — that is the CLI entry point,
not a hot path in every boot.  The scheduler only calls `startupCheck()`, which is
cheap (filesystem existence checks, no spawns, no network).

---

## CLI surface

All subcommands are added to the tenant's CLI runner (`tools/aios/cli.mjs`):

```
node tools/aios/cli.mjs setup
    Interactive guided setup wizard.  Walks the founder through:
      1. Prerequisite checks
      2. Project title → board title
      3. Agent roster (multi-select)
      4. Cadence (hourly / off)
      5. Budget caps
      6. Creates .ai/ skeleton
      7. Writes starter policy.yaml + board.json
      8. Seeds DB
      9. Runs validate to confirm

node tools/aios/cli.mjs setup --check
    Non-interactive prerequisite check only.  Prints the health report and exits
    0 (all pass) or 1 (some fail).  No filesystem writes.

node tools/aios/cli.mjs setup --init
    Non-interactive init with defaults.  Same output as accepting every default
    in the interactive wizard.  Idempotent — safe to re-run.

node tools/aios/cli.mjs boot-check
    Print the startup health report.  Non-mutating; just reads and validates.
    Exit 0 if ok, 1 if first-run or broken.
```

---

## Acceptance criteria

### AC-1 — Interactive setup completes end-to-end
Given a fresh checkout with no `.ai/` directory, running `node tools/aios/cli.mjs setup`
(interactive mode) asks the founder 3–5 questions and:
- Creates `.ai/state/`, `.ai/inbox/`, `.ai/features/`, `.ai/runs/`, `.ai/feedback/`
- Writes a starter `.ai/policy.yaml` with the founder's chosen cadence, roster, budget caps
- Writes a minimal `.ai/state/board.json`
- Seeds the SQLite DB from board.json
- Runs `validate` and reports PASS/FAIL
- Prints "Next: run `node tools/aios/scheduler.mjs` to start the daemon"

### AC-2 — Non-interactive init produces identical output
Given a fresh checkout with no `.ai/` directory, running `node tools/aios/cli.mjs setup --init`
produces the same filesystem state as the interactive wizard with all defaults accepted.
Both modes write identical starter board.json + policy.yaml.

### AC-3 — Idempotent
Running `setup` (interactive or `--init`) against an already-initialized project is a no-op
for steps that would overwrite existing files. The wizard reports "already initialized"
and exits cleanly (non-zero only on actual errors).

### AC-4 — Scheduler detects first run
When `start()` is called against a project with no DB (i.e., setup was never run),
the scheduler:
- Calls `startupCheck(config)` which returns `firstRun: true`
- Prints a clear 3-line message directing the founder to run `node tools/aios/cli.mjs setup`
- Exits with code 1 (does NOT proceed to openDb → crash)

### AC-5 — Every-boot health report
On every `start()` invocation (including restarts), the scheduler:
- Runs `startupCheck(config)` before opening the DB
- Logs the health report (colour-coding via daemon-logger) to `.ai/logs/daemon.log`
- Writes a `scheduler.health` event to the event log
- Non-fatal warnings never stop the daemon from starting

### AC-6 — Prerequisite validation covers the documented minimums
`validatePrerequisites()` checks and reports:
- Node.js installed AND version >= 22.5.0 (the `node:sqlite` floor)
- git installed and on PATH
- The working directory is inside a git repo
- The `.ai/` directory exists (or will be created by setup)

### AC-7 — All errors include remediation
Every check that fails includes a `detail` string that tells the founder exactly what to do:
- "Node.js >= 22.5.0 required — your version is 20.11.0. Install Node 24 from nodejs.org"
- ".ai/policy.yaml is missing — run: node tools/aios/cli.mjs setup"
- No error message is a raw stack trace or bare "something is wrong"

### AC-8 — Tests exist (unit, no real git/repo needed)
- `tests/setup.test.mjs` covers guidedSetup, initStructure, initPolicy, detectFirstRun
- `tests/boot-check.test.mjs` covers startupCheck, checkDatabase, healthReport
- `tests/scheduler.test.mjs` gains a test for the first-run gate
- All tests pass in CI with `node --test`

---

## Out of scope

- **A TUI/GUI setup wizard.** The interactive mode uses `readline` (Node built-in) —
  question/answer on the terminal. A web-based setup wizard in the dashboard is a
  separate, later task.
- **Auto-detecting providers or running conformance during setup.** The wizard asks
  for roster agent names; it does not test provider connectivity (that's
  `conformance.mjs`'s job, and it requires API keys the setup wizard may not have).
- **Writing a DomainPlugin `.mjs` file.** The wizard writes declarative config
  (policy.yaml); custom guardrails/prompts still require a code plugin.
- **Migration from a hand-crafted `.ai/` layout.** The wizard only handles fresh
  first-time setup; migrating an existing hand-built `.ai/policy.yaml` is out of
  scope.

---

## File inventory (what changes)

| File | Action | Notes |
|---|---|---|
| `setup.mjs` | **NEW** | The guided setup wizard module |
| `boot-check.mjs` | **NEW** | Every-boot health check + first-run gate |
| `scheduler.mjs` | **EDIT** | Call `startupCheck()` before `openDb`; exit on first run |
| `config.mjs` | **EDIT** | Export a `MIN_NODE_VERSION` constant |
| `daemon-logger.mjs` | **no change** | healthReport output goes through the existing logger |
| `tests/setup.test.mjs` | **NEW** | Unit tests for the wizard |
| `tests/boot-check.test.mjs` | **NEW** | Unit tests for startup checks |
| `tests/scheduler.test.mjs` | **EDIT** | Add first-run gate test |

---

## Contracts (implementation reference)

### Contract: setup.mjs public surface

```js
// setup.mjs — public exports
export { guidedSetup, detectFirstRun, validatePrerequisites,
         initDirectoryStructure, initPolicy, initBoard };
export const MIN_NODE_VERSION = '22.5.0';
export const DEFAULT_AGENTS = ['claude', 'antigravity'];
export const DEFAULT_CADENCE = 'hourly';
export const DEFAULT_WEEKLY_USD = 10;
export const REQUIRED_DIRS = ['state', 'inbox', 'features', 'runs', 'feedback'];
```

### Contract: boot-check.mjs public surface

```js
// boot-check.mjs — public exports
export { startupCheck, checkDatabase, healthReport };
export const CHECK_ORDER = ['node', 'git', 'directory', 'policy', 'database'];
```

### Contract: scheduler.mjs integration point

The scheduler's `start()` must call `startupCheck(config)` AFTER `createAios`/logger
setup but BEFORE `openDb`.  The exact insertion point is after the `loadEnvFile` block
(~line 435 in the current scheduler.mjs) and before
`db = openDb(undefined, config)` (~line 437).

When `startupCheck` returns `firstRun === true`, the scheduler prints:

```
AIOS first-run detected — no state database found at <dbPath>.
Run the guided setup wizard first:  node tools/aios/cli.mjs setup
```

and then calls `process.exit(1)`.  It does NOT call `openDb` or any downstream
initialization.
