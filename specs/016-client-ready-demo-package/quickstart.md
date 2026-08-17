# Quickstart: Client-Ready Demo Package Validation

## Purpose and readiness boundary

This guide records implementation validation and presenter experience. It does not create a screenshot, recording, client-facing capture asset, commit, push, PR, or production claim. A successful local run proves only the stated synthetic local workflow.

## Preconditions

- Node.js 24+ and repository dependencies are already installed.
- A headed Chrome-capable browser is available.
- The presenter can use a free loopback port. The onboarding baseline uses the requested example port 4317.
- No provider key, customer data, payment/email data, external-provider account, or live service is present or required.

## Workflow A: existing visible onboarding baseline

Run the existing supported command from the repository root:

```powershell
node scripts/run-visible-onboarding.mjs --port 4317
```

Expected headed-browser experience:

1. A new Chrome window opens at the launcher's printed local `/setup` URL and reports synthetic, disposable data.
2. Pause at welcome and explain that the walkthrough begins at `/setup`; do not say `/app/setup` is implemented.
3. Advance through agent choices, controlled loopback provider validation, and budget selection. Explain that no real provider, credential, payment, or email service is contacted.
4. Pause at review and explain the review-before-commit boundary.
5. Perform the explicit final action, observe completion, then close the browser or press `Ctrl+C`.
6. Confirm the launcher closes dependencies, writes only redacted safe evidence under `artifacts/qa/<run-id>/`, and removes the temporary onboarding root.

If the browser or process stops early, treat the run as abandoned and rerun from a clean process. Never reuse its temporary root or browser profile.

## Workflow B: visible client operations demo

```powershell
node scripts/run-visible-client-demo.mjs --port 4318
```

Expected headed-browser experience:

1. The launcher starts a temporary local cloud control plane, prints a loopback root URL, and opens it in a headed browser. The visible label identifies the run as synthetic and disposable.
2. Pause at the local root sign-in screen and say the account is a fixture-only local identity; it is not a customer or production account.
3. Sign in with the runbook's synthetic values (`demo-admin@synthetic.invalid` / `fixture-only-passphrase`). Show connected machines and aggregate provider health; explain that values are deterministic display data and no provider call has occurred.
4. Enter the allowlisted policy example and request a preview. Pause at the preview and say that no policy has been pushed.
5. Pause at the explicit confirmation/rollback boundary. The default narrative stops here. If an optional synthetic confirmation segment is later implemented and selected, announce that it has only local fixture effects and follow its prescribed cleanup.
6. Close the browser or press `Ctrl+C`. Confirm the fixture writes redacted evidence only and removes the temporary control-plane database and browser/session state.

The live client route is the local cloud server's `/` route. Do not browse to `/cloud/dashboard/index.html`; that path is an automated-browser test mapping, not the live presenter route.

## Presenter checkpoints and founder narrative

| Checkpoint | What to say | Evidence/recovery |
|---|---|---|
| Local and synthetic | “This is a local, disposable demonstration—not a customer environment.” | Run status and redacted manifest; restart if cleanup fails. |
| Onboarding review | “The configuration is reviewed before the explicit final action.” | Existing onboarding launcher evidence; rerun if interrupted. |
| Client health | “These fictional machines show the operating view without reaching a provider.” | Client fixture result; stop if any non-loopback request is attempted. |
| Policy preview | “This shows who would be eligible; it has not pushed policy.” | Preview checkpoint; discard/restart on fixture failure. |
| Confirmation boundary | “A human acknowledgement is required; rollback language is a boundary, not a promise of external reversal.” | Default stop point; never imply a production action. |
| Readiness question | “This demo does not approve production, releases, Safari/macOS, NVDA/VoiceOver, Electron, performance, canary, or visual baselines.” | Link to Spec 015 external-gate index. |

## Curated visual shots and optional recording

The future capture brief must list, but not automatically create, these shots: onboarding welcome; onboarding review; onboarding completion; client sign-in; client machines/health; policy preview; confirmation boundary; cleanup/result summary. Each shot must use only fixed synthetic values and a declared viewport.

Optional recording requirements: start on the synthetic-session label, show the entry route, narrate each pause point, omit keys/local paths/terminal output/raw requests, end with cleanup, and retain a companion capture manifest. At the current pre-customer stage, the Founder records a founder self-review of narrative and redaction before a recording becomes deliverable. Any unsafe or unapproved capture is discarded, not retained as evidence.

## Evidence, approvals, and deliverables

