# F003 – MeridianOS Marketing Website

**Feature ID:** F003
**Area:** Marketing
**Wedge:** Governance Gateway (Wedge 1) — Surface
**Status:** Proposed (DEFERRED — execute LAST)
**Priority:** P4 — Lowest (blocked by all product features)
**Estimated Effort:** 1 day
**Assigned To:** designer (Antigravity Gemini)
**Dependencies:** F001, F002, F004, F005, F006, F007, F008, F009, F011 (all product features done)
**Blocks:** None (last feature)

---

## Business Context

### Why This Is Last
The website is a marketing surface. It should showcase a COMPLETE product with real data, real dashboards, real integrations, and real customer stories. Building it before the product is built would mean filling it with lorem ipsum and placeholder screenshots — which is dishonest and wastes effort. Build the product first, then build the website that tells its story.

### Success Criteria
1. A live static website at `meridianos.dev` (or GitHub Pages)
2. All content is backed by real product data
3. Every page has a clear CTA

---

## Functional Requirements

### FR1: Site Structure (Single Page + Sections)
- **Hero:** "Know what your AI costs. Before the money's spent." + `npx meridian-gateway` CTA
- **Problem:** "3 AI tools. 3 bills. Zero answers."
- **Solution:** Gateway → Meter → Enforce diagram
- **Demo:** Embedded video (from F009)
- **Dashboard Preview:** Animated screenshot of real dashboard (from F004)
- **Pricing:** Free / Pro ($99/mo) / Enterprise (from F005)
- **Comparison:** Summary of competitive matrix (from F008)
- **Integrations:** ADO + Slack + Jira logos (from F006, F007)
- **Dogfood Data:** "Built with MeridianOS: X features, $Y.ZZ total cost"
- **CTA:** "60 seconds to know your AI spend. `npx meridian-gateway`"
- **Footer:** GitHub, Discord, email, privacy

### FR2: No JavaScript Framework
The marketing site SHALL be:
- Static HTML + CSS only (no React, no Next.js, no build step)
- Single HTML file (or a few pages with shared CSS)
- Hostable on GitHub Pages, Vercel, or any static host
- Loads in < 1 second

### FR3: Responsive Design
- Desktop: Full layout with side-by-side elements
- Mobile: Stacked layout, readable text, tappable buttons
- No horizontal scrolling at any viewport width

---

## Technical Requirements

### TR1: Hosting
- Primary: GitHub Pages (`meridianos.dev` or `gravity-7.github.io/meridianos`)
- Fallback: Single HTML file deployable anywhere

### TR2: Analytics (Optional)
- Plausible or Fathom for privacy-respecting analytics
- No Google Analytics (privacy-conscious developer audience)

### TR3: Content Source
All text content SHALL be sourced from previously completed features:
- Tagline + description from F011 (Product Hunt)
- Dashboard screenshot from F004
- Pricing from F005
- Comparison from F008
- Demo video embed from F009
- Dogfood data from F001

---

## Acceptance Criteria

1. ✅ Site loads in < 1 second (static HTML)
2. ✅ All numbers are real (from dogfood/build data, not placeholders)
3. ✅ `npx meridian-gateway` is the primary CTA
4. ✅ Mobile layout is readable and functional
5. ✅ Site is deployed and accessible via URL

---

## AI Implementation Guidance

The `designer` agent (Antigravity Gemini) should:
1. Collect ALL content and data from previously completed features
2. Design a clean, developer-aesthetic single-page site
3. Use a dark theme with accent colors matching MeridianOS branding
4. Optimize for the "developer scanning" pattern (headlines, code blocks, numbers)

### Design Inspiration
- Linear.app (clean, dark, minimal)
- Vercel.com (developer-focused, bold typography)
- Tailwind CSS (if a CSS framework is used — keep it small)

### Do NOT
- Use a heavy framework (no React, no Next.js, no Webpack)
- Include tracking scripts that slow down the page
- Write content that isn't backed by real product data

---

*Feature spec version: 1.0 | Created: 2026-07-19 | Author: GitHub Copilot*
