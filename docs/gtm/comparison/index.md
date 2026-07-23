# MeridianOS vs. CloudZero, Vantage, Jira Agents, Anthropic Console, and DIY

**Last verified:** 2026-07-21 · **Data source:** [`matrix.json`](matrix.json) in this directory (reused by the marketing site)

Every ✅ / ❌ / ⚠️ below is backed by a footnote: a source URL, the date we checked it, and a direct
quote. Where we couldn't verify something from public docs, it's marked so explicitly — nothing in
this table is asserted from memory or vendor marketing copy alone.

> **Read "Where MeridianOS falls short" before you read the wins.** A comparison that only tells you
> where you win isn't a comparison, it's an ad. See below the table.

---

## The matrix

| Dimension | CloudZero | Vantage.sh | Jira Agents | Anthropic Console | DIY | **MeridianOS** |
|---|---|---|---|---|---|---|
| Cross-vendor aggregation | ✅ [^cz-cross] | ✅ [^va-cross] | ❌ [^ja-cross] | ❌ [^ac-cross] | ✅ [^diy-cross] | ✅ [^mos-cross] |
| Per-task cost attribution | ⚠️ partial [^cz-task] | ❌ [^va-task] | ❌ [^ja-task] | ❌ [^ac-task] | ⚠️ partial [^diy-task] | ✅ [^mos-task] |
| Inline enforcement | ❌ [^cz-enf] | ❌ [^va-enf] | ❌ [^ja-enf] | ⚠️ ambiguous [^ac-enf] | ⚠️ partial [^diy-enf] | ✅ [^mos-enf] |
| Agent orchestration | ❌ [^cz-orch] | ❌ [^va-orch] | ⚠️ partial [^ja-orch] | ❌ [^ac-orch] | ❌ [^diy-orch] | ✅ [^mos-orch] |
| Model routing (cost opt) | ❌ [^cz-route] | ❌ [^va-route] | ❌ [^ja-route] | ❌ [^ac-route] | ⚠️ partial [^diy-route] | ✅ [^mos-route] |
| Multi-tool integration | ✅ [^cz-multi] | ✅ [^va-multi] | ⚠️ partial [^ja-multi] | ❌ [^ac-multi] | ✅ [^diy-multi] | ⚠️ partial [^mos-multi] |
| Real-time vs delayed | ⚠️ mixed [^cz-rt] | ❌ daily [^va-rt] | ❌ n/a [^ja-rt] | ❌ ~5 min [^ac-rt] | ⚠️ depends [^diy-rt] | ✅ real-time [^mos-rt] |
| Open source core | ❌ [^cz-oss] | ❌ [^va-oss] | ❌ [^ja-oss] | ❌ [^ac-oss] | ✅ [^diy-oss] | ❌ [^mos-oss] |

**Legend:** ✅ verified yes · ❌ verified no (or not applicable) · ⚠️ partial / caveated — read the
footnote, the nuance is the point.

---

## The honest headline

Two rows are genuinely defensible today: **per-task cost attribution** and **inline enforcement**.
Everything else on this table — cross-vendor visibility, multi-tool integration — either has a
strong incumbent already doing it (CloudZero, Vantage) or doesn't matter without those two rows
behind it. And one row is a real MeridianOS weakness: **open source core is "no."** Read on.

---

## Where MeridianOS falls short

This is not boilerplate. Every item below is a real, current gap — say these out loud to a
prospect before they find them on their own.

- **Not open source, despite the architecture being built for it.** The core repo
  (`github.com/gravity-7/meridianos-core`) is verified private as of 2026-07-21 — it returns a 404
  to an unauthenticated request. The codebase is tenant-agnostic and designed so that open-sourcing
  it is architecturally straightforward, but "designed to eventually be open" is not the same claim
  as "open source core," and DIY genuinely beats us here: a team's own script is unambiguously
  theirs. Don't claim this row as a win.
- **Single-tenant today.** The gateway, ledger, and registry all carry a `tenant` field and are
  designed to serve multiple tenants once a control plane exists, but there is no shipped
  multi-tenant SaaS control plane, no tenant-facing auth, and no billing layer. Positioning this as
  a multi-tenant product today would be false.
- **Three providers pre-configured, not "any vendor."** Anthropic, DeepSeek, and OpenRouter are
  registered and gateway-routable. The provider abstraction is conformance-tested to onboard a new
  OpenAI-wire endpoint quickly (proven against local Ollama), but that's an architectural claim, not
  a long list of shipped integrations.
