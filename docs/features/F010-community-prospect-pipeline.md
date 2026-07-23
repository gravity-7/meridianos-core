# F010 – Community & Prospect Pipeline

**Feature ID:** F010
**Area:** Marketing / Sales
**Wedge:** All Wedges — Distribution
**Status:** Proposed
**Priority:** P3 — Pipeline
**Estimated Effort:** 4h (agent research) + 3h (founder outreach)
**Assigned To:** designer (Antigravity Gemini) for research + founder for execution
**Dependencies:** None (independent)
**Blocks:** Revenue generation (Month 1, Week 4)

---

## Business Context

### Problem
MeridianOS has zero prospects, zero community, zero distribution channels. The product is technically solid but invisible. The plan calls for identifying 10 prospects and creating a community where early adopters gather.

### Success Criteria
1. A list of 10 qualified prospects with contact information and personalization notes
2. Outreach templates for email, LinkedIn, and Twitter/X
3. A Discord server (or Slack community) set up and configured
4. A CRM tracker (spreadsheet or simple DB) to manage the pipeline

---

## Functional Requirements

### FR1: Prospect Research
Identify 10 prospects matching the Tier 1 ICP:
- Mid-size engineering teams (20-200 devs)
- Using multiple AI tools (Copilot + Claude + API keys)
- Growing AI spend, can't attribute cost
- Decision-maker: Engineering Manager, VP Engineering, or CTO
- Active on LinkedIn, Twitter/X, or GitHub

For each prospect, provide:
- Name, title, company
- Why they fit the ICP (specific signal)
- Contact method (LinkedIn URL, email, Twitter handle)
- Personalization angle (recent blog post, talk, tweet, or company news)
- Estimated AI spend (based on company size and public info)

### FR2: Outreach Templates
Three templates, each ≤ 150 words:

**Email template:**
"Subject: Your AI bill — do you know what each feature costs?
Hi {name},
{personalization}. I'm building MeridianOS — a proxy that sits under your AI tools and tells you exactly what each feature/pr/team spends, across Claude, Copilot, DeepSeek, all of them. Inline. Before the money's spent.
15-minute demo? I'll show you your own numbers in real time.
-{founder name}"

**LinkedIn template:**
"{personalization}. Curious — do you know what your team's AI tools cost per feature? Most eng leaders I talk to say no. Would love to show you something we built that answers that."

**Twitter/X DM template:**
"hey {name} — saw {personalization}. quick q: do you track AI spend per feature? building something for this, would love your take"

### FR3: Community Setup
A Discord server (preferred over Slack for developer communities) with:
- **#welcome** — rules, intro, what this community is about
- **#announcements** — product updates, releases
- **#ai-cost-horror-stories** — the core channel. People share AI bill surprises.
- **#meridian-os** — product discussion, feature requests, support
- **#general** — off-topic
- Roles: @founder, @early-adopter, @community
- Pinned message: "This community exists because nobody can answer: 'what did that feature cost to build with AI?'"

### FR4: CRM Pipeline Tracker
A simple CSV or JSON file tracking the pipeline:
```csv
prospect, company, role, icp_fit, contact_method, contacted_date, response, meeting_date, stage, notes
```

Stages: `identified → contacted → responded → meeting_booked → demo_done → negotiating → closed_won | closed_lost`

---

## Technical Requirements

### TR1: Agent Research
The agent SHALL use:
- LinkedIn search (public profiles, no API needed)
- GitHub search (public activity, org members)
- Twitter/X search (public posts about AI costs, Copilot, Claude Code)
- HN/Reddit search (people complaining about AI bills)

### TR2: Data Format
All outputs SHALL be in Markdown so they can be version-controlled:
- `docs/gtm/prospects.md` — prospect list
- `docs/gtm/outreach-templates.md` — templates
- `docs/gtm/pipeline.csv` — CRM tracker

### TR3: Community
Discord setup is manual (founder creates the server). The agent produces:
- Server structure document (channels, roles, permissions)
- Welcome message text
- Channel descriptions
- Pinned messages content
- Rules text

---

## Acceptance Criteria

1. ✅ 10 prospects identified with all required fields
2. ✅ Each prospect has a clear ICP signal (not random)
3. ✅ 3 outreach templates written and reviewed
4. ✅ Discord server structure documented
5. ✅ Pipeline CSV template created

---

## AI Implementation Guidance

### For the agent (Antigravity Gemini):
1. Search public sources for developers/CTOs discussing AI costs
2. Cross-reference with company size and tech stack
3. Write personalized outreach angles
4. Output structured Markdown files

### For the founder:
1. Review the prospect list — remove any that don't feel right
2. Personalize and send outreach (start with warmest contacts first)
3. Create the Discord server using the agent's structure doc
4. Update the pipeline CSV after each interaction

### Do NOT
- Scrape private data or use APIs that require auth
- Make up prospect information — only use publicly available data
- Send outreach without founder review and approval

---

*Feature spec version: 1.0 | Created: 2026-07-19 | Author: GitHub Copilot*
