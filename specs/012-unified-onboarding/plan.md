# Implementation Plan: Unified Onboarding

**Branch**: `spec/012-unified-onboarding` | **Date**: 2026-08-11 | **Spec**: [spec.md](spec.md)

## Summary

Deliver UXF-003 as one routeable, accessible setup workflow that has identical conceptual steps and normalized outcomes in browser and Electron. The workflow keeps only a non-secret draft, requires a successful provider validation and positive dollar budget before a reviewed commit, uses surface-owned credential storage, and hands successful users to a persistent first-value checklist. It extends the UXF-001 application foundation; legacy `/setup` and the legacy Electron wizard remain selectable for one compatibility release.

## Technical Context

**Language/Version**: Node.js 24+; ES modules (`.mjs`) for application modules, with the existing Electron main/preload CommonJS boundary retained.

**Primary Dependencies**: Existing Node.js built-ins, existing Electron/keytar desktop boundary, and existing browser-test tooling; no new runtime dependency.

**Storage**: Non-secret browser draft storage; policy/tenant configuration files; browser environment-secret file only at explicit commit; Electron OS secure credential storage; existing audit/log facilities. No secret is stored in a browser draft, plan, review, or telemetry record.

**Testing**: Native `node:test` unit/contract/integration tests; existing browser test harness for direct load, keyboard/accessibility, responsive, and state evidence; Electron bridge/keychain tests.

**Target Platform**: Local browser dashboard and packaged Electron desktop application on supported desktop platforms.

**Project Type**: Local Node.js dashboard plus Electron desktop surface.

**Performance Goals**: At least 75% of representative first-time users complete a validated-provider first run in 10 minutes or less; provider validation uses the existing bounded timeout and reports a non-secret recovery state.

**Constraints**: UI platform remains configuration-flagged and legacy-compatible; no `/api/*` or `/api/v1/*` contract regression; gateway remains the only LLM metering path; no new secrets in browser persistence, logs, telemetry, URLs, plan/review output, or test fixtures; Electron stays context-isolated and node integration remains disabled.

**Scale/Scope**: One first-run workflow and its bridge/contract surfaces. Plugin marketplace, advanced tenant provisioning, unrelated Operations-page migration, and legacy removal are excluded.

## Constitution Check

| Principle | Design response |
|---|---|
| Provider & Model Agnosticism | Provider selection and validation consume the declarative provider registry and environment-key references; no provider-specific onboarding flow or hard-coded routing result is allowed. |
| Gateway as Single Source of Truth | First-task/run guidance uses the existing agent and gateway path; onboarding adds no LLM bypass or separate metering path. |
| Zero Dependencies | The design reuses Node, existing Electron/keytar, and the existing browser harness. Any additional dependency requires a documented exception. |
| Test-First Discipline | Draft-redaction, validation, preview/commit, bridge/keychain, and browser a11y tests precede implementation tasks. |
| Configuration over Code | UI eligibility and legacy rollback remain policy-controlled; provider and budget choices write declarative configuration only after explicit review. |
| Observability & Auditability | Lifecycle events contain allow-listed, non-secret metadata and sanitized outcome codes; no credential or raw provider response is recorded. |
| Non-Technical Usability | The flow exposes one ordered, recoverable, accessible experience and a first-value checklist, with a 10-minute p75 target. |

**Gate result**: PASS, contingent on UXF-001 implementation landing. `origin/main` currently contains only UXF-001 planning artifacts; the available implementation is `e753f80` on `feat/011-ui-platform-foundation`. Implementation of this plan MUST rebase on or otherwise include the merged UXF-001 implementation before adding `/app/setup`.

## Architecture Decisions

