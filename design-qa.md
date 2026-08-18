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
