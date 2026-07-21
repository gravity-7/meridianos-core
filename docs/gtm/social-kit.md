# MeridianOS — Social Media Launch Kit

**Feature:** F011 · **Version:** 1.0 · **Written:** 2026-07-21
**Status:** DRAFT — founder review required before posting

---

## Voice & Tone Guidelines

- **Developer-first, not corporate.** Write like you're telling another engineer what you built — not like you're selling to a procurement department.
- **Numbers, not adjectives.** "454 calls, $0.48, 22 denies" beats "revolutionary cost visibility." If a claim doesn't have a number or a query behind it, cut it.
- **Honest about limitations.** If someone asks about single-vendor shops, the honest answer is "your provider's console already covers you — we shine when you add a second vendor or need per-task attribution." Say it before they find it.
- **One idea per post.** Don't cram the gateway, the ledger, the scheduler, and the ADO connector into one tweet. Each post sells one capability.
- **Always include a link that works.** The PH listing on launch day. The GitHub repo after. The npm page always. No link shorteners — full URLs build trust.

---

## Twitter / X Posts

### Post 1 — Launch Announcement (Post at T+0, 12:01 AM PT)

> We put MeridianOS on Product Hunt today.
>
> It's a proxy that sits under your AI agents and tells you what every feature cost to build — down to the cent.
>
> Our own build ledger: 454 calls. $0.48 total. 22 calls refused at the cap.
>
> `npx meridian-gateway` in 60 seconds. Free for one agent.
>
> {PH link}

**Why it works:** Opens with the action (we launched), drops the three numbers that are the whole pitch (454 / $0.48 / 22), closes with the zero-friction install. No adjectives. The numbers do the work.

**Image/GIF:** The two-line terminal hook from screenshot #1 — black screen, "Your agents spent money today. / Which feature was it for?"

---

### Post 2 — Technical Deep-Dive (Post at ~8:00 AM PT, US morning scroll)

> How MeridianOS enforces AI spend budgets inline (technical):
>
> 1. Your agent calls the gateway instead of the provider directly
> 2. Gateway checks the budget *before* forwarding — not after
> 3. Over cap → 403 with `code: over_budget`, never dials the paid endpoint
> 4. Under cap → forward with server-side key, meter the real usage block, write to SQLite
>
> The key insight: a 429/retryable response would make the agent back-off and retry against the cap until the launcher's 30-min kill. A non-retryable 403 makes it exit cleanly in under 2.5s.
>
> 907 tests. 0 failures. Source on GitHub.
>
> {GitHub link}

**Why it works:** Technical audience. Explains the one architectural decision that makes enforcement real (403 vs 429). The "907 tests, 0 failures" is credibility for engineers. No marketing fluff.

**Image/GIF:** Screenshot #5 — the 403 deny response body in a terminal or HTTP client.

---

### Post 3 — Momentum / Thank You (Post at ~2:00 PM PT, afternoon engagement window)

> Well this is happening. MeridianOS is {ranking} on Product Hunt right now.
>
> The thing I keep hearing: "I had no idea which feature was burning the budget."
>
> That's exactly why we built this. Every AI agent call should be a queryable row, not a line item on a monthly invoice you can't decode.
>
> If you tried it today and found something surprising in your own spend — reply with what you found. Genuinely want to know.
>
> {PH link}

**Why it works:** Social proof ("this is happening"), invites user-generated content ("reply with what you found"), keeps it about the problem not the product. Flexible — update `{ranking}` throughout the day.

**Image/GIF:** Screenshot #3 — the live dashboard split-screen with numbers visibly ticking upward.

---

## LinkedIn Posts

### Post 4 — Professional Launch (Post at T+0, 12:01 AM PT)

