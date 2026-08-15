# Budget warning, halt, and safe resume

- **journey_id: JRN-003**
- **Persona:** Experienced individual operator
- **Classification:** DETERMINISTIC-SIMULATED
- **Synthetic data: yes**
- **Review status:** REVIEWED-FOR-INTERNAL
- **Runbook reviewed:** 2026-08-14

## Customer value

The operator can see budget protection react predictably, understand why work
stopped, and resume only through a permitted, controlled action.

## Preconditions

Use `solo_byok` with a seeded synthetic task and frozen generated usage ledger.
Model traffic is a loopback response passing through the test gateway; no real
provider account or spend is used.

## Visible steps

| # | Screen | Action | Expected visible result |
| --- | --- | --- | --- |
| 1 | Budget policy | View generated monthly limit | Current limit and usage basis are visible. |
| 2 | Task/run state | Execute a deterministic usage increment | Warning state appears before the limit is crossed. |
| 3 | Budget/task state | Execute the next bounded increment | Gateway halt and its reason are visible. |
| 4 | Recovery | Choose permitted resume after reviewing policy | Resume requires an intentional administrator action. |
| 5 | Ledger | Inspect resulting entries | Simulated usage and enforcement decision are attributable. |

## Recovery

If the operator lacks permission or the threshold remains exceeded, the UI must
keep the run stopped and offer escalation rather than a hidden bypass.

## Truth and claim boundaries

This demonstrates MeridianOS budget-enforcement behavior against a generated
ledger. Dollar values, token counts, and provider usage are simulation fixtures,
not a claim about a live bill.

## Evidence

Retain the ledger/browser evidence only in `artifacts/qa/<run-id>/`; client
material may describe the guardrail but not expose internal traces.