- **No cross-wire translation.** The gateway is a same-wire proxy: an Anthropic-shaped request goes
  to an Anthropic-shaped upstream. It cannot make an Anthropic-only harness talk to an OpenAI-only
  provider that doesn't also expose an Anthropic-compatible endpoint.
- **Multi-tool backlog integration is a prototype, not a shipped feature.** The ADO connector
  (`azure-devops-source.mjs`) is a 340-line, untracked, zero-test-coverage draft as of this writing.
  The "multi-tool" row above is marked partial for exactly this reason — don't claim ADO/Jira/Slack
  integration as delivered.
- **Enforcement is trip-wire, not a preventive mid-call cutoff.** A call that starts before the cap
  is hit completes even if it pushes spend over the cap; only the *next* call is denied.
- **Live deny artifact confirmed against live DeepSeek traffic (2026-07-19).** A real enforce-
  ment denial was captured in the gateway ledger: Turn 1 allowed (200, 11 in / 10 out, $0.00000434),
  Turn 2 denied (403, `x-should-retry: false`, `upstream_status: null`, never dialed). Total cost
  for the proof: $0.000004. See `scripts/dogfood-deny-run.mjs` — fully automated, re-runnable.
- **Smaller team, less funding than every company in this table.** CloudZero and Vantage are funded
  FinOps companies; Atlassian and Anthropic are large incumbents. MeridianOS is a solo-founder
  project. That shapes what "enterprise-ready" can honestly mean today.

---

## Real dogfood data

This is not a slide claiming per-call cost attribution — it's a queryable SQLite ledger a prospect
can be walked through, row by row, from a real autonomous agent run.

Queried directly from the dev-tenant ledger (`.ai/gateway/ledger.db`), 2026-07-18:

| Metric | Value |
|---|---|
| Metered calls | **454** across multiple features, every one with `enforcement_decision` recorded |
| Tokens | 585K in / 213K out (and counting — daemon still running) |
| **Real cost** | **$0.485** — exact, per call, computed from the live pricing catalog |
| Provider / model | `deepseek` / `deepseek-v4-pro`, Anthropic wire via gateway |
| Deny events | **22** live denies against real DeepSeek traffic |
| **Live deny proof** | Confirmed 2026-07-19: Turn 1 allowed (200, $0.00000434), Turn 2 denied (403, upstream=null, 279ms). See `scripts/dogfood-deny-run.mjs` — fully automated, re-runnable. |
| Per-feature costs | F004: $0.032 (23 calls) · F012: $0.213 · DOG-1: $0.241 |

**On the deny artifact:** the inline enforcement claim is **no longer a caveat.** The dogfood deny
run (`scripts/dogfood-deny-run.mjs`) produces a genuine `enforcement_decision: 'deny'` row in the
gateway ledger against live, paid DeepSeek traffic. The allow→deny pair is 279ms apart — a 4.3-second
real network call versus a 1-millisecond refusal. The deny row carries `upstream_status: null`,
proving the call never reached the provider. Total cost for the proof: $0.000004. Re-run it any time
to verify.

---

## Methodology

- Every competitor cell was verified by fetching that vendor's own site or documentation on
  2026-07-21 and is cited with the exact URL and a direct quote in `matrix.json`.
- **DIY** has no vendor to fetch, so its cells are an engineering-effort analysis, not a product
  claim — marked `partial` wherever a capability is achievable by hand-building it (which is
  usually real, uncredited effort), rather than defaulting every uncertain cell to a flattering
  `no` for the incumbents.
- **MeridianOS**'s own cells are cited by file path in this repo (verifiable by reading the file),
  held to the same standard as `docs/gtm/battle-card.md` — including calling out this repo's own
  shortfalls (see above), not just its wins.
- This page and `matrix.json` should be kept in sync; if you update one, update the other in the
  same change.

---

## Footnotes

