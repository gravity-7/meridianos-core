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

### D2 — Planning is a module behind a `ProjectStore`; `.ai/` becomes one backing implementation

Draw a module boundary around **Planning** (`intake → refine → card → DoR`) distinct from Execution,
and put board/spec/intake persistence behind a **`ProjectStore` interface**. The current
`.ai/`-on-filesystem layout becomes the *default* `ProjectStore` implementation, not the only one; a
client project may back it with a database or a different layout. `config.mjs`'s hardcoded `.ai/*`
paths and the `pricingPath` runner-leak move behind this seam.

The existing `.ai/inbox/` directory is demoted from a privileged special case to "the filesystem
`IntakeSource`" (sets up D4).

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
own tenant label in the ledger. Zero shared mutable module state (config.mjs already guarantees this).

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
