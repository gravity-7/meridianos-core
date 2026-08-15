# UXF-006 Remaining-Work Inventory

**Baseline:** `origin/main` at `8e080a3` (2026-08-12), after live GitHub PRs #88, #90, #92, and #94 were verified as merged and their merge commits were verified as ancestors of `origin/main`.

**Scope:** Evidence-backed follow-up to `docs/UI-UX-Audit-Revamp-Master-Plan.md`. This inventory is intentionally conservative: a merged feature is counted as present only where code and tests provide evidence, and a human approval is never counted as complete without a recorded decision.

## Evidence inventory

| Area | Current evidence | Status | Remaining work |
|---|---|---|---|
| UXF-001/002 shell and primitives | `dashboard/app.html`, `dashboard/static/app-platform.mjs`, `dashboard/static/ui-primitives.mjs`, `tests/ui-platform.test.mjs` | Partial | Extend the shell across the required viewport, zoom, forced-colors, reduced-motion, keyboard, and focus-restoration matrix; keep the legacy route available during migration. |
| UXF-003 onboarding | `dashboard/static/onboarding-flow.mjs`, onboarding tests, Electron integration tests | Partial | Add release-gate evidence for browser/Electron parity, manual AT review, timing evidence, and support recovery documentation. |
| UXF-004 operations and alerts | `dashboard/app/routes/overview`, `operations`, `observability`, operational tests, `dashboard/app/shared/realtime-coordinator.mjs` | Partial | Enforce the cross-browser/visual/performance gates, add alert/search drill-down evidence, and record telemetry/privacy and rollback evidence. |
| UXF-005 management | `dashboard/management-*.mjs`, management routes/tests, management support docs | Partial | Add cloud parity evidence, shared search/permission behavior, full responsive/AT coverage, and release/legacy parity evidence. |
| Global search / command palette | No `search` route/API or `Ctrl/Cmd+K` command registry found in `dashboard/app` or `dashboard/server.mjs`. | Missing | Add scope- and authorization-aware entity search plus safe command registry and keyboard-first palette. Add negative authorization and cross-tenant tests. |
| Status/alert SSE pilot | `dashboard/server.mjs` exposes `/api/operations/events`; `operational-events.mjs` scopes, replays, heartbeats, and caps connections; coordinator reconnects and falls back to polling; `tests/realtime-coordinator.test.mjs` and `tests/operational-realtime.test.mjs` cover core behavior. | Implemented core / partial release evidence | Add browser reconnect evidence, privacy-safe telemetry, documented polling fallback, load/performance gate, and cloud decision (cloud remains polling unless a compatible stream is approved). |
| Cloud dashboard alignment | `cloud/dashboard/index.html` and `cloud/dashboard/app.js` are a separate minimal login/machine/health/policy form. | Missing | Align shell language and responsive/a11y behavior; add machine detail, policy impact preview, confirmation, per-target outcome, and safe recovery states without changing cloud auth/API contracts. |
| Responsive behavior | Native CSS has a small mobile breakpoint; route shell has no complete evidence for 1440×900, 1280×800, 1024×768, 768×1024, 480×800, 390×844, and 320×568. | Partial | Add deterministic browser fixtures and assertions for no horizontal overflow, touch targets, navigation, tables, dialogs, charts, cloud views, 200% zoom, and forced colors. |
| Accessibility | Semantic landmarks, visible focus, dialogs, and reduced-motion foundations exist in the native shell. | Partial | Enforce axe/keyboard/focus tests per route/state; record manual NVDA and VoiceOver evidence where available; add exception/approval handling for any unresolved issue. |
| Visual regression | Existing browser workflow uploads screenshots, but no baseline comparison or threshold gate is evident. | Missing | Add stable light/dark/state/viewport baselines and CI enforcement with an explicit update/approval process. |
| Performance | `package.json` exposes browser tests and a benchmark script; no CI budget assertion for shell bytes, LCP, interaction, table, chart, refresh, or long tasks is present. | Missing | Add budget checks and artifacts for the master-plan thresholds; fail CI on regressions unless a documented human exception exists. |
| Telemetry privacy | Onboarding and control-plane telemetry exist in feature-specific paths. | Partial | Centralize an allowlisted UXF event envelope containing route, pseudonymous scope, role, flag, duration, and outcome only; test that prompts, credentials, API keys, webhook secrets, and raw request content cannot enter events. |
| Legacy parity/removal | Legacy modules and the original dashboard remain available; no durable ledger mapping every module to target, owner, evidence, flag, removal gate, and rollback asset was found. | Missing | Add the parity ledger and migration guide. Keep legacy code/routes; removal is blocked until parity evidence, usage threshold, regression coverage, rollback asset, and human approval are recorded. |
| Canary / rollback | Feature-flag patterns exist in operational code, but no UXF-006 canary cohort, two-release-candidate evidence, or rehearsed rollback record is present. | Missing | Document flag controls, cohort progression, support/admin/user rollout, rollback drill, retained legacy asset, and release-candidate evidence. |
| Documentation | UXF-003–005 have feature-specific support docs; no UXF-006 validation quickstart, release-gate evidence index, or complete legacy migration ledger exists. | Partial | Add quickstart commands/results, browser/AT/performance evidence, telemetry privacy notes, cloud guide, migration/rollback plan, changelog, and support runbook. |

## Work that can be implemented autonomously

- Native ES-module search API, command registry, palette, and authorization-negative tests.
- Shared allowlisted telemetry envelope and secret-leak tests.
- Responsive shell/cloud styling and semantic markup that preserves existing APIs.
- Browser fixtures and deterministic source/runtime gates for the required viewport, keyboard, reduced-motion, forced-colors, zoom, visual, and performance checks.
- Parity ledger, route/module catalogue, migration guide, changelog, support runbook, feature-flag/rollback templates, and validation quickstart.
- SSE reconnect/polling fallback browser evidence and documentation.

## Decisions requiring human approval or external evidence

- Named Product, UX, Accessibility, Security, Backend, Frontend, QA, Documentation, and Release owners.
- Final IA/route catalogue, terminology, scorecard baseline, and representative-user research review.
- Architecture/dependency ADR. This implementation follows the user-specified native ES-module platform and does not add React, TypeScript, or a component library; the plan's earlier React recommendation remains an explicit superseded proposal until the ADR is signed.
- Approved legacy-use threshold, accessibility exception authority, and performance-budget exception authority.
- Canary cohort, two consecutive release-candidate gate records, support readiness, and rollback drill approval.
- NVDA/VoiceOver manual evidence when the corresponding environments are unavailable to automation.

No legacy surface is removed in UXF-006 until these approvals and the parity/removal gates are evidenced.
