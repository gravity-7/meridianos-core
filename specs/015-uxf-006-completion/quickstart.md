# UXF-006 Validation Quickstart

This guide is the evidence index for the autonomous portion of UXF-006. Historical results below are from the isolated Windows worktree on 2026-08-12; the post-merge focused recheck was run on `origin/main` in an isolated Windows worktree on 2026-08-16. An unavailable manual environment is recorded as unavailable, not passed.

## Prerequisites

- Node.js 24+
- Existing repository dependencies installed with `npm ci`
- A configured local policy for dashboard server/browser checks
- Playwright browsers available for the browser job
- Optional: NVDA on Windows, VoiceOver on macOS, and Electron runtime

## Focused validation

```powershell
node --test tests/uxf-006-search.test.mjs tests/uxf-006-telemetry.test.mjs tests/uxf-006-quality.test.mjs tests/uxf-006-gates.test.mjs
node --test tests/operational-api.test.mjs
node --test tests/realtime-coordinator.test.mjs tests/operational-realtime.test.mjs
node scripts/uxf-006-gates.mjs --source
npm run test:browser -- --grep UXF-006
git diff --check
```

Record command, date, commit, duration, pass/fail count, and artifact paths here:

| Gate | Command | Result | Evidence |
|---|---|---|---|
| Search/auth contract | focused UXF Node tests; `tests/operational-api.test.mjs` | 11 + 6 passed, 0 failed, 0.113s + 1.088s | Scope, role, malformed-input, safe projection, and HTTP compatibility output |
| Telemetry privacy | focused UXF Node tests | 11 passed, 0 failed | Allowlist, pseudonym, URL/query, prompt/key/raw-content negatives |
| SSE reconnect/fallback | realtime Node tests | 5 passed, 0 failed, 0.085s | Reconnect, dedupe, cursor, visibility, three-failure polling fallback |
| Viewport/keyboard/focus | `npm run test:browser -- --grep UXF-006` | Post-merge focused recheck: 12 project-runs passed, 52.2s targeted; includes native and dialog-fallback focus, local seven-viewport shell, and cloud seven-viewport variant coverage | `artifacts/browser/report`, `artifacts/playwright-results` |
| Visual regression | `npm run test:browser` screenshots | 54 passed, 0 failed, 1.3m | Browser report/screenshots; baseline approval remains a human release gate |
| Performance budgets | `node scripts/uxf-006-gates.mjs --source` plus browser assertions | Post-merge source gate passed; critical JS 5,580 bytes gzip; runtime LCP/interaction/table/refresh measurements remain uncollected | Full artifact mode is fail-closed and requires all measurements |
| API/secret compatibility | `npm test` and `npm run test:ci` | 1,642/1,652 and 1,586/1,596 passed; 10 skips each; 0 failures | Existing API/v1, auth, gateway, onboarding, cloud, and secret tests |
| Source hygiene | `git diff --check` | passed | No whitespace errors |

## Target matrix

| Browser/host | 1440×900 | 1280×800 | 1024×768 | 768×1024 | 480×800 | 390×844 | 320×568 | AT/manual |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| Chrome | pass | pass | pass | pass | pass | pass | pass | Keyboard/palette, focus restoration, reduced motion/forced colors, no overflow |
| Edge | pass | pass | pass | pass | pass | pass | pass | Same UXF-006 Playwright assertions |
| Firefox | pass | pass | pass | pass | pass | pass | pass | Same UXF-006 Playwright assertions |
| Safari | CI job updated | CI job updated | CI job updated | CI job updated | CI job updated | CI job updated | CI job updated | macOS CI palette capture updated; local Windows run unavailable; VoiceOver manual gate open |
| Electron | not run in this host | not run in this host | not run in this host | not run in this host | not run in this host | not run in this host | not run in this host | Existing Electron integration tests pass; packaged/native host smoke remains required |

## Performance budgets

