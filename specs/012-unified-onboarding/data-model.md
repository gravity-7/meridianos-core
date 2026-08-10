# Data Model: Unified Onboarding

## OnboardingDraft

| Field | Rules |
|---|---|
| `version` | Required schema version for safe invalidation/migration. |
| `status` | `fresh`, `in_progress`, `ready_for_review`, `committing`, `completed`, or `repair_needed`. |
| `lastSafeStep` | Required ordered step identifier; never advances past unvalidated provider or unconfirmed review. |
| `installationName` | Non-empty, user-visible non-secret name. |
| `agents` | At least one normalized non-secret agent name. |
| `provider` | Non-secret provider identity and permitted metadata only. |
| `monthlyBudgetUsd` | Positive finite dollar value. |
| `validation` | Optional sanitized `ProviderValidationResult`; bound to the chosen provider and draft revision. |
| `reviewConfirmed` | False until the administrator explicitly approves the latest preview. |
| `updatedAt` | Non-secret timestamp for resumption/expiry behavior. |

**Forbidden fields**: API keys, authorization headers, raw upstream error/body/URL, generated `.env` content, complete file content, or any secret-derived value.

## ProviderValidationResult

| Field | Rules |
|---|---|
| `providerId` | Matches the provider selected in the draft. |
| `status` | `valid`, `invalid`, `unreachable`, or `timeout`. |
| `retryable` | Boolean; true for recovery states that may be retried. |
| `messageCode` | Allow-listed recovery message identifier. |
| `latencyMs` | Optional non-negative measurement; absent if not safely available. |
| `modelsFound` | Optional non-negative count only. |
| `testedAt` | Non-secret timestamp. |

## SecretHandoff

| Field | Rules |
|---|---|
| `surface` | `browser` or `electron`; determines allowed owner and destination. |
| `providerId` | Allow-listed provider identifier. |
| `purpose` | `validate` or `commit`; single operation only. |
| `state` | `entered`, `in_use`, `stored`, `cleared`, or `failed`; never persisted with the secret. |
| `destination` | Browser: approved environment-secret store at commit; Electron: OS keychain only. |

## SetupReview

Contains draft revision, selected provider identity, agent roster, budget policy summary, changed-file names, confirmation state, and preview timestamp. It must not contain secret fields or raw generated file contents.

## FirstValueChecklist

| Field | Rules |
|---|---|
| `providerValidated` | Derived from latest valid result. |
| `configurationCommitted` | Derived from successful commit outcome. |
| `firstTaskTarget` | Stable documented task-create/import destination. |
| `firstRunTarget` | Stable identified-run destination, unavailable with a clear reason until the run exists. |
| `completedAt` | Optional completion timestamp. |

## SetupLifecycleEvent

Captures event type, non-secret actor/surface, draft revision, provider ID, result code, timestamp, and correlation ID. Allowed events include start, draft resumed, validation result, review viewed, commit result, completion, and recovery. Credentials and raw provider responses are prohibited.
