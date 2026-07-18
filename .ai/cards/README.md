# Cards — DoR-complete backlog for v1.0

Each card meets the two-tier DoR: **user story · ≥2 testable ACs · complexity 1–5 · owner ·
risk_tags · depends_on**. Detailed Given/When/Then ACs live in the linked contract; this file
carries the story + the remaining DoR fields. `owner: unassigned` = not yet dispatched (dispatch is
gated — see checkpoint 0 §4).

Tracks: **A** = Sonnet-5 subagent swarm · **B** = mos-dev DeepSeek tenant · **C** = Antigravity headless.

---

### C1 · Gateway standalone CLI — Track A · complexity 2 · depends_on: —
**Story:** As an ops user running a mixed agent fleet, I want to launch the cost-governance gateway
with one command, so I can meter/cap spend without adopting the whole OS.
**ACs:** [gateway-cli.contract.md](../contracts/gateway-cli.contract.md) AC1–AC5.
**risk_tags:** chokepoint:package.json, chokepoint:docs/GATEWAY.md · **Owns:** see OWNERSHIP.md C1.

### C2 · DomainPlugin-as-data — Track A · complexity 3 · depends_on: —
**Story:** As a client with no wish to write JS, I want to declare a project as a YAML/JSON record
validated into a working plugin, so I can onboard a project declaratively.
**ACs:** [domain-record.contract.md](../contracts/domain-record.contract.md) AC1–AC6.
**risk_tags:** chokepoint:config.mjs, backward-compat · **Owns:** see OWNERSHIP.md C2.

### C3 · GitHub Issues IntakeSource — Track A · complexity 2 · depends_on: #33 (merged)
**Story:** As a team planning in GitHub Issues, I want issues pulled in as normalized intake items,
so requirements enter MeridianOS without a filesystem drop.
**ACs:** [intake-source.contract.md](../contracts/intake-source.contract.md) AC1–AC5.
**risk_tags:** external-api, auth:BYO-key, pull-only · **Owns:** see OWNERSHIP.md C3.

### C4 · Ledger-canonical metering — Track A · complexity 2 · depends_on: gateway (merged)
**Story:** As a buyer of cost governance, I want one canonical ledger to be the metering truth when
the gateway is on, so spend numbers are authoritative not per-harness guesses.
**ACs:** [ledger-metering.contract.md](../contracts/ledger-metering.contract.md) AC1–AC4.
**risk_tags:** metering-accuracy, backward-compat · **Owns:** see OWNERSHIP.md C4.

### C5 · Control plane MVP — Track A · complexity 3 · depends_on: **C2**
**Story:** As an operator of many projects, I want one supervisor to iterate N project records under
L1 isolation with a shared tenant-labeled gateway, so I run a fleet from one process.
**ACs:** [domain-record.contract.md](../contracts/domain-record.contract.md) C5 section.
**risk_tags:** chokepoint:config.mjs (after C2), isolation-invariants · **Owns:** see OWNERSHIP.md C5.

### C6 · L2 packaging (Docker) — Track A · complexity 3 · depends_on: thin-tenant shape stable
**Story:** As a stranger with Docker, I want a Dockerfile + compose that runs a governed tenant, so
I go clone→running in <30 min (the global DoD).
**ACs:** (a) `docker compose up` boots a tenant that renders a board + serves `/healthz`; (b) the
gateway meters into a ledger volume that survives container restart; (c) Node-24/`node:sqlite` ABI
works in-image; (d) image documented in `docs/DEPLOY.md`.
**risk_tags:** native-abi(better-sqlite3/node:sqlite), packaging · **Owns:** see OWNERSHIP.md C6.

### C7 · mos-dev thin-tenant rebuild — Track A (top prio) · complexity 3 · depends_on: —
**Story:** As the dogfood tenant, I want mos-dev rebuilt as a thin consumer of
`@gravity-7/meridianos-core` (mirroring PV `tools/aios/`), so it stops drifting and proves the
Model-A onboarding story.
**ACs:** (a) mos-dev imports core from node_modules (no vendored core `.mjs` files remain);
(b) `tools/aios/cli.mjs` seed/render/validate/tick run green against the package; (c) policy.yaml =
gateway on, DeepSeek v4-pro impl route, cadence ON; (d) a dry-run boot tick renders the board with
zero drift; (e) the rebuild is captured as the first draft of the onboarding guide.
**risk_tags:** separate-repo, real-spend(on cadence), git-history · **Owns:** OWNERSHIP.md C7.
**NOTE:** enabling cadence + gateway spends real DeepSeek credit → dispatch gated on Gate 2.

