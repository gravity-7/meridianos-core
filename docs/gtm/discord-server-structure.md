# Discord server structure

> Setup is manual — the founder creates the server. This document is the build sheet: channels,
> roles, permissions, and every piece of copy, ready to paste.

**Server name:** MeridianOS
**Tagline (Server Settings → Description):** *What did that feature cost to build?*

**One strategic note before you build it.** The centre of gravity here is `#ai-cost-horror-stories`,
not `#meridian-os`. A product-support server with five members reads as dead; a place where eng
leaders swap billing disasters is worth joining even for someone who never installs MeridianOS —
and those people become prospects by self-selection. **Resist the urge to make this a product
channel with a community attached.** If the vendor channel outgrows the stories channel in the first
month, something has gone wrong.

---

## Channels

| Channel | Category | Purpose | Who can post |
|---|---|---|---|
| `#welcome` | INFO | Rules, intro, what this is | @founder only (read-only) |
| `#announcements` | INFO | Releases, changelog, product updates | @founder only (read-only) |
| `#ai-cost-horror-stories` | COMMUNITY | **The core channel.** AI bill surprises | Everyone |
| `#general` | COMMUNITY | Off-topic, introductions | Everyone |
| `#meridian-os` | PRODUCT | Product discussion, feature requests, support | Everyone |

Read-only = `@everyone`: View ✅ / Send ❌ / Add Reactions ✅. Reactions stay on — a silent
announcement channel looks abandoned.

**Channel topics** (Edit Channel → Topic, 1024 char limit):

- `#welcome` — Start here. Rules, what this community is, and how to introduce yourself.
- `#announcements` — MeridianOS releases and product updates. Read-only.
- `#ai-cost-horror-stories` — Post your AI bill surprises. The overnight agent loop, the forgotten
  key, the invoice nobody could explain. Vendor-neutral — every provider welcome.
- `#general` — Off-topic, introductions, anything that doesn't fit elsewhere.
- `#meridian-os` — Questions, bugs, and feature requests for MeridianOS. Ask anything.

**Deliberately omitted:** voice channels (dead air signals a dead server), `#off-topic` as distinct
from `#general`, and per-topic channels. **Five channels is already generous for zero members.**
Split only when a channel is provably too busy to follow. Empty channels are the single most common
way a new server reads as abandoned.

---

## Roles

| Role | Colour | Who | Permissions |
|---|---|---|---|
| `@founder` | `#E67E22` | Founder + anyone with commit access | Administrator |
| `@early-adopter` | `#3498DB` | Ran MeridianOS against a real workload, or gave substantive feedback | Base + embed links, attach files, external emoji, priority speaker |
| `@community` | default | Everyone on join | View, send, react, add threads |

`@community` is the `@everyone` baseline — assign it via Server Settings → Onboarding.
`@early-adopter` is granted by hand, not claimed. **Grant it visibly** (call it out in `#general`) —
a role people can see being earned is worth having; an auto-granted one is wallpaper.

**Disable `@everyone`/`@here` for non-founder roles** before the first invite goes out. One 3am ping
from a stranger costs you members permanently.

---

## `#welcome` — pinned welcome message

> # Welcome to MeridianOS 👋
>
> This community exists because nobody can answer one question:
> **"What did that feature cost to build with AI?"**
>
> You can see your monthly Anthropic bill. You cannot see what one PR cost, what one team spent, or
> what that overnight agent run burned before someone noticed. If you're running more than one
> vendor, there's no shared view at all — every console speaks its own dialect.
>
> This server is for engineers and eng leaders dealing with that. Three things happen here:
>
> **💸 `#ai-cost-horror-stories`** — the heart of this place. Post your AI bill surprises. The
> runaway loop, the forgotten API key, the invoice nobody could explain. Vendor-neutral: Claude,
> Copilot, OpenAI, Gemini, local — all of it counts. No war story is too small or too embarrassing.
>
> **🛠️ `#meridian-os`** — the tool I'm building: a proxy that meters every AI call and attributes it
> per task and per PR, across vendors, and can stop a run at a cap inline. Questions, bugs, and
> feature requests all welcome. It's early. Say so when it breaks.
>
> **💬 `#general`** — introductions and everything else.
>
> **Introduce yourself in `#general`:** what you work on, what AI tools your team runs, and whether
> anyone there can currently answer the question at the top of this message.
>
> Read the rules below, then jump in. — {founder}

---

## Pinned messages

**`#ai-cost-horror-stories`** (pin first, before the first invite):

