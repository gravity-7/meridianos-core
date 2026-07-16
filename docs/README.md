# MeridianOS — Documentation

MeridianOS is a **provider- and harness-agnostic core for autonomous agent orchestration with cost
governance**. It runs a fleet of AI coding agents through a Scrum-style loop against a durable state
core, meters their token spend across mixed vendors, and enforces budgets. PropertyVerdict is
**tenant #0** (the dogfood); all product-specific behavior is injected via a `DomainPlugin`, so the
core carries no domain defaults.

**The wedge:** *cost governance + a control plane for heterogeneous agent fleets* — observe, cap, and
audit spend across Claude + DeepSeek + OpenRouter + local models, provider- and harness-agnostic.

---

## Doc index

| Doc | What's in it |
|---|---|
| [ARCHITECTURE](#architecture-overview) (below) | the subsystems and how they fit |
| [PROVIDERS.md](./PROVIDERS.md) | per-provider reference — endpoints, auth, models, pricing, quirks, doc links |
| [PRICING.md](./PRICING.md) | pricing source-of-truth + the `aios:pricing:refresh` mechanism |
| [GATEWAY.md](./GATEWAY.md) | the gateway sidecar — meter → verdict → enforce, key custody, streaming |

---

## Architecture overview

### 1. The state core (durable truth)
A co-located **SQLite** store (`node:sqlite`, `db.mjs` + `schema.sql`) is the single runtime source of
truth: tasks, leases, resource locks, history, events. Durability + audit live in git via
`.ai/state/board.json` (the committed serialization) + `board.md` (the human view), both *rendered*
from the DB, never hand-edited. Atomic lease claims give race-free mutual exclusion when multiple
agents run co-located. State transitions are guarded by `machine.mjs`.

### 2. The autonomous loop (scheduler + planner)
`scheduler.mjs` runs a watchdog **tick** (~60s): it drives the planner, launches eligible agents,
reaps stale leases, prunes, and renders the board. `planner.mjs` promotes work through a two-tier
Definition-of-Ready gate (`definition-of-ready.mjs`): `proposed → spec` needs only a title+owner;
`spec → designing` needs real acceptance criteria + complexity (the spec agent writes them). The
verify loop (`verify-loop.mjs` + `verifier.mjs`) bounces failing work for rework up to a persisted
attempt cap, then blocks + escalates.

### 3. Provider & harness abstraction (vendor-agnostic)
- **Providers** (`providers.mjs`): the `PROVIDERS` registry — each descriptor has a wire
  (`anthropic`/`openai`), a `keyEnv` **name** (BYO-key, never a literal), and per-tier models.
  Policy overlays extend/override it. See [PROVIDERS.md](./PROVIDERS.md).
- **Harnesses** (`harness-adapters.mjs`): makes the agent CLI swappable — `claude-code`, `antigravity`,
  `opencode`. Each turns a normalized run into a spawn plan (`{cmd, args, env, files}`). This module
  owns every hardcoded CLI invocation.
- **Model routing** (`model-router.mjs`): maps a task's complexity **tier** (`simple`…`critical`) to a
  provider/model, with a cost-safety guard.

### 4. Metering, pricing & budget
- **Metering** today: per-harness usage readers (`usage-readers.mjs` + `claude-usage`/
  `antigravity-usage`/`opencode-usage`) read each harness's own accounting post-run. **These are
  slated for replacement by the gateway ledger** (see below).
- **Pricing** (`pricing.mjs` + `pricing-refresh.mjs`): USD cost from a committed catalog, refreshed
  from public sources. Never guesses. See [PRICING.md](./PRICING.md).
- **Budget** (`budget.mjs`): per-agent 5h + weekly windows compared to caps in `.ai/policy.yaml`;
  `verdictFor` → `ok`/`warn`/`halt`.

### 5. The gateway sidecar (the enforcement boundary)
A local forward-proxy all provider traffic routes through — meters inline into its own ledger and
enforces budgets (non-retryable 403 on over-cap), with keys injected server-side so workers never hold them. Built,
tested, and dogfooded live; opt-in. The strategic core of the product. See [GATEWAY.md](./GATEWAY.md).

### 6. Governance, safety & escalation
Domain guardrails (tone/currency/secrets) run via an injected `guardrailCheck`. Escalation hard-stops
(schema/data-model changes, touching tone/currency/legal rules, spending money, deploying, external
sends) require a human. Budget kill-switch + §6 governance flags (approve/snooze/skip) are durable DB
columns, not note substrings.

### 7. Multi-tenancy via `DomainPlugin`
`createAios`/`config.mjs` take a `DomainPlugin` supplying: agents, prompts, guardrailCheck, board
title, risk taxonomy, budget meter, default models, agent harness, task categories, MCP servers,
CLI path (`cliPath`, defaults to `'tools/aios/cli.mjs'`). PropertyVerdict is tenant #0; the core has
zero product defaults.

---

## Running & testing

- **Node 24 only** (`node:sqlite` / better-sqlite ABI).
- Tests: `npm test` (`node --test` over `tests/*.test.mjs` + `gateway/tests/*.test.mjs`).
  - Note: the `createWorktree` integration tests (`worktree.test.mjs`, `harness-adapters.test.mjs`)
    fail when run from *inside* a git worktree checkout (worktree-in-worktree); run the full suite
    from the primary checkout, which is authoritative.
- Pricing refresh: `npm run aios:pricing:refresh` (opt-in, network, no auth).
- The daemon (tenant runner) is operated separately by the tenant (PropertyVerdict runs it as a
  scheduled task on `:4317`).

---

## Repo layout (top level)

```
config.mjs         DomainPlugin wiring + path/config resolution (createAios, resolvePaths)
db.mjs schema.sql  the SQLite state core
machine.mjs        state-transition guard
scheduler.mjs      the watchdog tick / autonomous loop
planner.mjs definition-of-ready.mjs   promotion + two-tier DoR
launcher.mjs       spawns agents in isolated worktrees; opt-in gateway injection
worktree.mjs       isolated per-run git worktrees
providers.mjs      the provider registry
harness-adapters.mjs   swappable agent CLIs
model-router.mjs   tier → provider/model routing
budget.mjs         per-agent 5h/weekly budget verdicts
pricing.mjs pricing-refresh.mjs   USD cost catalog + refresh
usage-readers.mjs  + *-usage.mjs   per-harness metering (→ to be replaced by the gateway ledger)
verify-loop.mjs verifier.mjs   verification / rework loop
escalation-push.mjs  §6 escalations
gateway/           the gateway sidecar (see GATEWAY.md)
dashboard/         the control dashboard (:4317)
```
