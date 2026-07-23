# Tier 1 Prospect Pipeline — targeting dossier

> **STATUS: 10 slots defined, 0 slots filled with named individuals.**
> **Read the section directly below before using this document. It is not what F010 FR1 asked for,
> and the difference is deliberate.**

---

## ⚠️ Why there are no names in this file

F010 FR1 asks for 10 named individuals with title, company, LinkedIn URL, and a personalization
angle referencing "a recent blog post, talk, tweet, or company news." The same spec says, under
**Do NOT**: *"Make up prospect information — only use publicly available data."*

Those two instructions collided, and the second one wins. Here is precisely what the research
turned up and why the first could not be satisfied honestly:

**What I could verify.** Public, citable, current artifacts about AI-spend pain at engineering
orgs — vendor pricing changes, named company-level incidents, published practitioner surveys, and
open-source cost-tracking tools with public commit history. All of it is in "Verified signal
inventory" below, with URLs.

**What I could not verify.** That a specific named human currently holds a specific title at a
specific 20–200-dev company and personally said a specific thing about AI cost. Confirming that
requires three facts to be simultaneously true and current:

1. the person exists and the role/company is accurate **today** (titles churn fast; a cold email to
   a stale title is an instant disqualification),
2. the company's engineering headcount is genuinely in the 20–200 band, and
3. the personalization hook is a real utterance by that real person, quotable back to them.

LinkedIn — the only source that reliably carries (1) — is auth-walled and not fetchable here.
Web search surfaced almost entirely **vendor content-marketing pages** (Finout, Kilo, CloudZero,
Braintrust, StackSpend, morphllm — all selling adjacent products), not identifiable practitioners.
The only individuals named anywhere in the results were Guillermo Rauch (Vercel CEO — wrong role,
wrong company size, not ICP) and an **anonymous** "CTO at a US-based company" quoted in a Pragmatic
Engineer survey.

**Why fabricating would have been worse than delivering nothing.** These are real, named, private
individuals. A plausible-looking row — right-sounding name, right-sounding title, invented tweet —
survives review precisely because it looks correct. The failure surfaces at the worst possible
moment: the founder sends "saw your post about capping Copilot spend" to someone who never wrote it.
That burns the prospect, the sender's domain reputation, and the founder's credibility, and it is
unrecoverable. A file that is visibly 60% complete costs an afternoon. A file that is invisibly 100%
false costs the top of the funnel.

**So this file is the 90% that is real**: verified signal sources, the exact queries that convert
them into names, and 10 structured slots with per-slot qualification criteria. Filling the names is
~2 hours in an authenticated LinkedIn/X session — see "How to fill a slot."

**One structural warning before you spend that time** — see "ICP disqualifier" below. It is the most
important paragraph in this document and it will cut your addressable list.

---

## ICP disqualifier — apply this before adding anyone

`wedge-and-icp.md` (verified 2026-07-19) establishes that **single-vendor shops are not the ICP.**
Anthropic and OpenAI both ship org-level usage reporting, per-workspace spend controls, and — for
Claude Code specifically — per-user monthly spend limits and per-user cost analytics. A team on one
vendor is already served by their vendor's own console.

This directly invalidates the most tempting search result. "Company X's AI bill exploded" is *not*
an ICP signal on its own. **A prospect qualifies only if at least one of these is independently
true:**

| # | Qualifier | What to look for publicly |
|---|---|---|
| Q1 | **More than one vendor in play** | Job posts naming both Anthropic and OpenAI/Gemini/DeepSeek; a repo with multiple provider SDKs; a post about routing between models |
| Q2 | **Needs cost per unit of work** (per task, per PR, per project) | Anyone asking "what did *this feature* cost" — no vendor exposes a job-level or user-defined tag dimension |
| Q3 | **Needs the call stopped, not reported** | Anyone describing a runaway loop, an overnight agent, or frustration that vendor data lags ~5 min; note OpenAI's project budget is documented as *soft* |

A prospect that satisfies none of Q1–Q3 goes in the "already served" bin, no matter how loudly they
complain about cost. **Record which qualifier fired in the `icp_fit` column of `pipeline.csv`** —
a slot without a Q-number is not qualified, it is just a lead.

---

## Verified signal inventory

Everything below was retrieved and is citable. This is the raw material personalization angles are
built from — but note the granularity: these are **events and artifacts**, and an event is only a
personalization angle once you find the *individual who reacted to it in public*.

### S1 — The Microsoft/Claude Code cancellation (highest-energy thread)

Microsoft gave thousands of engineers in its Experiences and Devices division Claude Code access in
Dec 2025; licenses were cancelled ~May 2026 on cost grounds with a migration to GitHub Copilot CLI
by 30 June. Reported per-engineer API cost: **$500–$2,000/month**. The HN thread reached **#2 with
492 points and 465 comments**.

