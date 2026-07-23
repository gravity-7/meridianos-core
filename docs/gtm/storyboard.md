# MeridianOS — Demo Video Storyboard

**Feature:** F009 · **Version:** 1.0 · **Written:** 2026-07-21
**7 shots · 2:00 total · screen-only, no face cam**
**Companion:** [`demo-script.md`](demo-script.md) (spoken audio + data provenance)

---

## Recording setup

| Setting | Value |
|---|---|
| Capture | OBS Studio (free), Display Capture or Window Capture |
| Resolution | 1920×1080 minimum, 30 fps |
| Terminal font | ≥ 16 pt — the `upstream=null` cell must be readable on a phone |
| Terminal theme | Dark background, high contrast. Hide the shell prompt's path if it leaks machine names |
| Browser | Full-screen, bookmarks bar hidden, one tab |
| Audio | Any USB mic. Record voice on a **separate track** from screen so you can re-do narration without re-recording the screen |
| Mouse | Only move it when the script says to. A wandering cursor reads as nervous |

**Before you hit record:** clear terminal scrollback, close Slack/mail notifications, and confirm
no API keys, `.env` contents, or gateway run tokens are visible anywhere on screen.

---

## Shot 1 — Cold terminal, the question

| | |
|---|---|
| **Duration** | 0:00 – 0:20 (20 s) |
| **Visual** | Full-screen terminal, black, empty. No prompt activity. Two lines of text fade in centered, ~3 s apart, in the terminal's own font — not a title card, not a slide |
| **On screen** | `Your agents spent money today.` <br> `Which feature was it for?` |
| **Camera/motion** | Static. Zero movement. Let it feel uncomfortable |
| **Audio** | Script §0:00–0:20 |
| **Transition out** | Hard cut on the last word |

> **How to make it:** the two lines can be literal `echo` output with `sleep` between them, or an
> overlay in OBS. `echo` is better — it keeps the whole video in one visual world.

---

## Shot 2 — The gateway boots

| | |
|---|---|
| **Duration** | 0:20 – 0:40 (20 s) |
| **Visual** | Same terminal, same position. You type the command live. The boot line appears in real time — **do not cut this** |
| **On screen** | `$ npx meridian-gateway --provider deepseek` <br> `meridian-gateway listening at http://127.0.0.1:52045` |
| **Camera/motion** | Static. Half-second of silence after the boot line before narration resumes |
| **Audio** | Script §0:20–0:40 |
| **Transition out** | Cut to split screen |

> **How to make it:** real boot measured 113 / 122 / 122 ms on 2026-07-21 (v0.3.1). The port is
> ephemeral — yours will differ from `52045`, which is fine and more credible. If you record a true
> cold `npx`, the package download comes first; adjust the narration per the script's honesty note.

---

## Shot 3 — Live metering on the dashboard

| | |
|---|---|
| **Duration** | 0:40 – 1:10 (30 s) |
| **Visual** | Split screen, 50/50. **Left:** VS Code, an agent task actively running, output scrolling. **Right:** browser at `localhost:4317`, gateway panel in view |
| **On screen** | Right pane: call count and cost tick upward *while* the left pane works. Totals visible: 454 calls · 628,208 tokens in · $0.48511722 · 22 denies |
| **Camera/motion** | Static split. **Do not move the mouse while the numbers change** — the viewer must believe the update is the system, not you |
| **Audio** | Script §0:40–1:10 |
| **Transition out** | Cut to terminal |

> **How to make it:** OBS scene with two cropped Window Captures side by side. The dashboard polls
> on its own — start the agent task ~5 s before this shot begins so numbers are already moving when
> the shot opens. Re-query live totals before recording; they grow.

---

## Shot 4 — Set the cap

| | |
|---|---|
| **Duration** | 1:10 – 1:22 (12 s) |
| **Visual** | Editor or terminal showing the policy fragment. Held still, large, ~3 s. Then cut to the task being run again |
| **On screen** | `agent_budget:` <br> `  builder:` <br> `    per_5h_tokens: 50` |
| **Camera/motion** | Optional slow zoom to the `50`. Nothing else |
| **Audio** | Script §1:10–1:40, first sentence |
| **Transition out** | Hard cut to the ledger output |