> **We launched MeridianOS on Product Hunt today. Here's why.**
>
> Every engineering team I've talked to in the last three months is running AI agents. Not one of them can tell me what a single feature cost to build. The provider invoice is one number at the end of the month — it doesn't break down by task, by PR, by project. And it can't stop anything.
>
> So we built a proxy that does both.
>
> MeridianOS sits underneath the agents you already run. Every call is metered to a task ID before it's forwarded. Cost stops being a monthly invoice and becomes a queryable row. And if a task exceeds its budget, the gateway returns a 403 and never dials the provider.
>
> Our own dogfood numbers: 454 metered calls across 5 days. $0.48 total real cost. 22 calls denied at the cap. Feature F004 cost $0.031703 across 23 calls — I can show you the row.
>
> **What it is:**
> • `npx meridian-gateway` — boots in ~110 ms
> • SQLite-native ledger — your data, your machine
> • Multi-provider: DeepSeek, Anthropic, OpenAI, OpenRouter — one ledger
> • Multi-harness: Claude Code, OpenCode, Antigravity — bring your own agent
> • Azure DevOps + Slack integration — work items sync, alerts push
>
> **What it isn't:**
> • Not another autonomous coding agent — we're the layer underneath the one you already use
> • Not a cloud service you can't export — the ledger is a SQLite file you own
> • Not a vendor markup play — you bring your own LLM keys, we never touch your API spend
>
> Free for one agent. Pro is $99/mo for 10 agents. Enterprise for teams.
>
> If you're running AI agents and you can't answer "what did that feature cost," I'd love for you to try it.
>
> {PH link}

**Why it works:** LinkedIn rewards longer, narrative posts. This tells the full story: problem → solution → proof → features → limitations → pricing → call to action. The "what it isn't" section builds trust — it disqualifies the wrong buyers before they waste time.

