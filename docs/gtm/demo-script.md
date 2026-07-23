# MeridianOS — 2-Minute Demo Script

**Feature:** F009 · **Version:** 1.0 · **Written:** 2026-07-21
**Runtime:** 2:00 · **Format:** screen-only, no face cam
**Companion docs:** [`storyboard.md`](storyboard.md) · [`elevator-pitch.md`](elevator-pitch.md)

---

## Data provenance — read before recording

Every number spoken in this script is traceable to one of four sources. Nothing is estimated,
rounded up, or aspirational.

| # | Source | What it gives us |
|---|---|---|
| S1 | Live ledger: `c:\projects\mos-dev\.ai\gateway\ledger.db` (tenant `mos-dev`) | Totals, per-feature cost, the allow→deny pair |
| S2 | Live dashboard API: `http://localhost:4317/api/gateway/summary` | The on-screen numbers the viewer sees |
| S3 | [`comparison/index.md`](comparison/index.md) | Competitive claims + the F001 live-DeepSeek deny proof |
| S4 | Measured on this machine, 2026-07-21, `@gravity-7/meridianos-core` v0.3.1 | Gateway boot time |

**Snapshot taken 2026-07-21 (S1, full ledger):**

| Metric | Value |
|---|---|
| Metered calls | 454 |
| Window | `2026-07-16T08:00:52Z` → `2026-07-20T19:57:59Z` |
| Tokens | 628,208 in / 243,502 out |
| Total real cost | **$0.48511722** |
| Enforcement denies | **22** |
| Provider / model | `deepseek` / `deepseek-v4-pro` (single provider in this ledger) |

**Per-feature cost (S1) — the money shot:**

| Task | Calls | Real cost | Denies |
|---|---|---|---|
| `DOG-1` | 265 | $0.240551 | 0 |
| `F012` | 166 | $0.212863 | 11 |
| **`F004`** | **23** | **$0.031703** | **11** |

**Gateway boot time (S4):** three consecutive cold starts of `node gateway/cli.mjs` measured
**113 ms / 122 ms / 122 ms** to the `listening at http://127.0.0.1:…` line.

> ⚠️ **Re-query before you record.** The ledger is live and still growing. The API returned 444
> calls / $0.479225145 while the ledger held 454 / $0.48511722 — the dashboard caches. Re-run the
> queries in the "Pre-record checklist" below and update the spoken numbers to whatever is true on
> recording day. **Do not record these numbers if the screen shows different ones.**

---

## 0:00–0:20 — The Problem

**Visual:** Black terminal, nothing running. Text fades in centered, one line at a time, in the
terminal font. No animation flourish.

```
Your agents spent money today.
Which feature was it for?
```

**Audio (~45 words):**

> Your team is running AI agents now. They write code, they open pull requests, and they spend real
> money doing it. At the end of the month your provider sends you one number. It doesn't tell you
> which feature that number paid for. And it can't stop anything.

**Direction:** Flat delivery. No urgency in the voice — the numbers do the work later. Do not say a
dollar figure here; you have not earned it yet.

---

## 0:20–0:40 — The Gateway Boots

**Visual:** Same terminal. Type the command live (or paste — but let the boot line appear in real
time, uncut).

```
$ npx meridian-gateway --provider deepseek
meridian-gateway listening at http://127.0.0.1:52045
```

**Audio (~45 words):**

> This is the whole install. One proxy, in front of the agents you already run. It came up in about
> a tenth of a second — I measured a hundred and thirteen milliseconds. Your agent's base URL now
> points here instead of at the provider. That's the entire integration.

**Direction:** Let the boot line land with a half-second of silence before you keep talking. The
speed *is* the argument — do not talk over it.

> **Honesty note for the founder:** 113 ms is the *local process* boot (S4). A true cold
> `npx` also downloads the package first. If you record an actual cold `npx`, say "npx fetches the
> package, then the proxy is up in about a tenth of a second" instead.

---

## 0:40–1:10 — Live Metering

**Visual:** Split screen. Left: VS Code with an agent task running. Right: the dashboard at
`localhost:4317`, gateway panel visible. The right pane updates while the left pane works.

**On screen:** the row count and cost tick upward as calls land. Cursor idle — do not move the
mouse while numbers change.

**Audio (~72 words):**

> Every call the agent makes goes through the proxy, and every call gets written to a ledger with a
> task ID attached — before it's forwarded. So this isn't a monthly invoice. It's a queryable row
> per call. Here's our own build: four hundred fifty-four calls, six hundred twenty-eight thousand
> tokens in, and forty-eight and a half cents, exact, computed per call from the real pricing
> catalog. And because every row carries the task — feature F004 cost three cents. Twenty-three
> calls. I can show you the rows.

**Direction:** Land on "three cents" and stop. That is the line the prospect repeats to their boss.

> **Substitution table** — if the live numbers differ on recording day, swap in the fresh values:
> `454 calls` · `628,208 tokens in` · `$0.48511722` → say "forty-eight and a half cents" ·
> `F004 = $0.031703 across 23 calls` → say "three cents, twenty-three calls".

---

## 1:10–1:40 — Enforcement: the 403 Deny

**Visual:** Terminal, three beats.

