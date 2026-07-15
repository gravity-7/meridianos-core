# ADR 0001 — Planning / Execution planes, configurable spec model, pluggable sources, multi-project

- **Status:** Proposed
- **Date:** 2026-07-15
- **Owner:** orchestrator (Opus) + founder
- **Supersedes / relates to:** the deferred Phase 3.5 "IntakeSource + Agent Session" plan; the
  planner-strategy direction (agile methodology as a swappable strategy).

## Context

MeridianOS today fuses three concerns into one loop bound to PropertyVerdict's `.ai/` folder
convention:

1. **Intake** — how requirements enter (today: a single `.ai/inbox/` filesystem drop).
2. **Planning** — turning a requirement into a board card with a spec, acceptance criteria (ACs),
   contracts, and a complexity estimate, gated by a Definition-of-Ready (DoR).
3. **Execution** — the loop that routes a `ready-for-impl` card to an agent, runs it in an isolated
   worktree, and opens a PR (metered/enforced by the gateway).

This is correct for tenant #0 (PV) but blocks the product we want to sell:

- **The model that curates specs is not independently configurable.** `routeModel`
  (`model-router.mjs`) chooses a model by *complexity tier*, not by *stage/role*. A client cannot
  say "use a premium model to author my specs, a cheap model to implement them." Spec quality is the
  whole ballgame — a cheap model writing specs is garbage-in.
- **Planning + intake are coupled to `.ai/` on the filesystem.** The *logic* (`planner.mjs`,
  `definition-of-ready.mjs`) is already tenant-agnostic core, but `config.mjs` hardcodes the `.ai/*`
  folder layout (and even leaks `pricingPath: tools/aios/pricing.json`, a runner path, into core).
- **One project per tenant, defined as hand-written JS.** A tenant is a `{root, domain}` pair with an
  independent config — genuinely multi-tenant — but each project needs a `.mjs` DomainPlugin and its
  own scheduler/ports. An end-user with many projects can't be asked to write JavaScript per project.
- **Requirements only arrive via the filesystem inbox.** Real clients plan in ADO, Jira, Slack, etc.

## Decision

Separate the system into **three planes** plus a **control plane**, each pluggable:

```
 SOURCES              PLANNING PLANE              EXECUTION PLANE
 ADO / Jira    ──▶  refine → card → DoR gate  ──▶  route → executor → PR → review → merge
 Slack / chat        (configurable spec model)      (cheap executor tier)
 inbox / email             ▲                                ▲
        │                  │                                │
        └── IntakeSource ──┘         ┌──────────────────────┴─────────────────┐
            registry (D4)            │  Project registry / control plane +     │  (D3)
                                     │  SHARED, tenant-labeled gateway ledger  │
                                     └──────────────────────────────────────────┘
```

### D1 — The spec-authoring model is a configurable, per-project route keyed on stage/role

`routeModel` gains a **role axis** alongside its existing tier axis. Policy grows a
`model_routing.<agent>.roles.<role>` block where `role ∈ {spec, design, impl, review}`, derived from
the task's stage (`spec`/`designing` → `spec`/`design`; `ready-for-impl`/`in-progress` → `impl`).

- **Precedence:** an explicit `roles.<role>` route wins; otherwise fall back to the existing
  `<tier>` route (fully backward compatible — tenants that set no roles behave exactly as today).
- **Shipped default (quality-safe):** premium model curates `spec`/`design`; cheap model does `impl`.
- **Client override:** each project's own policy sets its spec-curating model. This is the end-user
  knob — "which model curates my requirements" — without touching code.

This is a small extension of a mechanism that already exists (`model_routing` +
`DomainPlugin.defaultModels`), not new infrastructure. It is **Bite #1** (spec appendix below).

### D2 — Planning is a module behind a `ProjectStore` facade over two canonical stores

Draw a module boundary around **Planning** (`intake → refine → card → DoR`) distinct from Execution,
and put persistence behind a **`ProjectStore` facade** so the planning module never imports `.ai/`
paths directly. That kills the `config.mjs` `.ai/*` hardcoding (and the `pricingPath` runner-leak).

**Two canonical stores for two kinds of data — not one deriving the other.** This is the load-bearing
decision. MeridianOS already splits its data correctly today; D2 only names the seam:

