# Outreach templates

> **Founder review required before any send** (F010: *"Do NOT send outreach without founder review
> and approval"*). These are drafts to edit, not scripts to automate.

**Placeholders:** `{name}` · `{personalization}` · `{founder}` · `{company}`

**The `{personalization}` rule.** It must be a real thing that specific person said or did, pasted
from `prospects.md`. If the slot is empty, **do not send** — a generic fill ("saw your work in the
AI space") is worse than no send: it is instantly recognizable as a mailmerge and it burns the
prospect permanently. No-send is a valid outcome.

---

## What we can and cannot claim

From `wedge-and-icp.md`, which audited every claim against the code. Violating this in outreach
creates a promise the demo cannot keep — the prospect discovers it live, on the call.

**✅ Say:**
- Exact per-call metering on live traffic — a real DeepSeek dogfood run, **64 metered calls,
  33,756 in / 36,587 out, $0.04651455**, every row carrying tenant/agent/session/run/PR-level fields.
- Cost per **unit of work** (task, PR, project) — the dimension **no vendor exposes**. This is the wedge.
- Inline enforcement: the deny path is real, runs *before* forwarding, and a real `claude` CLI past
  its cap exits non-zero in **under 2.5s**, upstream never dialed (`tests/exit-confirm-e2e.test.mjs`).
- Provider-agnostic: Claude, DeepSeek, OpenRouter, local models, one ledger.

**❌ Never say:**
- *"We caught live overspend in production."* The two silent-fallback billing bugs are real and
  documented, but were found by engineering hardening **before the gateway existed**.
- *"We've seen a live denial against paid traffic."* The surviving ledger is **64 rows, all
  `allow`, zero denies.** Process-level proof is against a stub provider.
- Any pricing, SLA, latency, or multi-tenant SaaS capability. None exist yet.
- Anything implying we beat a vendor's own console **for a single-vendor shop** — we don't, and
  that's the disqualifier, not a talking point.

---

## 1. Email — ~112 words (limit 150)

**Subject:** `What did that feature cost to build?`

> Hi {name},
>
> {personalization}
>
> Most eng leaders I ask can tell me their monthly Anthropic bill, but not what one feature, one PR,
> or one team cost — because no vendor console has that dimension. If you're running more than one
> model vendor, there's no common denominator at all.
>
> I'm building MeridianOS: a proxy under your AI tools that meters every call and attributes it per
> task and per PR, across vendors. It can also stop a run at a cap inline, not five minutes later
> in a report.
>
> Worth 15 minutes? I'll walk you through a real ledger — 64 metered calls from an autonomous run,
> costed to the cent.
>
> — {founder}

**Notes.** Subject is the Q2 question, not a pitch — it's the thing no console answers. The
"more than one model vendor" line is load-bearing: it self-selects for Q1 and lets a single-vendor
reader disqualify themselves, which saves everyone a call. Closing offers a *real artifact*, not a
slide deck. Rewrite the opener for a Q3 prospect: *"You mentioned an agent looping overnight —"*.

---

## 2. LinkedIn DM — ~77 words (limit 100)

> Hi {name} — {personalization}
>
> Quick question, since you're closer to this than most: can you tell what a single feature or PR
> costs your team in AI spend? Every eng leader I ask knows the monthly total and nothing below it.
> No vendor breaks it down per unit of work, and if you're on more than one vendor there's no shared
> view at all.
>
> Built something that does. Happy to show you — 15 min, real numbers.

**Notes.** LinkedIn rewards a question over a pitch. "Since you're closer to this than most" is only
honest if `{personalization}` earns it — cut the line if the hook is thin. Connection request should
carry the `{personalization}` sentence alone; save the ask for after they accept.

---

## 3. X/Twitter DM — ~49 words (limit 80)

> hey {name} — {personalization}
>
> genuine q: can you see what a single PR costs your team in AI spend? nobody I ask can — vendors
> only break down by key/model, never per unit of work.
>
> built a proxy that does it across vendors. want to see a real ledger?

**Notes.** Lowercase, no links in the first message (links tank DM deliverability and read as spam).
One question, one offer. If they reply, *then* send the artifact.

---

## Sequencing

1. **Warm intros first** — slot 10 in `prospects.md`. One intro beats the nine cold slots combined.
2. **One channel per prospect.** Simultaneous email + LinkedIn + X reads as automation. Pick the
   platform where the personalization hook actually lives.
3. **One follow-up, maximum**, 5–7 days later, with something *new* — a link to the ledger walkthrough
   or `battle-card.md`. Never "just bumping this."
4. **Log every touch** in `pipeline.csv` (`contacted_date`, `response`, `stage`) on the same day.
5. **Two replies asking the same unexpected question = a real signal.** Bring it back to
   `wedge-and-icp.md`, whose ICP section is explicitly marked as needing validation from exactly
   these conversations. These first ten calls are research as much as sales — the doc says so.

---

*Drafted 2026-07-21. Claims audited against `wedge-and-icp.md` (2026-07-19). Founder review required
before first send.*
