# File-ownership map — in-flight cards

**Rule:** no two *in-flight* cards may list the same file. Shared **chokepoints** are serialized —
only one in-flight card may hold each at a time; the orchestrator sequences them. A subagent that
believes it must touch a file outside its list **STOPS and reports** — it does not improvise.

Chokepoints (serialized, never co-held): `config.mjs` · `schema.sql` · `package.json` ·
`providers.mjs` · `docs/GATEWAY.md` · `docs/README.md`.

Status legend: ⬜ not started · 🟡 in-flight · ✅ merged · ⛔ blocked.

_Last updated: 2026-07-18 (Day 2, session #25 RESUME). **Tool-permission gate that blocked
test-execution/git-mutation across sessions #5–#24 (21 consecutive sessions) is LIFTED as of this
session** — `.claude/settings.local.json` now grants `Bash(git:*)`/`Bash(gh:*)`/`Bash(npm:*)`/
`Bash(node:*)`/`Bash(npx:*)`. **C5 MERGED** (#38, main @aa714f0). **C1 MERGED** (#39, main @b0bb85a).
**BUG-1 FIXED and MERGED** (#40, main @3450be1) — `npm test` is now green standalone with no
`AIOS_ROOT` workaround (854/854 pass, 0 fail, deterministic). One pre-existing, unrelated flake
remains: `harness-adapters.test.mjs` intermittently fails under full-suite concurrent load (passes
29/29 in isolation every time) — a resource-contention race, not a regression from any of today's
merges; tracked in known_issues, not blocking._

| Card | Track | Status | Owns (may touch) | Chokepoint held | depends_on |
|---|---|---|---|---|---|
| **C1 · Gateway standalone CLI** | A | ✅ | `gateway/cli.mjs`, `gateway/README.md`, `gateway/tests/cli.test.mjs` — **merged #39** (main @b0bb85a; AC1/AC2/AC3/AC3b/AC5 independently verified, 8/8 pass) | — (released) | — |
| **C2 · DomainPlugin-as-data** | A | ✅ | `domain-record.mjs`, `schema/domain-record.schema.json`, `tests/domain-record.test.mjs` — **merged #36** (config.mjs untouched → chokepoint FREE) | — (released) | — |
| **C3 · GitHub Issues IntakeSource** | A | ✅ | `github-source.mjs`, `intake-registry.mjs`, `tests/github-source.test.mjs` — **merged #34** | — | #33 |
| **C4 · Ledger-canonical metering** | A | ✅ | `usage-readers.mjs`, `tests/metering-canonical.test.mjs` — **merged #35** | — | gateway ledger |
| **C5 · Control plane MVP** | A | ✅ | `control-plane.mjs`, `tests/control-plane.test.mjs` — **merged #38** (main @aa714f0; AC1/AC1b/AC2/AC2b/AC3/AC4/AC5 independently verified, 10/10 pass) | — (released) | **C2 ✅** |
| **C6 · L2 packaging** | A | ✅ | `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `docs/DEPLOY.md` — **merged #41** (main @45cb3b0; images gateway sidecar only, since `config.mjs` throws with no `DomainPlugin` — daemon documented as a tenant-layered extension; BYO-key verified via grep, no literals; 853/862 full-suite re-verified from primary checkout post-merge, 1 fail = known `harness-adapters.test.mjs` flake, clean 29/29 in isolation) | — (released) | C-tenant shape stable |
| **C7 · mos-dev thin-tenant rebuild** | A | ⛔ | *(mos-dev repo)* `tools/aios/*`, `.ai/policy.yaml`, `package.json`, `.npmrc` — **BLOCKED session #28**: `/c/projects/mos-dev` is not actually a separate repo, it shares `meridianos-core`'s own git remote and is a stale clone of THIS repo (no `gravity-7/mos-dev` exists on GitHub) — see decision-log D-041. Needs founder clarification before dispatch (>10-file-deletion + repo-identity change = §6 hard-stop). | *(shares meridianos-core's remote — NOT a separate repo, see D-041)* | — |
| **C8 · Continuity kit** | A | ✅ | `conductor.mjs`, `RESUME-PROMPT.md`, `scripts/register-conductor.ps1`, `tests/conductor.test.mjs` — built+tested(6/6)+drilled+**registered** (orchestrator-owned; STILL uncommitted working-tree infra, founder decision pending — see checkpoint) | — | — |
| **C9 · Ledger metering wired into budget read** | A | ✅ | `budget.mjs`, `tests/budget-ledger.test.mjs` — **merged #37** (main @485a051; AC5/AC6 independently verified: 10/10 new, 17/17 existing budget.test UNMODIFIED). Scope item 5 COMPLETE. | — | **C4 ✅** |
| **C10 · Landing page** | C | ⬜ | `meridian-animation/*` | — | — |
| **C11 · Commercial docs** | B/A | ⬜ | `docs/QUICKSTART.md` (new), `docs/ONBOARDING.md` (new), `docs/PRICING.md` | `docs/README.md` (index row) | C1,C6,C7 |
| **BUG-1 · Standalone repoRoot fix** | A | ✅ | `tests/bus.test.mjs` — **merged #40** (main @3450be1). Fix applied exactly as preserved in `.ai/state/BUG-1-fix-pending-commit.md`; 19/19 bus.test.mjs pass, 854/854 full suite pass, no `AIOS_ROOT` needed. | — (config.mjs not touched) | — |

### Day-1 opening wave (disjoint, safe to run concurrently)
- **C2** holds `config.mjs` (the only chokepoint in the wave) → **C5 must wait** for C2 to merge.
- **C3** and **C4** touch no chokepoint and no shared file with C2 → safe to run alongside C2.
- Chosen 3-up: **C2 ∥ C3 ∥ C4** (matches plan §6 Day 1). C1 (holds `package.json`) queued next so it
  never co-holds with a package.json-touching card. C8 (continuity kit) is Day-0 infra, no overlap.
