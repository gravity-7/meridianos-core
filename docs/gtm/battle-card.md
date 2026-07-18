# MeridianOS — Competitive Battle Card (internal draft)

> **INTERNAL DRAFT — not for external distribution.** Nothing in this file has been reviewed for
> publication. Every capability claim below is grounded in a specific module or test in this repo,
> cited inline. Numbers not verifiable from the code are marked `TBD` with a note on where the real
> figure would come from. Do not lift claims out of this file into customer-facing copy without a
> founder review pass.

---

## The wedge, in one sentence

**MeridianOS is cost governance and a control plane for heterogeneous AI-agent fleets** — it sits as
a forward proxy between agents (any harness) and providers (any vendor), meters every call exactly,
and enforces spend caps inline, before the call reaches a paid endpoint.
(`docs/README.md`: *"cost governance + a control plane for heterogeneous agent fleets... provider-
and harness-agnostic."*)

---

## Who we are NOT

**We are not another autonomous coding agent.** That market — Claude Code, Cursor, Copilot,
Devin-style agents, opencode, and a dozen well-funded entrants — is crowded, well-capitalized, and
not where a small team should try to win on features.

MeridianOS *runs* a fleet of coding agents (`scheduler.mjs`, `launcher.mjs`, `harness-adapters.mjs`
already drive `claude-code`, `antigravity`, and `opencode` as swappable harnesses — see
`docs/README.md` § "Harnesses"), but the product is not "our agent is better than theirs." It is
the layer **underneath** whichever agent/harness a customer already runs: the thing that tells you,
in real dollars, what every one of those agents is actually spending and stops it from silently
overspending. We are harness-agnostic by design — a customer keeps their agent of choice.

---

## Three defensible capabilities

### 1. Cross-vendor exact token metering
The gateway (`gateway/server.mjs`) is a transparent same-wire proxy in front of every provider call.
It parses the real `usage` block the provider returns — not an estimate, not a token-counter
approximation:
- Anthropic wire: `input_tokens` / `output_tokens` / `cache_read_input_tokens` /
  `cache_creation_input_tokens` (`extractUsage`, `gateway/server.mjs`).
- OpenAI wire: `prompt_tokens` / `completion_tokens` / `prompt_tokens_details.cached_tokens`.
- Both buffered JSON responses and streaming SSE are metered (`createSseUsageTracker`,
  `handleStreamingResponse` — `gateway/server.mjs`), exactly once per request, success or failure.

Every usage/cost field is `number | null`, and **null means genuinely unknown — never fabricated as
zero** (`token-event.mjs`'s `makeTokenEvent`/`validateTokenEvent`, and the identical contract
restated in `pricing.mjs` and `gateway/ledger.mjs`'s `queryWindow`). This null-is-unknown discipline
is enforced by validation that throws on a malformed event, not just documented as a convention.

Cost, not just tokens: `pricing.mjs`'s `costFor()` turns metered tokens into USD from a committed
catalog (`pricing.json`) sourced from models.dev (Anthropic, DeepSeek) and the provider's own API
for aggregators (OpenRouter) — see `docs/PRICING.md`. An unpriced provider/model returns `null` cost,
never a guessed `$0`. This is what let the DeepSeek dogfood show that a cache-heavy call can log a
large token count but a near-zero real dollar cost — a distinction token-counting alone cannot make
(`docs/PRICING.md`).

Currently registered, gateway-routable providers (`providers.mjs`'s `PROVIDERS`): **Anthropic,
DeepSeek, OpenRouter**. The provider abstraction is also conformance-tested against a fourth,
*unregistered* OpenAI-wire endpoint — local Ollama — to prove a new provider onboards without core
changes (`tests/ollama-e2e.test.mjs`); Ollama itself is not yet a first-class entry in `providers.mjs`.

### 2. Inline enforcement, not after-the-fact reporting
Enforcement runs **before** the call is forwarded, not in a nightly report:
- `checkVerdict(ctx)` is called exactly once per request, before forwarding
  (`gateway/server.mjs`'s `handleRequest`).
- A `deny` verdict never reaches the provider — it short-circuits to a **non-retryable HTTP 403**,
  shaped in the client's own wire format (`permission_error` / `over_budget`), plus an explicit
  `x-should-retry: false` header so SDKs that would otherwise back off and retry a 429 exit cleanly
  instead (`gateway/server.mjs`'s `sendDeny`/`denyBody`, documented in `docs/GATEWAY.md` §
  "Enforcement semantics").
- The verdict itself is computed from the gateway's own ledger's rolling trailing 5h/week windows
  against per-agent caps in `.ai/policy.yaml` (`gateway/windows.mjs`'s `agentBudgetVerdict` →
  `toEnforcementDecision`, reusing `budget.mjs`'s `verdictFor` so the two paths cannot drift on what
  "halt" means). Caps can be set in raw tokens **or** in USD (`per_5h_cost_usd` / `per_week_cost_usd`
  — opt-in, additive; an agent with no cost cap behaves exactly as the token-only path did).
- Semantics are explicit and honest: it is a **trip-wire, not a guillotine** — the call that crosses
  the cap completes; the *next* call is denied. There is no mid-response cutoff (`docs/GATEWAY.md`).

Because the harness only ever holds a short-lived gateway token — the real provider API key is
resolved and injected server-side, inside the gateway, and never reaches the harness process
(`gateway/server.mjs` header docs; `run-registry.mjs`) — enforcement cannot be bypassed by a harness
that "forgets" to check a budget. There is no traffic path to the provider that does not go through
the meter.

### 3. Tested concurrency rigor
This is infrastructure meant to sit in front of real spend, so its state layer is tested against real
concurrency, not just unit-mocked:
- `tests/race.test.mjs` spawns **6 separate OS processes** racing to claim the same task lease against
  a real SQLite file and asserts exactly one wins and every loser sees a `'leased'` reason — a
  genuine multi-process race test, not a single-process mock.
- `tests/second-tenant.test.mjs` proves the SAME core modules (`render`, `validate`, `planner`,
  `verifier`, `config`) produce fully independent, non-overlapping behavior for two different
  `DomainPlugin` configs (roster, risk taxonomy, guardrails, board title) with zero core code
  changes — the isolation boundary a multi-tenant control plane depends on.
- The gateway's own ledger is append-only SQLite with `WAL` + `busy_timeout` (`gateway/ledger.mjs`'s
  `openLedger`), and every aggregate query (`queryWindow`) only ever sums non-null columns — a
  malformed or partial row degrades to an `unknownRuns`/`costUnknownRuns` counter rather than being
  silently coerced into the sum.
- Suite size and status, **executed and verified** (Node 24.15.0, at the `0.2.1` release commit,
  2026-07-18): **860 tests — 851 pass, 0 fail, 9 skipped.** The 9 skips are provider/harness e2e tests
  that self-skip without a live key or the relevant CLI on PATH (by design; they are the live-provider
  conformance battery, not dead tests). This is a real run, not a grep.

---

## Honest limitations (read this before quoting the card)

This section is not optional. A battle card that overclaims is worse than none.

- **Single-tenant today.** The gateway, ledger, and registry all carry a `tenant` field and are
  documented as "designed to serve multiple tenants once a control plane exists"
  (`token-event.mjs`), but there is no shipped multi-tenant control plane, no tenant-facing auth, and
  no billing layer. ADR 0001 (`docs/adr/0001-planning-and-execution-planes.md`) explicitly scopes the
  control plane (its "D3") as future work, not built. Positioning this as a multi-tenant SaaS product
  today would be false.
- **No cross-wire translation.** The gateway is a **same-wire** proxy — an Anthropic-shaped request
  goes to an Anthropic-shaped upstream, an OpenAI-shaped request to an OpenAI-shaped upstream. It
  cannot make an Anthropic-only harness (e.g. `claude-code`) talk to an OpenAI-only provider that
  doesn't also expose an Anthropic-compatible endpoint. Deliberately deferred (`docs/GATEWAY.md` §
  "Known follow-ups").
- **Enforcement is trip-wire, not preventive mid-call.** A single call that starts before the cap is
  hit is allowed to finish even if it pushes spend over the cap; only the *next* call is denied. For
  a customer expecting hard real-time ceiling enforcement mid-response, this needs to be stated
  plainly up front.
- **No `degrade` (reroute-to-cheaper) enforcement yet.** Today the only enforcement actions are
  allow/deny; automatically falling back to a cheaper model/provider on a warn is a documented,
  unbuilt follow-up (`docs/GATEWAY.md`).
- **Launcher-side injection covers one wire so far.** Automatic gateway routing is wired for the
  Anthropic-wire harness path (`inject.mjs`); OpenAI-wire harness injection (opencode's
  `opencode.json` baseURL rewrite) is a documented follow-up, not yet built.
- **No upstream request timeout in the gateway itself.** It relies on the provider closing idle
  connections (e.g. DeepSeek's own 10-minute cap) rather than enforcing one itself — noted as a
  follow-up in `docs/GATEWAY.md` and `docs/PROVIDERS.md`.
- **Cached-input cost is not split from fresh-input cost.** `pricing.json` captures a
  `cachedInputPerM` rate, but `costFor()` prices all input tokens at the uncached rate today — a
  documented, not-yet-built refinement (`docs/PRICING.md`).
- **Retiring the legacy per-harness usage readers is explicitly gated**, not done: `usage-readers.mjs`
  remains the fallback metering path whenever the gateway is off or has no matching ledger event for
  a run (`meterRun`, `usage-readers.mjs`); the gateway ledger is the canonical source only when it is
  actually running in front of traffic.
- **The provider registry is small.** Three registered, gateway-routable providers today (Anthropic,
  DeepSeek, OpenRouter). "Any vendor" is the architectural claim (the abstraction is conformance-
  tested to onboard a new OpenAI-wire endpoint quickly — see `tests/ollama-e2e.test.mjs`'s framing of
  its own conformance battery as "onboard any new provider in a minute"), not yet a long list of
  shipped, pre-wired integrations.
- **No primary artifact of a live enforcement denial.** The surviving dogfood ledger was queried
  directly (2026-07-18): 64 metered calls, **all `allow`, zero denies**. The deny path is proven at
  the process level offline (`tests/exit-confirm-e2e.test.mjs`) and in unit/integration tests, but
  enforcement firing against live *paid* traffic has no recoverable evidence. Closing this costs
  ~$0.006 — see `docs/dogfood-29-confirm.md`. Until then, do not claim a live denial.
- **No customer-facing performance/latency numbers exist.** Gateway-added latency, throughput under
  load, and any SLA figure are all `TBD` — they would come from a dedicated load-test pass, which has
  not been run and is not in this repo.

---

## One-line objection handlers (draft, needs founder sign-off before use)

- *"Why not just use \[coding-agent product\]'s built-in usage dashboard?"* — Those report usage
  per-vendor, after the fact, inside one vendor's own harness. MeridianOS is the layer that sits
  *underneath* whichever harness/vendor mix you already run, meters all of them the same way, and can
  say "no" before the call goes out — not just show you a number after the money's spent.
- *"Is this a coding agent?"* — No. It runs existing agent harnesses (Claude Code, opencode, etc.)
  through a scheduler; the product is the governance/metering/enforcement layer, not a new agent to
  evaluate against Devin or Cursor.
- *"How many providers do you support?"* — Three shipped and gateway-routable today (Anthropic,
  DeepSeek, OpenRouter); the abstraction is designed and conformance-tested to onboard a new
  OpenAI-wire provider quickly, not a long pre-built list.
