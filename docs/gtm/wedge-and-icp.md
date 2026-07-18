# MeridianOS — Wedge, ICP, and Proof-of-Value Demo Script (internal draft)

> **INTERNAL DRAFT — not for external distribution.** Every claim below is grounded in a specific
> module, doc, or test in this repo, cited inline. No number here is invented; anything not
> verifiable from the repo is marked `TBD` with a note on where the real figure would come from.
> Founder review required before any of this goes external.

---

## The wedge

**Cost governance + a control plane for heterogeneous agent fleets** — observe, cap, and audit spend
across Claude, DeepSeek, OpenRouter, and local models, provider- and harness-agnostic
(`docs/README.md`).

The insight the wedge is built on: once you let AI agents run autonomously against real provider
APIs, "did it actually go where I think it went, and did it cost what I think it cost" stops being
a rhetorical question. This repo's own operational history contains two concrete, non-hypothetical
instances of an agent harness silently spending against the wrong (more expensive) provider — see
"The sharpest story we have," below. The gateway (`gateway/server.mjs`) exists specifically to make
that class of bug structurally impossible rather than patched one harness at a time.

---

## ICP (draft — needs founder validation against real prospect conversations)

**Who this is for**, based strictly on what the product actually does today (a same-wire metering/
enforcement proxy in front of provider APIs, wired into a scheduler that runs coding-agent
harnesses):

- Teams running **more than one LLM harness or vendor** for agentic coding/automation work — e.g.
  Claude Code plus a cheaper third-party model for high-volume mechanical tasks — where "which
  agent run cost how much, on which vendor" is not visible today. (`docs/README.md`'s stated
  scope: "meters their token spend across mixed vendors, and enforces budgets.")
- Teams that have already been burned, or are worried about being burned, by an agent harness
  quietly authenticating against a different (more expensive) endpoint than the one they configured
  — see the two documented bugs below. This is a **known failure mode of this exact class of
  software**, not a hypothetical.
- Teams running agents **unattended / overnight / with real autonomy** (auto-merge, auto-PR), where
  a human is not watching every call and a hard spend ceiling matters more than a nice dashboard.
  The gateway's enforcement is inline and non-retryable by design for exactly this case
  (`gateway/server.mjs`'s `DENY_STATUS` comment: a capped agent should exit cleanly rather than
  retry-loop to a 30-minute kill).
- **TBD (needs real validation, not assumption):** company size, budget authority, whether the buyer
  is a platform/infra team or an individual eng lead. Nothing in this repo tells us who has bought or
  would buy this — that has to come from actual customer conversations, which have not happened
  inside this repo's scope.

**Who this is explicitly NOT for (yet):** anyone needing a multi-tenant, self-serve SaaS control
plane today — there isn't one (see the battle card's limitations section; ADR 0001's "D3" control
plane is proposed, not built). Anyone needing cross-wire translation (Anthropic-only harness talking
to an OpenAI-only provider with no Anthropic-compatible endpoint) — not supported, deliberately
deferred.

---

## The proof-of-value demo: a real DeepSeek dogfood run

This is not a mocked demo. It is a real end-to-end call against a live DeepSeek endpoint, run through
the gateway, with the actual result recorded in the docs this repo ships:

> "A minimal live dogfood (one real DeepSeek call, key read from a gitignored `.env`, never printed)
> is the reference for wiring it end-to-end — it proved metering (9 in / 1 out / 10 total) and is
> what surfaced the `accept-encoding` fix." (`docs/GATEWAY.md` § "Running it")

And from `docs/PROVIDERS.md`'s DeepSeek section: *"the one we've dogfooded live through the gateway
(a real call metered exactly: 9 in / 1 out / 10 total)."*

### What it proved, concretely, and where each claim lives in the code

