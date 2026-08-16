# Live-canary approval — DeepSeek only

This is a non-executable preparation record. It is valid only for a manually
started, user-local DeepSeek canary after the synthetic `/setup` journey has
passed. It never authorizes a standard fixture, browser test, CI job, or any
automatic provider request.

## Required readiness record

Complete every field before a run may be labelled `MANUAL-CANARY`:

- **Journey / run ID:** `journey_id`, `run_id`
- **Named human approval:** `approver`, `approved_at`, and `expires_at`
- **Local key ownership:** `key_owner` names the person who owns the key and
  confirms that it remains only in that person's local environment; never put
  the key value in this record.
- **Provider/model scope:** `provider: deepseek`, the exact registered `model`,
  and a `scope` describing the single minimal check.
- **Finite spend cap:** `max_spend_usd` as a non-negative decimal string.
- **Finite duration cap:** `max_duration_minutes` as a positive integer.
- **Stop condition:** the exact condition that ends the run immediately,
  including any unexpected data, destination, error, or cost boundary.
- **Rollback:** the reversible action that restores the pre-run state.
- **Evidence classification:** `evidence_classification:
  LIVE-CANARY-RESTRICTED`; retain only redacted internal evidence.
- **Post-run key revocation:** `key_revocation` names the action and owner that
  revoke/delete the local key after the run, whether it passes or stops early.

The approval is incomplete if any field is absent, stale, non-DeepSeek, or not
finite. A complete record still does not make a live request; it only makes a
manual canary eligible for a separate human start decision.

## Approval statement

Normal fixture tests must remain simulated. This approval authorizes only the
named, minimal DeepSeek check. Use a dedicated test account, record no secrets,
keep the key in the key owner's local environment, and stop immediately if the
boundary is crossed.

Store the completed record as `artifacts/qa/<run-id>/canary-approval.json` with
`journey_id`, `run_id`, `approver`, `key_owner`, `provider`, `model`, `scope`,
`max_spend_usd`, `max_duration_minutes`, `approved_at`, `expires_at`, `rollback`,
`stop_condition`, `evidence_classification`, and `key_revocation`. A catalog
entry may use `MANUAL-CANARY` only when that record and its matching, passed
synthetic evidence manifest validate.

## Explicit unsupported provider boundary

Z.ai GLM is not registered in the current provider/model registry. It is
unsupported for setup and canary readiness, regardless of whether a user has a
credential. Do not add a Z.ai/GLM approval record until a separate provider
registration and routing feature is implemented and verified.
