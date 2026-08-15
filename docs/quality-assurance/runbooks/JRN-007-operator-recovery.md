# Operator task recovery and escalation

- **journey_id: JRN-007**
- **Persona:** Organization operator
- **Classification:** DETERMINISTIC-SIMULATED
- **Synthetic data: yes**
- **Review status:** REVIEWED-FOR-INTERNAL
- **Runbook reviewed:** 2026-08-14

## Customer value

An operator can complete allowed work and handle a routine failure safely,
without silently acquiring administrative authority.

## Preconditions

Use `organization_roles` with an assigned generated task and deterministic
runner failure. Provider traffic is simulated through the test gateway.

## Visible steps

| # | Screen | Action | Expected visible result |
| --- | --- | --- | --- |
| 1 | Assigned task | Open generated task | Assignee, state, and allowed actions are clear. |
| 2 | Task workflow | Run the deterministic task | Running then recoverable failure state is visible. |
| 3 | Recovery | Follow retry guidance once | Retry result is recorded without duplicate hidden work. |
| 4 | Escalation | Escalate the unresolved generated issue | Escalation records context and preserves task history. |
| 5 | Restricted action | Attempt an admin-only action | Denial is visible and no state changes. |

## Recovery

The fallback is escalation, not repeated retries or policy bypass. A blocked
operator records the reason and hands the task to the named permitted role.

## Truth and claim boundaries

Task results and failures are deterministic. This run proves the intended
recovery UX/permission boundary, not a real model's production reliability.

## Evidence

Keep trace, console summary, and generated task IDs in `artifacts/qa/<run-id>/`.
