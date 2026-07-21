# MeridianOS — 60-Second Elevator Pitch

**Feature:** F009 · **Version:** 1.0 · **Written:** 2026-07-21
**Length:** 151 words · ~58 seconds at conversational pace (155 wpm)

---

## The pitch

> Every engineering team is running AI agents now, and none of them can tell you what a single
> feature cost to build. The provider invoice is one number at the end of the month. It doesn't say
> which feature, and it can't stop anything. MeridianOS is one proxy that sits underneath the
> agents you already run. Every call gets metered to a task ID *before* it's forwarded — so cost
> stops being an invoice and becomes a queryable row. And if that task is over budget, the proxy
> returns a 403 and never dials the provider. Here's our own build ledger: four hundred fifty-four
> real calls, forty-eight cents, and twenty-two calls we refused to pay for. Feature F004 cost
> three cents across twenty-three calls — I can show you the row. It's `npx meridian-gateway`, it
> boots in a tenth of a second, and it's one line of config.

---

## Delivery notes

- **Pause after "it can't stop anything."** That's the turn — everything before it is the problem,
  everything after is the product.
- **The three numbers are the whole pitch.** If you're cut off early, "four hundred fifty-four
  calls, forty-eight cents, twenty-two denied" is the version that survives. Memorize those three
  in that order.
- **"I can show you the row"** is the ask. It invites the laptop to open. Land it and stop talking.
- **Don't accelerate at the end.** The last sentence is the close, not a disclaimer.

## Where each number comes from

All figures queried 2026-07-21 from the live `mos-dev` gateway ledger
(`c:\projects\mos-dev\.ai\gateway\ledger.db`) — see [`demo-script.md`](demo-script.md) for the full
provenance table and the re-query commands.

| Spoken | Actual | Source |
|---|---|---|
| "four hundred fifty-four real calls" | 454 metered calls | ledger totals |
| "forty-eight cents" | $0.48511722 | ledger totals |
| "twenty-two calls we refused to pay for" | 22 rows, `enforcement_decision = 'deny'` | ledger totals |
| "F004 cost three cents across twenty-three calls" | $0.031703 / 23 calls | ledger, grouped by task |
| "boots in a tenth of a second" | 113 / 122 / 122 ms, measured | v0.3.1 cold starts, 2026-07-21 |

**Re-query before you use this in the field.** The ledger is live and growing; these numbers are a
2026-07-21 snapshot.

## What this pitch deliberately leaves out

It sells only the two capabilities that survive scrutiny per
[`comparison/index.md`](comparison/index.md): **per-task cost attribution** and **inline
enforcement**. It does *not* claim cross-vendor aggregation (the ledger shown holds one provider,
`deepseek`), open source (repo is private), multi-tenancy, or Jira/ADO integration. If asked about
any of those, the honest answer is short and you should give it — the comparison doc has the
wording.

One nuance worth volunteering to a technical listener: enforcement is a **trip-wire**. A call
already in flight completes; the *next* one is denied. Say it before they find it.
