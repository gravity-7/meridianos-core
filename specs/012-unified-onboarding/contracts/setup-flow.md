# Unified Setup Flow Contract

This internal dashboard contract extends UXF-001 application boundaries. It is additive and must not alter existing `/api/*` or `/api/v1/*` request/response contracts.

## Common rules

- Browser mutation requests use the established same-origin/per-boot authorization boundary and `Cache-Control: no-store`.
- All inputs are validated before use; server responses use fixed schemas and never echo a secret, authorization header, raw generated file, raw upstream error/body, or provider request URL.
- Browser request secret fields are single-use and must not be stored in draft state or logged. Electron must not send a secret to these browser endpoints.
- A commit requires the latest draft revision, a `valid` result for its selected provider, a positive budget, and explicit review confirmation.

## Browser setup status

`GET /api/onboarding/status`

Returns only preflight and non-secret capability data:

```json
{
  "ok": true,
  "installation": "fresh|configured|repair_needed",
  "providers": [{ "id": "string", "label": "string", "requiresCredential": true }],
  "compatibility": { "legacySetupAvailable": true }
}
```

## Provider validation

`POST /api/onboarding/provider-validation`

Request contains a non-secret draft subset plus a single-use `credential` field. The credential is used only in request memory and is cleared before returning.

```json
{
  "draftRevision": "string",
  "provider": { "id": "string", "metadata": {} },
  "credential": "single-use-secret"
}
```

Response:

```json
{
  "ok": true,
  "result": {
    "providerId": "string",
    "status": "valid|invalid|unreachable|timeout",
    "retryable": true,
    "messageCode": "provider_auth_failed",
    "latencyMs": 123,
    "modelsFound": 4,
    "testedAt": "2026-08-11T00:00:00.000Z"
  }
}
```

An invalid/malformed request returns a non-secret validation failure. A validation failure never writes configuration or a credential.

## Sanitized preview and commit

`POST /api/onboarding/preview` accepts a non-secret `OnboardingDraft` and returns a `SetupReview` summary and changed file names only. It cannot return generated `.env` content.

`POST /api/onboarding/commit` accepts the reviewed draft plus a one-time browser credential only when the selected provider requires it. It stages/validates the full non-secret configuration before final write and returns:

```json
{
  "ok": true,
  "outcome": "committed|rejected|recovery_required",
  "filesWritten": [".ai/policy.yaml", ".ai/tenant.yaml"],
  "checklist": {
    "firstTaskTarget": "string",
    "firstRunTarget": null
  }
}
```

Existing configuration, stale validation, failed review confirmation, credential-store failure, and partial-write recovery are returned as allow-listed result codes with a recovery action. They never cause overwrite through a default/implicit `force` value.

## Electron bridge

The preload exposes a narrow `onboarding` capability, not raw IPC:

```text
validateCredential(providerId, credential) -> ProviderValidationResult
storeCredential(providerId, credential) -> { ok, code? }
commitSetup(draft, confirmation) -> CommitOutcome
```

- `providerId` is allow-listed by the main process; values and lengths are validated before keychain access.
- `validateCredential` and `storeCredential` never return credentials or raw keychain/provider errors.
- `storeCredential` writes only to OS keychain. If unavailable, it returns a recoverable code and prevents commit; it never falls back to `.env`.
- The renderer clears its input after every call and the bridge exposes no generic channel or raw Electron object.