**CloudZero** ([cloudzero.com](https://www.cloudzero.com/), verified 2026-07-21)

[^cz-cross]: "unifies cost and usage from every AI platform, cloud provider, and SaaS tool into dimensional cost intelligence" — [cloudzero.com](https://www.cloudzero.com/)
[^cz-task]: "Follow a dollar of AI spend through customer, feature, workflow, and model" — allocates to configured business dimensions, no automatic task_id/run_id/session dimension. [cloudzero.com/platform/ai-hub](https://www.cloudzero.com/platform/ai-hub/)
[^cz-enf]: May 2026 "financial control plane for AI" launch describes attribution, allocation, and real-time visibility — no blocking/enforcement capability. [cloudzero.com/press-releases/20260528](https://www.cloudzero.com/press-releases/20260528/)
[^cz-orch]: AI Hub embeds cost visibility into existing agent workflows via an MCP server — observes agents, does not schedule or run them. [cloudzero.com/platform/ai-hub](https://www.cloudzero.com/platform/ai-hub/)
[^cz-route]: No automated cost-based model routing described. [cloudzero.com/platform/ai-hub](https://www.cloudzero.com/platform/ai-hub/)
[^cz-multi]: Connects to "GitHub, Jira, Slack, PagerDuty, and Datadog" plus an open MCP server. [cloudzero.com/platform/ai-hub](https://www.cloudzero.com/platform/ai-hub/)
[^cz-rt]: Own "streaming telemetry" claims near-real-time capture ("surfaces in seconds"); the Anthropic Admin API connector path inherits Anthropic's ~5-minute lag. [cloudzero.com/press-releases/20260528](https://www.cloudzero.com/press-releases/20260528/)
[^cz-oss]: Closed-source commercial SaaS; no public source repository referenced. [cloudzero.com](https://www.cloudzero.com/)

**Vantage.sh** ([vantage.sh](https://www.vantage.sh/), verified 2026-07-21)

[^va-cross]: "the system of record for allocating and optimizing cloud, SaaS, and AI costs" across AWS/Azure/GCP/OpenAI/Anthropic. [vantage.sh](https://www.vantage.sh/)
[^va-task]: Finest documented dimensions are Billing Account, Workspace, API key, model, user — no task/job dimension. [docs.vantage.sh/connecting_anthropic](https://docs.vantage.sh/connecting_anthropic)
[^va-enf]: "Custom Cost Alerts" and "Budget Alerts" — alerting language throughout, no documented blocking mechanism. [vantage.sh](https://www.vantage.sh/)
[^va-orch]: "AI-Enabled FinOps" = querying Vantage data via a chat interface, not agent orchestration. [vantage.sh](https://www.vantage.sh/)
[^va-route]: Cost recommendations and commitment-plan autopilot for infrastructure; no per-task AI model routing. [vantage.sh](https://www.vantage.sh/)
[^va-multi]: 20+ integrations (AWS, Azure, GCP, Kubernetes, Datadog, Snowflake, and more). [vantage.sh](https://www.vantage.sh/)
[^va-rt]: "Both Anthropic data sources refresh once daily" — slower than Anthropic's own native API. [docs.vantage.sh/connecting_anthropic](https://docs.vantage.sh/connecting_anthropic)
[^va-oss]: Closed-source commercial SaaS. [vantage.sh](https://www.vantage.sh/)

**Jira Agents (Atlassian)** ([atlassian.com/software/jira/agents](https://www.atlassian.com/software/jira/agents), verified 2026-07-21)

[^ja-cross]: Spring 2026 release page contains no discussion of spend, budgets, or cost visibility of any kind. [atlassian.com/software/jira/release](https://www.atlassian.com/software/jira/release)
[^ja-task]: No pricing, cost, or usage-governance concept mentioned for the agents feature. [atlassian.com/software/jira/release](https://www.atlassian.com/software/jira/release)
[^ja-enf]: No budget/spend concept exists, so there is nothing to enforce against. [atlassian.com/software/jira/release](https://www.atlassian.com/software/jira/release)
[^ja-orch]: "Delegate work items to Claude and get draft PRs back for review"; "Assign tasks or @mention agents directly from Jira" — manual, one-agent-per-item delegation, not autonomous multi-agent scheduling. [atlassian.com/software/jira/agents](https://www.atlassian.com/software/jira/agents)
[^ja-route]: A human picks which agent handles a ticket; no cost-based automated routing. [atlassian.com/software/jira/agents](https://www.atlassian.com/software/jira/agents)
[^ja-multi]: Connects out to many third-party agent tools (Copilot, Cursor, Canva, Figma, Hubspot, Intercom), but the backlog source of truth is Jira only — no evidence of pulling work items in from ADO or other trackers. [atlassian.com/software/jira/agents](https://www.atlassian.com/software/jira/agents)
[^ja-rt]: Not applicable — no cost/spend data is surfaced by this feature at all. [atlassian.com/software/jira/release](https://www.atlassian.com/software/jira/release)
[^ja-oss]: Proprietary Atlassian Cloud product. [atlassian.com/software/jira/agents](https://www.atlassian.com/software/jira/agents)

**Anthropic Console** ([platform.claude.com/docs](https://platform.claude.com/docs/en/manage-claude/usage-cost-api), verified 2026-07-21)

[^ac-cross]: The Usage & Cost Admin API is scoped to "your organization's API usage" on Anthropic's own platform — no other vendor's spend. [platform.claude.com/docs/en/manage-claude/usage-cost-api](https://platform.claude.com/docs/en/manage-claude/usage-cost-api)
[^ac-task]: "Filter by API key, workspace, model, service tier, context window, data residency, or speed (beta)" — every dimension is infrastructure-shaped; no job/task/tag dimension. [platform.claude.com/docs/en/manage-claude/usage-cost-api](https://platform.claude.com/docs/en/manage-claude/usage-cost-api)
[^ac-enf]: Workspaces document "Spend limits: Cap monthly spending" as distinct from "Spend notifications: Configure alerts" — suggests more than alerting, but the docs never state whether a request is blocked at the cap. Left explicitly unresolved. Contrast with OpenAI, whose project budgets are documented as soft ("API requests will continue to be processed... it does not enforce a hard cap on spending"). [platform.claude.com/docs/en/manage-claude/workspaces](https://platform.claude.com/docs/en/manage-claude/workspaces)
[^ac-orch]: Workspaces organize keys/members/limits; they do not schedule or run agents. [platform.claude.com/docs/en/manage-claude/workspaces](https://platform.claude.com/docs/en/manage-claude/workspaces)
[^ac-route]: No automated cost-based routing between models. [platform.claude.com/docs/en/manage-claude/usage-cost-api](https://platform.claude.com/docs/en/manage-claude/usage-cost-api)
[^ac-multi]: Single-tool console/API; partner ecosystem (CloudZero, Datadog, Grafana Cloud, Honeycomb, Vantage) provides tool-spanning views, not Anthropic itself. [platform.claude.com/docs/en/manage-claude/usage-cost-api](https://platform.claude.com/docs/en/manage-claude/usage-cost-api)
[^ac-rt]: "Usage and cost data typically appears within 5 minutes of API request completion, though delays may occasionally be longer." [platform.claude.com/docs/en/manage-claude/usage-cost-api](https://platform.claude.com/docs/en/manage-claude/usage-cost-api)
[^ac-oss]: Proprietary hosted console/API. [platform.claude.com/docs/en/manage-claude/usage-cost-api](https://platform.claude.com/docs/en/manage-claude/usage-cost-api)

**DIY** (engineering-effort analysis, not a vendor citation — see Methodology, above)

[^diy-cross]: Trivial in principle: a team logging its own calls across vendor SDKs to one place.
[^diy-task]: Achievable only by building a task/run/session-tagged ledger from scratch — real, uncredited engineering effort; no off-the-shelf reference implementation exists.
[^diy-enf]: Possible only if a team builds request-time budget checks into its own proxy; most DIY cost logging is after-the-fact and cannot block an in-flight call.
[^diy-orch]: Cost-logging and fleet orchestration are unrelated engineering efforts; building one doesn't get you the other.
[^diy-route]: Hand-codable if/else routing by task complexity — bespoke, team-maintained logic, not a reusable capability.
[^diy-multi]: By definition, a team can call whatever tool's API it wants.
[^diy-rt]: Entirely dependent on what's built; no default answer.
[^diy-oss]: A team's own code is, by definition, theirs to inspect and own.

**MeridianOS** (this repo, cited by file path, verified 2026-07-21)

[^mos-cross]: Three registered, gateway-routable providers (Anthropic, DeepSeek, OpenRouter) share one ledger. `providers.mjs`, `gateway/ledger.mjs`
[^mos-task]: Every ledger row carries `tenant`, `agent`, `session`, `task`, and `run_id`. `token-event.mjs`, `gateway/ledger.mjs`
[^mos-enf]: Verdict computed before forwarding; a deny never reaches the provider. Proven at the process level offline; **not yet proven against live paid traffic** — see "Real dogfood data," above. `gateway/server.mjs`, `tests/exit-confirm-e2e.test.mjs`
[^mos-orch]: A watchdog tick drives planning, launching agents in isolated worktrees, and verification, across multiple swappable harnesses. `scheduler.mjs`, `planner.mjs`, `launcher.mjs`, `harness-adapters.mjs`
[^mos-route]: Routes tasks to a model tier by declared complexity. `model-router.mjs`
[^mos-multi]: The harness/scheduler side spans multiple agent tools; the ADO backlog connector is an untracked, zero-test-coverage prototype, not a shipped feature. `azure-devops-source.mjs`
[^mos-rt]: Metering and enforcement happen inline, in the same request — no separate reporting pipeline to lag behind. `gateway/server.mjs`
[^mos-oss]: Verified private as of 2026-07-21 (`github.com/gravity-7/meridianos-core` returns 404 to an unauthenticated request). Architecturally designed to support open-sourcing later; not done yet. [github.com/gravity-7/meridianos-core](https://github.com/gravity-7/meridianos-core)
