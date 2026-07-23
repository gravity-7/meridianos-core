# MeridianOS — Product Hunt Launch Checklist

**Feature:** F011 · **Version:** 1.0 · **Written:** 2026-07-21
**Launch window:** TBD (recommend Tuesday–Thursday, 12:01 AM PT)

---

## Pre-Launch: 7 Days Before (D-7)

### Product Readiness
- [ ] Re-query live ledger totals and update all spoken/written numbers (calls, cost, denies, per-feature breakdowns)
- [ ] Measure gateway cold-boot time on a clean machine (3 consecutive runs, report median)
- [ ] Run full test suite (`npm test`), confirm 0 failures
- [ ] Verify `npm install @gravity-7/meridianos-core` works on a clean Node.js ≥24 install (Windows, macOS, Linux)
- [ ] Confirm `npx meridian-gateway --provider deepseek` boots without errors on all three platforms
- [ ] Verify the dashboard loads at `localhost:4317` with live data
- [ ] Tag and push the launch release (`v0.4.0` or launch version) to npm + GitHub
- [ ] Update README.md if any features/docs have changed since last release
- [ ] Confirm `docs/PRICING.md` matches the listing and is publicly accessible

### Listing Preparation
- [ ] Finalize Product Hunt tagline (pick from alternates in `product-hunt-listing.md`)
- [ ] Finalize short description (≤ 260 chars)
- [ ] Finalize full description markdown, proofread for typos
- [ ] Create all 5–7 screenshots (see `product-hunt-listing.md` § Screenshot Ideas)
  - [ ] Shot 1: terminal with "Your agents spent money today. Which feature was it for?"
  - [ ] Shot 2: gateway boot (`npx meridian-gateway`)
  - [ ] Shot 3: live dashboard split-screen
  - [ ] Shot 4: ledger per-feature cost query result
  - [ ] Shot 5: 403 deny response body
  - [ ] Shot 6: architecture diagram (optional)
  - [ ] Shot 7: full dashboard (optional)
- [ ] Record and export the 2-minute demo video per `demo-script.md` + `storyboard.md`
- [ ] Upload video to YouTube (unlisted) or Loom — embed in listing or first comment
- [ ] Create a MeridianOS logo/icon (if not already done) — 240×240 px minimum for PH thumbnail
- [ ] Fill in maker profile: avatar, name, headline, Twitter/GitHub linked, website
- [ ] Draft first comment (use `product-hunt-listing.md` § First Comment Draft, customize)
- [ ] Prepare a "thank you" reply template for commenters (genuine, not copy-paste — just a framework)

### Community & Outreach
- [ ] **Get 50+ PH users to "follow" the maker/profile before launch.** PH algorithm weights followers in the first hour. Target: existing users, friends, early testers, Twitter followers.
- [ ] Identify 5–10 PH power users / influencers in Developer Tools and AI categories. DM or email each one *personally* (use `outreach-templates.md` for tone, customize per person).
- [ ] Post a "launching soon" teaser on Twitter/X — no date, just "we're putting MeridianOS on Product Hunt. here's why →" with a screenshot or the two-line terminal hook.
- [ ] Post a "launching soon" on LinkedIn — professional angle: "We built cost governance for AI agents. Product Hunt launch next week. Here's the one number that made us ship."
- [ ] DM 5–10 existing users / early testers. Ask: "Would you upvote us on PH and leave an honest comment about your experience?" Do not ask for positive reviews — ask for honest ones.
- [ ] Prepare a short "how to support us" message for DMs: direct PH link + "upvote and comment with your real experience" — make it easy for people to act.
- [ ] Find and join 2–3 relevant Slack/Discord communities (Developer Tools, AI Engineering, indie dev) where launch posts are allowed. Read their self-promo rules first.
- [ ] Identify 3–5 relevant subreddits (r/programming, r/SaaS, r/selfhosted, r/vscode) and note each sub's rules on product launches. Draft posts per `social-kit.md`.
- [ ] Prepare a Hacker News "Show HN" draft — not for PH day, but for the day after if PH goes well (HN and PH audiences overlap; staging them avoids dilution).

### Technical Readiness
- [ ] Ensure the gateway demo environment is stable and won't crash during a live demo
- [ ] Have a backup demo environment ready (local or second machine)
- [ ] Prepare a "quick start" gist or one-liner that works with zero config: `npx meridian-gateway --provider deepseek --model deepseek-v4-flash`
- [ ] Test the install → boot → meter → deny flow end-to-end in under 2 minutes (the demo path)
- [ ] Confirm the npm package page looks professional (README renders, version is correct, install command works)
- [ ] Confirm GitHub repo README is the best landing page it can be — many PH visitors will click through to GitHub

