# BUG-1 fix — verified correct, blocked on write-permission gate (session #10)

**Status:** Code-reviewed and judged CORRECT by the orchestrator (session #10, 2026-07-18). NOT yet
committed, pushed, or test-run — every write-type command (`git add`, `git commit`, `git diff -C
<other-worktree>`, `node --test`, `npm test`) is denied in this environment for both the dispatching
subagent and the orchestrating session itself. Only read-only ops (plain `git status`/`git log` in the
current dir, and the `Read` tool) succeed. This is the same blocker tracked in `continuity.json` /
decision-log D-013 through D-017, now confirmed to cover writes as well as test execution, and to
apply identically inside an isolated subagent worktree — not just the orchestrator's own shell.

**Location of the uncommitted fix (on disk, same machine, durable until someone cleans the worktree):**
`C:\projects\meridianos-core\.claude\worktrees\agent-abb3022d0fd4f1036\tests\bus.test.mjs`
branch: `worktree-agent-abb3022d0fd4f1036` (currently at `main`'s tip `485a051`, one unstaged file change).

**The fix (single line changed, `tests/bus.test.mjs` around line 18 → line 28 after the added
comment):**

Before:
```js
const config = resolvePaths({ domain: { ...FIXTURE_DOMAIN, agents: ['claude', 'antigravity'] } });
```

After:
```js
// `root` is an explicit throwaway temp dir rather than the ambient/computed default: this file's
// shared `config` backs `store.docs`/`store.intake` (doc-store.mjs), which do real filesystem I/O
// scoped to `config.repoRoot` (e.g. the "inbox override still bypasses..." test below calls
// `store.intake.list()` for real). Relying on config.mjs's computed default here would couple this
// suite to running from inside an installed `node_modules/@gravity-7/meridianos-core/` layout —
// standalone (this repo checked out directly, not as a dependency) that computed default resolves
// to an ancestor OUTSIDE the repo, which doc-store.mjs's root-escape guard then (correctly) rejects
// (BUG-1). Every other real-I/O test in this file already injects its own `mkdtempSync` root; this
// makes the shared top-level `config` do the same instead of being the one holdout on the ambient
// default.
const config = resolvePaths({ root: mkdtempSync(join(tmpdir(), 'aios-bus-test-')), domain: { ...FIXTURE_DOMAIN, agents: ['claude', 'antigravity'] } });
```

(`mkdtempSync`, `tmpdir`, `join` were already imported at the top of the file — no new imports needed.)

**Why this satisfies BUG-1's ACs (`.ai/cards/README.md`):**
- (a) `npm test` from repo root, no `AIOS_ROOT` set → should now be green (unverified — blocked).
- (b) `config.mjs` is **untouched** → the installed/consumer resolution path is unaffected by
  construction, not just by inspection.
- (c) The fix injects an explicit `root` via `mkdtempSync`, exactly as AC(c) requires (not a
  test-side `AIOS_ROOT` pin, which was already known not to generalize — it breaks
  `domain-plugin.test.mjs` test #363).

**Root cause (subagent's diagnosis, orchestrator-reviewed and judged sound):** `bus.test.mjs`'s
shared top-level `config` was the only real-I/O-backing config object in the file that didn't inject
its own `mkdtempSync` root. Its `repoRoot` fell back to `config.mjs`'s `COMPUTED_DEFAULT_ROOT`, which
assumes install under `node_modules/@gravity-7/meridianos-core/` and walks up two directories from
`config.mjs`'s own location — standalone, this overshoots outside the repo entirely. The specific
failing test ("the 'inbox' override still bypasses the DocStore/InboxSource exactly as before") then
calls `store.intake.list()` for real, which hits `doc-store.mjs`'s root-escape guard.

**What the next session (or the founder) needs to do:**
1. If write permissions are restored: `cd` into the worktree above, `git add tests/bus.test.mjs`,
   `git commit`, push a branch (or apply the same one-line change directly on a fresh
   `fix/bug-1-standalone-repo-root` branch off `main@485a051` — the worktree's branch has no other
   commits, so either path is equivalent), run `npm test` with no `AIOS_ROOT` set to confirm green,
   spot-check `domain-plugin.test.mjs` test #363 still passes, then open a PR.
2. If the founder is applying this manually: the "After" block above is the complete replacement for
   the single `const config = resolvePaths(...)` line; everything else in `bus.test.mjs` is unchanged.
3. Once merged, this doesn't itself unblock C5/C1 (those are blocked on write/test verification, not
   on this bug) — but it does mean a *future* `npm test` run (once the permission gate lifts) will be
   green standalone with no `AIOS_ROOT` workaround needed.
