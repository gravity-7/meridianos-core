# First value through the legacy `/setup` BYOK compatibility bridge

- **journey_id: JRN-001**
- **Persona:** First-time individual operator
- **Classification:** DETERMINISTIC-SIMULATED
- **Synthetic data: yes**
- **Review status:** REVIEWED-FOR-INTERNAL
- **Runbook reviewed:** 2026-08-14

## Customer value

An individual can choose a registered provider/model route, validate it through
a one-time server-side handoff, inspect a redacted budget review, and explicitly
create a new local setup without blindly writing configuration.

## Preconditions

Use a new root with no `.ai/policy.yaml`, `.ai/tenant.yaml`, or `.env`. Phase 1
has focused synthetic HTTP coverage only; the isolated loopback fixture, headed
walkthrough, and browser evidence are Phase 2 work. Do not use a real key in a
standard test or walkthrough.

The catalog is derived from version-controlled trusted registry metadata;
installation-local endpoint overlays are excluded. DeepSeek is registered; Z.ai GLM is not a
registered setup option and must not be presented as supported. A manual
DeepSeek-only canary is Phase 3 preparation, not a standard run.

## Visible steps

| # | Screen | Action | Expected visible result |
| --- | --- | --- | --- |
| 1 | `/setup` welcome | Enter generated workspace name | Step 1 advances only with valid local input. |
| 2 | Agent roster | Keep generated agent names | The roster preview is visible and editable. |
| 3 | Provider connection | Select a registered provider and model; submit a key once | The browser retains no raw key. A successful opaque validation ID permits the next step. |
| 4 | Budget | Set generated budget limit | Limit is shown in the review, with gateway enforcement named. |
| 5 | Review | Inspect the route, budget, and file summary; explicitly confirm | The review has no `.env` content or key. Only the final action writes a fresh local configuration. |

## Recovery

A safe authorization, timeout, or unavailable result blocks review and commit
without reflecting the submitted value, endpoint, headers, or response body.
Changing provider/model, going back, or closing the page revokes an active
validation; the individual may re-enter a key to validate again. Detailed fixture-driven
failure/retry evidence is Phase 2 work. If any setup target already exists,
`/setup` offers only a safe return to the dashboard; it never overwrites it.

## Truth and claim boundaries

`/setup` is the current legacy setup flow and this bridge does not claim that
`/app/setup` exists. Client-review material may show only the selected route,
budget, file names, and approved redacted wording—never a key, validation ID,
request/response, `.env` content, endpoint, browser storage, or raw trace.

## Evidence

Phase 1 has no browser evidence bundle. Phase 2 will add an internal redacted
bundle at `artifacts/qa/<run-id>/`; only reviewed redacted material may be used
for a client-facing explanation.