1. **Exact per-call metering on live traffic.** The gateway parsed DeepSeek's real Anthropic-shaped
   `usage` block (`input_tokens` / `output_tokens`) and recorded 9 input / 1 output / 10 total tokens
   — not an estimate (`gateway/server.mjs`'s `extractUsage`, wired through `emitEvent`).
2. **A real bug the dogfood found and fixed, live.** The first live attempt broke: DeepSeek actually
   compresses its response when the client sends `accept-encoding: gzip`, which broke the gateway's
   JSON-parse-based metering (offline stub tests never compress, so this only surfaced against the
   real endpoint). Fix: force `accept-encoding: identity` upstream so the metering parse always sees
   plaintext (`gateway/server.mjs`'s `buildForwardHeaders`, comment explicitly citing "real DeepSeek
   does exactly this — offline stubs never compress, so it only surfaced in a live dogfood"). This is
   itself a data point for the pitch: even a well-tested offline suite missed a real-world encoding
   quirk that only a live dogfood caught — which is exactly the kind of gap a governance layer sitting
   in the real traffic path is positioned to catch.
3. **Inline enforcement denial semantics, engineered and testable (see caveat).** The deny path
   (non-retryable 403, `x-should-retry: false`, wire-shaped `permission_error`) is implemented and
   unit/integration-tested in `gateway/tests/server.test.mjs`. **Caveat, stated plainly:** the
   `docs/GATEWAY.md`/`docs/PROVIDERS.md` dogfood description names one successful metered call; it
   does not itself document a live run that crossed a cap and got denied. Whether an actual denial
   was demonstrated live (versus proven only in tests) is `TBD` — verify against the live session
   transcript/PR before stating "we saw a live denial" to a prospect. What we can say without caveat:
   the denial code path is real, wired into the request handler before forwarding
   (`gateway/server.mjs`'s `handleRequest`), and covered by `gateway/tests/server.test.mjs`.
4. **`cost_usd` recorded per event.** `gateway/ledger.mjs`'s `appendEvent` writes a `cost_usd` column
   per token-event, computed via `pricing.mjs`'s `costFor()` and injected as a seam
   (`docs/PRICING.md`: *"Every `token-event`'s `costUsd` is that real dollar figure, or `null` when
   the model has no catalog entry."*).
5. **A tenant-labeled ledger.** Every token-event carries a `tenant` field (`token-event.mjs`'s
   `makeTokenEvent`, defaulting to `'pv'`), and `queryWindow`/`listEvents` (`gateway/ledger.mjs`) both
   filter by tenant — the schema is multi-tenant-shaped even though there is one tenant in production
   today (see the battle card's limitations section).

### Demo script (draft — walk a prospect through this)

1. Show `docs/GATEWAY.md`'s one-line loop diagram: harness → gateway (meter, verdict) → provider,
   with the real key only ever touching the gateway process, never the harness.
2. Run the standalone quickstart (`docs/GATEWAY.md` § "Standalone quickstart"): one command,
   `node gateway/cli.mjs --port 8787 --provider deepseek --model deepseek-chat`, no tenant/daemon
   required — this is the fastest path to a prospect seeing a real metered call themselves.
3. Point an agent's base URL at the printed gateway URL, send one real request.
4. Read the resulting ledger row live: `listEvents(openLedger('.ai/gateway/ledger.db'), { tenant:
   'pv' })[0]` — shown verbatim in `docs/GATEWAY.md` as `{ provider: 'deepseek', totalTokens: 10,
   costUsd: null, enforcementDecision: 'allow', ... }` (note: `costUsd` is `null` in that exact
   quickstart example because the quickstart doesn't wire a pricing catalog — call this out honestly
   rather than implying cost is always populated out of the box).
5. Set a deliberately low `per_5h_cost_usd` or token cap in `.ai/policy.yaml`'s `agent_budget`, make a
   second call, and show the 403 + `permission_error` response body and the `enforcementDecision:
   'deny'` row in the ledger — this demonstrates the trip-wire semantics live (per `docs/GATEWAY.md`
   § "Enforcement semantics": the call that crosses the line completes; the next call is denied).

---

## The sharpest story we have: two ways a harness can silently bill you at a competitor's endpoint — caught, not theorized

This is the strongest concrete narrative in the repo: two **distinct, real** silent-fallback bugs,
each independently discovered and each fixed with its own hardening, both documented in
`harness-adapters.mjs` and covered by `tests/harness-adapters.test.mjs`. Both predate the gateway;
the gateway (built later) is explicitly positioned as the structural fix that makes this entire bug
*class* impossible rather than requiring a third patch (`docs/PROVIDERS.md`: *"the gateway closes it
structurally (traffic must pass the meter)."*).

**How each was actually caught** — stated precisely so this isn't oversold: both are documented in
`harness-adapters.mjs` as *"verified empirically... live DeepSeek run"* — i.e. discovered during live
verification of the DeepSeek provider/harness integration, not flagged automatically by a running
governance system (the gateway didn't exist yet at that point). The honest framing for a prospect:
*"we hit this ourselves while integrating a second provider, and it's exactly the kind of thing that
goes undetected in any setup that isn't watching real traffic — which is why we built the layer that
watches real traffic."*

### Bug 1 — OAuth-shadowing (a `claude-code` session silently re-authenticates as Anthropic)

From `harness-adapters.mjs` (lines ~37–48):

> "`--bare` (third-party only): verified empirically (1.5, live DeepSeek run) that without it, a CLI
> with an active `claude login` OAuth session silently authenticates with the STORED OAuth token
> instead of the injected key — `ANTHROPIC_BASE_URL` is honored (the request really does go to the
> third-party endpoint) but auth still uses the operator's own Claude.ai session, which that endpoint
> then rejects."

In plain terms: pointing `claude-code`'s base URL at DeepSeek is not enough. If the operator has ever
run `claude login` (the normal, default state for anyone using the CLI day to day), the CLI's own
OAuth/keychain auth silently wins over the injected third-party key — the request goes to the right
*URL* but authenticates as the operator's own Anthropic account. The code comment is explicit that
this is not an edge case: *"any founder/dev who has ever run `claude login`... would hit this same
silent-fallback on the live daemon."*

**Fix:** the `--bare` CLI flag, which is documented (per the code comment) as the only mode where
"Anthropic auth is strictly `ANTHROPIC_API_KEY`... OAuth and keychain are never read." Applied to
every non-native-Anthropic provider route (`harness-adapters.mjs`'s `claudeCodeAdapter`, gated on
`!isNativeAnthropic`). Covered by `tests/harness-adapters.test.mjs`'s
*"claude-code + deepseek: resolves the /anthropic endpoint, reads the BYO key via ANTHROPIC_API_KEY,
and passes --bare"* test, which explicitly asserts `ANTHROPIC_AUTH_TOKEN` is undefined (i.e. only the
injected key can authenticate) and that `--bare` is present in the spawn args.

### Bug 2 — internal model-tier fallback (the top-level model override doesn't cover the CLI's own internal calls)

From `harness-adapters.mjs` (lines ~50–58), one layer deeper than Bug 1:

> "Third-party hardening (`ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL`): `--model`/
> `ANTHROPIC_API_KEY` only override the SESSION's top-level model — Claude Code can still make
> internal calls against its own named model tiers (subagent spawns, cheap internal operations)
> that, left unmapped, resolve to Anthropic's OWN model names and silently hit paid Anthropic even
> on a DeepSeek-routed session."

In plain terms: even after fixing Bug 1, setting `--model` to point the top-level session at
DeepSeek is not sufficient — Claude Code makes its own internal calls (subagents, cheap background
operations) against Anthropic's internal model-tier names, and those calls are not covered by the
session-level override. Left alone, those internal calls silently bill the operator's real Anthropic
account, even though the visible session is "routed" to DeepSeek.

**Fix:** explicitly map all three of Anthropic's internal tier env vars
(`ANTHROPIC_DEFAULT_HAIKU_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`, `ANTHROPIC_DEFAULT_OPUS_MODEL`)
to the third-party provider's own per-tier models (`harness-adapters.mjs`'s `claudeCodeEnv`,
e.g. for DeepSeek: haiku/sonnet tiers → `deepseek-v4-flash`, opus tier → `deepseek-v4-pro`) — chosen
to mirror the provider's own simple/medium/complex tiers rather than collapsing every internal call
onto one model. Covered by the same `tests/harness-adapters.test.mjs` test, which asserts all three
env vars resolve to the correct DeepSeek model per tier, plus regression coverage further down the
same file (lines ~305–308, ~402–404) verifying these values survive through the full launcher spawn
path, not just the adapter in isolation.

### Why this narrative matters for the pitch

Both bugs share the same shape: **the configured routing was followed, but authentication or a
subset of calls silently fell through to the more expensive, unconfigured endpoint anyway.** Neither
would show up by looking at the request URL or the top-level model name — you would only catch either
one by actually watching what got billed. That is precisely the gap the gateway closes structurally:
because the harness only ever holds a short-lived gateway token and the gateway is the only path to a
real provider key (`gateway/server.mjs`, `run-registry.mjs`), there is no code path left for a
harness-level auth quirk to silently reach a paid Anthropic endpoint — the meter sees every call
because every call must physically pass through it, rather than because a particular flag or env var
was remembered.

**What NOT to claim:** these two bugs were found and fixed via careful engineering hardening
(`--bare`, `ANTHROPIC_DEFAULT_*_MODEL`) *before* the gateway existed — not by an automated gateway
alarm catching live silent spend. Don't imply the gateway "caught these bugs in production." The
accurate claim is: these bugs are real, documented, non-hypothetical instances of exactly the failure
class the gateway is architected to make structurally impossible going forward.

---

## Open items / TBD before this goes external

- Real ICP validation from actual prospect conversations (none captured in this repo).
- Confirmation of whether a live enforcement *denial* (not just a live successful metered call) has
  been demonstrated end-to-end, or only proven in `gateway/tests/server.test.mjs`.
- Pricing/packaging — nothing in this repo defines what MeridianOS would cost a customer.
- Any performance/latency/SLA numbers for the gateway under load — not measured in this repo.
- Fresh `npm test` run to confirm current pass/fail state before quoting any test count externally.
