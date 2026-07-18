# Checkpoint 0 — Day 0 boot / gap audit

**Date:** 2026-07-17 · **Session:** #1 · **Orchestrator:** Opus 4.8 (plan-only)
**Status:** boot artifacts complete; **dispatch blocked on 3 batched founder gates (§6-class).**

> Delivery note: this checkpoint could not be POSTED to the escalation webhook — it is not
> configured (see Gate 1). It lives on disk; the founder reads it directly until the webhook exists.

---

## 1. Gap audit — scope item → evidence → remaining work

| # | Scope item (DoD) | Current-state evidence | Remaining work | Size | Card |
|---|---|---|---|---|---|
| 1 | **Gateway standalone** (thin CLI + README/quickstart) | `gateway/index.mjs:48` `assembleGateway(...)` and `gateway/server.mjs:377` `startGateway(...)` **exist and are tested**. No CLI entry, no `bin`, no gateway README. | New `gateway/cli.mjs` + `package.json` `bin` + quickstart. Wiring, not building. | S | **C1** |
| 2 | **DomainPlugin-as-data** (record + schema + validation) | `config.mjs` `createAios/resolvePaths` require a **code** DomainPlugin (throws otherwise). No declarative record path. `yaml-lite.mjs` exists (no YAML dep needed). | New `domain-record.mjs` + JSON-Schema; compile record→plugin; keep code path byte-identical. | M | **C2** |
| 3 | **Control plane MVP** (1 supervisor / N records, L1, shared gateway, per-project labels) | Isolation invariants already hold (`config.mjs` = zero shared module state; ledger already tenant-labeled). No supervisor over N projects. | New `control-plane.mjs`; depends on C2. Cheaper than pre-D2 estimate. | M | **C5** |
| 4 | **GitHub Issues IntakeSource** (pull-only) | `inbox-source.mjs` (#33) defines the `name`/`list`/`read`/`submit` seam; no registry, one source. | New `github-source.mjs` + `intake-registry.mjs`; `fetch`-based, pull-only. | S–M | **C3** |
| 5 | **Ledger-canonical metering** | `gateway/ledger.mjs` `queryWindow`/`listEvents` expose per-tenant totals; `usage-readers.mjs:99` `readUsage` is still the only metering entry. | New `meterRun` canonical-first path; readers demoted to fallback; wire `budget.mjs`. | S | **C4**,**C9** |
| 6 | **mos-dev thin tenant** (consumes core, cadence on, ≥5 real cards) | mos-dev is a **full clone**, 9 commits behind main (last: #24). PV `tools/aios/` is the correct thin shape (imports `@gravity-7/meridianos-core/*`). Board empty, cadence off. | Rebuild mos-dev to PV's shape; load board; prove loop on DeepSeek v4-pro. | M (ops) | **C7** + Track B |
| 7 | **L2 packaging** (Dockerfile + compose) | None present. Node-24 + `node:sqlite`/better-sqlite3 ABI constraint is the main risk. | New `Dockerfile` + `docker-compose.yml` + `.dockerignore` + deploy doc. | S–M | **C6** |
| 8 | **Landing + docs** (meridian-animation, quickstart, onboarding, pricing) | `meridian-animation/` exists (index.html/app.js/style.css — unfinished). `docs/PRICING.md` exists; no quickstart/onboarding. | Finish landing (Track C); write quickstart + onboarding; pricing copy. | S–M | **C10**,**C11** |

**Doc-vs-code reconciliations (logged):** README §4 still says usage-readers are "slated for
replacement" — that's exactly scope item 5, not yet done (matches). ADR marks D1+D2 done; git
confirms (#17, #30–#33). No contradictions found that change the plan.

---

## 2. Task DAG (full scope)

```
Day 0  ── C7 mos-dev rebuild (Track A, top prio) ──┐
        └ C8 continuity kit (conductor/RESUME/task) │  [needs: automation authz]
                                                     │
Day 1  ── C2 DomainPlugin-as-data ─┬─────────────▶ C5 control plane (Day 2)
       ── C3 GitHub IntakeSource   │  (C2 releases config.mjs)
       ── C4 ledger metering ──────┴─────────────▶ C9 budget-ledger wiring
       ── Track B: ≥3 real cards on DeepSeek  [Day-1 GATE]
       ── C1 gateway CLI (queued after C2 vacates package.json order)
Day 2  ── C5 control plane · C1 gateway CLI+README
Day 3  ── multi-project dogfood (PV + mos-dev under C5) · C6 Docker/compose
Day 4  ── v1-core FREEZE (items 1–6) · integration hardening · bug-bounce   [Day-4 GATE]
Day 5  ── C6 finish · 30-min stranger-quickstart rehearsal (docs-only)      [Day-5 GATE]
       ── C11 quickstart/onboarding · C10 landing final
Day 6  ── pricing/positioning · publish dogfood ledger numbers · (stretch: Option 2)
Day 7  ── buffer
```

**Dependencies:** C5→C2 · C9→C4 · C11→{C1,C6,C7} · C1 sequenced after C2 for the `package.json`
chokepoint. **Chokepoint schedule:** `config.mjs`→C2 then C5; `package.json`→C1; `docs/*`→C11 last.

**Day-1 opening wave (disjoint, concurrent):** **C2 ∥ C3 ∥ C4** (C2 alone holds a chokepoint).

Card specs (DoR-complete) live in `.ai/cards/`. Contracts in `.ai/contracts/`. Ownership in
`OWNERSHIP.md`.

---

## 3. Done this session (local, reversible, $0)
- Boot reads: plan §1–§9, README, ADR 0001 (D1–D4), gateway seams, PV thin-tenant reference, git log.
- **Stale-branch sweep:** 7 squash-merged locals deleted; `tooling/publish-script` parked (2 real
  unmerged commits — publish.ps1 rework + PV-side propagation); stale remote refs pruned. (D-002)
- **Package-leak guard:** added `.npmignore` + `.gitignore` hunk so orchestrator bookkeeping is
  git-durable but never ships in the tarball ("core ships no tenant data"). (D-001)
- Wrote: this gap audit, the DAG, `OWNERSHIP.md`, 4 contracts, `.ai/cards/` specs,
  `.ai/state/continuity.json`, `decision-log.md`.

---

## 4. BLOCKED — 3 batched founder gates (all §6-class; nothing dispatches until cleared)

1. **Escalation webhook (the one permitted Day-0 interrupt).** `AIOS_ESCALATION_WEBHOOK` is unset
   and there is no `.ai/secrets/escalation-webhook`. Until a URL exists I cannot route checkpoints
   or escalations anywhere, and sending the required test message is an external send needing the
   founder's URL. **Need:** a Slack/Discord webhook URL (I'll store it in the gitignored secret file
   or you set the env var), then I fire the test.
2. **Real-money authorization + DeepSeek reload.** Track B spends real DeepSeek credit (plan: reload
   ~$25, raise mos-dev caps from the $0.50-proof sizing); Track A spends Claude tokens; Track C spends
   Antigravity. **Need:** confirm the DeepSeek balance is reloaded, the per-week caps you want, and a
   go to begin paid dispatch. Until then I hold at $0.
3. **Standing automation authorization.** The conductor Scheduled Task auto-spawns
   `claude -p --permission-mode acceptEdits` every 5 min, unsupervised, indefinitely. I'll **build
   and unit-test** the conductor (C8) without your input, but I will not **register the recurring
   Windows Scheduled Task** (the always-on, auto-accept-edits part) without an explicit go.

## 5. Questions that can wait (batched — not blocking)
- Antigravity `agy` CLI: confirm it's installed/on PATH for Track C headless (I'll verify before
  dispatching C10; if absent, Track C queues to Day 7 per plan — non-blocking).
- GitHub IntakeSource demo repo: which `owner/repo` should C3's live-verify pull from? (tests use a
  stubbed `fetch`; only the manual AC-verify needs a real repo.)
- Landing-page copy/pricing tone is a §6 (tone/legal) item — I'll draft, you approve before publish.

## 6. Budget
$0 spent this session (planning only). Gateway ledger: no new events. Track B DeepSeek balance:
pending founder confirmation (Gate 2).

## 7. Schedule confidence
🟡 **Yellow, mechanically green.** All Day-0 *local* work is done and the DAG is clean and
parallelizable. The only thing between here and a green Day-1 is the three gates above — they are
config/authorization, not engineering. Clear them and the swarm starts immediately.
