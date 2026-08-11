# Operational Incident Response

Use the Operational overview to find open attention, then follow the labelled alert destination to retained task/run evidence. Severity is textual and non-color-only:

- `critical`: immediate service, spend, or integrity risk;
- `warning`: degradation or threshold risk requiring timely review;
- `info`: awareness without immediate intervention.

Legacy `warn` sources normalize to `warning`. One canonical alert occurrence represents an active episode. Repeated matching signals update its last-seen time and count instead of creating noise. A recurrence after resolution creates a linked new episode.

## Triage and acknowledgement

1. Confirm the URL's project, provider, and exact UTC time scope.
2. Open the alert and its exact affected task/run links. Retention gaps and unavailable fields are explicit; do not infer missing evidence.
3. Acknowledge only when taking ownership of triage. Operator/admin-equivalent mutation authority and a reason are required. Acknowledgement does not resolve the condition and the alert remains visible.
4. Same-severity recurrence while acknowledged suppresses duplicate outbound notification for that occurrence, while in-app evidence still updates. Existing channel cooldown may also suppress delivery. A higher-severity recurrence overrides suppression and is eligible for notification.
5. Resolve with a reason or linked remediation evidence only when the condition is no longer active. Reopen an acknowledged occurrence if ownership must return to active attention.

Lifecycle requests use optimistic versions. A stale request is rejected with a refresh instruction and immutable denied evidence; it must not silently overwrite another actor's decision.

## Safe recovery

Run detail derives recovery from typed outcome, current task state, and existing authorization. Authorized operators/admins may retry a retryable failed run by entering a reason. Retry uses an idempotency key, records intent and outcome, and safely requeues through existing task-state semantics. Finance/viewer access is read-only unless existing policy already grants mutation authority.

Restart is never automatic or the default remediation. It remains an administrator-only sensitive action. The existing restart control requires a reason, affected scope/impact preview, and deliberate confirmation. Provider credentials, notification credentials, and user administration are outside this workflow.

## Audit evidence

Every alert lifecycle, retry, and restart attempt records append-only evidence for both success and failure/denial. Follow the returned audit link and verify:

- actor identity/type and role;
- authorized tenant/project scope;
- target type and stable identifier;
- before/after lifecycle state or action result;
- reason and timestamp;
- correlation identifier;
- definitive result and safe metadata.

Audit and alert evidence exclude prompts, provider bodies, authorization headers, credentials, stack traces, and unrestricted run output. Alert/audit retention defaults to 365 days through validated `dashboard.operations` policy. Cleanup is scoped and never shortens run-log or gateway-ledger retention. The UI discloses earliest available source evidence when older records are gone.

## Realtime and recovery from disconnects

Polling every ten seconds is the default. Realtime SSE is opt-in, same-origin, and scoped. The stream uses ordered IDs and resume; an unavailable cursor causes an authoritative reset/refetch. After three consecutive stream failures, the UI visibly falls back to one polling timer. Hidden tabs pause updates, manual refresh remains available, and stale remote responses cannot overwrite a changed URL scope or a pending local mutation. Demo data disables streaming and every mutation.
