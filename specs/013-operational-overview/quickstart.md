# Validation Quickstart: Operational Overview

This guide defines the acceptance evidence to collect during Stage 2. Commands are run from the repository root on Node.js 24+ after the approved specification PR is merged.

## 1. Install and baseline

```powershell
npm install
node --version
npm test
```

Record the Node version and native test summary. No dependency may be added for this feature; `package.json`/lockfile must remain unchanged unless an existing dependency metadata correction is independently justified.

## 2. Focused API, lifecycle, pagination, and compatibility tests

```powershell
node --test tests/operational-scope.test.mjs tests/operational-analytics.test.mjs tests/operational-alert-store.test.mjs tests/operational-api.test.mjs tests/operational-realtime.test.mjs tests/operational-chart.test.mjs tests/runlog.test.mjs tests/dashboard-api-compatibility.test.mjs
```

Evidence must show:

- auth-derived tenant and authorized project/provider scope;
- exact UTC `[from,to)` behavior and shared URL serialization;
- stable task/run/alert/audit drill-down URLs and browser-back scope preservation;
- 50-record default and 200-record maximum run-log pages with stable snapshot cursors;
- alert create/deduplicate/escalate/acknowledge/resolve/reopen transitions and version conflicts;
- notification suppression without hiding acknowledged alerts;
- retry/restart role enforcement and immutable mutation/denial audit records;
- SSE ordering/resume/reset, three-failure polling fallback, visibility pause, and single-timer behavior;
- unchanged legacy response fixtures and authorization behavior.

## 3. Browser and accessibility coverage

```powershell
npx playwright test browser-tests/operational-overview.spec.mjs
```

Run the repository's configured Chromium and Firefox projects, plus its mobile viewport where available. Save trace/screenshot evidence for:

1. An operator finds the top critical condition from `/app/overview`, opens the related alert, reaches the failed run, confirms the safe retry explanation/action, and opens the returned audit record.
2. A finance user selects a time/project/provider scope, drills from spend into provider/model/agent/task drivers, and cannot invoke an unauthorized recovery.
3. Browser back/forward and refresh preserve scope and detail URLs.
4. Live mode reconnects with an event ID, falls back to polling after forced SSE failures, and never creates multiple poll timers.
5. Keyboard-only traversal, visible focus, route focus management, live-region announcements, forced-colors, 200% zoom/reflow, and reduced-motion behavior pass.
6. Every gateway/cost/usage chart has the same data in a captioned semantic table and remains usable when uPlot is blocked.

Record automated accessibility violations (must be zero serious/critical) and any manual observations.

## 4. Performance evidence

The browser test loads deterministic fixtures with exactly 2,000 points per tested chart series. It captures `operational-chart:*` performance measures and `PerformanceObserver` long-task entries.

Acceptance:

- p95 from data-ready to chart-plus-table interactive is <=500 ms across the configured sample set;
- no operational chart render creates a main-thread task >200 ms;
- point count and aggregation label are asserted so an empty/truncated fixture cannot create a false pass.

Save the test-emitted JSON summary as CI artifact or paste its values into the implementation PR.

## 5. Alert-to-run journey evidence

Execute the seeded browser journey at least ten times with a mix of critical and warning alerts. Measure from overview attention visibility to the related run detail becoming ready.

Acceptance:

- median completion <=60 seconds;
- at least 90% of attempts reach the correct related task/run or an explicit retained-evidence explanation;
- selected filters remain present throughout the journey.

## 6. Policy and retention evidence

Run policy validation fixtures for absent settings, defaults, maximum page size, minimum polling interval, SSE bounds, and incompatible alert/audit retention. Run retention against a temporary state database and confirm it cannot delete run-log or gateway-ledger records.

## 7. Final gates

```powershell
npm test
git diff --check
```

Then run `$speckit-converge` until no unbuilt or inconsistent tasks remain. After each implementation push, follow the repository-mandated CI watch and Antigravity dispatch loop. Do not merge the implementation PR.

## Stage 2 execution record — 2026-08-11

### Environment and compatibility baseline

- Baseline: merged `origin/main` commit `6d922e971d4d`, containing UXF-002 and UXF-003.
- Runtime: Node.js `v24.15.0`; npm `11.12.1`.
- Reference desktop: Windows, AMD Ryzen 7 7435HS, 16 logical browser-reported processors, 25,439,199,232 bytes physical RAM. The Chromium Device Memory API reported 16 GiB; Firefox does not expose that value.
- Dependencies: no chart or runtime dependency was added; the existing vendored uPlot asset is used as an optional enhancement.
- Pre-change baseline: 1,572 tests; 1,563 passed, 0 failed, 9 skipped.

