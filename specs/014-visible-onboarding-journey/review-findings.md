# Phase 1 Review Findings — Secure Onboarding MVP

**Scope:** T001–T014 only. Phase 2 automation/recovery and Phase 3 canary work were not started.

## Outcome

All review perspectives completed with no remaining actionable Phase 1 findings after fixes:

- Architecture: clean after re-review.
- Security: clean after re-review.
- Production readiness: clean after re-review.
- Test quality: clean after re-review.
- Correctness: clean after final re-review.

## Findings fixed during review

- Validation sessions now revoke replaced, cancelled, and expired credentials/reviews; each served
  `/setup` page receives its own short-lived session identifier.
- Review and commit require a live browser session, exact redacted-review binding, and an explicit
  confirmation; every generated setup target remains no-overwrite even with legacy `--force`.
- Setup validation uses only version-controlled trusted provider metadata, rejects redirects, and
  has focused denial coverage before a fetch can be sent. Mutable policy and local-provider
  endpoint overlays cannot receive a submitted credential.
- Legacy CLI setup no longer imports an inherited provider value and now writes placeholders only.
- `/app/setup` redirects to the implemented legacy `/setup` bridge and does not claim a unified
  onboarding route exists.
- Focused tests cover unauthenticated secret-facing routes, unsupported provider/model rejection,
  browser-session isolation/expiry, cancellation, review/commit behavior, storage whitelist, and
  no-overwrite cleanup behavior.

## Focused validation

All data was synthetic; provider conformance uses exact loopback dependencies only.

```text
node --test tests/setup-onboarding-contract.test.mjs tests/setup-wizard-core.test.mjs tests/provider-wizard.test.mjs tests/provider-conformance.test.mjs tests/server.test.mjs
# 90 passed

node --test --test-name-pattern="setup --init" gateway/tests/cli.test.mjs
# 3 passed
```

No full `npm test` run, browser automation, live provider request, key use, commit, push, or PR
was performed.
