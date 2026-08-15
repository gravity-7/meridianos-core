# Validation Guide: Unified Onboarding

## Prerequisites

- Use a checkout that includes the merged UXF-001 platform implementation and has `ui_platform` enabled for the test subject.
- Start from an isolated fresh test installation with a controlled provider credential and no real credentials in fixtures or logs.
- Run the native test suite and the existing browser test harness from the repository root.

## Scenario 1: Browser happy path

1. Open `/app/setup` directly and verify the platform shell, ordered stepper, and initial status.
2. Enter installation name and at least one agent, select a provider, and submit a test credential.
3. Verify a `valid` sanitized result, a positive budget summary, and a review containing no credential or raw file content.
4. Explicitly confirm commit.
5. Verify the completion checklist exposes a documented first-task target and an unavailable/explained first-run target until a run exists.

**Evidence**: Direct-load screenshot, sanitized response assertion, persisted-draft inspection, no-secret scan, commit outcome, and checklist link assertion.

## Scenario 2: Browser interruption and provider recovery

1. Complete non-secret fields, enter a credential, and force an invalid, unreachable, or timed-out provider result.
2. Leave/reload the route, then return.
3. Verify safe fields and last safe step resume; verify the credential is absent from storage, URL, history, review, logs, telemetry, and diagnostics.
4. Retry after correcting the credential and complete setup.

**Evidence**: Draft DTO test, browser-storage/URL negative assertions, normalized recovery state, keyboard focus/status assertion.

## Scenario 3: Existing installation and compatibility rollback

1. Start with an existing policy, `.env`, or Electron keychain credential.
2. Open unified setup and verify no overwrite/migration option is offered by default.
3. Disable the platform feature flag and verify legacy `/setup` and legacy Electron wizard remain accessible and existing configuration remains unchanged.

**Evidence**: Before/after configuration comparison, feature-flag route result, legacy-route/browser test, and Electron fallback result.

## Scenario 4: Electron parity and keychain recovery

1. Run the Electron first-run flow using the shared ordered steps and a controlled valid provider.
2. Verify the normalized validation and completion checklist match the browser outcome.
3. Simulate keychain failure and verify a non-secret recoverable error, blocked completion, and no `.env` fallback.

**Evidence**: Isolated-bridge allowlist test, keychain fake assertion, no-secret result scan, parity fixture comparison.

## Scenario 5: Accessibility and responsive evidence

1. At 375 px and a wide desktop viewport, complete normal, validation-error, retry, review, and completion states with keyboard only.
2. Repeat with screen-reader semantics/automated accessibility checks, reduced motion, and 200% zoom.
3. Verify current-step announcement, error-summary focus, visible focus, status announcements, no horizontal overflow, and operable checklist links.

**Evidence**: Browser screenshots, automated accessibility report, keyboard trace, responsive assertions, and supported-browser matrix results.

## Recorded implementation evidence (2026-08-11)

- `npm test`: 1,562 passed, 0 failed, 10 skipped.
- Focused onboarding native coverage (`server`, draft, security, setup-core, Electron): 74 passed, 0 failed; final server/source-quality/provider/desktop checks: 53 passed, 0 failed.
- `npx playwright test browser-tests/onboarding.spec.mjs`: 15 passed across Chrome, Edge, and Firefox.
- Browser scenarios cover safe resume after reload, no browser-persisted/URL/review credential,
  failed-validation focus and retry state, storage-unavailable recovery, existing/repair-needed
  recovery, completion checklist persistence, available/unavailable first-run observation,
  semantic step count, and 375 px evidence.
- Electron structural/keychain coverage proves the allow-listed bridge, keychain-only commit,
  no `.env` fallback, and retained explicit legacy-wizard compatibility switch.
