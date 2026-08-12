# UXF-006 Support Runbook

## Search unavailable

Confirm the user is authenticated and the selected tenant/project is valid. Capture the HTTP status, correlation ID, route, role, feature-flag state, and duration only. Do not capture the query text or request body. Disable `uxf006.search` for the affected cohort if the additive endpoint is unhealthy; navigation and legacy routes remain available.

## Realtime degraded

Check the visible realtime state and operational server logs by correlation ID. The expected recovery path is reconnect, then polling/manual refresh. Disable the realtime policy flag if repeated reconnects increase load. Do not bypass gateway metering or expose raw event payloads.

## Cloud policy issue

Check the preview ID, authenticated administrator, target eligibility, and audit record. If confirmation fails, no push should be assumed. If a confirmed operation is partially successful, use the server rollback boundary and open an incident; external side effects may not be reversible.

## Release rollback

Disable the relevant feature flag, preserve the policy/database backup and parity-ledger revision, and restore the tagged asset only through the release process. Record the exact commit, cohort, scope, outcome, and evidence links. Never delete legacy assets during incident response.
