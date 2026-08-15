# Provider BYOK validation, model selection, and recovery

- **journey_id: JRN-009**
- **Persona:** Provider and integration administrator
- **Classification:** DETERMINISTIC-SIMULATED
- **Synthetic data: yes**
- **Review status:** REVIEWED-FOR-INTERNAL
- **Runbook reviewed:** 2026-08-14

## Customer value

An administrator can configure a BYOK-shaped provider route, choose an available
model, and recover from a provider outage without showing or retaining a secret.

## Preconditions

Use `provider_failure` and a generated sentinel input against `test/mock-provider.mjs`.
The local mock represents supported provider protocol shapes; it is not a real
provider account and uses no credential.

## Visible steps

| # | Screen | Action | Expected visible result |
| --- | --- | --- | --- |
| 1 | Providers | Add generated route details | Form distinguishes configuration fields from protected secret handling. |
| 2 | Validation | Test the loopback provider | Success is visible without displaying the sentinel. |
| 3 | Models | Choose a mock-discovered model | Selection shows the route through test gateway. |
| 4 | Failure state | Switch mock to unavailable or quota | Error is actionable, non-secret, and retryable where appropriate. |
| 5 | Diagnostics | Inspect redacted result summary | No sentinel appears in UI, storage, URL, console, or shareable evidence. |

## Recovery

Restore the controlled mock success behavior and retry. If validation remains
unavailable, preserve the prior safe configuration and offer escalation; do not
commit an unvalidated route.

## Truth and claim boundaries

This is a BYOK workflow simulation, not proof that a prospect's key is accepted
by an external provider. Model availability and rates are fixture-controlled.

## Evidence

Run sentinel/redaction scans before keeping anything in `artifacts/qa/<run-id>/`.
