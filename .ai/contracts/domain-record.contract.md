# Contract — DomainPlugin-as-data (card C2) + control plane (card C5)

ADR 0001 D3.1/D3.2. A project becomes a **declarative record** (YAML/JSON), validated into a
DomainPlugin-shaped object. `pv-domain.mjs` stays as the reference **code** plugin (unchanged).

## What a DomainPlugin is today (from `config.mjs` `resolveDomain`)
A code object supplying: agents/roster, prompts, `guardrailCheck`, board title, risk taxonomy,
budget meter, default models, agent harness, task categories, `mcpServers`, `cliPath`. `createAios`
/`resolvePaths` **throw** if no `domain` is supplied. C2 must NOT change that throw for the code path.

## C2 deliverables

### `schema/domain-record.schema.json` (new)
JSON-Schema (draft 2020-12) for the record. Required top-level: `name`, `roster`, `modelRouting`.
Optional: `sources`, `guardrails`, `budget`, `boardTitle`, `riskTags`, `taskCategories`,
`mcpServers`, `cliPath`. Values are **data only** — no functions. Anything requiring a function
(e.g. a custom `guardrailCheck`) is expressed declaratively (e.g. `guardrails: { tone, currency,
secrets }` flags) and compiled by the loader; a record CANNOT express arbitrary code (that's what
the reference code plugin is for).

### `domain-record.mjs` (new)
```
export function validateDomainRecord(record) → { ok: boolean, errors: string[] }
export function loadDomainRecord(pathOrObject) → DomainPlugin   // throws on invalid
```
- `loadDomainRecord` accepts a parsed object OR a path to a `.yaml`/`.json` file (YAML via the
  existing `yaml-lite.mjs` — do NOT add a YAML dependency).
- It returns an object **structurally accepted by `createAios({ domain })`** — i.e. it compiles the
  declarative `guardrails` flags into a `guardrailCheck` fn, maps `roster`→agents, etc. The compiled
  plugin must satisfy every field `resolveDomain` reads.

### `config.mjs` (chokepoint — C2 holds it)
Additive only: `createAios`/`resolvePaths` accept `{ domain }` that is EITHER a code plugin (today's
behavior, byte-identical) OR the output of `loadDomainRecord`. Simplest safe design: **no change to
`config.mjs` at all** if `loadDomainRecord` returns a fully-formed plugin — prefer that. Touch
`config.mjs` only if a genuine incompatibility is found, and if so keep it purely additive.

## Acceptance criteria
- **AC1** Given a minimal valid record (`name`, `roster`, `modelRouting`), `validateDomainRecord`
  returns `{ok:true, errors:[]}`.
- **AC2** Given a record missing `roster`, `validateDomainRecord` returns `ok:false` with an error
  naming `roster`.
- **AC3** Given a valid record with `guardrails:{tone:true,currency:false,secrets:true}`,
  `loadDomainRecord` returns a plugin whose `guardrailCheck` enforces tone+secrets and skips currency.
- **AC4** `createAios({ domain: loadDomainRecord(validRecord) })` succeeds and produces a config
  whose roster/title/models match the record.
- **AC5** The existing `config.mjs`/code-plugin tests stay green **unmodified** (backward compat).
- **AC6** A YAML record and the equivalent JSON record load to a deep-equal plugin.

## C5 (control plane) — depends on C2
```
export function createControlPlane({ projects, gateway, tick }) → {
  add(record): projectId,     // record → loadDomainRecord → isolated createAios
  tickAll(): Promise<Result[]>,   // one supervisor pass over N projects
  list(): ProjectHandle[],
}
```
- Each project gets its **own** `createAios` (own state store, own worktree root, own policy, own
  tenant label). Zero shared mutable state — lean on `config.mjs`'s existing guarantee.
- The gateway is **shared**; per-project isolation is the tenant label already in the ledger.
- L1 isolation only (same machine). No containers here (that's C6).

## Out of scope
Postgres StateStore, hosted deployment, per-project dashboards, live registry push/pull (L3).