| Item | Location/format | Owner role | Approval criterion |
|---|---|---|---|
| Local onboarding evidence | Existing redacted `artifacts/qa/<run-id>/manifest.json`, `result.json`, optional `triage.json` | Founder (self-review) | Synthetic label, redaction scan, cleanup result. |
| Local client-demo evidence | Redacted ignored `artifacts/qa/client-demo/<run-id>/` JSON/text | Founder (self-review) | All checkpoints pass, no external request, database/session cleanup succeeds. |
| Presenter runbook | Version-controlled Markdown | Founder (self-review) | Narrative is accurate and limits are stated. |
| Capture brief | Version-controlled Markdown | Founder (self-review) | Shot list uses approved synthetic content and redaction rules. |
| Optional capture | Human-created image/video plus manifest | Founder (self-review) | Founder review of visual/story accuracy and redaction; no independent or production/readiness inference. |

## Explicit external gates

UXF-006 external evidence remains separate: Safari/macOS evidence, NVDA/VoiceOver, Electron host smoke, runtime performance artifacts, visual-baseline approval, canary approval, and release sign-off. The Founder is the named owner at this early stage, but none of the unavailable environment evidence is satisfied by this package or a successful local demo.

## Validation record — 2026-08-16

| Command | Result | Duration | Safe evidence / notes |
|---|---|---:|---|
| `node --disable-warning=ExperimentalWarning --test tests/client-demo-package.test.mjs` | 8 passed, 0 failed | 0.44s | Test-owned temporary fixture roots and `artifacts/qa/client-demo/<run-id>/` records were removed after assertions. |
| `npx playwright test browser-tests/client-demo-package.spec.mjs --project=chrome` | 4 passed, 0 failed | 4.3s | Root-route sign-in, synthetic machine/health state, preview/confirmation boundary, safe sign-in failure, narrow/wide viewports, and the preserved `/setup` baseline; no capture asset created. |
| local headed-Chrome launch/cleanup smoke through `runVisibleClientDemo({ port: 0 })` | Started `http://127.0.0.1:55077/`; cleanup returned `rootRemoved: true`, `dbRemoved: true` | 2.4s | Redacted local runtime evidence only; no screenshot, recording, or client-facing asset was created. |

Unavailable/not claimed: independent human visual approval, Safari/macOS, NVDA/VoiceOver, Electron host smoke, performance approval, visual-baseline approval, canary approval, production/client readiness, and release approval. The Founder is the named early-stage owner; the headed smoke proves only that the local Chrome launch and teardown completed and is not a visual review.

## Founder-approved platform-default validation — 2026-08-17

| Command/check | Result | Evidence boundary |
|---|---|---|
| `node --disable-warning=ExperimentalWarning --test tests/server.test.mjs tests/policy-validate.test.mjs tests/client-demo-package.test.mjs` | 56 passed, 0 failed | Proves the platform root default, `/legacy` fallback, explicit policy opt-out, onboarding boundary, and synthetic demo package contracts. |
| `npx playwright test browser-tests/uxf-006.spec.mjs browser-tests/client-demo-package.spec.mjs --project=chrome` | 8 passed, 0 failed | Chrome-only automated browser coverage; no visual, Safari/macOS, NVDA/VoiceOver, Electron, performance, canary, or release approval is implied. |
| `npx playwright test browser-tests/ui-platform.spec.mjs --project=chrome` | 1 passed, 0 failed | Proves the post-onboarding root URL, including time-scope query parameters, renders the overview and loads the platform header CSS. |
| `npx playwright test browser-tests/client-demo-package.spec.mjs --project=chrome` | 4 passed, 0 failed | Completes the preserved headed `/setup` flow into the new root route; proves the selected time preset persists and scope/refresh actions provide visible completion feedback. Windows fixture cleanup completed without retained test output beyond Playwright's `.last-run.json`. |
| `npm test` | 1,697 passed, 0 failed, 9 skipped | Full repository regression suite; completion does not create unavailable environment or independent-approval evidence. |
| Self-cleaning headed Chrome smoke of a temporary local dashboard server | Opened the local root `/`, found the platform navigation, then closed browser/server and removed the temporary root | Headed local Chrome evidence only; no capture asset or retained fixture was created. |

Founder decision recorded: the platform shell is the early-stage local default at `/`; `/legacy` remains the retained fallback; explicit `ui_platform.enabled: false` returns the local root to that fallback. Founder self-review is the current named ownership model and is not an independent approval.
