# Quickstart: Validate the Visible Onboarding Journey

## Standard automated run

1. Use the focused onboarding journey command supplied by this feature. It creates a new temporary installation, an ephemeral loopback dependency, and a fresh browser context.
2. Confirm the run reports `loopback-simulated` and a synthetic/disposable installation before interacting with setup.
3. Verify welcome, agent roster, provider selection/validation, budget, review, explicit commit, and completion at desktop and narrow widths.
4. Run the controlled invalid-provider scenario, verify the visible recovery message and blocked completion, then retry after switching to the controlled success scenario.
5. Inspect `artifacts/qa/<run-id>/manifest.json` and `result.json`; use the triage record if the outcome is not pass.

The standard run must not read a developer provider key, use a payment/email system, or make a non-loopback request. It records sanitised diagnostics rather than raw traces.

## Founder-visible walkthrough

1. Start the same fixture with the visible option and an explicitly selected free local port, for example 4317 when it is not already in use.
2. Open only the printed local `/setup` address in the fresh browser window. The banner and launcher both identify the data as synthetic and disposable.
3. Follow the runbook's numbered journey steps. Observe that the review exists before any configuration is written and that only the explicit final action writes inside the fixture root.
4. End the walkthrough using the fixture's cleanup command; it closes its browser/dependencies, scans evidence, and removes the temporary installation.

## Future DeepSeek live canary

Do not use the standard command. First complete the live-canary approval template with the key owner, DeepSeek provider/model, finite spend cap and duration, stop/rollback action, evidence classification, and key revocation action. The key owner supplies the key only in their own local environment. Z.ai GLM is not eligible until its provider registration and routing support are delivered and verified.
