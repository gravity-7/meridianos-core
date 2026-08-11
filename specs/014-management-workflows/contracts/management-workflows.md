# Management Workflow Contract Evolution

All endpoints are additive management contracts or compatible extensions. Every response uses an authorization-derived tenant/project scope; clients cannot select a broader tenant. Existing `/api/*` and `/api/v1/*` response fields and behaviors remain supported.

| Capability | Read contract | Mutation contract | Safety invariants |
|---|---|---|---|
| Providers | `GET /api/management/providers`, `GET /api/management/providers/:id` | create/update/test/retry/disable | Admin capability, <=10s test deadline, redacted diagnostics, correlation/audit |
| API keys | `GET /api/management/api-keys` | create/rotate/revoke | Create/rotate response has one-time `secret` only; all later records omit it; reauth + typed confirmation for revoke |
| Webhooks | `GET /api/management/webhooks/:id/attempts?cursor=&limit=` | `POST .../attempts/:attemptId/replay` | Opaque cursor, retained terminal-failure eligibility, idempotency key, no raw payload/error disclosure |
| Access | memberships, invitations, effective permissions | invite/resend/cancel/accept/change role | Auth/server scope, expiry/identity/version checks, no foreign tenant disclosure |
| Billing/settings/audit | billing/security/settings/audit detail reads | supported settings/policy preview/confirm/rollback | `environment` + `mode`, preview/confirmation/rollback boundary, disclosure-filtered audit |

## Common mutation envelope

Request: `intent`, optional bounded `reason`, expected resource version where applicable, and required confirmation/reauth proof for high-risk actions. Response: `outcome`, safe target summary, `correlation_id`, audit `href`, current version, and an action-specific safe recovery description. Errors never include a secret, raw provider diagnostic, raw webhook payload, or foreign resource identity.

## Compatibility rules

1. Existing `/api/v1/api-keys`, provider, and webhook routes retain their method, URL, authentication, and payload contracts.
2. Existing webhook delivery signatures and standard retry semantics do not change; replay is separately identified and correlated.
3. Existing dashboard-token and bearer-key checks are strengthened through server-side decision adapters, never weakened by new UI routes.
4. Local/cloud differences are explicit in the response rather than concealed behind a shared optimistic action.
