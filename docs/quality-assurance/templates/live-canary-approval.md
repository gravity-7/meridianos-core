# Live-canary approval

- **Journey / owner / approver / date:**
- **External system / account type:**
- **Exact cost, data, and time boundary:**
- **Rollback and stop condition:**

## Approval statement

Normal fixture tests must remain simulated. This approval authorizes only the
named, minimal live check. Use a dedicated test account, record no secrets, and
stop immediately if the boundary is crossed.

Store the completed record as `artifacts/qa/<run-id>/canary-approval.json` with
`journey_id`, `run_id`, `approver`, `scope`, `max_spend_usd`, `approved_at`, `expires_at`,
`rollback`, and `stop_condition`. A catalog entry may use `MANUAL-CANARY` only
when that record and its matching evidence manifest validate.
