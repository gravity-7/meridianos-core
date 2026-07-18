# Contract — IntakeSource registry + GitHub Issues adapter (card C3)

Extends the seam established by `inbox-source.mjs` (merged #33). **Pull-only. No write-back**
(ADR 0001 D4: write-back is a later connector concern, out of v1.0 scope).

## The IntakeSource interface (already implied by inbox-source; C3 formalizes it)

```
interface IntakeSource {
  name: string;                       // stable id, e.g. 'github-issues'
  list(opts?): Promise<Item[]>;       // cheap: metadata only, body ABSENT
  read(id): Promise<Item>;            // full: body PRESENT
  // submit(...) is OPTIONAL and NOT implemented for GitHub in v1.0 (pull-only).
}
```

## Normalized item shape (identical to the inbox source's — do NOT diverge)

```
{
  id,       // stable within the source, e.g. `issue-<number>`
  source,   // 'github-issues'
  kind,     // 'request' (a GitHub issue is a requirement request)
  feature,  // null unless derivable from a label like `feature:<x>`
  status,   // issue state: 'open' | 'closed'
  path,     // null for remote sources (no repo-relative file)
  meta,     // { number, url, labels: string[], author, createdAt, updatedAt, milestone? }
  body,     // ONLY on read(id); absent from list()
}
```

## `intake-registry.mjs` (new)

```
export function createIntakeRegistry(sources = []) → {
  register(source): void,             // throws on duplicate name
  get(name): IntakeSource | undefined,
  list(): IntakeSource[],
}
```
No global singleton (mirror `config.mjs` — zero shared module state). The registry is constructed
by a root and passed in.

## `github-source.mjs` (new) — `createGithubSource(opts)`

- **Auth:** reads a token from an env var **name** supplied in opts (`tokenEnv`, default
  `GITHUB_TOKEN`) — BYO-key, never a literal (mirror `providers.mjs` `keyEnv` discipline).
- **Fetch:** `GET /repos/{owner}/{repo}/issues?state={state}&labels={labels}` via `fetch` (Node 24
  global). Pull requests (issues with a `pull_request` field) are **filtered out** — issues only.
- **Config:** `{ owner, repo, tokenEnv?, labels?, state? = 'open' }`.
- **No write-back:** no `submit`, no comment, no label mutation.
- **Failure:** network/HTTP error → throw with a message naming the repo + status; never silently
  return `[]` (a caller must be able to distinguish "no issues" from "auth failed").

## Acceptance criteria (Given/When/Then)
- **AC1** Given a registry and two sources, When a second source with the same `name` is registered,
  Then `register` throws.
- **AC2** Given a stubbed `fetch` returning two issues (one with a `pull_request` field), When
  `list()` runs, Then exactly one normalized item is returned (the PR is excluded) and its `body`
  is absent.
- **AC3** Given the same stub, When `read('issue-<n>')` runs, Then the item includes `body` and
  `meta.url`/`meta.labels`/`meta.number`.
- **AC4** Given `tokenEnv` points to an unset env var, When the source is used, Then it still issues
  the request (public repos work tokenless) but a 401/403 response throws a message naming the repo
  and status — it does not return `[]`.
- **AC5** `createIntakeRegistry`, `createGithubSource` exported; unit-tested with `fetch` stubbed
  (no live network in tests).

## Out of scope
Webhooks, write-back, other adapters (Jira/ADO/Slack), pagination beyond the first page (note it as
a TODO if >100 issues), the planning-refine step that consumes items.
