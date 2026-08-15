# Setup Onboarding Contract

This is the intended contract for the legacy-setup compatibility bridge. It deliberately describes only non-secret browser-visible data.

## Provider catalog in setup status

`GET /api/setup/status` returns existing-installation status and a safe setup-provider catalog. A catalog item contains a registered identifier, display name, supported model choices, and key-environment variable name. It is derived only from the version-controlled trusted provider metadata; policy and `.ai/providers.yaml` endpoint overlays never enter first-time credential validation. It never contains an environment value, a key, or an internal endpoint.

## Validate a provider choice

`POST /api/setup/provider-validation` accepts a provider identifier, model identifier, and a one-time key submission over the already authenticated local dashboard connection.

On success, it returns:

```json
{
  "ok": true,
  "validation": {
    "id": "opaque-validation-id",
    "status": "valid",
    "provider": "deepseek",
    "model": "deepseek-v4-flash",
    "summary": "Connection verified. Continue to budget."
  }
}
```

Only one validation is active for a browser setup session. A replacement validation promptly
destroys the previous validation and any review bound to it; all validation state is removed when
it expires or is consumed.

Each `GET /setup` response receives a distinct short-lived browser session identifier in its page
source; setup status does not issue a process-wide session identifier. `POST
/api/setup/provider-validation/revoke` is an authenticated, idempotent cancellation operation for
that session. The client calls it when the provider/model changes, the user goes back, or the page
is abandoned, so a key is not retained until expiry when the user cancels.

Browser-session expiry itself revokes every validation and review for that session. Review and
commit both require the browser session to remain live, so an opaque validation identifier cannot
extend the session or be used after it expires.

On recoverable failure, it returns a stable safe code and recovery message, for example `AUTH_FAILED`, `TIMEOUT`, or `UNAVAILABLE`. Validation rejects redirects rather than following a provider-controlled destination. It does not echo a submitted key, raw endpoint, response body, or headers. A failure does not create a usable validation identifier.

## Create a review preview

`POST /api/setup/plan` accepts non-secret setup choices and an unexpired validation identifier. It returns an opaque review identifier plus a redacted review: installation name, agents, selected provider/model route, budget calculation, and generated file names/descriptions. It does not return file content that can contain a credential. The same bounded, safe installation name, agent roster, and positive budget validation is used for this review and for commit.

The endpoint is pure: it creates no application configuration and does not extend the secret-handoff lifetime merely by being viewed.

## Commit a setup

`POST /api/setup/commit` accepts the same non-secret setup choices, matching opaque review and validation identifiers, and an explicit confirmation. It validates that the redacted review and validation match exactly, writes only to the configured disposable or customer installation root, then destroys the validation session. It refuses a normal first-run commit if any generated target already exists, including `.ai/policy.yaml`, `.ai/tenant.yaml`, or `.env`; no `force` flag can override this, and the user receives a safe return/recovery path.

## Standard fixture network contract

The standard fixture permits only exact credential-free loopback HTTP(S) origins. The browser may call only its exact dashboard origin. The dashboard validation path may call only the fixture's loopback provider/gateway. Redirects, non-loopback URLs, inherited provider credentials, payments, mail, and external browser navigation fail the run before a request is sent.

## Route boundary

The implemented first-time setup surface is legacy `/setup`. `/app/setup` explicitly redirects to
`/setup`; it is not a delivered unified onboarding route.

## Evidence contract additions

Each run stores the existing required manifest/result fields plus:

- loopback attempt count and redacted method/origin/status list;
- fixture cleanup result;
- sentinel scan results for rendered DOM, URLs, browser storage, console output, and textual artifacts;
- no trace archive unless a separate trace-redaction contract has been approved.