The gate is fail-closed for missing measurements. Required thresholds are initial shell/critical JS ≤220 KB gzip; local LCP p75 ≤2.5 s; cloud LCP p75 ≤3.5 s; interaction p95 ≤100 ms after data arrival; 1,000-row filter/sort ≤100 ms; 2,000-point chart render ≤500 ms; summary refresh-to-render p95 ≤1 s; and no initial interaction long task >200 ms.

| Measurement | Target | Observed | Artifact/exception |
|---|---:|---:|---|
| Initial shell/critical JS gzip | ≤220 KB | 5,580 bytes for `dashboard/static/app-platform.mjs` in the post-merge focused recheck | Source gate JSON |
| Local LCP p75 | ≤2.5 s | Not collected by this host’s browser artifact | Must be supplied to `--evidence`; no pass claimed |
| Cloud LCP p75 | ≤3.5 s | Not collected | Cloud host evidence required |
| Interaction p95 | ≤100 ms | Not collected as a release artifact | Gate fails closed when absent |
| 1,000-row filter/sort | ≤100 ms | Not collected | Gate fails closed when absent |
| 2,000-point chart render | ≤500 ms | Chrome 24.2ms / Edge 23.6ms / Firefox 47ms p95 | Existing operational browser performance evidence |
| Summary refresh-to-render p95 | ≤1 s | Not collected | Gate fails closed when absent |
| Initial interaction long task | <200 ms | 0ms in existing chart evidence; UXF shell assertion ≤200ms | Browser output and gate tests |

## Manual accessibility evidence

Record OS, browser/Electron version, AT version, route/state, keyboard flow, focus behavior, zoom, reduced motion, forced colors, result, and issue IDs.

| Environment | Routes/states | Result | Evidence | Approval |
|---|---|---|---|---|
| NVDA | Not run in this host session | Unresolved until run | Manual Windows AT pass required | Accessibility owner TBD |
| VoiceOver | Not run in this host session | Unresolved until run | Manual macOS AT pass required | Accessibility owner TBD |

## Compatibility and security evidence

- Existing `/api/*` and `/api/v1/*` compatibility tests: `npm test` (1,652: 1,642 pass, 10 skip, 0 fail) / `npm run test:ci` (1,596: 1,586 pass, 10 skip, 0 fail).
- Authorization-negative and cross-tenant search tests: 4 pure search tests plus 1 HTTP operational API test; all pass.
- Secret-leak tests cover URL/history/DOM/log/telemetry/audit/error/raw query in existing suites plus the UXF telemetry allowlist; no new secret-bearing field is accepted.
- Gateway-only metering and public API tests remain unchanged; record their counts from the full suite.

## Realtime evidence

The existing SSE pilot is opt-in. Record open, event, duplicate, cursor resume, reset, scope-change, disconnect, three-failure polling fallback, hidden-tab pause, manual refresh, and demo/policy-disabled behavior. Keep polling enabled as the fallback.

## Rollout, parity, and unresolved approvals

- Review [legacy-parity-ledger.md](../../docs/legacy-parity-ledger.md) before any removal.
- Review [uxf-006-rollout.md](../../docs/uxf-006-rollout.md) for flags, canary, rollback, and support steps.
- Product/UX/Accessibility/Security/Backend/Frontend/QA/Documentation/Release owners, final IA/terminology/scorecard review, architecture/dependency ADR, approved legacy threshold, exception authority, canary cohort, manual AT evidence, and two consecutive release-candidate records are unresolved until named evidence is attached.
- No legacy module or route is removed by this feature.

## Full validation

```powershell
npm test
npm run test:ci
npm run test:browser
git diff --check
```

Final historical report: required Node and Chrome/Edge/Firefox browser checks passed on the pre-merge evidence run. Post-merge focused recheck passed 11 UXF Node tests and 12 Chrome/Edge/Firefox project-runs, including dialog fallback, cloud seven-viewport, dark/reduced-motion/forced-colors checks; the full suite and full browser suite were not repeated for this audit. Safari, Electron, manual NVDA/VoiceOver, full runtime performance artifact collection, visual-baseline approval, named owners, canary approval, and release sign-off remain explicitly unresolved external gates. No test failures were caused by missing dependencies or secrets in the isolated worktree.
