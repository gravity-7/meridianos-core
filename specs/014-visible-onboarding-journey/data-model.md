# Data Model: Visible Onboarding Journey

## Setup Provider Choice

| Field | Meaning | Rules |
| --- | --- | --- |
| provider_id | Registered provider selected by the new administrator | Must exist in the version-controlled trusted setup-provider registry and support BYOK; installation-local overlays are excluded. |
| model_id | Model route selected for initial use | Must be an offered model for the provider; never inferred from an unrelated provider. |
| key_environment_name | Name of the approved secret location | Derived from the registry; shown to the user only as a name. |
| route_summary | Non-secret route and capability summary | Derived from registered metadata; safe for review and evidence. |

## Provider Validation Session

| Field | Meaning | Rules |
| --- | --- | --- |
| validation_id | Opaque server-issued identifier | Random, short-lived, bound to the setup session, and never treated as a credential. |
| provider_id / model_id | Validated choice | Must match the choice used at review and commit. |
| outcome | `valid`, `invalid`, `timeout`, or `unavailable` | Only `valid` permits review/commit. |
| safe_summary | User-facing outcome and recovery guidance | Must not include the secret, raw request/response, headers, or internal hostname. |
| expires_at | Last usable time | Expiry, cancellation, replacement, or commit destroys retained secret material. |

The raw credential is intentionally not an entity field. It is an in-memory, server-owned value associated with a valid session for the shortest practical time and is never persisted in browser state, a plan preview, logging, or evidence.

## Setup Review

| Field | Meaning | Rules |
| --- | --- | --- |
| installation_name | Requested local installation label | Non-empty after normalization. |
| agent_roster | Requested agent names | At least one name. |
| selected_route | Provider/model route being committed | Must correspond to an unexpired successful validation. |
| monthly_budget_usd | Monthly amount | Positive number. |
| file_summary | Names and redacted descriptions of generated files | Must never contain `.env` content or a key value. |
| commit_confirmed | Whether the final action was requested | Only an explicit final action may write files. |

State transition: `draft → validating → valid | recoverable_failure → review → committed | cancelled | expired`. A review may return to a safe earlier draft; `committed`, `cancelled`, and `expired` destroy the validation session.

## Visible Fixture

| Field | Meaning | Rules |
| --- | --- | --- |
| run_id | Unique execution identifier | Included in redacted evidence. |
| temporary_root | Disposable application root | Must be created for this run and removed during cleanup; its absolute path is not retained in sharable evidence. |
| dependency_mode | `loopback-simulated` | Standard runs reject all other modes. |
| viewport | Desktop or narrow browser dimensions | Both are required for the P1 journey. |
| safety_result | Egress and sentinel-scan outcome | A nonzero external attempt or sentinel disclosure fails the run. |

## Evidence Record

| Field | Meaning | Rules |
| --- | --- | --- |
| journey_id / fixture_revision / run_id | Identity and reproducibility | Required by the existing evidence contract. |
| checkpoints | Expected/actual/outcome per user-visible state | Includes pre-commit, commit, and recovery states. |
| diagnostics | Sanitised browser/HTTP/storage summary | Includes key names and statuses only; no values, bodies, headers, cookies, or raw paths. |
| review_class | `internal` or `client-approved` | A standard run begins as internal. |
| retention | Evidence retention boundary | Must be finite and recorded. |
