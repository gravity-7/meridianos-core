# MeridianOS — Product Hunt Listing Draft

**Feature:** F011 · **Version:** 1.0 · **Written:** 2026-07-21
**Status:** DRAFT — founder review required before submission

---

## Tagline (max 60 chars)

> **Know what every AI agent run actually costs — and stop it before it overspends.**

*(59 chars)*

**Alternates (pick one or remix):**

| # | Tagline | Len |
|---|---|---|
| A | Your AI agents have a credit card. Give them a limit. | 54 |
| B | One proxy. Every agent. Zero surprise bills. | 46 |
| C | AI agent cost governance that runs before the call, not after the bill. | 76 ❌ |
| D | Ship AI features. Know what each one cost to build. | 53 |

**Recommendation:** Lead with **A** for memorability, keep the primary as the fallback if A tests poorly with the team. C is too long for PH (60 char hard limit).

---

## Short Description (max 260 chars)

> MeridianOS sits under the AI agents you already run. Every call is metered to a task ID *before* it hits the provider — so cost stops being a monthly invoice and becomes a queryable row. One proxy. Every agent. No vendor lock-in.

*(259 chars)*

---

## Full Description (~500 words)

### What is MeridianOS?

MeridianOS is a **VS Code-first autonomous agent orchestrator with cost governance built in, not bolted on.** Think: GitHub Copilot, but you own the agents, you bring your own LLM keys, and you know — down to the cent — what every feature cost to build.

It runs as a local forward proxy (`npx meridian-gateway`) that sits between your AI tools and any LLM provider. Every call is metered, costed, and enforced **inline** — before the request ever reaches a paid endpoint. No vendor dashboard. No end-of-month surprise. No lock-in.

### The problem it solves

Your team is running AI agents now. They write code, open PRs, and spend real money doing it. At the end of the month, your provider sends you one number. It doesn't tell you which feature that number paid for. It can't stop anything. And if you're using more than one model vendor, there's no common denominator at all.

MeridianOS answers the question no vendor console can: **"What did feature X cost to build?"**

### How it works

1. **`npx meridian-gateway`** — boots in ~110 ms. Points your AI tool's base URL at `localhost`.
2. **Every call is metered** — tokens in, tokens out, real dollar cost computed from live pricing data (DeepSeek, Anthropic, OpenAI, OpenRouter — one ledger, all vendors).
3. **Cost is attributed per task** — not per workspace, not per API key. Per *unit of work*. You can query the ledger: "F004 cost $0.031703 across 23 calls."
4. **Enforcement is inline** — if a task hits its budget cap, the gateway returns a 403 *before forwarding*. The agent exits cleanly. No retry-loop against the cap. No silent overspend.
5. **Keys never leave the gateway** — your agents only ever hold short-lived gateway tokens. Real provider keys are injected server-side. Key custody is structural, not aspirational.

### What we've shipped (July 2026)

Everything below is running in production on our own dogfood tenant today:

- **MeridianOS Gateway** — transparent same-wire proxy, metering both buffered and SSE-streaming responses. 907 tests, 0 failures.
- **Cost governance engine** — per-task budgets with inline 403 enforcement. Our ledger: 454 metered calls, 628K tokens, **$0.48 total**, 22 calls denied at the cap.
- **SQLite-native ledger** — no cloud DB, no vendor telemetry dependency. Every token event is a row you own.
- **Multi-harness scheduler** — drives Claude Code, OpenCode, and Antigravity as swappable harnesses through a unified work loop (plan → execute → verify).
- **Azure DevOps + Slack integration** — agents auto-sync work items to ADO boards; escalation alerts push to Slack when a run exceeds thresholds.
- **Model router** — automatically routes tasks to cheaper or more capable models based on complexity, as an active cost-optimization mechanism.
- **Dashboard** — local web UI at `localhost:4317` with live call counts, cost totals, and enforcement decisions.

### Pricing

| Tier | Agents | Price |
|---|---|---|
| **Free** | 1 agent | $0 |
| **Pro** | 10 agents | $99/mo |
| **Enterprise** | Unlimited | Custom |

All tiers include the full gateway, ledger, dashboard, and multi-provider support. You bring your own LLM keys — we never mark up your API spend. The pricing is for the orchestration layer, not the tokens.

### Who it's for

Indie developers shipping AI-powered features. Freelancers running coding agents against client work who need to bill accurately. Small engineering teams (2–20 devs) using more than one LLM vendor and tired of guessing which project burned the budget.

If you're a single-vendor, single-agent shop — your provider's console already serves you well. MeridianOS earns its keep the moment you add a second vendor, a second harness, or a budget you can't afford to blow through.

### What makes it different

- **Zero vendor lock-in.** Bring your own keys. Swap providers in config. Your ledger is a SQLite file on your machine — not a cloud service you can't export.
- **Cost governance is the product, not a feature.** The gateway was designed from day one to enforce budgets inline, not report them after the fact.
- **npm install in 60 seconds.** No cloud sign-up. No waiting for access. `npm install @gravity-7/meridianos-core` and you're running.
- **Honest about what it isn't.** We're not another autonomous coding agent. We're the layer *underneath* the agent you already use — we don't compete with Claude Code or Copilot, we make them auditable.

