# Research: Unified Onboarding

## Decision 1: Build on the UXF-001 platform implementation

**Decision**: Implement onboarding as `/app/setup` using the UXF-001 route registry, platform shell, theme behavior, accessible primitives, and application boundaries.

**Rationale**: The audit requires a routeable unified experience and explicitly lists `dashboard/app/routes/setup/**` as the target. The available UXF-001 implementation (`e753f80`) already has `/app` routing, `ui_platform` eligibility/rollback, primitives, and browser evidence. A separate setup page would repeat the fragmentation UXF-003 is intended to eliminate.

**Alternatives considered**: Retain and restyle `dashboard/setup.html` only (rejected: cannot share platform routing/primitives); maintain a separate Electron wizard (rejected: divergent flow and validation); wait to create onboarding artifacts (rejected: the spec can correctly state the landing prerequisite).

## Decision 2: Persist only a non-secret, versioned draft

**Decision**: A browser-resumable draft contains only non-secret fields, current/last safe step, and a normalized validation result. Secrets are cleared on handoff, navigation, completion, and cancellation; browser refresh always requests a secret again.

**Rationale**: Current `dashboard/setup.html` persists wizard state under `meridian.setupWizard.state.v1`. Keeping a strict DTO makes interruption recovery possible without violating UXF-003's no-browser-secret requirement.

**Alternatives considered**: Persist encrypted browser secrets (rejected: browser-controlled key/material does not satisfy the boundary); server-side secret draft (rejected: unnecessary credential retention); disable resumption (rejected: conflicts with FR-301).

## Decision 3: Use surface-owned secret handoff

**Decision**: Browser secrets are single-use inputs to an authenticated same-origin setup operation and reach the environment-secret store only at explicit commit. Electron secrets travel only through a narrow preload allowlist to main/keychain, which is the sole Electron secret owner.

**Rationale**: `dashboard/server.mjs` already protects mutations with a per-boot same-origin token; `desktop/main.js` uses `contextIsolation: true` and `desktop/preload.js` exposes narrow IPC. `setup-wizard-core.mjs` currently exposes generated `.env` contents through legacy preview, so the new route must use a separate redacted preview/commit boundary.

**Alternatives considered**: Send Electron secrets to browser APIs (rejected: expands the trust boundary); write Electron secrets to `.env` (rejected: weakens existing OS-keychain ownership); reuse `POST /api/providers` (rejected: it mutates process/policy state before reviewed commit).

## Decision 4: Normalize validation results before presentation

**Decision**: Convert provider-conformance output to a fixed non-secret result with provider identity, status, retryability, latency, model count/capability summary, timestamp, and allow-listed recovery message.

**Rationale**: `provider-conformance.mjs` provides useful status classification but some exception paths include remote details. The UI, audit, and telemetry must never receive raw upstream errors, provider URLs, headers, or keys.

**Alternatives considered**: Render existing error messages (rejected: secret/endpoint leakage risk); report only success/failure (rejected: inadequate recovery); validate only after configuration commit (rejected: contradicts FR-302).

## Decision 5: Preserve existing setups and legacy paths

**Decision**: Existing `.ai/policy.yaml`, `.env`, and Electron keychain values are not migrated or overwritten. Existing setup routes remain as a policy-controlled compatibility fallback for one release.

**Rationale**: Current first-run detection is based on `.env` and policy presence and can encounter partial states. A first-run wizard must never become an unsafe repair/migration tool.

**Alternatives considered**: Reuse legacy `force` overwrite (rejected: destructive, ambiguous recovery); silently import existing values into the new draft (rejected: leaks secret ownership and creates migration behavior outside scope).