1. Show the policy fragment being set (one line, held on screen for 2 s):
   ```yaml
   agent_budget:
     builder:
       per_5h_tokens: 50
   ```
2. Run the task again.
3. Cut to the ledger query output showing the real allow→deny pair (S1, task `F004`):

```
2026-07-19T18:31:27.326Z  allow  upstream=200   in=2408  out=229  $0.00124671  4353ms
2026-07-19T18:31:27.605Z  deny   upstream=null  in=null  out=null  $0.00000000     1ms  cap=5h
```

**Audio (~70 words):**

> Now I set a cap. The call at twenty-seven point three seconds was allowed — it went to the
> provider, took four and a third seconds, cost a tenth of a cent. Two hundred and seventy-nine
> milliseconds later, the next call was denied. Look at the upstream column: null. One millisecond.
> Zero dollars. It wasn't logged, it wasn't alerted on, it wasn't refunded. It never happened.

**Direction:** Point the cursor at the `upstream=null` cell and leave it there. That single word is
the product. Say the last four words slowly.

> **Honesty note — say this on camera if you are demoing to a technical buyer.** Enforcement is a
> trip-wire, not a mid-flight cutoff (S3). The call that was already in progress *completes* even
> if it pushes you over the cap; the **next** call is denied. The timestamps above show exactly
> that, which is why they are the right rows to show. Don't claim a mid-call abort — a good
> engineer will test it in ten minutes and you will lose the deal.

---

## 1:40–2:00 — The Close

**Visual:** Dashboard deny panel — 22 deny events, then cut to a clean card: wordmark, one line,
one URL.

**On screen:**
```
MeridianOS
Per-feature AI cost. Enforced, not reported.
github.com/gravity-7/meridianos-core
```

**Audio (~48 words):**

> Twenty-two calls this proxy refused to pay for. Cost visibility tools will show you that money
> after it's gone. This one doesn't forward the request. If you're running agents and you can't
> answer what a feature cost, or stop one that's overspending — it's one command, and it's
> npx meridian-gateway.

**Direction:** Hold the end card for three full seconds of silence. Resist adding anything.

---

## Claims this script deliberately does NOT make

Pulled from [`comparison/index.md`](comparison/index.md)'s "Where MeridianOS falls short." Every
one of these is a claim a prospect can disprove, so the script avoids all of them:

- ❌ **"Cross-vendor — one bill across Claude, Copilot, and DeepSeek."** Three providers are
  registered (Anthropic, DeepSeek, OpenRouter); the ledger you're showing on screen contains
  **one** (`deepseek`). Copilot is not integrated at all. The spec's draft pitch (F009 FR2) says
  this — it is not supportable, and it is cut from this script.
- ❌ **"Open source."** The core repo is verified private as of 2026-07-21. DIY genuinely beats us
  on this row. Don't claim it.
- ❌ **"Multi-tenant."** Single-tenant today; no control plane, no tenant auth, no billing.
- ❌ **"Blocks a call mid-flight."** Trip-wire only — see the honesty note at 1:10.
- ❌ **"Jira/ADO integration."** The ADO connector is an untracked, zero-test-coverage prototype.
- ❌ **"Feature F006 cost $0.47."** F009 FR3 suggests this number. It is **not in the ledger** —
  F006 has no rows. The real per-feature figures are F004/$0.031703, F012/$0.212863,
  DOG-1/$0.240551. Use those.

The two rows that *are* defensible — per-task cost attribution and inline enforcement — are the
only two this script sells. That's deliberate.

---

## Pre-record checklist

1. **Re-query the live numbers** and update every figure above that changed:
   ```bash
   curl -s http://localhost:4317/api/gateway/summary
   ```
   ```bash
   cd c:/projects/mos-dev && node -e "
   const {DatabaseSync}=require('node:sqlite');
   const db=new DatabaseSync('.ai/gateway/ledger.db',{readOnly:true});
   console.log(db.prepare(\"SELECT COUNT(*) calls, SUM(cost_usd) cost, SUM(input_tokens) inp, SUM(output_tokens) out, SUM(enforcement_decision='deny') deny FROM token_events\").get());
   for(const r of db.prepare(\"SELECT task, COUNT(*) calls, ROUND(SUM(cost_usd),6) cost FROM token_events GROUP BY task ORDER BY cost DESC\").all()) console.log(r);
   db.close();"
   ```
2. **Reproduce a deny on camera** (optional but far stronger than showing an old row) —
   `scripts/dogfood-deny-run.mjs` is automated and re-runnable, costs well under a cent, and
   produces a fresh allow+deny pair. The F001 live-DeepSeek proof (S3) ran at
   **$0.000004 total**: Turn 1 allowed 200 with 11 in / 10 out at $0.00000434; Turn 2 denied 403
   with `x-should-retry: false` and `upstream_status: null`.
3. **Scrub the terminal** — no API keys, no `.env` contents, no provider tokens in scrollback.
   `npx meridian-gateway` prints a run token; blur or regenerate it before publishing.
4. **1920×1080 minimum**, terminal font ≥ 16 pt — the `upstream=null` cell must be legible on a
   phone.
5. **Total runtime ≤ 2:00.** If you're over, cut from 0:00–0:20, never from 1:10–1:40.