**Why it matters more as a mining site than as a story:** that comment thread is 465 self-selected
engineers volunteering their own org's AI-cost situation in public, under durable pseudonymous-or-real
handles. This is the single densest ICP-signal source found. Mine the *comments*, not the article.

- <https://news.ycombinator.com/> (locate the thread by title; ~May–June 2026)
- <https://fortune.com/2026/05/22/microsoft-ai-cost-problem-tokens-agents/>
- <https://www.buildmvpfast.com/blog/microsoft-cancels-claude-code-licenses-ai-cost-engineer-2026>

⚠️ Microsoft itself is emphatically **not** ICP (headcount, procurement, and they are building the
competing thing). Its value is entirely as a conversation trigger and comment-thread honeypot.

### S2 — GitHub Copilot's switch to metered/credit billing (June 1, 2026)

A pricing-model change that forcibly converted a flat per-seat line item into a variable one for
every Copilot customer simultaneously. **This is the best Q1 (multi-vendor) trigger available**:
teams that had Copilot on flat-rate *and* Claude/API keys on usage now have two variable bills in
different consoles with no common denominator — exactly the gap MeridianOS fills.

- <https://www.hitechies.com/github-copilot-metered-billing-june-2026/>
- <https://blog.kilo.ai/p/the-github-copilot-bill-came-due>
- <https://www.morphllm.com/comparisons/github-copilot-vs-claude-code>

### S3 — Uber's budget exhaustion + $1,500/mo/tool cap

Uber burned its entire 2026 AI-coding-tools budget by April (four months) and capped per-employee
spend at **$1,500/month per tool**. Not ICP (far too large), but it is the most quotable
*third-party* proof that budget-then-cap is the current default failure mode — and the "per tool"
detail is a gift: a per-tool cap is precisely the control that cannot answer "what did this feature
cost across tools." Useful as a one-line opener.

### S4 — Published practitioner cost benchmarks (use for the ROI math, not for names)

- Claude Code enterprise: **~$13/dev/active day**, **$150–250/dev/month**; 90% of users under
  $30/active day — <https://getdx.com/blog/ai-coding-assistant-pricing/>
- Teams mixing inline + agentic tools: **$200–600/dev/month** all-in (same source). **This is the
  Q1 population** — "mixing inline and agentic" is multi-vendor by definition.
- Gartner projection that AI coding costs will approach developer pay —
  <https://www.techtimes.com/articles/319333/20260629/ai-coding-costs-can-drain-budget-days-gartner-predicts-they-will-match-developer-pay.htm>

**Sizing math for the `est_ai_spend` field:** `devs × $200–600/mo`. A 50-dev team ⇒ **$10k–30k/mo
($120k–360k/yr)**. That figure, not a feature list, is what earns the meeting — and it is
defensible because it is someone else's published benchmark, not ours.

### S5 — The anonymous-CTO caps quote (Pragmatic Engineer survey, ~April 2026)

> "Right now, we're not sweating the costs because we're trying to evolve best practices. But that
> has resulted in some devs really blowing through budget — so we may start instituting caps on
> spending."

Attributed only to "a CTO at a US-based company" — **not identifiable, do not attempt to guess who.**
Its value is as a *mirror*: it is almost verbatim the Q3 posture, from a peer, and works well quoted
anonymously in outreach ("a CTO in the Pragmatic Engineer survey put it as…").
<https://newsletter.pragmaticengineer.com/p/the-impact-of-ai-on-software-engineers-2026>

### S6 — Open-source AI cost-tracking tools (verified via GitHub API, 2026-07-21)

Real orgs with public commit history and public issue trackers:

