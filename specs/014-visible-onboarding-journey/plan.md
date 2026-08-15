# Implementation Plan: Visible Onboarding Journey

**Branch**: `014-visible-onboarding-journey` | **Date**: 2026-08-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/014-visible-onboarding-journey/spec.md`

## Summary

Deliver a real, visible first-time individual onboarding journey on the current legacy `/setup` route. The feature upgrades the route from environment-key detection to a narrow, secure provider/model connection step with a redacted validation handoff and route-aware review. It then adds an isolated loopback fixture, user-visible browser checks, redacted evidence, a founder launcher, and a DeepSeek-only canary preparation record. The draft unified `/app/setup` remains out of scope.

## Technical Context

**Language/Version**: Node.js 24+; ES modules in `.mjs`; browser HTML/JavaScript.

**Primary Dependencies**: Existing Node.js built-ins, `better-sqlite3`, and installed Playwright test tooling; no new runtime dependency.

**Storage**: Existing per-installation `.ai/policy.yaml`, `.ai/tenant.yaml`, and approved `.env` secret location. A provider validation secret is server-memory-only and short-lived until commit, cancellation, or expiry.

**Testing**: Node native focused unit/HTTP tests plus a dedicated Playwright onboarding journey. The full `npm test` suite is not part of this user-requested validation pass.

**Target Platform**: Local dashboard on Windows/macOS/Linux; headed founder browser and headless CI browser.

**Project Type**: Node dashboard/gateway application with browser UI and test tooling.

**Performance Goals**: A standard visible setup fixture becomes ready in five minutes or less; provider validation presents an actionable result within its defined timeout; no standard run contacts an external service.

**Constraints**: No secrets in browser persistence, plan/review responses, logs, screenshots, or evidence; no inherited developer provider variables; default dependency egress is exact loopback only; explicit commit is the only write; no raw Playwright traces until redaction is available; Z.ai GLM is not yet registered.

**Scale/Scope**: One first-time individual browser journey; registered BYOK provider/model choice, beginning with DeepSeek in the standard fixture; success and controlled failure/retry; desktop, narrow, and keyboard checks; evidence and founder walkthrough. Organization, billing, Docker, Electron, unified `/app/setup`, and a live canary execution remain out of scope.

## Constitution Check

*GATE: Pass before research and re-check after design.*

| Principle | Status | Plan response |
| --- | --- | --- |
| Provider & Model Agnosticism | PASS | Provider/model choices derive from the resolved registry; no duplicate list or fake Z.ai option. |
| Gateway as Single Source of Truth | PASS | The committed route remains gateway-routable. Fixture AI traffic, if any, stays behind the loopback gateway; connection metadata validation is separately labelled and egress-guarded. |
| Zero-Dependency Philosophy | PASS | Reuse Node and existing test tooling only. |
| Test-First Discipline | PASS | Add focused red/green coverage for secret redaction, plan/commit boundary, validation recovery, fixture isolation, and browser checkpoints. |
| Configuration over Code | PASS | Provider identity/model/route are generated from registry/configuration; credentials persist only in the approved environment-secret location. |
| Observability & Auditability | PASS | Sanitised manifest/result/triage records identify a run and checkpoint without credential data. |
| Non-Technical Usability | PASS | A visible provider/model choice, validation result, recovery action, budget review, and founder runbook replace a hidden environment-variable prerequisite. |
| ES Modules & Modern JavaScript | PASS | New runtime and fixture files use `.mjs` and ESM. |
| PR Discipline & Code Review | PASS | No commit/PR/merge is created without the user's explicit direction. |
| Spec-Driven Development | PASS | Spec, research, model, contract, quickstart, tasks, implementation, and convergence are tracked in this feature. |

## Global Constraints

- Node.js 24+; source and test modules use ESM and `.mjs` files.
- No new runtime dependency; use existing Node.js built-ins and installed Playwright tooling only.
- The gateway remains the single metering path for any LLM traffic; the standard fixture permits only loopback simulated dependencies.
- Provider/model choices come from configuration and registered metadata, not hardcoded source switches. Secrets use only the approved environment-secret location and never policy configuration.
- Standard runs must never read an inherited real provider key, make a paid/provider/payment/email request, or alter a customer installation.
- The full `npm test` suite is not run for this user-requested implementation pass; focused checks are written and run instead.

## Project Structure

### Documentation

```text
specs/014-visible-onboarding-journey/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── contracts/setup-onboarding-contract.md
├── quickstart.md
└── tasks.md
```

### Source Code

```text
dashboard/
├── setup.html                         # provider/model step, recovery, review and visible synthetic label
└── server.mjs                          # safe setup catalog, validation, review and commit contracts

gateway/
└── server.mjs                          # reused by loopback fixture for simulated AI routing

setup-wizard-core.mjs                   # pure redacted-plan and committed route generation
setup-validation-session.mjs             # opaque short-lived server-only provider-secret handoff
provider-wizard.mjs / providers.mjs     # safe registry metadata source (no setup-specific duplicate list)
provider-conformance.mjs                # injectable, redacted connection metadata validation

scripts/
└── run-visible-onboarding.mjs           # founder-visible isolated fixture launcher

tests/
├── fixtures/onboarding-fixture.mjs      # temporary root, sanitized environment, loopback dependencies, teardown
├── setup-wizard-core.test.mjs           # setup-plan, route and secret-boundary tests
└── onboarding-fixture.test.mjs          # fixture egress/evidence/cleanup contract tests

browser-tests/
└── legacy-setup-onboarding.spec.mjs     # wide, narrow, keyboard, success and recovery journey

docs/quality-assurance/
└── runbooks/JRN-001-first-value-byok.md # truthful founder/client-safe walkthrough
```

**Structure Decision**: Extend the existing legacy dashboard/server and its pure setup-plan core. Keep fixture and browser-specific orchestration isolated in `tests/`, `browser-tests/`, and `scripts/`; do not add a new application package or a parallel onboarding UI.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
| --- | --- | --- |
| None | — | — |
