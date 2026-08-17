# Client Demo Presenter Runbook

## Scope and safety boundary

This package demonstrates two **local, synthetic, disposable** workflows. It is not a customer environment and does not establish production/client readiness, release approval, visual-baseline approval, canary approval, performance evidence, Safari/macOS approval, Electron approval, or NVDA/VoiceOver approval.

At the current pre-customer stage, the Founder is the sole named owner for product, UX/design, testing, demo, security/privacy, and release decisions. Record any review as **Founder (self-review)**; it is not an independent approval and does not turn unavailable platform evidence into a pass.

Use only the two routes below:

| Workflow | Command and presenter route | Boundary |
|---|---|---|
| Onboarding | `node scripts/run-visible-onboarding.mjs --port 4317` and its printed `/setup` URL | `/app/setup` only redirects to `/setup`; never present it as implemented. |
| Client operations | `node scripts/run-visible-client-demo.mjs --port 4318` and its printed local root URL | `/cloud/dashboard/index.html` is test-static only and is never a live presenter route. |

Separately, the local dashboard's Founder-approved platform default is `/`; its retained rollback route is `/legacy`. This is not an additional client-demo route and does not change the `/setup` onboarding baseline.

For Spec 017 platform-board review, open the normal local dashboard root `/` after a clean install or the isolated synthetic fixture. Review the persistent left rail, dense panel grid, Request/Latency/Cost/Token trends, and the reusable Cost used, Tokens used, and Budget consumed circled meters. This platform-board review is separate from the client-control-plane presenter route above; it never changes the required client-demo root route.

Do not enter, request, print, retain, or use provider keys, customer data, payment data, email-delivery data, raw requests, or external services. The onboarding validation is loopback-simulated; the client workflow uses an ephemeral loopback cloud database.

## Founder narrative and timing

- **Onboarding-only (up to 10 minutes):** "We start from the supported local `/setup` experience. The data is synthetic and disposable. We review the plan before the explicit final write, and no real provider or account is contacted."
- **Full package (add up to 8 minutes):** "The second workflow is the supported local control-plane root dashboard. Its fictional machines and health state are deterministic display data; it is not a hosted service or a customer environment."
- **Readiness question:** "This local demonstration does not approve production, client readiness, releases, Safari/macOS, NVDA/VoiceOver, Electron, performance, visual baselines, or canaries. Those UXF-006 gates remain external and unresolved."

- **Spec 017 board pause (Founder self-review):** "The new root board is a local, scope-aware operational view. The meter arcs are a reusable threshold treatment for cost, tokens, and budget; every chart has a table/text alternative."

## Workflow A — existing visible onboarding baseline

1. Run `node scripts/run-visible-onboarding.mjs --port 4317`. If the port is unavailable, select a free loopback port and use the launcher's printed `/setup` URL.
2. **Welcome pause:** identify the headed `/setup` session as synthetic and disposable.
3. **Agent choices pause:** explain that the choices are a local walkthrough, not a customer configuration.
4. **Provider-validation pause:** explain the controlled validation is loopback-simulated; do not enter a real credential or claim an external provider call.
5. **Budget pause:** show the fictional budget choice and explain no payment action occurs.
6. **Review-before-commit pause:** state that no configuration has been written before the explicit final action.
7. **Explicit final-action pause:** make the action only after the review narration.
8. **Completion and cleanup:** show completion, then close the browser or press `Ctrl+C`. Confirm the temporary installation was removed and only redacted local evidence remains.

If interrupted or a step fails, mark the walkthrough abandoned, close it, and rerun from a clean session. Do not reuse a temporary root or browser profile.

## Workflow B — visible client operations (up to 8 minutes)