**Image:** The architecture diagram (screenshot #6) — shows the proxy position clearly.

---

### Post 5 — Post-Launch Learnings (Post on D+2 or D+3)

> **What 48 hours on Product Hunt taught us about AI agent cost governance.**
>
> We launched MeridianOS on Tuesday. It's a proxy that meters AI agent spend and enforces budgets inline — `npx meridian-gateway` in 60 seconds. Here's what we learned from the comments, the DMs, and the install data.
>
> **1. The question that resonates isn't "how much did we spend" — it's "which feature."**
> Almost every conversation started with some version of "I know my monthly bill but I have no idea what it paid for." The per-task attribution dimension is the wedge. Vendors report at the workspace/key level. Only a proxy that sees every call knows what work it was for.
>
> **2. Single-vendor teams self-disqualify — and that's fine.**
> Several people said "Anthropic's console already shows me this." And for a single-vendor, single-agent setup, they're right. The product earns its keep at vendor #2, harness #2, or the first budget you can't afford to blow through. Being honest about this in the listing saved everyone time.
>
> **3. "Is my key safe?" is the top technical question.**
> The answer — structural key custody, not aspirational — matters more than we expected. The gateway holds the real keys server-side. Agents only ever get short-lived gateway tokens. We designed it this way from day one because the alternative (keys scattered across every harness config) is the bug that bit us twice before the gateway existed.
>
> **4. Speed sells.**
> Multiple people installed it during the launch just to see if the ~110 ms boot claim was real. It was. Several stayed because the dashboard updated live while their agent was running — that moment of "the numbers are moving" converts better than any screenshot.
>
> **5. Pricing transparency matters.**
> Not marking up API spend — just charging for the orchestration layer — came up in positive comments more than any feature. Developers are tired of platforms that take a cut of their token spend without adding proportional value.
>
> **What's next:** {1–2 feature priorities based on launch feedback}.
>
> If you missed the launch: {GitHub link}. Free for one agent. npm install in 60 seconds.
>
> {PH link if still relevant}

**Why it works:** The "what we learned" format performs exceptionally well on LinkedIn. It's authentic, specific, and useful to other founders. It also extends the launch's shelf life by 2–3 days.

**Image:** A simple metric card: "{X} upvotes, {Y} comments, {Z} installs in 48 hours" — clean, no embellishment.

---

## Reddit Post

### Post 6 — r/programming or r/SaaS (Post at ~8:00 AM ET on launch day)

**Title options (pick one):**

> I built a proxy that tells you what every AI agent call actually costs — and stops it before it overspends. 907 tests, 0 failures, free for one agent.

> Show r/programming: MeridianOS — a local forward proxy that meters AI agent spend per task and enforces budgets inline. `npx meridian-gateway` in 60 seconds.

**Body:**

> I've been dogfooding my own agent harness against DeepSeek for a few months, and I realized I couldn't answer the simplest question: what did today's run cost?
>
> Not "what's our monthly bill." I wanted per feature. Per PR. Per task. No vendor console exposes that dimension — they report at the workspace/API-key level. The unit of work is invisible to them.
>
> So I built a proxy. Then a ledger. Then a budget engine. Then a scheduler that drives three different agent harnesses through a unified work loop. It's now a product.
>
> **What it does:**
> - Sits between your AI tools and any LLM provider (DeepSeek, Anthropic, OpenAI, OpenRouter)
> - Meters every call — real usage block from the provider response, not a token-counter estimate
> - Attributes cost per task/run/PR — the dimension no vendor console has
> - Enforces budgets inline: over cap → 403 before forwarding, not a report 5 minutes later
> - Holds real provider keys server-side — agents only get short-lived gateway tokens
>
> **Our own dogfood numbers (live ledger, queried today):**
> - 454 metered calls across 5 days
> - 628K tokens in, 243K tokens out
> - $0.48511722 total real cost
> - 22 calls denied at the cap
> - Feature F004: 23 calls, $0.031703, 11 denies
>
> **Stack:**
> - Node.js ≥24, SQLite (better-sqlite3), zero cloud dependencies
> - `npx meridian-gateway` boots in ~110 ms
> - 907 tests, 0 failures
> - npm: `@gravity-7/meridianos-core`
> - Source: github.com/gravity-7/meridianos-core
>
> **Pricing:**
> - Free: 1 agent, all features
> - Pro: $99/mo, 10 agents
> - Enterprise: custom
>
> You bring your own LLM keys. We don't mark up your API spend — the pricing is for orchestration.
>
> **Honest about limitations:**
> - If you're a single-vendor, single-agent shop — your provider's console already serves you well. We shine at vendor #2 or harness #2.
> - Enforcement is a trip-wire: a call already in flight completes. The *next* one is denied. This is by design — it's a budget cap, not a circuit breaker.
> - Multi-tenancy SaaS control plane doesn't exist yet. This is a local tool you run on your own machine.
>
> Happy to answer questions. AMA about building cost-governed agent infrastructure, the 403-vs-429 enforcement design, or what 454 calls to DeepSeek v4 Pro actually cost.

**Why it works:** Reddit rewards substance and honesty. The "honest about limitations" section is essential — it preempts the three most likely skeptical comments. The AMA close invites engagement. The numbers are specific and sourced.

**Subreddit recommendations:**
| Subreddit | Fit | Notes |
|---|---|---|
| `r/programming` | Best fit | Large, technical audience. Post as "I built..." not "We launched..." |
| `r/SaaS` | Good fit | Indie hackers, pricing discussion. Lead with the business angle. |
| `r/selfhosted` | Decent fit | SQLite-native, local-first resonates here. |
| `r/vscode` | Niche fit | VS Code-first is the framing. Read their self-promo rules carefully. |
| `r/ArtificialIntelligence` | Risky | Large but low signal-to-noise. May get lost. |

**Important:** Read each subreddit's rules on self-promotion before posting. Some require a minimum karma threshold or restrict product launches to specific days. r/programming is generally friendly to "I built X" posts from the builder — but "we launched Y" from a company account can get removed. Post from a personal account.

---

## Hashtag Suggestions

### Primary (use on every post)
```
#MeridianOS #AIAgents #CostGovernance #DevTools #BuildInPublic
```

### Secondary (rotate based on post content)
```
#FinOps #LLM #VS Code #OpenSource #DeveloperTools #AgentOrchestration #DeepSeek #ClaudeCode #npm
```

### Contextual (use sparingly, when relevant)
```
#ProductHunt #PHLaunch #IndieDev #SaaS #StartupLife
```

**Hashtag rules:**
- Twitter/X: 1–2 hashtags max per post. More looks desperate. Put them at the end.
- LinkedIn: 0–3 hashtags. LinkedIn now supports them but overuse reduces reach.
- Reddit: Zero hashtags. They don't work on Reddit and mark you as a marketer.
- Instagram/Threads: Not a primary channel for this product, but if used, 5–10 hashtags is normal there.

---

## Launch Week Content Calendar

| Day | Time (PT) | Platform | Content | Status |
|---|---|---|---|---|
| **Mon (D-1)** | 6:00 PM | Twitter | "Tomorrow." + screenshot of the "Your agents spent money today" terminal hook. No link yet. | Draft |
| **Tue (D-Day)** | 12:01 AM | Twitter | Post 1 — Launch announcement | Draft |
| **Tue (D-Day)** | 12:01 AM | LinkedIn | Post 4 — Professional launch narrative | Draft |
| **Tue (D-Day)** | 12:02 AM | PH | First comment — Founder's note | Draft |
| **Tue (D-Day)** | 8:00 AM | Twitter | Post 2 — Technical deep-dive | Draft |
| **Tue (D-Day)** | 8:00 AM | Reddit | Post 6 — r/programming | Draft |
| **Tue (D-Day)** | 2:00 PM | Twitter | Post 3 — Momentum / thank you | Draft |
| **Tue (D-Day)** | 4:00 PM | LinkedIn | Comment on own post: "Quick update — we're at {X} upvotes and the top question in comments is {Y}..." | Draft |
| **Wed (D+1)** | 9:00 AM | Twitter | "24 hours on PH. {metrics}. Here's what surprised us." — short thread (3–5 tweets) | Draft |
| **Wed (D+1)** | 10:00 AM | HN | Show HN post (if held back on D-Day) | Draft |
| **Thu (D+2)** | 9:00 AM | LinkedIn | Post 5 — What we learned in 48 hours | Draft |
| **Fri (D+3)** | 10:00 AM | Twitter | "One feature request we heard 8+ times during the launch: {X}. It's now on the roadmap." + link to GitHub issue | Draft |
| **Mon (D+6)** | 9:00 AM | Blog/Dev.to | Full retrospective: "Launching MeridianOS on Product Hunt — The Numbers" | Plan |
| **Ongoing** | — | All | Reply to every comment, DM, and mention within 24 hours for the full launch week | — |

---

## Do's and Don'ts

### ✅ Do
- Post from the founder's personal account, not a company account. People upvote people.
- Include a real screenshot or GIF with every post. Text-only posts underperform.
- Reply to every comment — on PH, Twitter, LinkedIn, and Reddit. Responsiveness drives the algorithms.
- Thank people publicly for sharing, upvoting, or leaving thoughtful feedback.
- Share specific, verifiable numbers. "454 calls, $0.48" is interesting. "Game-changing cost visibility" is noise.
- Be honest when someone points out a limitation. "You're right — here's where we are on that" builds more trust than deflection.
- Update the PH listing description if you catch a typo or need to clarify something — PH lets you edit after launch.

### ❌ Don't
- Don't ask for upvotes directly ("Please upvote us on Product Hunt!"). It violates PH's spirit and can get you penalized. "We're on PH today — would love your honest take" is fine.
- Don't post the exact same content across platforms. Adapt the voice and length per platform. Cross-posting verbatim is visible and lazy.
- Don't get defensive in replies. A critical PH comment is an opportunity to demonstrate how you handle feedback — future customers are watching.
- Don't make claims you can't back up with a query or a test. Engineers will check. The battle card (`docs/gtm/battle-card.md`) has the honest answers — use them.
- Don't spam unrelated communities. One Reddit post in r/programming is fine. Cross-posting to 6 subreddits is not.
- Don't go silent after D+1. The launch week is 7 days, not 24 hours. The D+2 / D+3 content often performs better than the launch day posts because the audience has context.
- Don't forget to sleep. Launch day is a marathon. Set a 2-hour alarm for comment checks overnight, but don't pull an all-nighter — you'll make worse replies at 4 AM.
