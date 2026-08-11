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
