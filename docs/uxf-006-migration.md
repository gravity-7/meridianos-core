# UXF-006 Migration and Legacy Compatibility

The migration uses the existing native ES-module shell. It does not introduce React, TypeScript, a component library, a bundler, or a new runtime dependency. Existing `/api/*` and `/api/v1/*` endpoints, auth boundaries, project/tenant scope, gateway-only metering, secrets, and legacy route behavior remain in place.

## Operator migration

1. Keep the current dashboard and cloud static assets available.
2. Apply the UXF-006 feature flags from [uxf-006-rollout.md](./uxf-006-rollout.md) in a non-production policy fixture.
3. Run the focused contract, auth-negative, cross-tenant, privacy, browser, and fallback tests from the feature quickstart.
4. Compare the target route to the [parity ledger](./legacy-parity-ledger.md), including unavailable/retention states and recovery copy.
5. Promote only with an approved canary and rollback record.

## Compatibility guarantees

- Search is read-only, bounded, server-scoped, and returns allowlisted projections. It cannot execute a mutation or reveal an out-of-scope record.
- The command palette is a navigation convenience. Keyboard access does not bypass route authorization.
- SSE is an opt-in transport optimization. Cursor dedupe, reconnect, visibility handling, and polling fallback preserve the existing operational read model.
- Cloud preview/confirm/rollback uses existing server-side recent-authentication and role checks. The browser never supplies an authority-bearing role or tenant scope.
- UXF telemetry is opt-in/local-only and drops non-allowlisted fields before persistence.

## Legacy removal policy

No legacy source or route is removed by this migration. Removal is a later, explicitly approved change after the ledger contains usage-threshold evidence, parity across supported viewports/hosts, passing API/auth/privacy/security gates, two release-candidate approvals, and a tested rollback asset. A failed or incomplete gate leaves the legacy surface enabled.