### Node and API validation

`npm test` completed in 24.00 seconds: **1,621 tests; 1,612 passed, 0 failed, 9 skipped** across 126 suites.

Focused tests separately covered shared scope, snapshot cursors, alert lifecycle/retention, retry/restart authorization and audit records, operational API envelopes, legacy/public compatibility, SSE broker and polling fallback, chart/table parity, and source-quality contracts. The representative compatibility gate preserved `/api/status`, `/api/run`, `/api/ledger/summary`, `/api/analytics/overview`, `/api/activity/feed`, `/api/v1/openapi.yaml`, existing static assets, direct app routes, and missing-token mutation denial.

### Browser and accessibility evidence

The relevant UXF-002/003/004 matrix completed **45/45 tests**:

- UXF-004 operational scenarios: 27/27 (nine each in Chrome, Edge, and Firefox).
- UXF-002 platform regression: 3/3.
- UXF-003 onboarding regression: 15/15.

Browsers were Chrome `151.0.7922.34`, Edge `151.0.7922.34`, and Firefox `153.0`. Operational artifacts include a 320 px screenshot, semantic-accessibility JSON, screen-reader semantic snapshots, chart-performance JSON, and alert-to-run timing JSON per browser.

Automated semantic checks reported **zero critical or serious issues** in every browser for duplicate IDs, missing interactive/form names, table captions/headers, and page heading structure. Keyboard focus plus Enter activation reached cost evidence. Forced colors, reduced motion, 200% zoom, three semantic finance/chart tables without uPlot, direct/Back/Forward URL scope, lifecycle focus/live status, and 320 px layout all passed.

### Performance and operational timing

Each browser rendered ten gateway/cost samples with exactly 2,000 already-received points and deterministic bucket size 1:

| Browser | Chart/table p95 | Longest observed main-thread task | Limits |
|---|---:|---:|---|
| Chrome | 37.2 ms | 66 ms | <=500 ms / <=200 ms |
| Edge | 36.6 ms | 69 ms | <=500 ms / <=200 ms |
| Firefox | 76.0 ms | 0 ms reported | <=500 ms / <=200 ms |

The automated failed-alert journey opened the exact run, found retained evidence, and identified the safe recovery action ten times per browser:

| Browser | Median | Successful runs | Limit |
|---|---:|---:|---|
| Chrome | 212.0 ms | 10/10 | <=60 s and >=90% |
| Edge | 233.0 ms | 10/10 | <=60 s and >=90% |
| Firefox | 311.5 ms | 10/10 | <=60 s and >=90% |

The attention scenario presented the top textual `critical` condition in 301 ms on Chrome, 294 ms on Edge, and 842 ms on Firefox, all below five seconds.

These deterministic browser timings prove the automated thresholds and repeatability. They do not fabricate the separate moderated human-validation success criteria. The draft-PR review can record participant observations here when conducted:

| Participant | Role | Top attention + affected entity correct? | Attention time | Alert-to-run outcome | Journey time | Notes |
|---|---|---|---:|---|---:|---|
| P1 | Operator | Pending moderated review | — | Pending moderated review | — | — |
| P2 | Operator | Pending moderated review | — | Pending moderated review | — | — |
| P3 | Operator | Pending moderated review | — | Pending moderated review | — | — |
| P4 | Operator | Pending moderated review | — | Pending moderated review | — | — |
| P5 | Operator | Pending moderated review | — | Pending moderated review | — | — |
| F1 | Finance/governance | Not applicable | — | Identify top cost driver and supporting records: pending moderated review | — | — |

### Commands executed

```powershell
node --test tests/operational-scope.test.mjs tests/operational-analytics.test.mjs tests/operational-alert-store.test.mjs tests/operational-api.test.mjs tests/operational-realtime.test.mjs tests/realtime-coordinator.test.mjs tests/operational-recovery.test.mjs tests/operational-client.test.mjs tests/operational-chart.test.mjs tests/app-route-registry.test.mjs tests/runlog.test.mjs tests/dashboard-api-compatibility.test.mjs
npx playwright test browser-tests/operational-overview.spec.mjs
npx playwright test browser-tests/ui-platform.spec.mjs browser-tests/operational-overview.spec.mjs
npx playwright test browser-tests/onboarding.spec.mjs
npm test
```

`$speckit-converge` appended T070–T079 for discovered interface, browser-evidence, HTTP/SSE, audit, recovery, detail-route, alert, and finance-driver gaps. Each appended task is complete; the repeat assessment found no remaining unbuilt requirement.
