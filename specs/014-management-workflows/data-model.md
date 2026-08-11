# Data Model: Management Workflows

## AuthorizationDecision

| Field | Rules |
|---|---|
| `actor_id`, `actor_type` | Authenticated non-secret actor identity and type |
| `tenant_id`, `project_id` | Derived scope; project can only narrow tenant scope |
| `capability`, `target_type`, `target_id` | Requested operation and safe target identity |
| `policy_version`, `role`, `decision`, `reason_code` | Reproducible allow/deny decision evidence |
| `correlation_id`, `created_at` | Link request, audit, UI feedback, and support record |

## CredentialDisclosure and ApiKeyCredential

`ApiKeyCredential` stores only non-secret identity, name, scopes, active state, replacement lineage, overlap/revocation boundaries, and timestamps. `CredentialDisclosure` is response/in-memory state only: opaque one-time nonce, key ID, expiry, consumed/cleared timestamps, and no material field in persistent storage or audit.

State transitions: `active -> rotating(overlap) -> revoked` or `active -> revoked`; a suspected-key emergency action may skip overlap. A replacement cannot reactivate its predecessor.

## ProviderTestAttempt

Scoped immutable record: provider/integration ID, configuration revision, actor/authorization, status category, requested/started/finished time, bounded retry count, redacted diagnostic class/detail, correlation, and audit link. It never contains submitted credentials or raw upstream bodies.

## WebhookDeliveryAttempt and WebhookReplay

Attempt evidence includes opaque ID, webhook ID, event identity, delivery timestamp, attempt number, terminal/safe result, redacted response/error, retention expiry, and payload disclosure classification. `WebhookReplay` owns `delivery_id`, monotonically increasing `generation`, idempotency key, actor/reason/authorization, state, outbound result, correlation, and audit link. Unique `(delivery_id, generation)` prevents duplicate replays.

## Invitation and Membership

Invitation adds tenant scope, project scope, role, issuer, target email identity, token hash/reference, expiry, status (`pending`, `accepted`, `expired`, `cancelled`, `superseded`), predecessor/replacement link, version, and evidence links. Membership exposes effective role, explicit role, scope, permissions snapshot/version, and change audit; raw invitation token is never listed.

## ManagementAuditEvent

Append-only event: event ID, actor, authorization decision, tenant/project scope, target, declared intent/reason, outcome (`allowed`, `denied`, `failed`, `cancelled`, `duplicate`, `conflict`, `succeeded`), correlation, safe before/after summary, disclosure class, retention boundary, and timestamp. The event schema explicitly excludes secret material, raw credential headers, raw webhook payloads, and unauthorized target identifiers.

## BillingSecurityTenantState and PolicyPush

State response identifies source (`local` or `cloud`), availability mode (`normal`, `read_only`, `degraded`, `unavailable`), limits/entitlements, security checks, settings revision, and authorized actions. A policy push contains previewed target set/diff, confirmation evidence, version/rollback boundary, target outcomes, and correlated audit events. Rollback references a compatible prior version; it cannot imply reversal of external side effects.