---

## Launch Day: Hour-by-Hour

**Schedule assumes 12:01 AM PT launch.** Adjust times to your local zone. PH's first 4 hours are critical — the algorithm heavily weights early velocity.

### 12:01 AM PT — LAUNCH
- [ ] Product Hunt listing goes live (PH lets you schedule this)
- [ ] **IMMEDIATELY** paste the first comment (within 60 seconds of launch — it's visible above the fold)
- [ ] Send the PH link to your "launch support" DM list: "We're live on Product Hunt. If MeridianOS has been useful to you, an upvote and honest comment would mean the world. [link]"
- [ ] Post the Twitter/X announcement (see `social-kit.md` § Post 1)
- [ ] Post the LinkedIn announcement (see `social-kit.md` § Post 4)
- [ ] Share in any Slack/Discord communities that permit launch announcements

### 12:30 AM – 2:00 AM PT (First 2 Hours)
- [ ] Monitor PH comments continuously. **Reply to every comment within 15 minutes.** PH rewards responsiveness.
- [ ] Check that the website/GitHub/demo links in the listing all resolve correctly
- [ ] Watch the dashboard for any spike in gateway usage (curious devs testing it live)
- [ ] DM any PH power users who haven't engaged yet — a gentle nudge: "We just launched — would love your take."

### 2:00 AM – 6:00 AM PT (Overnight — US West Coast sleeping, Europe waking up)
- [ ] If you're sleeping, have a co-founder or teammate cover this window. PH is global — European traffic matters.
- [ ] If solo, set a 2-hour alarm to check comments. Better to be tired for one day than miss the launch window.
- [ ] Reply to any overnight comments. Europeans will have questions — be there to answer them.

### 6:00 AM – 9:00 AM PT (US East Coast Wakes Up)
- [ ] Second wave of social posts (see `social-kit.md` § Post 2 — technical deep-dive). Catch the morning-scroll audience.
- [ ] Post the Reddit thread (see `social-kit.md` § Post 6) — time it for ~8:00 AM ET when r/programming is most active.
- [ ] Engage with any Twitter/LinkedIn replies. Quote-tweet positive reactions.
- [ ] Check Hacker News for any organic mentions. If none, consider posting Show HN (but only if PH is already performing well — don't split votes).

### 9:00 AM – 12:00 PM PT (Peak US Traffic)
- [ ] This is the highest-traffic window on PH. Be fully present. Reply to comments within 5–10 minutes.
- [ ] If the demo video is gaining traction, pin a comment linking to it.
- [ ] Share any early metrics that look good: "Top 5 on PH right now" or "100 upvotes in the first 4 hours" — social proof drives more votes.
- [ ] Engage with any critical or skeptical comments honestly. Do not get defensive. The battle card (`docs/gtm/battle-card.md`) has honest answers to common objections — use them.

### 12:00 PM – 4:00 PM PT (Afternoon)
- [ ] Third social wave: the "wow, this is happening" post (see `social-kit.md` § Post 3 — momentum/thank-you).
- [ ] If ranking in PH top 5, start reaching out to tech journalists / newsletters that cover devtools (TLDR, Changelog, Console.dev, Pragmatic Engineer). A "Top 3 on Product Hunt" subject line opens inboxes.
- [ ] Monitor GitHub stars, npm downloads, and dashboard signups. These are the real metrics — PH upvotes are vanity, installs are value.

### 4:00 PM – 11:59 PM PT (Evening Wrap)
- [ ] Reply to any remaining comments. Leave nothing unanswered.
- [ ] Post a "closing the day" update on Twitter/LinkedIn — thank the community, share the day's numbers.
- [ ] Screenshot everything: final PH ranking, upvote count, comment count, GitHub star count, npm download count. You'll want these for the post-launch retrospective.
- [ ] Note every bug report, feature request, and piece of feedback from PH comments. These are gold — triage them into GitHub issues within 48 hours.

---

## Post-Launch: D+1 to D+7

### D+1 (Day After)
- [ ] Post the Hacker News "Show HN" if you held it back on launch day
- [ ] Send personal thank-you DMs to everyone who left a thoughtful PH comment
- [ ] Write a "what we learned launching on Product Hunt" Twitter thread — transparent numbers, what worked, what didn't
- [ ] Triage all PH feedback into GitHub issues (label: `feedback/ph-launch`)
- [ ] Respond to any GitHub issues or discussions that spun off from the launch

### D+2 to D+3
- [ ] Send follow-up emails to any journalists / newsletter authors you reached out to on launch day
- [ ] Post the second LinkedIn piece (see `social-kit.md` § Post 5) — the "what we learned" angle
- [ ] Write a blog post: "Launching MeridianOS on Product Hunt — The Numbers" (transparent retrospective, good for SEO and future launches)
- [ ] Add PH badge/rating to the GitHub README and website
- [ ] Review npm download trends — did the launch convert to actual installs?

### D+4 to D+7
- [ ] Cross-post the retrospective to dev.to, Hashnode, Medium
- [ ] Engage with any Reddit threads still active
- [ ] Plan the next feature release based on launch feedback — prioritize the most-requested capability
- [ ] Schedule a team retro: what went well, what to improve for the next launch
- [ ] Update `docs/gtm/prospects.md` with any new leads generated from PH visibility
- [ ] Archive all launch assets (screenshots, metrics, social post analytics) in `docs/gtm/launch-archive/`

---

## Key Metrics to Track

### Launch Day (hourly)
| Metric | Source | Target |
|---|---|---|
| PH upvotes | Product Hunt dashboard | Top 5 of the day |
| PH comments | Product Hunt dashboard | ≥ 30 (quality > quantity) |
| PH ranking | Product Hunt / PH API | #1–#3 in Developer Tools |
| Twitter impressions | Twitter Analytics | ≥ 10K on launch post |
| Twitter engagement (likes + RTs + replies) | Twitter Analytics | ≥ 200 |
| LinkedIn impressions | LinkedIn Analytics | ≥ 5K |
| GitHub stars | GitHub repo | +50 on launch day |
| npm downloads | npmjs.com package page | +100 on launch day |
| Website / docs traffic | Analytics (if set up) | ≥ 500 uniques |

### Launch Week (D+1 to D+7)
| Metric | Source | Target |
|---|---|---|
| npm downloads (weekly) | npmjs.com | ≥ 500 |
| GitHub stars (cumulative) | GitHub repo | ≥ 150 |
| New GitHub issues (feedback) | GitHub issues | Any — triage all |
| Gateway installs (if telemetry exists) | Ledger / telemetry | ≥ 20 active installs |
| Newsletter signups (if exists) | Email platform | Any |
| Twitter followers gained | Twitter Analytics | +50 |
| Backlinks / press mentions | Google Alerts / manual | ≥ 2 |

### Long-Term (30 days)
| Metric | Source | Target |
|---|---|---|
| npm downloads (monthly) | npmjs.com | ≥ 1,000 |
| GitHub stars | GitHub repo | ≥ 300 |
| Active gateway installs (30-day retention) | Telemetry | ≥ 10 |
| Pro tier conversions | Payment processor | ≥ 3 |
| Community contributions (PRs, issues) | GitHub | ≥ 5 |

---

## Emergency Contacts & Quick Reference

| What | Where / Who |
|---|---|
| PH support / listing issues | `producthunt.com/contact` |
| npm package page | `npmjs.com/package/@gravity-7/meridianos-core` |
| GitHub repo | `github.com/gravity-7/meridianos-core` |
| Demo video (YouTube/Loom) | `{link}` |
| Live ledger queries | `docs/gtm/demo-script.md` § "Pre-record checklist" |
| Competitive claims reference | `docs/gtm/comparison/matrix.json` |
| Honest-answers-to-objections | `docs/gtm/battle-card.md` § "Competitive reality" |
| Outreach templates | `docs/gtm/outreach-templates.md` |

---

## Final Pre-Flight (30 Min Before Launch)

Run through this in the last 30 minutes before go-live. If anything fails, delay the launch — a broken listing is worse than a late one.

- [ ] All links in the PH listing resolve (200 OK, no redirect chains)
- [ ] `npm install @gravity-7/meridianos-core` succeeds on a clean machine
- [ ] `npx meridian-gateway --provider deepseek` boots and meters a call
- [ ] Dashboard loads at `localhost:4317`
- [ ] Demo video plays with audio (test on mobile too)
- [ ] Screenshots are the correct dimensions and readable on mobile
- [ ] First comment is drafted in a text editor, ready to copy-paste instantly
- [ ] Twitter, LinkedIn, Reddit posts are drafted and ready to publish
- [ ] DM list is loaded — know exactly who you're messaging at T+0
- [ ] Phone is charged and notifications are ON for PH comment alerts
- [ ] Coffee is made. Let's go.
