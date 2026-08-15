# Docker deployment reaches the established dashboard safely

- **journey_id: JRN-013**
- **Persona:** Organization administrator
- **Classification:** DETERMINISTIC-SIMULATED
- **Synthetic data: yes**
- **Review status:** REVIEWED-FOR-INTERNAL
- **Runbook reviewed:** 2026-08-14

## Customer value

An administrator can understand the local container deployment path, confirm
safe service readiness, and reach the established operational dashboard.

## Preconditions

Use the generated `solo_byok` manifest with a local compose-style fixture,
loopback provider, and test gateway. This is not a hosted environment and does
not contact a real model provider.

## Visible steps

| # | Screen | Action | Expected visible result |
| --- | --- | --- | --- |
| 1 | Local runtime | Start the named fixture services | Dashboard and gateway report generated health/readiness. |
| 2 | Dashboard root | Open the established dashboard URL | Operational overview loads with generated state. |
| 3 | Health/status | Inspect gateway/provider status | Local simulated route is clearly healthy or safely unavailable. |
| 4 | Fault state | Trigger controlled service unavailability | Dashboard shows a recoverable, configuration-safe error. |
| 5 | Recovery | Restore local service then refresh | Health returns without reusing real configuration. |

## Recovery

Stop the temporary fixture, inspect the local readiness summary, and recreate it
from the manifest. Do not debug against a production compose stack.

## Truth and claim boundaries

This demonstrates a local simulated deployment workflow. It is not a claim of
production hosting, external provider connectivity, uptime, or customer data isolation.

## Evidence

Keep container logs, service names, local paths, and unredacted screenshots
inside `artifacts/qa/<run-id>/`.