- **`StateStore` — the DB, canonical for structured lifecycle state (ALREADY EXISTS).** Tasks are
  rows in `aios.db` (`state.mjs`/`db.mjs`): `id, status, owner, complexity, acceptance_criteria,
  lane, sprint, risk_tags, task_type`, governance/park state. Transitions are **ACID** DB writes.
  `.ai/state/board.json` and `.ai/board.md` are **generated, git-committed projections** of this
  store (`render.mjs`), so `git blame board.json` *is* the audit trail for state — the DB does not
  cost us git history. `validate --drift` re-renders and diffs to catch tampering.
- **`DocStore` — files, canonical for document BODIES (the D2 build).** The prose spec
  (`features/<id>/spec.md`), `contracts/`, and handoffs stay as git-tracked files, human-readable at
  rest, reviewed in PRs alongside code. A task references its body by path: `task.spec = <path>`.

The two stores are **linked by that path, and do NOT sync into each other.** The only place they
meet is deliberate: a spec agent writes `spec.md` **and** calls
`cli.mjs update-task --acceptance-criteria … --complexity …` to set the structured fields — the
agent writes both, explicitly.

**`ProjectStore`** composes `StateStore` + `DocStore`; the planning module talks only to the facade.
SQLite backs `StateStore` now; the interface is what lets a hosted multi-tenant deployment (D3) swap
in Postgres later. `DocStore` is a filesystem implementation now (rooted at the project repo); a
hosted deployment could back bodies with an object store — but bodies stay **documents**, never
relational columns.

The existing `.ai/inbox/` directory is demoted from a privileged special case to `InboxSource`, the
first `IntakeSource` (hands off to D4).

**Already done vs. the D2 gap.** The DB state store + generated, git-committed board render is *done*
(~75%). The narrow, migration-free D2 work: (a) wrap the existing state store in a `StateStore`
interface (no behavior change), (b) build the `DocStore`/`FilesystemStore` for bodies, (c) route the
planning module through the `ProjectStore` facade, (d) refactor the inbox into `InboxSource`.

**Rejected alternative — "files canonical, DB a derived index, one-way `files → DB` sync."** Making
`spec.md` frontmatter the source of truth for `status`/`owner`/`complexity` and deriving the DB from
it *relocates* the two real weaknesses of a files-only design — parse-fragility and loss of ACID
transitions — rather than removing them: a status change would become "write a file, re-parse
frontmatter, hope it's well-formed" instead of one atomic DB update. The DB is already canonical for
state and stays so; frontmatter is never parsed back into state.

### D3 — A project is data, and a control plane supervises many of them

Two evolutions:

1. **DomainPlugin-as-data.** A project is a **config record** (roster, model routing incl. spec
   model, sources, guardrails, budget caps) — not JavaScript. PV's `pv-domain.mjs` remains the
   reference code plugin; arbitrary client projects are declarative.
2. **Project registry / control plane.** One supervisor manages N projects (a tick iterating
   projects, or supervised per-project workers), each with its own state store, worktree root, and
   policy. The **gateway is shared**; because its ledger is *already tenant-labeled*, per-project
   metering and budget enforcement come essentially for free. This is the "Model B" control plane
   from the commercialization plan.

Per-project isolation invariants: own state store, own worktree root, own policy, own budget window,
own tenant label in the ledger. Zero shared mutable module state (`config.mjs` already guarantees this).

#### Tenant-isolation ladder

Isolation is a **deployment/topology choice, not a core rewrite** — `config.mjs` guarantees zero shared
module state and the gateway ledger is tenant-labeled, so the core supports any of these unchanged:

| Level | What's isolated | Shares | Use |
|---|---|---|---|
| **L1 — logical (same machine)** | process · clone/root · `.ai/` state+DB · policy · ports · own gateway sidecar+ledger · own `.env`/keys | kernel + raw machine resources (no CPU/mem limit; a runaway tenant can starve the box; each can read the other's files by path) | dogfood / trusted single-operator |
| **L2 — container-per-tenant** | + filesystem, network, process namespace, **CPU/mem cgroup limits**, secrets | kernel only | **real production isolation; the sellable unit** |
| **L3 — separate hosts/cloud + control plane** | + physical/host boundary; control plane pushes registry/policy, pulls ledgers | nothing | full multi-region SaaS |

**Decision (2026-07-16): L1 now → L2 (containers) as a deliberate later phase.** Rationale: prove the
autonomous loop + gateway metering + budget enforcement under L1 (cheap, fast) before wrapping it in
containers — otherwise a first run debugs Docker, the loop, the provider, and the gateway all at once.
L1 is sufficient for a trusted operator; L2's resource + filesystem isolation is **required** before
any *untrusted* multi-tenant use. L2 is the natural artifact for the Model-A/Docker packaging phase.

### D4 — Intake sources are a pluggable registry

An `IntakeSource` interface: `pull()` or webhook → a **normalized intake item**
`{title, body, links, labels, sourceRef}`. Adapters: `filesystem-inbox` (refactor of today's
`.ai/inbox`), `jira`, `ado`, `slack`, `chat`, `email`. The planning plane's **refine** step (the
configurable model from D1) turns intake items into DoR-quality cards.

