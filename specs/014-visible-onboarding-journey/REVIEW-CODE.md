# Code Review: Visible Onboarding Journey — Phase 2

**Spec:** `specs/014-visible-onboarding-journey/spec.md`
**Scope:** T015–T022 only
**Date:** 2026-08-15
**Reviewer:** Spex Phase 2 review

## Compliance Summary

**Overall Phase 2 score: 100%**

Phase 2 scope requirements were checked against the implementation, focused tests, and generated evidence. FR-010 and T023–T027 are intentionally excluded from this gate.

| Requirement area | Result | Evidence |
|---|---|---|
| Disposable named journey and isolated root | Compliant | `tests/fixtures/onboarding-fixture.mjs`, `quickstart.md` |
| Synthetic-only, exact loopback dependencies | Compliant | Sanitized child environment, exact provider allowlist, redirect and inherited-key tests |
| Headed founder walkthrough | Compliant | `scripts/run-visible-onboarding.mjs`, synthetic banner and safe launcher output |
| Visible setup checkpoints | Compliant | `browser-tests/legacy-setup-onboarding.spec.mjs` uses `/setup` controls only |
| Wide, narrow, keyboard, recovery | Compliant | Two focused Playwright journeys and recovery assertions |
| Redacted evidence and triage | Compliant | `writeOnboardingEvidence`, `validateOnboardingResult`, safe screenshots/diagnostics |
| Provider failure and retry | Compliant | Auth, timeout, unavailable, redirect, blocked completion, and retry coverage |
| Existing-installation safety | Compliant | Explicit commit writes only the fixture root; review remains non-writing |

## Error Handling

- Authorization, timeout, unavailable, and redirect outcomes map to stable safe recovery codes without reflecting the synthetic credential.
- Failed validation does not create a usable handle; the browser clears the key, focuses the alert, blocks Continue, and preserves only non-secret choices.
- A failed or abandoned run emits redacted triage/evidence and still attempts exact fixture cleanup.

## Code Quality Notes

- Raw Playwright traces are disabled for this journey.
- Browser console and page-error text are scanned in memory and are not written as raw diagnostics.
- Evidence validation rejects non-loopback dependency modes, nonzero external-attempt counts, retained traces, failed sentinel scans, and invalid cleanup states.

## Verification

- `node --disable-warning=ExperimentalWarning --test tests/onboarding-fixture.test.mjs tests/setup-onboarding-contract.test.mjs` — 14 passed.
- `npx --no-install playwright test --config=playwright.onboarding.config.mjs` — 2 passed.
- Focused syntax checks passed for the changed fixture, browser journey, and launcher files.
- Full `npm test` was not run per the Phase 2 request.

## Conclusion

Phase 2 is ready for publication and human/CI review. No `/app/setup` implementation or Phase 3 task is included.
