# F009 – Demo Video & Pitch Production

**Feature ID:** F009
**Area:** Marketing
**Wedge:** All Wedges — Sales Enablement
**Status:** Proposed
**Priority:** P3 — Marketing
**Estimated Effort:** 4h (agent) + 2h (founder recording)
**Assigned To:** designer (Antigravity Gemini) for script + founder for recording
**Dependencies:** F001 (deny artifact), F002 (gateway published), F004 (dashboard with real data)
**Blocks:** F011 (Product Hunt)

---

## Business Context

### Problem
Text documentation and specs don't sell products. A 2-minute video showing the gateway in action — metering a real call, denying an over-cap call, showing the dashboard — converts prospects faster than any document. The video needs a tight script, professional structure, and real data.

### Success Criteria
1. A script/storyboard for a 2-minute demo video
2. A 60-second verbal elevator pitch
3. Both reference real dogfood data (the deny artifact, dashboard data, cost-per-feature numbers)

---

## Functional Requirements

### FR1: 2-Minute Demo Script
Structure:
- **0:00-0:20** — The problem: "Your AI bill is growing. You don't know what it costs per feature. Nobody does."
- **0:20-0:40** — The gateway: `npx meridian-gateway` — boots in 2 seconds
- **0:40-1:10** — Live demo: point VS Code at the gateway, make a call, show the dashboard update in real-time with exact token count and USD cost
- **1:10-1:40** — Enforcement: set a cap, make another call, show the 403 deny. "Not a dashboard. Not a report. The call never happened."
- **1:40-2:00** — The multi-wedge pitch: cross-vendor, per-feature cost, model routing. Call to action.

### FR2: 60-Second Elevator Pitch
"Your engineering team uses 3 different AI tools. Claude for code. Copilot for boilerplate. DeepSeek for bulk work. Each vendor tells you THEIR part of the bill. Nobody adds them up. Nobody tells you what feature X cost to build. And nobody stops the overspend before it happens. MeridianOS is one proxy that sits under all of them — one bill, per feature, capped before you blow the budget. `npx meridian-gateway`. 60 seconds. That's it."

### FR3: Real Data Integration
- Show the actual ledger row from F001 (deny event with real timestamps)
- Show the dashboard with real mos-dev build data
- Quote real cost-per-feature numbers: "Feature F006 cost $0.47 to implement"

### FR4: Storyboard
A visual storyboard (text descriptions of each shot) for the founder to follow during recording:
```
Shot 1: Terminal — npx meridian-gateway boots (5s)
Shot 2: VS Code — agent makes a call (10s)
Shot 3: Dashboard — spend updates live (10s)
Shot 4: Terminal — set cap, make call, see 403 deny (15s)
Shot 5: Dashboard — deny event appears (5s)
Shot 6: Split screen — gateway + dashboard + agent (15s)
Shot 7: Logo + tagline + URL (5s)
```

---

## Technical Requirements

### TR1: Script Format
Script SHALL be written in Markdown with timing annotations:
```markdown
## 0:00-0:20 — The Problem
**Visual:** Terminal with growing AI bill numbers
**Audio:** "You're spending $40,000 a month on AI tools..."
```

### TR2: Recording Setup
Recommended recording setup (included in the spec for the founder):
- Screen recording: OBS Studio (free) or OS-native
- Microphone: Any USB mic (even headset is fine for v0.1)
- Resolution: 1920×1080 minimum
- No face cam needed (screen-only demo is more focused)

### TR3: Hosting
Video SHALL be hosted on:
- YouTube (unlisted or public)
- Embedded on the marketing site (F003, deferred)
- Linked from Product Hunt listing (F011)

---

## Acceptance Criteria

1. ✅ Script covers all 5 sections with timing
2. ✅ Elevator pitch is ≤ 60 seconds when read aloud
3. ✅ Both reference real dogfood data (not placeholder numbers)
4. ✅ Storyboard has visual descriptions for each shot
5. ✅ Script is clear enough that someone unfamiliar with MeridianOS can follow

---

## AI Implementation Guidance

The `designer` agent (Antigravity Gemini) should:
1. Read the dogfood data from F001, the dashboard from F004, and the competitive content from F008
2. Write the video script with timing, visuals, and audio cues
3. Write the 60-second pitch
4. Create the text storyboard
5. Output all three as `docs/gtm/demo-script.md`

### Do NOT
- Use placeholder numbers — cite real data only
- Make the script > 2 minutes (prospects lose attention)
- Use jargon without explaining it

---

*Feature spec version: 1.0 | Created: 2026-07-19 | Author: GitHub Copilot*