1. **Shared route, surface adapter**: Register `/app/setup` and its completion state in the UXF-001 platform route registry. The browser and Electron load the same route/module and use an injected surface capability for credential operations; neither gets a separate flow definition or different business-state model.
2. **Explicit compatibility release**: The existing browser `/setup` and Electron wizard remain available while the policy-owned UI-platform feature is disabled or compatibility fallback is selected. Existing `.env` and keychain installations are read without migration and are never overwritten by the first-run flow.
3. **Non-secret draft only**: Persist a versioned `OnboardingDraft` containing safe identity, roster, budget, provider metadata, sanitized validation result, and last safe step. Clear it after successful commit or explicit cancellation. A refresh requires credential re-entry; unavailable storage yields an in-session flow with a clear resume limitation.
4. **Credential ownership by surface**: Browser credentials exist only in a password control and one authenticated same-origin request. They are used in request memory for validation and are written only at an explicit successful commit to the approved environment-secret store, with restrictive file permissions where the platform supports them. Electron credentials pass through an allow-listed context-isolated bridge directly to OS keychain; Electron has no `.env` fallback.
5. **Sanitized provider contract**: Separate staged provider validation and setup-preview/commit contracts from legacy `/api/setup/plan` responses. UI responses carry fixed status, latency, capability count, retryability, and allow-listed recovery text only—never raw error bodies, base URLs with secrets, request URLs, or generated secret-file content.
6. **Safe review and commit**: Preview returns a semantic non-secret summary plus changed-file names. Commit requires the latest validated draft and explicit review confirmation, refuses existing configuration, stages all non-secret writes before finalizing, and reports partial-write recovery without silently overwriting credentials.
7. **First-value handoff without Operations migration**: The completion checklist links to stable, documented task creation/import and run-observation destinations. During the compatibility release these may hand off to a preserved legacy target, but the target must retain task/run identity; unrelated task/run UI migration is not part of this feature.
8. **Accessible state machine**: The stepper is a semantic ordered navigation with an announced current step, error summary/focus restoration, async status feedback, disabled commit until valid review, and reduced-motion-compatible transitions using UXF-001 primitives.

## Project Structure

```text
dashboard/
├── server.mjs                              # guarded /app and sanitized setup endpoints
├── ui-platform.mjs                         # route registry and eligibility extension
├── static/
│   ├── app-platform.mjs                     # platform route registration/rendering
│   ├── ui-primitives.mjs                    # UXF-001 accessible controls/feedback
│   ├── onboarding-flow.mjs                  # shared state machine and browser rendering
│   └── onboarding-draft.mjs                 # non-secret DTO validation/persistence
└── setup.html                               # retained legacy compatibility flow

desktop/
├── main.js                                  # narrow trusted setup/keychain operations
├── preload.js                               # allow-listed onboarding bridge
├── keychain.mjs                             # provider credential storage and retrieval
└── renderer/wizard.{html,js}                # retained legacy compatibility flow

setup-wizard-core.mjs                        # sanitized preview, staged commit, policy generation
provider-conformance.mjs                     # provider test normalization/redaction boundary
tests/
├── setup-wizard-core.test.mjs
├── server.test.mjs
├── onboarding-draft.test.mjs
├── onboarding-security.test.mjs
└── integration/electron-app.test.mjs

browser-tests/
└── onboarding.spec.mjs

docs/
├── user-guide.md
└── troubleshooting.md
```

**Structure Decision**: Extend the 011 platform module shape rather than add a second browser wizard. Keep compatibility-only legacy files untouched except for an explicit, reversible handoff. Core policy generation remains in `setup-wizard-core.mjs`; UI code may not write configuration directly.

## Delivery Phases

1. **Foundation and contracts**: Land the UXF-001 prerequisite; define a validated non-secret draft, route registration, policy-controlled compatibility selection, sanitized result DTOs, and lifecycle event schema.
2. **Safe server/core behavior**: Add test-first staged validation, preview, atomic/recoverable commit, secret redaction, existing-installation protection, and allow-listed audit records.
3. **Shared browser and Electron flow**: Compose the shared stepper with platform primitives; add the narrow Electron credential/keychain adapter; retain legacy fallback.
4. **First value and documentation**: Provide task/run handoff checklist, administrator/support recovery instructions, and privacy-preserving completion timing.
5. **Evidence and release gate**: Collect unit, contract, Electron, browser/a11y/keyboard, responsive, and compatibility evidence, then validate rollback and first-value outcomes.

## Artifacts

- [research.md](research.md): Decisions, current-state evidence, and rejected alternatives.
- [data-model.md](data-model.md): Draft, secret handoff, validation, review, checklist, and audit entities.
- [contracts/setup-flow.md](contracts/setup-flow.md): Sanitized browser setup API and Electron bridge contract.
- [quickstart.md](quickstart.md): Repeatable end-to-end validation and evidence guide.

## Risk Controls

- Treat a secret in any persisted/browser-visible API response, test fixture, URL, log, telemetry event, or review rendering as a release blocker.
- Never use the current provider dashboard mutation route for onboarding credential handoff because it mutates process state before a reviewed commit.
- Never use legacy `/api/setup/plan` as a secret-bearing preview because it returns file contents; introduce a sanitized boundary instead.
- Normalize provider-conformance failures before the UI/audit boundary to prevent upstream bodies, error messages, URLs, or query credentials from escaping.
- Block completion on a failed/unavailable provider validation, inaccessible Electron secure storage, existing configuration, or an unconfirmed review.
- Prove `/setup`, existing Electron wizard, public API contracts, existing `.env`/keychain values, and policy rollback remain unaffected during the compatibility release.
