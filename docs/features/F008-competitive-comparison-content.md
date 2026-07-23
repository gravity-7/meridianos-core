# F008 – Competitive Comparison & Content Pages

**Feature ID:** F008
**Area:** Marketing
**Wedge:** Governance Gateway (Wedge 1) — Positioning
**Status:** Proposed
**Priority:** P2 — Sales Enablement
**Estimated Effort:** 1 day
**Assigned To:** docs-writer (Antigravity Gemini via OAuth)
**Dependencies:** F001 (dogfood data for credibility)
**Blocks:** F011 (Product Hunt needs positioning)

---

## Business Context

### Problem
Prospects evaluating MeridianOS will compare it against CloudZero, Vantage, Jira Agents, and DIY solutions. Without a clear, honest, data-backed comparison, the default assumption is "the vendor's own dashboard does this already." The competitive reality section in `battle-card.md` must be transformed into public-facing content that proves — with citations — where MeridianOS wins and where it doesn't.

### Success Criteria
1. A live comparison page at the marketing site showing MeridianOS vs 5 competitors
2. Every claim is backed by a citation to public docs (URL + date verified)
3. The comparison is honest — it acknowledges where competitors are stronger
4. Uses REAL dogfood data from F001 (cost per feature, deny evidence)

---

## Functional Requirements

### FR1: Comparison Matrix
A page comparing MeridianOS against 5 competitors across 8 dimensions:

| Dimension | CloudZero | Vantage | Jira Agents | Anthropic Console | DIY | MeridianOS |
|---|---|---|---|---|---|---|
| Cross-vendor aggregation | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ |
| Per-task cost attribution | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Inline enforcement | ❌ | ❌ | ❌ | ⚠️ soft | ❌ | ✅ |
| Agent orchestration | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ |
| Model routing (cost opt) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Multi-tool integration | ❌ | ❌ | ❌ (Jira-only) | ❌ | ✅ | ✅ |
| Real-time vs delayed | 5min delay | 5min delay | N/A | 5min delay | N/A | Real-time |
| Open source core | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |

### FR2: Citations
Every "❌" or "✅" in the matrix SHALL be backed by a footnote with:
- Source URL
- Date verified
- Direct quote or API documentation reference

### FR3: Honest Limitations Section
The comparison SHALL include "Where MeridianOS falls short":
- Single-tenant today (no multi-tenant SaaS)
- 3 providers pre-configured (not "any vendor")
- No cross-wire translation
- Smaller team, less funding than competitors

### FR4: Real Data Integration
Where possible, use real dogfood data:
- "64 calls metered, $0.047 total cost" (from F001 dogfood)
- "1 deny proven against live DeepSeek traffic" (from F001)
- "Cost per feature: $X.XX" (from mos-dev self-build)

---

## Technical Requirements

### TR1: Static Page
The comparison page SHALL be a static HTML page served by the dashboard server or marketing site. No backend required beyond serving the file.

### TR2: Data-Driven
The comparison matrix SHALL be defined as JSON data so it can be reused across pages and kept in sync:
```json
{
  "dimensions": [...],
  "competitors": [...],
  "meridianos": {...},
  "lastVerified": "2026-07-19",
  "sources": {...}
}
```

### TR3: Markdown Source
The content SHALL be authored in Markdown and rendered to HTML. This allows:
- Easy editing (no HTML in raw form)
- Version control (changes tracked in git)
- Agent authoring (AI can write Markdown naturally)

---

## Acceptance Criteria

1. ✅ Comparison matrix covers 5 competitors × 8 dimensions
2. ✅ Every claim has a footnote citation with URL and date
3. ✅ "Where MeridianOS falls short" section is prominent (not buried)
4. ✅ Page uses real dogfood data where applicable
5. ✅ Page loads in < 2 seconds (static, no API calls)

---

## AI Implementation Guidance

The `docs-writer` agent (Antigravity Gemini) should:
1. Research each competitor's CURRENT capabilities (read their docs live)
2. Write the comparison matrix as JSON data
3. Write the Markdown content with citations
4. Create the HTML rendering
5. Place files in `docs/gtm/comparison/`

---

*Feature spec version: 1.0 | Created: 2026-07-19 | Author: GitHub Copilot*
