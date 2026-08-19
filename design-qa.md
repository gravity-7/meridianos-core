# Spec 017 visual QA

**source visual truth path**: user-provided Grafana reference attachments in the conversation (no local source path was supplied)

**implementation screenshot path**: not-created; the project capture policy keeps screenshots/recordings/client-facing assets `not-created` by default. The implementation was exercised in headed Chrome by `browser-tests/dashboard-visual-reference.spec.mjs` and `browser-tests/dashboard-theme-responsive.spec.mjs`.

**viewport**: automated evidence covers desktop Chrome and 320 CSS px mobile. A pixel-normalized source/implementation pair is unavailable because the reference attachments cannot be opened from the local worktree and no capture asset was created.

**state**: root `/` board, empty local operational state, persistent left rail, System/Light/Dark controls, and mobile drawer/focus return.

**full-view comparison evidence**: blocked. The implementation browser checks confirm the required hierarchy, rail, panel families, meters, themes, and no-overflow behavior, but the supplied source image is not available as a local comparison artifact.

**focused-region comparison evidence**: blocked for the same source-artifact reason. No screenshot or recording was retained.

**Findings**

- [P2] Founder visual comparison remains outstanding. Automated headed Chrome checks pass for the dense panel hierarchy and reusable cost/token/budget circled meters, but they are not a pixel comparison or Founder approval.

**Comparison history**

- Initial implementation had strict panel-count and mobile disclosure assertions; those were corrected. The final headed Chrome rerun passed 2/2 visual-reference tests. No source-image comparison iteration could be performed.

**Implementation Checklist**

- [x] Persistent MeridianOS-owned left rail and mobile drawer.
- [x] Dense stat, graph/table, gauge, bar-gauge, heatmap, list, activity, and table families.
- [x] Segmented threshold circled meters for cost, tokens, and budget with numeric/status text.
- [x] System/Light/Dark, forced-colors, reduced-motion, and 320px no-overflow checks.
- [ ] Founder compares the live root board with the supplied references and records any accepted visual deviations.

**Follow-up Polish**

- Any remaining pixel-level typography, spacing, icon, or color adjustments require the Founder to inspect the live headed dashboard against the supplied attachments.

final result: blocked

---

# Home-page polish QA (Spec 018 slice)

source visual truth path: `artifacts/design-source/home-page-reference-2x.png`
implementation screenshot path: `artifacts/playwright-results/home-page-polish-desktop-h-7b4b5-h-the-main-header-and-board-chrome/home-page-desktop.png`
viewport: 1440x900 CSS px capture, Chromium, deviceScaleFactor 1
source and implementation pixel dimensions: source is 2880x4410 px; normalized source is 1440x2205 CSS px; headed capture is 1425x2265 px because Chromium reserves a 15px vertical scrollbar
density normalization: the source was downsampled from 2x to 1440 CSS px; headless geometry measures 2248 CSS px of page height, a 43px (1.95%) delta from the normalized reference
state: `/` home route, system theme resolving to light, deterministic empty operational data, no active alert

## Comparison evidence

- Full view: the fixed dark rail starts at the top of the viewport, the white header begins at the rail boundary, and the scope card, attention notice, six KPI cards, circled meters, heatmap, tables, trends, alerts, and snapshot follow the supplied hierarchy.
- Focused regions: the rail/header boundary, scope form, KPI footer/link wrapping, empty meter treatment, and manual-refresh behavior were compared against the local PNG. The browser regression confirms that a refresh reuses the mounted board and preserves the viewport.

## Findings

- [P3] Typography uses the repository system font stack rather than a measured match to the Figma export. The hierarchy is consistent and the difference is non-blocking for this polish slice.

## Comparison history

1. Initial implementation had the shell below the header and KPI captions/links could run together. The shell was moved to a fixed top-to-bottom rail, the scope submit action was given its own row, and KPI metadata was wrapped in `.panel-stat-footer`.
2. Realtime/manual refresh initially replaced the route shell and could collapse the page to the top. The refresh path now reuses the mounted controls/root and restores the captured scroll offset. Revised evidence is the implementation screenshot above and the passing `home-page-polish.spec.mjs` browser test.
3. The downloaded source export enabled pixel-normalized comparison. The header/rail alignment was corrected, blank project/provider filters now present truthful “All projects” / “All providers” affordances, and the source rail boundary was measured at 240px CSS.
4. Both P2 findings are resolved: navigation now uses a local line-icon SVG sprite served by the dashboard, and chart/empty-state margins, link targets, scope controls, and row rhythm were compacted. The resulting 2248px headless page height is within 2% of the normalized reference.

## Verification

- `node --test tests/home-page-polish.test.mjs tests/operational-dashboard.test.mjs tests/dashboard-navigation.test.mjs tests/dashboard-theme.test.mjs tests/ui-platform.test.mjs` — 15 passed.
- `npm run test:browser -- browser-tests/dashboard-visual-reference.spec.mjs browser-tests/dashboard-theme-responsive.spec.mjs browser-tests/home-page-polish.spec.mjs --project=chrome` — 6 passed.
- `npm run test:browser -- browser-tests/home-page-polish.spec.mjs --project=chrome --headed` — 2 passed.
- `npm test` — 1,701 passed, 9 skipped, 0 failed.
- `git diff --check` — clean.
- `npm run lint` — unavailable: `eslint` is not installed in this worktree.

final result: passed

The source comparison is unblocked and both actionable P2 differences are resolved. The remaining font-stack deviation is recorded as non-blocking P3 evidence for a future typography pass.
