# UXF-005 Validation Guide

## Prerequisites

- Node.js 24+ and installed repository dependencies.
- Fixture tenants/projects/roles for admin, operator, viewer, and foreign-tenant actors.
- Isolated provider, webhook receiver, billing-local/cloud, and policy-push fixtures with capture logs that contain no real credentials.

## Required validation sequence

1. Run authorization and secret-redaction tests before any management UI mutation work. Include role-negative, cross-tenant, absent/expired reauthentication, and denied-attempt audit cases.
2. Run provider test/add/retry fixtures. Assert 10-second timeout behavior, categorised/redacted details, no credential leaks, and correlation/audit links.
3. Run API-key create/rotate/revoke fixtures. Inspect DOM after close/reload/navigation and captured URL/history/log/telemetry/audit/error fixtures for absence of the material.
4. Run webhook cursor, retention, terminal eligibility, duplicate/concurrent replay, and outbound-count tests. Confirm an ineligible replay sends zero requests.
5. Run invitation lifecycle, effective-permission, role-negative, cross-tenant, expiry/resend/cancellation, and acceptance-identity tests.
6. Run billing normal/read-only/degraded/unavailable and policy preview/partial failure/rollback-boundary tests for local and cloud fixtures.
7. Run mutation-audit completeness/retention/disclosure tests and frozen existing REST/v1/gateway compatibility suites.
8. Run `npm test`, the management browser suite, supported-browser keyboard/focus/zoom/reduced-motion checks, accessibility scan/manual evidence, and route performance measurements. Record counts and timings in the implementation PR.

## Browser evidence

For provider test, one-time key disclosure, revoke confirmation, webhook replay, invitation, and policy push: record keyboard-only completion, focus restoration to the invoking action, persistent status/error feedback, Back/Forward behavior for detail routes, and absence of secrets in page source/DOM after close.