> **This community exists because nobody can answer: "what did that feature cost to build with AI?"**
>
> Post your horror stories here. A good one usually has:
> - **What happened** — the loop, the key, the misrouted agent
> - **What it cost** — ballpark is fine, redact whatever you need to
> - **How you found out** — the invoice? an alert? someone noticed?
> - **What you changed** — or didn't
>
> That third bullet is the interesting one. Almost everyone finds out *after*.
>
> **Vendor-neutral.** This isn't a place to dunk on providers — every one of them bills by the token
> and none of them can tell you what a feature cost. Redact employer names freely; the pattern
> matters more than the logo.

**`#meridian-os`**:

> **MeridianOS** is a proxy that sits under your AI tools: it meters every call, attributes cost per
> task and per PR across vendors, and can stop a run at a cap — inline, before the money's spent,
> not five minutes later in a report.
>
> **Where it's honest to set expectations — it's early:**
> - Real proof: a live dogfood run, 64 metered calls, costed to the cent ($0.0465), every row tagged
>   by tenant/agent/session/run.
> - The enforcement deny path is real and tested end-to-end (a capped CLI exits in <2.5s, upstream
>   never dialed) — but our surviving production ledger contains **zero deny rows**. We're not going
>   to pretend otherwise.
> - **No** multi-tenant SaaS control plane, **no** pricing, **no** SLA. Not yet.
>
> **Worth saying plainly:** if you're on a single vendor, that vendor's console probably already
> serves you — Anthropic and OpenAI both ship usage reporting and spend controls. This is built for
> people running *more than one*, or who need cost per unit of work, or who need the call stopped
> rather than reported.
>
> Bugs and feature requests here. Ask anything.

**`#announcements`** — no pin at launch. Post the first release note instead; a pinned placeholder
in an empty channel is worse than an empty channel.

---

## Rules — post in `#welcome`

> ## Rules
>
> **1. Be decent.** No harassment, bigotry, or personal attacks. Disagree with the argument.
>
> **2. No spam, no recruiting, no cold DMs.** Don't DM members to sell them things — including me.
> Sharing your own relevant project in context is fine; drive-by promo is not.
>
> **3. Redact what you need to.** Cost stories are more useful with real numbers, but never post
> anything you're not free to share — employer names, customer data, internal docs. **Never paste an
> API key, token, or credential.** If you do, rotate it immediately and ping @founder.
>
> **4. Vendor-neutral.** Every provider is welcome as a topic. Criticize pricing models, not people.
>
> **5. This is not a support desk.** MeridianOS is early and I'm one person. Ask in `#meridian-os`
> and I'll get to it — but it's a community, not an SLA.
>
> **6. Don't repost what's shared here.** Stories in `#ai-cost-horror-stories` are shared with this
> room, not with your timeline. Ask the author before quoting them anywhere else.
>
> Breaking these gets a warning, then a removal. I'd rather have a small good server than a big one.

**Rule 6 is not boilerplate.** The channel's entire value is that people feel safe naming real
numbers. One screenshotted story on X ends that permanently, and the founder is the most likely
person to be tempted — those stories are excellent marketing material. **Ask every time.**

---

## Setup checklist

- [ ] Create server, name **MeridianOS**, set description
- [ ] Create categories: INFO, COMMUNITY, PRODUCT
- [ ] Create the 5 channels; set topics; make `#welcome` + `#announcements` read-only
- [ ] Create roles `@founder`, `@early-adopter`, `@community`; set colours
- [ ] **Disable `@everyone`/`@here` for all non-founder roles**
- [ ] Community Server ON → enables Onboarding + auto-assign `@community`
- [ ] Post welcome message + rules in `#welcome`; pin both
- [ ] Pin the `#ai-cost-horror-stories` and `#meridian-os` messages
- [ ] Set verification level **Medium**; enable AutoMod defaults
- [ ] Seed `#ai-cost-horror-stories` with the founder's own story **before inviting anyone**
- [ ] Create a vanity invite link; add to README, site footer, and outreach follow-ups

**On the seed story:** post the two documented silent-fallback billing bugs from `wedge-and-icp.md`
— a harness that authenticated against the wrong endpoint, and internal model-tier calls silently
hitting paid Anthropic on a supposedly-DeepSeek session. Both are real, both are ours, both are
genuinely embarrassing. **That's why they work.** Nobody posts first in an empty channel, and a
founder who opens with their own screwup sets a permission structure that a polished launch post
cannot.

**Don't invite anyone until the seed story is up.** An empty `#ai-cost-horror-stories` teaches the
first ten visitors that this is a dead server, and you only get one first impression per person.

---

*Drafted 2026-07-21. Product claims consistent with `wedge-and-icp.md` (2026-07-19).*
