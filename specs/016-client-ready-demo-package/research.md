# Research: Client-Ready Demo Package

## Decision 1: Preserve the existing visible onboarding launcher

**Decision**: Use `node scripts/run-visible-onboarding.mjs --port 4317` as the onboarding baseline and document it rather than changing it.

**Rationale**: The launcher already opens a headed Chrome browser, navigates to `/setup`, uses an isolated onboarding fixture with loopback-simulated provider validation, writes redaction-checked evidence, and removes its temporary installation on normal or interrupted shutdown. Spec 014's quickstart explicitly says `/setup` is supported and `/app/setup` is redirect-only.

**Alternatives considered**:

- Rebuild onboarding in a new demo launcher — rejected because it would duplicate and risk reopening Spec 014/UXF-006 implementation.
- Present `/app/setup` — rejected because it redirects to `/setup` and is not an implemented onboarding destination.

## Decision 2: Use the cloud control-plane root route, not its test-static path

**Decision**: Base the client workflow on `createCloudServer` serving the cloud dashboard at its local root URL; explicitly prohibit `/cloud/dashboard/index.html` as a live presenter URL.

**Rationale**: `cloud/cloud-server.mjs` serves `cloud/dashboard/index.html` at `/` and its `app.js` at `/app.js`, then backs sign-in, machines, health, preview, confirmation, and rollback endpoints through the existing control-plane behavior. In contrast, `scripts/start-ui-platform-test-server.mjs` maps `/cloud/dashboard/index.html` and `/cloud/dashboard/app.js` only to support browser tests, and `browser-tests/uxf-006.spec.mjs` stubs API responses for that route.

**Alternatives considered**:

- Use the static path demonstrated by UXF-006 browser tests — rejected as test-only for the current local presentation.
- Claim a hosted Cloudflare control plane — rejected because the local server notes production hosting/deployment is a separate future concern.

## Decision 3: Seed an ephemeral deterministic cloud fixture

**Decision**: A future dedicated fixture will initialize a temporary cloud database and deterministic fictional organization, admin account, machines, health reports, and policy-preview input; it will remove the database when the session ends.

**Rationale**: Existing cloud functions and tests demonstrate local, HTTP-backed control-plane behavior with a temporary database. A dedicated fixture keeps the live presenter experience reproducible without reusing browser-test route stubs or any customer state.

**Alternatives considered**:

- Reuse a developer's existing cloud database — rejected because it can contain non-synthetic state and cannot guarantee cleanup.
- Call an external cloud deployment — rejected because this feature forbids live external requests and production claims.

## Decision 4: Narrate, do not overclaim, the policy operation

**Decision**: Show policy preview and the explicit `APPLY POLICY` confirmation boundary as mandatory presenter checkpoints. The default runbook stops before confirmation; a future optional synthetic-only confirmation segment requires deterministic fixture coverage and a clear local-only label.

**Rationale**: The existing UI says a preview does not push policy, requires explicit confirmation, and exposes a rollback boundary that does not promise reversal of external machine effects. The demo must preserve that meaning and avoid creating a misleading operational claim.

**Alternatives considered**:

- Always confirm automatically — rejected because it hides the human decision point and could be interpreted as an operational action.
- Omit the preview/confirmation — rejected because it removes the strongest supported client workflow.

## Decision 5: Capture instructions only; assets later by named humans

**Decision**: Deliver a curated shot list and optional recording procedure, not screenshots or recordings.

**Rationale**: The requested planning session prohibits assets. Existing UXF-006 evidence confirms automated browser coverage but leaves visual-baseline approval as a human external gate. A capture brief gives repeatability while preserving that approval boundary.

**Alternatives considered**:

- Generate screenshots in implementation — rejected because routine demo runs should not silently create materials for client use.
- Treat current browser-test screenshots as approved marketing/demo visuals — rejected because approval does not exist.

## Decision 6: Keep evidence redacted and scoped

**Decision**: Retain only safe runtime manifests, result records, optional triage records, and references to later human-approved captures. Store runtime evidence in ignored artifact locations and discard unsafe captures.

**Rationale**: The onboarding fixture already scans observations and cleanup records. UXF-006's quickstart says unavailable manual environments remain unresolved and evidence must identify its limits. This package must keep those limits visible.

**Alternatives considered**:

- Retain browser profiles, raw responses, or raw recording traces for troubleshooting — rejected due to privacy and accidental secret exposure risk.
- Label a successful local run as production/client readiness — rejected because inherited external gates remain open.