- **Distinct from `mcpServers`.** `DomainPlugin.mcpServers` is the *pull-context* side — spec/design
  agents calling Confluence/GitHub/Figma for context. `IntakeSource` is the *push-requirements*
  side. Both are "connectors," different roles; do not merge them.
- **Write-back is optional and later** (a Jira ticket flips to In-Progress/Done as its card moves) —
  a connector concern, never core.

## Consequences

- **Positive:** spec quality becomes a first-class, per-client configurable guarantee; the product
  works against real planning tools; one user runs many projects; each plane evolves independently;
  the whole thing is the concrete shape of the "productize the wedge" phase.
- **Cost / risk:** `ProjectStore` and `IntakeSource` are new seams to design carefully; the control
  plane is a genuine new component; DomainPlugin-as-data needs a schema + validation. Mitigation:
  ship one bullet at a time, each dogfoodable via the DeepSeek dev tenant.
- **Non-goals (now):** cross-wire translation; write-back connectors; a hosted multi-tenant SaaS
  deployment. These are later.

## Sequenced roadmap (one bite at a time, each dogfoodable)

1. **D1 — stage/role model routing** (Bite #1 below). Small; unblocks "premium spec / cheap impl."
2. **D2 — Planning module boundary + `ProjectStore` adapter.** De-`.ai/`-couple.
3. **D4 — `IntakeSource` registry + two adapters** (`filesystem-inbox` refactor + one SaaS).
4. **D3 — Project registry / control plane.** Multi-project + Model-B productization.

---

## Appendix — Bite #1 spec: stage/role-aware model routing

> This appendix is written to Definition-of-Ready standard so it can be executed as a board card.

**Story.** *As a project owner, I want to configure which model authors specs versus which model
implements them, so that I get premium spec quality without paying premium rates for mechanical
execution.*

**Complexity:** 2 (small, contained; one module + policy + tests + docs).

**Design.**
- `routeModel(agent, task, policy, budgetState, domain)` currently resolves a `tier`, then reads
  `policy.model_routing.<agent>.<tier>`. Add: derive a `role` from `task.status` via a pure helper
  `roleForStatus(status)` → `spec` | `design` | `impl` | `review` (mapping: `spec`→`spec`,
  `designing`→`design`, `ready-for-impl`/`in-progress`→`impl`; unknown/absent → `impl`).
- Resolution precedence inside `routeModel`: if `policy.model_routing.<agent>.roles.<role>` exists,
  use it (same two accepted forms as a tier entry: a `{provider, model?}` object, or a bare provider
  string defaulting the model via `modelForTier`); otherwise fall back to the existing
  `<tier>` lookup unchanged.
- `DomainPlugin.defaultModels` MAY gain an optional parallel `roles` fallback later; NOT in this
  bite (keep scope tight — policy-level override only).

**Acceptance criteria.**
- Given a policy with `model_routing.claude.roles.spec = {provider:'anthropic', model:'claude-opus-4-8'}`
  and a task in status `spec`, `routeModel` returns that provider/model regardless of the task's
  complexity tier.
- Given the same policy and a task in status `ready-for-impl`, `routeModel` ignores the `roles.spec`
  entry and resolves via the existing tier route.
- Given a policy with NO `roles` block, `routeModel` behaves byte-identically to today for every
  stage (full backward compatibility — proven by the existing tests staying green unmodified).
- `roleForStatus` is exported and unit-tested for every status → role mapping incl. the unknown
  fallback.
- A bare-string role form (`roles.spec = 'deepseek'`) resolves the model via `modelForTier`.

**Contracts.** No change to `routeModel`'s return shape (`{provider, model, harness, tier, baseTier,
category, reason}`); `reason` should distinguish a role-route hit (e.g. `role:spec`) from a tier
route for observability.

**Out of scope.** The `spec`/`design`/`review` STAGES themselves already exist in the state machine;
this bite only changes model *selection*, not the pipeline. No dashboard changes.

**Docs.** Update `docs/PROVIDERS.md` or a routing doc to describe the `roles` block + the shipped
default (premium spec / cheap impl).