### C8 · Continuity kit — Track A · complexity 3 · depends_on: —
**Story:** As a 24/7 system surviving 5h limits, I want a conductor that relaunches a fresh
orchestrator from durable state, so no session death loses work.
**ACs:** (a) `conductor.mjs` ≤~60 lines, no LLM/network beyond the webhook ping, idempotent; (b) it
takes the orchestrator lease BEFORE spawning (double-spawn impossible); (c) exits early if lease
active OR `resume_at` in future OR verdict==halt; (d) `RESUME-PROMPT.md` written; (e) one forced
pause→resume cycle proven with zero lost cards.
**risk_tags:** standing-automation, unsupervised-spend, acceptEdits · **Owns:** OWNERSHIP.md C8.
**NOTE:** building/testing the module is ungated; **registering the recurring Scheduled Task is
gated on Gate 3.**

### C9 · Budget↔ledger wiring — Track A · complexity 2 · depends_on: **C4**
**Story:** As a buyer, I want budget verdicts computed from the same ledger the gateway enforces on,
so caps and metering never disagree. **ACs:** ledger-metering.contract.md AC5–AC6.
**risk_tags:** metering-accuracy, backward-compat · **Owns:** OWNERSHIP.md C9.

### C10 · Landing page — Track C · complexity 2 · depends_on: —
**Story:** As a prospect, I want a finished landing page that explains the wedge + shows the ledger,
so I understand and try the product. **ACs:** (a) hero states the cost-governance wedge; (b) quickstart
CTA; (c) responsive + theme-aware; (d) no external network calls (self-contained assets).
**risk_tags:** tone/legal(founder-approve before publish), track-C-nonblocking · **Owns:** OWNERSHIP.md C10.

### C11 · Commercial docs — Track B/A · complexity 2 · depends_on: C1,C6,C7
**Story:** As a stranger, I want quickstart + onboarding + pricing docs, so I self-serve in <30 min.
**ACs:** (a) quickstart drives the Day-5 30-min rehearsal to green using docs only; (b) onboarding
guide reproduces the C7 rebuild; (c) pricing copy drafted (founder-approve tone). **risk_tags:**
tone/legal, chokepoint:docs/README.md · **Owns:** OWNERSHIP.md C11.

---

### BUG-1 · Standalone-core repoRoot resolves to the drive root — Track B/mechanical · complexity 1 · depends_on: —
**Story:** As a core maintainer running the suite standalone (not as an installed dep), I want
`resolvePaths` (or the affected test) to resolve a correct `repoRoot`, so `npm test` is green without
manually pinning `AIOS_ROOT`. **Evidence:** `tests/bus.test.mjs`'s InboxSource test throws
`doc-store: path escapes repo root: .ai/inbox` because `COMPUTED_DEFAULT_ROOT` assumes core lives under
`node_modules/@gravity-7/meridianos-core/` and overshoots to `C:\` when run from the repo itself.
Pre-existing (fails on clean `main`); green with `AIOS_ROOT="$(pwd)"`.
**ACs:** (a) `npm test` from the core repo root is green with NO `AIOS_ROOT` set; (b) the fix does not
change resolution when core IS installed under node_modules (consumer path unaffected); (c) if the fix
is in the test, it injects an explicit `root`/temp dir rather than depending on the ambient default.
**risk_tags:** possible chokepoint:config.mjs (if COMPUTED_DEFAULT_ROOT is touched — else test-only),
backward-compat · **Owns:** `tests/bus.test.mjs` (test-only fix) OR `config.mjs` (root-detection fix).

---

**Board seeding:** these become rows on the core board (C1–C6,C8,C9,C10,C11) and the mos-dev board
(C7 + Track-B volume cards) via `cli.mjs seed`/`update-task`, executed at dispatch time (gated).
Authoring them as files first keeps them DoR-reviewable and durable before any DB write.
