# Evidence bundle: [run ID]

- **Journey / fixture revision:**
- **Commit / runner / browser / viewport:**
- **Started / completed:**
- **Outcome:** PASS | FAIL | BLOCKED | SKIPPED
- **Evidence classification:** INTERNAL | CLIENT-APPROVED

## Required contents

- `manifest.json`: journey, fixture, commit, hashes, timestamps, safety checks.
- `result.json`: expected and actual result for each step.
- Screenshots and, on failure, the Playwright trace.
- Console/network error summary, accessibility/keyboard assertions, and a
  `triage.md` only when the outcome is not PASS.

Never include keys, cookies, authorization headers, user storage, real emails,
or unredacted customer/project data.

For a release `PASS`, `manifest.json` must contain `journey_id`,
`fixture_revision`, `tested_commit`, `run_id`, `completed_at`, `reviewer`, and
`retention_until`. It is valid only for 14 days and only while the journey and
fixture revision remain unchanged.
