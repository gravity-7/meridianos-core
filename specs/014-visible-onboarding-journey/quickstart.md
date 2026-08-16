# Quickstart: Validate the Visible Onboarding Journey

## Focused verification commands

Run these commands from the repository root of a clean Phase 3 worktree:

```text
node --disable-warning=ExperimentalWarning --test tests/quality-assurance-blueprint.test.mjs tests/setup-onboarding-contract.test.mjs tests/onboarding-fixture.test.mjs
npx --no-install playwright test --config=playwright.onboarding.config.mjs
```

The Node command covers the QA evidence/readiness contract, registered
provider boundary, fixture isolation, recovery, redaction, and cleanup. The
Playwright command covers the visible `/setup` journey at wide/narrow sizes,
keyboard focus, review-before-commit, explicit commit, and failure/retry. The
feature-specific verification does not invoke `npm test` and no command in
this quickstart makes a live provider request.

## Standard automated run

1. Run the focused Node and Playwright commands above. Each browser test creates a new temporary installation, an ephemeral loopback dependency, and a fresh browser context.
2. Confirm the run reports `loopback-simulated` and a synthetic/disposable installation before interacting with setup.
3. Verify welcome, agent roster, provider selection/validation, budget, review, explicit commit, and completion at desktop and narrow widths.
4. Run the controlled invalid-provider scenario, verify the visible recovery message and blocked completion, then retry after switching to the controlled success scenario.
5. Inspect `artifacts/qa/<run-id>/manifest.json`, `result.json`, and any `triage.json`; browser screenshots are named inside the same run directory. Inspect only redacted JSON/text and screenshots—never raw request bodies or traces.

The standard run must not read a developer provider key, use a payment/email system, or make a non-loopback request. It records sanitised diagnostics rather than raw traces.

## Founder-visible walkthrough

1. Start the headed launcher with an explicitly selected free local port, for example `node scripts/run-visible-onboarding.mjs --port 4317`.
2. Open only the printed local `/setup` address in the fresh browser window. The banner and launcher identify the data as synthetic and disposable.
3. Follow the runbook's numbered journey steps. Observe that the review exists before any configuration is written and that only the explicit final action writes inside the fixture root.
4. `/setup` is the supported onboarding route. `/app/setup` redirects to `/setup`; it is not a delivered unified onboarding route.
5. Press `Ctrl+C` or close the browser. The launcher closes the browser/dependencies, scans redaction, writes safe evidence under `artifacts/qa/<run-id>/`, and removes its temporary installation.

The launcher never accepts a provider key and never starts a live canary.

## Recovery and cleanup

- For a controlled provider failure, use the focused Playwright run. It starts
  the loopback provider in authorization-failure mode, proves the safe alert,
  cleared key, preserved non-secret choices, and blocked completion, then
  retries in success mode.
- If a headed session is interrupted, rerun the launcher; the interrupted run
  is recorded as `abandoned` when safe evidence can be written. Do not reuse its
  temporary root or any browser profile.
- After an automated or headed run, confirm the temporary
  `meridianos-visible-onboarding-*` root is gone. Keep only the redacted
  `manifest.json`, `result.json`, optional `triage.json`, and approved
  screenshots in the ignored `artifacts/qa/<run-id>/` directory.
- If evidence scanning fails, stop, discard the unsafe run directory, and rerun
  the focused checks from a clean process. Never inspect or copy a raw key-like
  value into an issue, log, screenshot, or approval record.

## Future DeepSeek live canary

Do not use the standard commands for a canary. First complete
`docs/quality-assurance/templates/live-canary-approval.md` with a named
approver, local key owner, registered DeepSeek provider/model scope, finite
spend and duration caps, stop/rollback actions, `LIVE-CANARY-RESTRICTED`
evidence classification, and post-run key revocation. The key owner supplies
the key only in their own local environment. Z.ai GLM is not eligible until its
provider registration and routing support are delivered and verified.