> **How to make it:** `50` is the smallest functional cap — `0` is a footgun that means "no cap."
> Revert this policy change after recording (F001 TR5).

---

## Shot 5 — The 403 deny *(the most important shot in the video)*

| | |
|---|---|
| **Duration** | 1:22 – 1:40 (18 s) |
| **Visual** | Terminal, ledger query output. Two rows, monospaced, aligned so the `upstream` column lines up vertically |
| **On screen** | `2026-07-19T18:31:27.326Z  allow  upstream=200   in=2408  out=229  $0.00124671  4353ms` <br> `2026-07-19T18:31:27.605Z  deny   upstream=null  in=null  out=null  $0.00000000     1ms  cap=5h` |
| **Camera/motion** | Zoom in on the two rows. Park the cursor on `upstream=null` and **leave it there** for the last 5 s |
| **Audio** | Script §1:10–1:40, remainder. Final four words — "It never happened" — slow |
| **Transition out** | Cut to dashboard |

> **How to make it:** these are real rows from task `F004` in the live ledger. Stronger option:
> generate a **fresh** pair on camera with `scripts/dogfood-deny-run.mjs` — it's automated,
> re-runnable, and costs well under a cent (the F001 live-DeepSeek proof totalled $0.000004).
> Either way the shape is identical: allow with a real upstream 200 and real latency, then deny with
> `upstream=null` at 1 ms. **Highlight `null` and `1ms`.** That contrast — a 4,353 ms real network
> call versus a 1 ms refusal 279 ms later — is the entire product in two rows.

---

## Shot 6 — Deny events on the dashboard

| | |
|---|---|
| **Duration** | 1:40 – 1:52 (12 s) |
| **Visual** | Browser, dashboard deny panel. The deny list populated, timestamps visible |
| **On screen** | 22 deny events, agent `builder`, `cap_window: 5h` |
| **Camera/motion** | Slow scroll down the deny list — enough to show it's a list, not a single cherry-picked row. Stop scrolling before the fade |
| **Audio** | Script §1:40–2:00, first sentence |
| **Transition out** | Slow fade to black (~0.5 s) — the only soft transition in the video |

> **How to make it:** `http://localhost:4317/api/gateway/denials` backs this panel. All 22 denies
> are agent `builder` on the `5h` window, spanning `18:31:27Z` → `18:34:35Z` on 2026-07-19.

---

## Shot 7 — End card

| | |
|---|---|
| **Duration** | 1:52 – 2:00 (8 s) |
| **Visual** | Static card on black. Wordmark, one line of positioning, one URL. No animation, no music sting |
| **On screen** | `MeridianOS` <br> `Per-feature AI cost. Enforced, not reported.` <br> `github.com/gravity-7/meridianos-core` |
| **Camera/motion** | None. Three full seconds of silence after the last spoken word |
| **Audio** | Script §1:40–2:00, remainder. Then silence |
| **Transition out** | Fade to black |

> **How to make it:** the repo is currently **private** — it returns 404 to an unauthenticated
> visitor. Before publishing, either open the repo, or replace the URL with a landing page or
> waitlist link. **Shipping a video that points at a 404 is worse than shipping no video.**

---

## Shot list summary

| # | Shot | Time | Duration |
|---|---|---|---|
| 1 | Cold terminal, the question | 0:00 | 20 s |
| 2 | `npx meridian-gateway` boots | 0:20 | 20 s |
| 3 | Split screen — agent call + dashboard updating live | 0:40 | 30 s |
| 4 | Policy cap set to 50 tokens | 1:10 | 12 s |
| 5 | **403 deny — `upstream=null`, 1 ms** | 1:22 | 18 s |
| 6 | Dashboard deny panel, 22 events | 1:40 | 12 s |
| 7 | Logo + tagline + URL | 1:52 | 8 s |
| | **Total** | | **2:00** |

## If you have to cut

Trim Shot 1 to 12 s and Shot 3 to 24 s. **Never shorten Shot 5.** It is the only footage in this
video that no competitor in [`comparison/index.md`](comparison/index.md) can produce.
