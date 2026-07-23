# F011 – Product Hunt Launch Package

**Feature ID:** F011
**Area:** Marketing
**Wedge:** Governance Gateway (Wedge 1) — Launch
**Status:** Proposed
**Priority:** P3 — Launch
**Estimated Effort:** 4h
**Assigned To:** designer (Antigravity Gemini)
**Dependencies:** F003 (website), F009 (demo video), F008 (comparison pages)
**Blocks:** Launch event

---

## Business Context

### Problem
Product Hunt is the #1 launch platform for developer tools. A well-executed launch brings: early adopters, feedback, backlinks, social proof, and often the first paying customers. The launch package needs to be ready before Week 4 Day 28.

### Success Criteria
1. All Product Hunt listing assets prepared: tagline, description, images, first comment
2. Launch-day runbook: timeline of actions from midnight to end-of-day
3. Social media promotion copy for Twitter/X, LinkedIn, Reddit, HN
4. Maker profile ready

---

## Functional Requirements

### FR1: Product Hunt Listing
- **Name:** MeridianOS Gateway
- **Tagline:** "Know what your AI costs — before the money's spent. One proxy. All vendors."
- **Description:** 2-3 paragraphs covering: the problem (AI spend is invisible), the solution (inline metering + enforcement across vendors), the proof (real dogfood data: $0.047 for 64 calls, live deny evidence), the tech (60-second `npx meridian-gateway` install)
- **Topics:** Developer Tools, AI, DevOps, Open Source, Analytics
- **Gallery:** 3-5 images (gateway terminal screenshot, dashboard, deny event, architecture diagram)

### FR2: First Comment (Maker Comment)
The founder's first comment (crucial for PH success):
"Hey Product Hunt! I built MeridianOS because I was running 3 different AI tools (Claude, Copilot, DeepSeek) and couldn't answer a simple question: 'what did that feature cost?' Not per-month. Per-feature. Per-PR. Per-task.

So I built a proxy that sits underneath all of them. It meters every call in real-time, adds up the bill across vendors, and — crucially — says NO before you blow the budget.

The numbers from our own dogfood: 64 autonomous agent calls, $0.047 total, 1 enforced deny. We're building MeridianOS WITH MeridianOS. The dashboard you see is showing real build costs.

Happy to answer any questions about the tech, the market, or why I think AI cost governance needs to be inline, not after-the-fact.

- [founder name]"

### FR3: Launch Day Runbook
Hour-by-hour schedule:
```
00:01 — Post goes live. Upvote. Post first comment.
00:15 — Share on Twitter/X with Product Hunt link
00:30 — Share on LinkedIn with personal story
01:00 — Share on relevant Reddit communities (r/programming, r/devops, r/selfhosted)
02:00 — Share on Hacker News (Show HN format)
06:00 — Check PH comments, respond to every one
08:00 — Share on Discord/Slack communities (F010)
12:00 — Mid-day engagement push (reply, upvote others)
18:00 — Share update with ranking/milestone if notable
23:00 — Final check, respond to remaining comments
Day+1 — Thank-you post with stats
```

### FR4: Social Media Copy
Pre-written copy for each platform:
- **Twitter/X:** 3 tweets (launch announcement, technical deep-dive, results)
- **LinkedIn:** 1 long-form post (the story of why you built it)
- **Reddit:** 2 posts (r/programming "Show HN" style, r/selfhosted technical)
- **HN:** 1 Show HN post
- **Discord/Slack:** 1 announcement for the community (F010)

### FR5: Image Assets
- **Logo:** 240×240px (already exists in the repo — use MeridianOS branding)
- **Gallery image 1:** Terminal showing `npx meridian-gateway` booting
- **Gallery image 2:** Dashboard showing real spend data
- **Gallery image 3:** Deny event in the ledger
- **Gallery image 4:** Architecture diagram (gateway → providers)
- **Thumbnail:** Eye-catching, shows the core value prop in one image

---

## Technical Requirements

### TR1: All content SHALL be in Markdown
- `docs/gtm/product-hunt/listing.md` — tagline, description, topics, gallery captions
- `docs/gtm/product-hunt/first-comment.md` — maker comment
- `docs/gtm/product-hunt/runbook.md` — launch day runbook
- `docs/gtm/product-hunt/social-copy.md` — all social media posts
- `docs/gtm/product-hunt/assets/` — image assets

### TR2: Real Data Requirement
Every number in the listing and first comment SHALL come from real dogfood data. No placeholders, no estimates, no "we expect to..."

---

## Acceptance Criteria

1. ✅ All PH listing text written, reviewed, and ready to paste
2. ✅ First comment is personal, honest, and cites real data
3. ✅ Runbook covers every platform + time zone consideration
4. ✅ Social copy is written for all 5 platforms
5. ✅ Gallery images are ready (or descriptions are clear enough to screenshot)
6. ✅ Maker profile on PH is set up and verified

---

## AI Implementation Guidance

The `designer` agent (Antigravity Gemini) should:
1. Read ALL previous feature outputs for real data (F001 deny, F004 dashboard, F006-F007 integrations, F008 comparisons)
2. Write the listing in the tone of a technical founder (not marketing-speak)
3. Generate the runbook as an actionable checklist
4. Create social copy that matches each platform's culture

### Do NOT
- Use hype words ("revolutionary", "game-changing", "world's first")
- Make claims not backed by dogfood data
- Schedule posts at times the founder isn't awake

---

*Feature spec version: 1.0 | Created: 2026-07-19 | Author: GitHub Copilot*
