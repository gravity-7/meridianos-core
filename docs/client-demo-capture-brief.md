# Client Demo Capture Brief

## Default disposition

No screenshot, recording, or client-facing capture is created by this package or an ordinary demo run. Every planned asset begins as `not-created`. At the current pre-customer stage, the Founder performs the product, UX/design, security/privacy, and demo review as a **Founder self-review**, not an independent approval.

## Required pre-capture checks

1. Use a clean synthetic fixture and a loopback URL only.
2. Confirm no provider key, customer record, payment/email data, terminal output, local path, raw request, browser profile, or unsupported readiness claim is visible.
3. Use the specified viewport and the required route: `/setup` for onboarding and the local cloud server root `/` for client operations. Do not capture `/app/setup` as an implementation route or `/cloud/dashboard/index.html` as a live route.
4. Record the run ID, synthetic classification, owner as `Founder (self-review)`, viewport, redaction result, reviewer, and approval date in a later human-created manifest.

For a Spec 017 platform-board capture, use the normal local dashboard `/` only after the above checks. The required composition is the persistent dark left rail plus dense stat, graph, gauge/circled-meter, bar-gauge, table, heatmap, alert/list, activity, and integration-status families. Capture remains optional and `not-created` by default; no automatic screenshot or recording is produced by the implementation.

## Curated shot list and optional recording segments

| Shot ID | Workflow | Required state | Viewport | Narration / approval | Disposition |
|---|---|---|---|---|---|
| `onboarding-welcome` | onboarding | synthetic `/setup` welcome | 1280×800 | local-only opening; Founder self-review | not-created |
| `onboarding-review` | onboarding | review-before-commit | 1280×800 | no write before explicit final action; Founder self-review | not-created |
| `onboarding-completion` | onboarding | synthetic completion | 1280×800 | cleanup follows; Founder self-review | not-created |
| `client-sign-in` | client operations | local root sign-in | 1280×800 | fixture-only account; Founder self-review | not-created |
| `client-machines-health` | client operations | connected machines and aggregate health | 1280×800 | deterministic local display data; Founder self-review | not-created |
| `client-policy-preview` | client operations | eligible targets and no-push text | 1280×800 | preview only; Founder self-review | not-created |
| `client-confirmation-boundary` | client operations | explicit confirmation and rollback wording | 1280×800 | default stop point; Founder self-review | not-created |
| `client-cleanup-result` | client operations | redacted teardown result, never terminal/raw log | 1280×800 | disposable cleanup; Founder self-review | not-created |
| `platform-root-board` | platform dashboard | root board with active rail and cost/token/budget circled meters | 1280×800 | Grafana-inspired hierarchy; Founder self-review | not-created |
| `platform-root-mobile` | platform dashboard | 320px drawer, scope controls, panels without horizontal scroll | 320×800 | mobile responsive check; Founder self-review | not-created |

Optional recording follows the same order: synthetic-session label, entry route, each required pause, and cleanup. It must omit keys, local paths, terminal output, raw requests, browser profiles, customer data, and external-service claims. Do not record an optional confirmation unless it is announced as fixture-only.

## Manifest, approval, discard, and recovery

Any later human-created capture manifest must contain only `shotId`, run ID, `local-synthetic` classification, viewport, redaction result, capture owner, reviewer, approval date, and disposition. The approval criterion is a recorded Founder self-review of redaction and story accuracy; local-demo success alone is insufficient.

If any unsafe value, unredacted local path, unsupported readiness language, or non-synthetic material appears, discard the entire capture and its manifest reference, mark it `discarded`, close the fixture, and restart a fresh local session. Never retain failed captures as runtime evidence.
