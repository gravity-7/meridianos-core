# Deep Review Findings

**Date:** 2026-08-14
**Branch:** `main` (the workspace was not on a numbered feature branch)
**Rounds:** 3 iterative fix/review rounds
**Gate outcome:** PASS
**Invocation:** implementation quality gate

## Scope

Reviewed only the Persona Testing Blueprint implementation: the QA catalog,
runbooks, fixture/evidence/release documentation, focused test, and its two
test-only guard helpers. Existing edits to `dashboard/server.mjs` and
`dashboard/metrics.mjs`, plus the separately requested static dashboard preview,
were not part of this review.

## Summary

| Severity | Found | Fixed | Remaining |
| --- | ---: | ---: | ---: |
| Critical | 1 | 1 | 0 |
| Important | 17 | 17 | 0 |
| Minor | 1 | 1 | 0 |
| Notable | 0 | 0 | 0 |

Actual persona fixture servers, browser journeys, and CI artifact
materialisation are intentionally the next feature. The catalog and scorecard
truthfully keep those P1 journeys `BLOCKED`; no feature is represented as
browser-verified today.

## Fixed findings

| Area | Resolution |
| --- | --- |
| Catalog completeness | Added all required persona IDs, product domains, goals, business value, risk, preconditions, synthetic data, controlled dependency scenarios, numbered actions, recovery, verification, truth state, and review status. Raw YAML journey keys are now checked for uniqueness before parsing. |
| P1 browser contract | Added explicit desktop, narrow, keyboard, and recovery fields for every P1, including Docker and Electron renderer paths. |
| Dependency safety | Structured every dependency scenario around success, validation-error, authorization-denied, timeout, and unavailable variants; require P1 references to resolve. |
| Gateway boundary | Added fixture revisions and a required `test-gateway -> loopback-provider` path for provider-bearing journeys, including operator and desktop fixtures. |
| Network egress | Added `persona-network-guard.mjs`, which accepts only exact loopback hosts, records attempted requests, and rejects redirects before a mock can bounce into an external host. |
| Fixture operations | Added manifest lifecycle states, always-run teardown, TTL sweep, and cleanup ownership/escalation rules. |
| Runbook safety | The focused test now checks P1 runbook structure, synthetic-data label, permitted evidence placeholder, and absence of secret-like values, URLs, and internal hostnames. |
| Release evidence | Scorecard now has execution, commit/fixture, evidence, freshness, owner, and next-action fields for every P1. Evidence and canary contracts reject stale, future-dated, mismatched-commit, mismatched-fixture, unretained, or unbound approval records. |

## Review agents

| Agent | Found | Fixed | Remaining | Status |
| --- | ---: | ---: | ---: | --- |
| Correctness | 6 | 6 | 0 | completed and re-reviewed |
| Architecture & idioms | 5 | 5 | 0 | completed and re-reviewed |
| Security | 4 | 4 | 0 | completed and re-reviewed |
| Production readiness | 5 | 5 | 0 | completed and re-reviewed |
| Test quality | 4 | 4 | 0 | completed and re-reviewed |
| Goal alignment | 0 | 0 | 0 | skipped; no PR was present |
| CodeRabbit | 0 | 0 | 0 | skipped; CLI not installed |
| Copilot CLI | 0 | 0 | 0 | skipped; CLI not installed |
| Codex external CLI | 0 | 0 | 0 | unavailable in this environment |

MVP: Test quality (4 findings that materially strengthened the regression guard).

## Test result

`node --test tests/quality-assurance-blueprint.test.mjs` passed with three
tests. The full project test suite was not run.