| Repo | What it is | Relevance |
|---|---|---|
| [`getagentseal/codeburn`](https://github.com/getagentseal/codeburn) | Local tracker across **31 tools/agents** (Claude Code, Cursor, Codex, Gemini), by model/project/task. Created 2026-04-13, active through 2026-07-20 | Adjacent/competitive. "By project and task" is aimed at Q2 |
| [`Piebald-AI/splitrail`](https://github.com/Piebald-AI/splitrail) | Real-time multi-agent token/cost monitor (Claude Code, Codex, Copilot, Cline, +) | Adjacent/competitive |
| `ccusage`, `Claude-Code-Usage-Monitor` | Community Claude Code usage tools, cited by Faros | Read-only, single-vendor |

**These orgs are not prospects — they are the competitive set**, and they matter for two reasons.
First: their existence is proof the pain is real and people build weekend tools for it. Second, and
more important — **their stargazers and issue-filers are.** Someone who files an issue on codeburn
asking for per-project attribution across providers has publicly self-identified on Q1 *and* Q2, in
their own words, under a handle that usually links to an employer. **Highest-yield mining site
found; start here.** Read `docs/gtm/comparison/` and `battle-card.md` before any conversation where
these come up.

---

## How to fill a slot

Per slot, ~10 minutes in an authenticated browser session. Nothing here requires scraping, an API
key, or anything beyond a normal logged-in human reading public pages.

1. **Mine a source, don't search for a persona.** Open S1's HN comments or S6's issue/stargazer
   lists. Look for a *first-person* statement of cost pain — "we", "our team", "our bill."
2. **Resolve the handle to a person.** HN/GitHub profile → linked site/X/LinkedIn. If a handle
   resolves to nothing, drop it and move on; do not infer identity from writing style or
   circumstantial detail.
3. **Confirm the ICP facts.** Current title (EM / VP Eng / CTO / platform lead) and current company
   on their own profile. Headcount 20–200 devs — LinkedIn company page headcount, careers page, or
   team page. Discard anything outside the band.
4. **Apply Q1–Q3.** Write down which one fired and the evidence. No Q ⇒ not qualified (see
   disqualifier above).
5. **Capture the personalization angle verbatim.** Paste the actual sentence plus its permalink.
   If you cannot paste a real quote and a real URL, **the slot stays empty.** This is the rule that
   keeps this document honest — do not relax it under deadline pressure.
6. Fill the slot row below and the matching row in `pipeline.csv`.

**Search strings that worked** (paste into the platform's own search, logged in):

```
site:news.ycombinator.com  "our AI bill" OR "our Copilot bill" OR "token budget"
LinkedIn  "VP Engineering" AND ("AI spend" OR "token budget" OR "cost per PR")
X/Twitter "claude code" (bill OR "$" OR budget) min_faves:20 -filter:links
GitHub    is:issue "cost per" (project OR team OR PR) in:title  → codeburn / splitrail / ccusage
Reddit    r/ExperiencedDevs, r/engineeringmanagers — "AI budget", "Copilot credits"
```

**Anti-patterns — reject on sight:** anyone whose only signal is retweeting a vendor post; solo devs
and consultancies (no 20–200 band, no budget authority); the vendor-marketing authors from the
search results above (they sell a competing product); anyone whose cost pain is single-vendor and
already solved by their vendor's console (the disqualifier).

---

## Slots

Fields per FR1. `est_ai_spend` uses the S4 formula. **Do not fill a slot partially** — a half-row
reads as verified at send time, which is the exact failure this document exists to prevent.

| # | Name | Title | Company | Q (ICP signal + evidence) | Contact | Personalization (verbatim quote + permalink) | Est. AI spend | Source |
|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | — | — | — | — | S1 HN comments |
| 2 | — | — | — | — | — | — | — | S1 HN comments |
| 3 | — | — | — | — | — | — | — | S6 codeburn issues |
| 4 | — | — | — | — | — | — | — | S6 splitrail issues |
| 5 | — | — | — | — | — | — | — | S6 stargazers |
| 6 | — | — | — | — | — | — | — | S2 Copilot metering |
| 7 | — | — | — | — | — | — | — | S2 Copilot metering |
| 8 | — | — | — | — | — | — | — | X/Twitter |
| 9 | — | — | — | — | — | — | — | r/ExperiencedDevs |
| 10 | — | — | — | — | — | — | — | Warm/network intro |

**Slot 10 is deliberately reserved for a warm intro.** FR's own founder guidance says to start with
the warmest contacts, and a single intro from the existing network will almost certainly outperform
the nine cold slots combined. Fill it first.

**Sequencing note:** slots 3–5 (S6 issue-filers) are the highest-yield cold slots, because those
people wrote their pain in their own words *and* their handle usually resolves to an employer. Work
3–5 before 1–2.

---

## Honest status against F010 acceptance criteria

| # | Criterion | Status |
|---|---|---|
| 1 | 10 prospects identified with all required fields | ❌ **0/10 named.** 10 slots + qualification criteria + sourcing playbook delivered. Blocked on authenticated-session research — see top of file |
| 2 | Each prospect has a clear ICP signal | ⚠️ Enforced structurally via Q1–Q3 rather than asserted; no slot can be filled without one |
| 3 | 3 outreach templates | ✅ `outreach-templates.md` |
| 4 | Discord server structure documented | ✅ `discord-server-structure.md` |
| 5 | Pipeline CSV created | ✅ `pipeline.csv` (10 slot rows; `stage` intentionally **blank** — a slot is not `identified` until it has a real name. Set `stage=identified` as you fill each one) |

**The one thing to do next:** spend 2 hours on slots 10, then 3–5, in a logged-in browser. That
converts this from a targeting doc into the prospect list F010 actually asked for. Everything else
downstream is already built and waiting on those names.

---

*Compiled 2026-07-21. All URLs retrieved that day. Signal inventory is real and cited; every name
field is empty by design, not by omission.*