1. Run `node scripts/run-visible-client-demo.mjs --port 4318`. Read the printed root URL and synthetic/disposable notice; the browser must open that root URL.
2. **Client sign-in pause:** enter only `demo-admin@synthetic.invalid` with `fixture-only-passphrase`. These are fixed fictional fixture credentials, not a provider key, customer account, or email-delivery account. Say: "This is a fixture-only local account."
3. **Machines and health pause:** show the connected fictional machines and aggregate health. Say: "These values are deterministic local display data; no provider has been contacted."
4. **Policy preview pause:** use the fixture policy example and choose **Preview policy change**. State that the eligible targets are a preview and **no policy has been pushed**.
5. **Confirmation boundary pause:** show **Confirm with APPLY POLICY** and the rollback wording. The default demo stops here. An optional confirmation is fixture-only, must be announced before use, and does not imply an external policy effect or external rollback.
6. **Cleanup:** close the browser or press `Ctrl+C`. Confirm the temporary database and fixture root were removed. Retain only a redacted manifest/result/triage record if one was written.

If sign-in, load, preview, browser, or cleanup fails, stop the workflow, treat the run as abandoned, allow teardown to finish, and restart. Never manually repair or reuse fixture data.

## Checkpoint, evidence, and recovery traceability

| Requirement/checkpoint | Visible expected state | Evidence location / owner | Recovery |
|---|---|---|---|
| FR-016-001, `onboarding-start` | `/setup` welcome | existing `artifacts/qa/<run-id>/manifest.json`, Founder (self-review) | restart with the printed `/setup` URL; never present `/app/setup`. |
| FR-016-002, `onboarding-review` | review before final write | existing redacted result, Founder (self-review) | abandon and rerun if interrupted. |
| FR-016-003, `client-login` | local root sign-in | `artifacts/qa/client-demo/<run-id>/manifest.json`, Founder (self-review) | restart fixture; never use `/cloud/dashboard/index.html`. |
| FR-016-004, `client-health` | fixed connected machines and aggregate health | redacted `result.json`, Founder (self-review) | stop on any unsafe/non-loopback condition and restart. |
| FR-016-004, `client-preview` | eligible target preview, no push | redacted `result.json`, Founder (self-review) | discard failed run and restart. |
| FR-016-004, `client-confirmation` | explicit confirmation and rollback boundary | redacted `result.json`, Founder (self-review) | default stop; optional fixture-only confirmation must be announced. |
| FR-016-010, `client-cleanup` | teardown result | redacted result/optional triage, Founder (self-review) | do not reuse a failed fixture. |
| FR-016-006/007 | planned capture only | version-controlled capture brief, Founder (self-review) | discard unsafe capture; no automatic assets. |
| FR-016-008/009 | external gate boundary | this runbook, Founder (self-review) | state UXF-006 is dependency evidence only; no Spec 014/015 closure claim. |
| FR-017-001/007/016/017 | platform root board and circled meters | `browser-tests/dashboard-visual-reference.spec.mjs` and `browser-tests/dashboard-theme-responsive.spec.mjs`, Founder (self-review pending) | compare `/` with the supplied Grafana references; record any accepted deviation before client capture. |

## Evidence, approval, and disposition

Runtime evidence is restricted to redacted `manifest.json`, `result.json`, and an optional `triage.json` below ignored `artifacts/qa/client-demo/<run-id>/`. It contains safe checkpoint outcomes and cleanup results, never credentials, raw content, request bodies, browser profiles, screenshots, or recording files.

| Deliverable | Owner role | Approval criterion | Retention/disposition |
|---|---|---|---|
| Local runtime manifest/result | Founder (self-review) | redaction scan passes; all recorded values are synthetic; cleanup succeeds | ignored local evidence; dispose under normal local-artifact policy. |
| Presenter narrative | Founder (self-review) | route, pauses, and readiness limits are accurate | version-controlled Markdown. |
| Optional visual or recording | Founder (self-review) | founder review of redaction and story accuracy; no independent-approval claim | `not-created` by default; unsafe/unapproved material is discarded. |

## Stop rules and external gates

Stop immediately for a non-loopback target, a credential/customer-data prompt, raw-content capture, or a fixture failure. Do not make manual database repairs. UXF-006 external evidence remains unavailable or unresolved for Safari/macOS, NVDA/VoiceOver, Electron host smoke, runtime performance, visual-baseline approval, canary approval, and release sign-off; founder ownership is explicit for this early-stage decision.