---

## First Comment Draft (Founder's Note)

> I built MeridianOS because I got tired of not knowing.
>
> We were dogfooding our own agent harness against DeepSeek, and I realized I couldn't answer the simplest question: "what did today's run cost?" Not "what's our monthly bill" — that's one number. I wanted to know *per feature*. Per PR. Per task.
>
> So I wrote a proxy. Then a ledger. Then a budget engine that says "no" before the call is made. Then a scheduler that loops through a work queue across three different harnesses. At some point it stopped being a side project and started being a product.
>
> The numbers that made me ship it: our own build ledger shows 454 real calls, $0.48 total, and 22 calls we refused to pay for. Feature F004 cost three cents across 23 calls. I can show you the row.
>
> MeridianOS is free for one agent. It's `npx meridian-gateway` and boots in a tenth of a second. If you're running AI agents and you can't answer "what did that feature cost," I'd love for you to try it and tell me what you find.
>
> Happy to answer questions all day. AMA.

---

## Screenshot / Thumbnail Ideas

| # | Title | Description | Visual |
|---|---|---|---|
| 1 | **The Question** | Black terminal. Two lines centered: "Your agents spent money today. / Which feature was it for?" — the hook that frames the entire product. | Terminal screenshot, dark theme, large font |
| 2 | **Gateway Boot** | `npx meridian-gateway --provider deepseek` → `listening at http://127.0.0.1:52045` in ~110 ms. Shows the zero-friction install experience. | Terminal with command and boot line visible |
| 3 | **Live Dashboard** | Split view: VS Code with an agent running on the left, dashboard at `localhost:4317` on the right with call count and cost ticking upward in real time. The money shot. | Split-screen screenshot, numbers visibly mid-update |
| 4 | **The Ledger** | A query result showing per-task cost breakdown: "F004 — 23 calls — $0.031703 — 11 denies." Proves per-feature attribution is real, not aspirational. | Terminal or SQLite browser showing ledger rows |
| 5 | **Deny In Action** | A 403 response body: `{"type":"permission_error","code":"over_budget","message":"task budget exceeded"}`. Shows enforcement is inline and non-retryable. | Terminal or HTTP client showing the deny response |
| 6 | **Multi-Harness Architecture** | Diagram: Claude Code / OpenCode / Antigravity → Gateway → DeepSeek / Anthropic / OpenAI. One proxy, any harness, any provider. | Clean architecture diagram (light or dark) |
| 7 | **The Dashboard — Full View** | The complete MeridianOS dashboard showing all panels: cost over time, per-task breakdown, enforcement log, provider latency. | Full browser window screenshot |

**Priority order for PH gallery:** 1 → 2 → 3 → 4. If only 3–4 images fit, lead with the story arc: question → boot → proof (dashboard + ledger).

---

## Suggested Tags

PH allows up to 5 tags. Recommended set:

1. **Developer Tools** — primary category; this is a devtool
2. **Artificial Intelligence** — the domain
3. **Productivity** — the outcome for engineering teams
4. **Open Source** — core is on GitHub (`@gravity-7/meridianos-core` on npm, repo public)
5. **Analytics** — cost analytics / FinOps angle

**Alternate to consider:** swap "Analytics" for **SaaS** if the Pro tier positioning matters more than the FinOps story.

---

## Maker / Team Info

| Field | Value |
|---|---|
| **Maker name** | `{founder name}` |
| **Maker role** | Founder, Gravity 7 |
| **Maker headline** | Building cost-governed AI agent infrastructure |
| **Twitter/X** | `{@handle}` |
| **GitHub** | `{github username}` |
| **Website** | `{meridianos or gravity-7 site}` |
| **Team size** | `{N}` |
| **Location** | `{city, country}` |

> ⚠️ Fill placeholders before submission. PH requires at least one confirmed maker with a Twitter/X or GitHub linked account.

---

## Pre-Submission Validation

- [ ] Tagline is ≤ 60 characters
- [ ] Short description is ≤ 260 characters
- [ ] Full description renders correctly in markdown (PH supports Markdown)
- [ ] All numbered claims verified against live ledger (re-query before submission day — the ledger grows)
- [ ] Screenshots: 1270×760 px minimum, no PH branding on images themselves
- [ ] First comment drafted and ready to paste immediately after launch
- [ ] Maker profile complete with avatar, Twitter/GitHub linked
- [ ] Pricing page (`docs/PRICING.md`) is current and consistent with listing
- [ ] `@gravity-7/meridianos-core` is published and installable via `npm install`
- [ ] Gateway boot time re-measured on submission day (don't quote stale perf numbers)
- [ ] Any competitive claims cross-checked against `docs/gtm/comparison/matrix.json` (last verified 2026-07-21)
