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

## Implementation validation record — 2026-08-12

| Evidence | Command | Result | Duration |
|---|---|---:|---:|
| Management authorization, cross-tenant denial, secret containment, audit, integration, concurrent state isolation, webhook idempotency/outbound eligibility, durable invitations/memberships, billing, router, cloud policy, and route contracts | `node --test tests/management-*.test.mjs tests/api-webhooks.test.mjs` | 19 passed, 0 failed | 345ms |
| REST/v1, dashboard compatibility, auth, and invitation regression | `node --test tests/server.test.mjs tests/dashboard-api-compatibility.test.mjs tests/api-v1.test.mjs tests/integration/test-auth-http.mjs tests/integration/test-invitation-lifecycle.mjs` | 73 passed, 0 failed | 1.1s |
| Full native suite | `npm test` | 1,630 passed, 0 failed, 10 skipped | 24.8s |
| Complete supported-browser suite against the real dashboard server (no management API stubs) | `npm run test:browser` | 48 passed (Chrome, Edge, Firefox) | 1.2m |
| Whitespace | `git diff --check` | clean | <1s |

Browser evidence verifies the real dashboard-server API path, labelled controls, Back/Forward navigation, keyboard access to the skip link, 320px viewport, reduced-motion media, one-time key disclosure cleanup, and absence of the disclosed value after close. Accessibility found no issues with forced colors, 2x zoom, and reduced motion. Performance p95 was 25.6ms (Chrome), 22.7ms (Edge), and 58ms (Firefox), all below the 500ms budget. The management router tests prove server-derived scope, non-disclosing denial, one-time material consumption, serialized tenant state, audit serialization/redaction, durable replay delivery, durable invitation/membership authority, and replay duplicate prevention. Audit coverage includes allowed, denied, failed, cancelled, duplicate, and conflict outcome paths through the shared serializer; public REST/v1 and gateway-metering compatibility remain protected by the full suite.
