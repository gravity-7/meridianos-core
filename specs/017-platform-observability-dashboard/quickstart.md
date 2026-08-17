# Quickstart: Platform Observability Dashboard & Legacy-Parity Polish

## Prerequisites

- Node.js 24+
- Installed repository dependencies
- A headed Chrome-capable browser for local smoke checks
- A free loopback port

## Normal dashboard smoke

Start the local dashboard using the repository's supported launcher, then open `/`.

Verify:

1. The platform board opens at `/`; `/legacy` remains reachable.
2. Scope controls update the URL and visible scope status.
3. The root widgets show truthful data or explicit empty states.
4. Gateway, Cost, Usage, Alerts, Tasks, and Runs drill-downs preserve scope.
5. System, Light, and Dark can be selected and survive reload.
6. At 320px width, navigation and scope controls remain usable without horizontal scrolling.

## Focused validation commands

```powershell
node --test tests/operational-dashboard.test.mjs tests/dashboard-theme.test.mjs tests/dashboard-parity.test.mjs
npx playwright test browser-tests/operational-overview.spec.mjs browser-tests/dashboard-theme-responsive.spec.mjs --project=chrome
npx playwright test browser-tests/client-demo-package.spec.mjs --project=chrome
```

Expected result: all focused tests pass; no page errors; theme, mobile, state, scope, drill-down, chart/table, and synthetic fixture assertions are green.

## Synthetic demo validation

Run the existing local-only launchers with a disposable port. Use only the fixture credentials printed by the launcher. Verify that trend panels contain the declared fictional records, that the UI remains labelled synthetic/disposable, and that stopping the run removes its temporary root/database.

No real provider key, external endpoint, payment, email, customer data, screenshot, recording, or client-facing capture asset is permitted during ordinary validation.

## Recorded local validation (2026-08-18)

The supported local Chrome environment was available. Results:

| Command | Result |
|---|---|
| `node --test tests/dashboard-theme.test.mjs tests/dashboard-navigation.test.mjs tests/dashboard-parity.test.mjs tests/operational-dashboard.test.mjs tests/dashboard-fixture.test.mjs tests/dashboard-source-quality.test.mjs tests/dashboard-api-compatibility.test.mjs tests/operational-api.test.mjs tests/operational-analytics.test.mjs tests/operational-chart.test.mjs tests/server.test.mjs` | 70 passed, 0 failed |
| `npx playwright test browser-tests/dashboard-visual-reference.spec.mjs browser-tests/dashboard-theme-responsive.spec.mjs --project=chrome` | 4 passed, 0 failed |
| `npx playwright test browser-tests/ui-platform.spec.mjs browser-tests/operational-overview.spec.mjs --project=chrome` | 10 passed, 0 failed; performance p95 22.7 ms for 2,000 points, max long task 0 ms |
| `npx playwright test browser-tests/client-demo-package.spec.mjs --project=chrome` | 4 passed, 0 failed |
| `npm test` | 1,707 tests: 1,698 passed, 9 skipped, 0 failed |
| `git diff --check` | passed; only Git line-ending normalization warnings |

The browser suites exercised desktop and 320px mobile rail/drawer behavior, active navigation, System/Light/Dark persistence, forced colors, reduced motion, scope/drill-down behavior, chart/table parity, synthetic fixture cleanup, and no horizontal page scrolling. No screenshot, recording, or client-facing capture asset was created; transient Playwright failure artifacts were absent after the passing reruns.

Unavailable or not claimed: Safari/macOS, NVDA/VoiceOver, Electron, independent accessibility review, production/client readiness, visual-baseline approval, canary approval, and release approval. The supplied reference images remain the Founder visual-review input; automated browser hierarchy checks are evidence, not Founder approval.

## Evidence boundary

Record redacted test manifests under ignored `artifacts/qa/<run-id>/` only when required by the existing fixture contract. Do not claim Safari/macOS, NVDA/VoiceOver, Electron, production performance, independent accessibility, visual-baseline, canary, production/client readiness, or release approval without separate evidence.

## Review handoff

Before review:

```powershell
git diff --check
npm test
```

Then run `$speckit-converge` and the repository's required Antigravity review dispatcher against the implementation PR. Do not merge the PR.

## Review evidence boundary

Redacted evidence locations are the ignored `artifacts/qa/client-demo/<run-id>/manifest.json` and `result.json` paths generated only when a fixture run is explicitly stopped. Source-quality evidence is in `tests/dashboard-source-quality.test.mjs`, and parity dispositions are in `parity-inventory.md`. No secrets, provider keys, raw requests, browser profiles, or capture assets are retained.
