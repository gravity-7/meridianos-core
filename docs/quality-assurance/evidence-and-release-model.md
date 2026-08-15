# Evidence, visual review, and release model

## Evidence classes and storage

| Class | Purpose | Storage | Sharing rule |
| --- | --- | --- | --- |
| Deterministic automated | Contract/browser proof | `artifacts/qa/<run-id>/` | Internal only |
| Exploratory agent | Bounded investigation | `artifacts/qa/<run-id>/` | Internal only |
| Manual demonstration | Founder rehearsal | Reviewed runbook + approved asset | Clearly labelled synthetic |
| Live canary | Minimal external confidence check | Restricted internal evidence | Approval required |

Each execution creates the [evidence bundle](templates/evidence-bundle.md):
manifest, step result, screenshots, accessibility/keyboard assertions, and
failure-only trace plus triage. CI artifacts are transient. Only a reviewer may
copy a redacted, representative screenshot into a client-safe runbook asset.

## Visual and interaction checks

For every P1 browser journey, prove the expected state at a wide desktop and a
narrow viewport. Exercise keyboard navigation, focus visibility, recoverable
empty/error/loading states, and the path back from a failure. Current browser CI
already has Chromium, Edge, and Firefox paths with HTML reports, failure
screenshots, and traces; screenshot capture is evidence today, not an approved
pixel-baseline program.

| Journey | Wide/narrow | Keyboard/recovery focus | Initial browser target |
| --- | --- | --- | --- |
| JRN-001 setup/BYOK | yes | step progression, invalid-provider retry | legacy `/setup` |
| JRN-003 budget | yes | halt explanation and safe resume | budget panel |
| JRN-005 project/team | yes | creation, member roles, attribution | legacy dashboard |
| JRN-007 operator recovery | yes | action, retry, escalation, denial | task workflow panel |
| JRN-008 viewer boundary | yes | read-only and forbidden mutation | dashboard panels |
| JRN-009 provider recovery | yes | validation, unavailable, retry | providers/models panel |
| JRN-013 Docker dashboard | yes | health and safe error surface | deployed dashboard |
| JRN-014 desktop first run | desktop renderer plus constrained narrow window | keyboard wizard progression, locked-keychain recovery, and dashboard handoff | Electron renderer; separate approved real-device smoke only |

## Release scorecard rule

P1 status is never inferred from a green unrelated suite. A P1 row becomes
`PASS` only with a current, matching fixture revision and evidence bundle. A
`MANUAL-CANARY` row also needs a dated, approved canary record. Use `BLOCKED` or
`SKIPPED` when that is the truth, identify its owner, and record the next action in
[release-scorecard.md](release-scorecard.md). Evidence is stale after the
configured release window or any material journey/fixture change. The initial
window is **14 calendar days**; it becomes stale immediately after a material
journey, fixture, gateway, provider, role, billing, or desktop change.
