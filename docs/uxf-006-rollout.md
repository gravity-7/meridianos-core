# UXF-006 Rollout, Canary, and Rollback

UXF-006 is additive. Search, the command palette, responsive hardening, privacy-safe telemetry, and cloud policy preview are enabled only after the existing route/API/auth contracts pass. Legacy routes remain available throughout the canary.

## Flags

| Flag | Default | Scope | Safe disable behavior |
|---|---|---|---|
| `uxf006.search` | off until canary | tenant/project | Hide the search trigger and retain normal navigation |
| `uxf006.telemetry` | off | local installation | Drop UXF events; no product behavior changes |
| `ui_platform.realtime` | policy-controlled | tenant/project | Stop SSE and continue polling/manual refresh |
| `cloud.policy_preview` | on for admin canary only | organization | Retain existing policy form/API path if preview is unavailable |

Flags must be resolved server-side or from policy, never from an untrusted role/query parameter. The current native shell has no remote flag service; deployment owners must map these names to the existing policy/feature-flag mechanism before enabling a production canary.

## Canary sequence

1. Record the commit, policy snapshot, database backup identifier, browser evidence, and parity-ledger revision.
2. Enable `uxf006.search` for an internal tenant/project cohort with an assigned owner.
3. Exercise login, scoped search, command navigation, operations refresh, SSE reconnect/poll fallback, and cloud preview/confirmation using non-secret fixture data.
4. Observe privacy-safe events only: event name, normalized route, pseudonymous scope, role, feature flag, duration, outcome, and timestamp. Never collect search text, prompts, API keys, webhook secrets, or raw request content.
5. Compare error rate, fallback rate, p75/p95 performance, a11y defects, and legacy-route usage against the approved scorecard. The scorecard owner and thresholds remain human gates.
6. Expand only after the canary owner records the decision and a second release-candidate review passes.

## Rollback

- Disable `uxf006.search` and `cloud.policy_preview`; normal links and the existing policy API remain available.
- If the realtime pilot regresses, set the policy realtime flag off. The coordinator falls back to polling/manual refresh; do not delete event history.
- Restore the tagged dashboard asset or revert the additive commit only through the normal release process. Preserve database/policy backups and audit logs.
- For a confirmed cloud policy preview, use the server rollback boundary. It records whether external effects are reversible; it does not claim to reverse external machine side effects.
- Open an incident with commit, tenant/project scope, flag state, correlation ID, exact symptom, and whether secrets or raw content were exposed (they must not be copied into the report).

## Human gates still open

Named rollout owner, canary cohort, final scorecard/thresholds, accessibility/performance exception authority, architecture/dependency ADR, reviewer identities, manual NVDA/VoiceOver evidence, and release approval are intentionally `TBD`.
