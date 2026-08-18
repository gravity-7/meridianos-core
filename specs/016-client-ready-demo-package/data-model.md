# Data Model: Client-Ready Demo Package

## DemoSession

| Field | Meaning | Validation |
|---|---|---|
| `id` | Unique local run identifier | Generated per session; safe for filenames/logs. |
| `workflow` | `onboarding` or `client-operations` | Exactly one workflow per launcher run. |
| `route` | Printed local entry route | `/setup` for onboarding; local cloud-server root route for client operations. |
| `status` | `started`, `passed`, `abandoned`, `failed`, or `cleanup-failed` | Terminal state must include a cleanup outcome. |
| `startedAt`, `endedAt` | Safe timestamps | No browser history or identity metadata. |
| `checkpoints` | Ordered presenter checkpoint records | Contains visible state and outcome, never secrets or raw payloads. |
| `cleanup` | `removed` or `failed` | Failure blocks reuse of the session fixture. |

## SyntheticDemoDataset

| Field | Meaning | Validation |
|---|---|---|
| `label` | Visible fictional dataset label | Must include `synthetic` and `disposable`. |
| `organization` | Fictional local organization name | Reserved non-customer value only. |
| `presenterAccount` | Fixture-only local cloud sign-in identity | Never a real email/account and never persisted after cleanup. |
| `machines` | Small fixed set of machine display records | Fictional name, OS, version, status, and timestamps only. |
| `health` | Aggregate provider-health display state | No provider request or real diagnostic content. |
| `policyExample` | Path/value used for preview | Allowlisted, non-sensitive, deterministic. |

## PresenterCheckpoint

| Field | Meaning | Validation |
|---|---|---|
| `id` | Stable checkpoint identifier | Unique within a DemoSession. |
| `screen` | Visible screen/decision point | Must map to the runbook. |
| `narrative` | Founder-facing explanation | Must state local/synthetic boundary where relevant. |
| `pause` | Whether a human pause is required | Required for review-before-commit and policy confirmation boundary. |
| `expected` | Observable condition | Verifiable without source-code inspection. |
| `recovery` | Safe restart instruction | Must not ask for manual database/profile manipulation. |

## EvidenceRecord

| Field | Meaning | Validation |
|---|---|---|
| `kind` | `manifest`, `result`, `triage`, `capture-reference`, or `approval` | No raw trace, request body, credential, or browser profile. |
| `location` | Ignored local artifact path or approved external reference | Must be safe to disclose to the designated owner. |
| `ownerRole` | Founder/Demo, Demo Engineering, Product/UX, or Security/Privacy | Named owner remains a human decision. |
| `classification` | `local-synthetic` or `human-approved-capture` | Local synthetic evidence never implies release readiness. |
| `redactionStatus` | `passed`, `failed`, or `not-applicable` | `failed` requires discard and rerun. |

## CaptureBrief

| Field | Meaning | Validation |
|---|---|---|
| `shotId` | Stable curated shot/segment name | Matches runbook and file naming convention. |
| `workflow` | Workflow it depicts | Must be one of the supported workflows. |
| `viewport` | Required capture viewport | Fixed by the brief before capture. |
| `approval` | Required owner approval role | Capture cannot be presented as approved without it. |
| `disposition` | `not-created`, `approved`, or `discarded` | Defaults to `not-created`. |

## State Transitions

`DemoSession`: `started` → `passed` or `abandoned` or `failed` → cleanup `removed` or `cleanup-failed`.

`CaptureBrief`: `not-created` → `approved` only after a human creates, redaction-checks, and approves a capture; any unsafe capture transitions to `discarded`.
