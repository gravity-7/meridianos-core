# Research: Visible Onboarding Journey

## Decision: Treat the legacy setup wizard as a compatibility bridge, not as proof of full onboarding

**Rationale**: The implemented `/setup` flow has a real fresh-install and review-before-write boundary, but its provider step only reports environment variables. It neither selects nor validates a provider and it writes hard-coded routing. A browser test that pretended otherwise would create misleading evidence.

**Alternatives considered**:

- Test the existing read-only provider screen only. Rejected because it cannot prove BYOK connection, failure recovery, route configuration, or the user value requested for a new customer.
- Build the draft `/app/setup` route first. Rejected for this slice because it is not implemented and would delay a visible, compatible test of the product's current onboarding surface.

## Decision: Add a narrow, secure provider-connect capability to legacy `/setup`

**Rationale**: The compatibility wizard will list only registered BYOK providers, let the user select one and an offered model route, submit a key for a one-time validation, present a redacted success or recovery result, and require that success before review/commit. This produces a real customer-facing onboarding path while leaving the larger unified-onboarding work separate.

**Alternatives considered**:

- Ask the user to set an environment variable manually before opening setup. Rejected because it makes the wizard unable to onboard a non-technical new user and cannot validate the configured route.
- Reuse the dashboard provider panel. Rejected because it is an existing-installation surface and its current helper mutates process environment, which is unsuitable for a disposable, secret-safe setup session.

## Decision: Make the setup plan preview non-secret and commit from a short-lived server-side handoff

**Rationale**: `buildSetupPlan()` can include an optional key in generated `.env` content, and the existing plan endpoint currently returns all generated file content. Once the browser accepts a key, returning that material would expose it in browser responses, diagnostic logs, and evidence. The browser therefore receives only a redacted review summary and an opaque, short-lived validation handle; the secret is retained only by the server until commit, cancellation, expiry, or validation replacement.

**Alternatives considered**:

- Keep the key in browser local storage until commit. Rejected because setup resumption must not persist credentials.
- Send the key again with the commit request. Rejected because it increases the secret-bearing request surface and complicates evidence/redaction.
- Put a literal key into policy configuration. Rejected by the project constitution; keys belong only in the approved environment-secret location.

## Decision: Treat any existing setup target as an existing installation

**Rationale**: The current writer refuses to overwrite only `.ai/policy.yaml`; a pre-existing `.env` or `.ai/tenant.yaml` could still be replaced. The compatibility bridge must detect every file it may write and direct the user back to the existing dashboard/recovery path rather than allowing a normal first-run commit to overwrite an installation.

**Alternatives considered**:

- Preserve the current force-confirmation path. Rejected because it is unsuitable for a first-run test fixture and conflicts with the feature's non-alteration safety boundary.
- Protect only policy configuration. Rejected because credentials and tenant identity may reside in the other generated targets.

## Decision: Use version-controlled registered-provider metadata and make route selection explicit

**Rationale**: `gateway/known-providers.json` and the shipped metadata in `providers.mjs` already define DeepSeek's key environment name, OpenAI-compatible wire, endpoint, supported harnesses, and model tiers. The setup path derives safe display metadata and the committed provider/model route from this trusted metadata rather than an ad hoc UI list. Mutable policy and `.ai/providers.yaml` endpoint overlays are excluded before a first-time credential can be submitted. DeepSeek is registered; Z.ai GLM is not in the local registry, so it cannot appear as ready.

**Alternatives considered**:

- Add an ad hoc Z.ai option to the wizard. Rejected because an unregistered provider has no verified routing, key, wire, or model contract.
- Hard-code `deepseek-chat` and Anthropic routes as the current plan does. Rejected because it can differ from the selected provider and model.

## Decision: Simulate provider validation only through loopback infrastructure in standard runs

**Rationale**: A fresh fixture starts an OpenAI-compatible mock provider on an ephemeral loopback port and supplies a synthetic provider descriptor/key only to the server-side validation path. The fixture starts the dashboard with a minimal allowlisted environment, preventing inherited developer keys from affecting provider detection. The fixture's network wrapper rejects non-loopback endpoints and redirects before they are sent.

**Alternatives considered**:

- Use a developer's local DeepSeek key for browser automation. Rejected because default tests must be free, deterministic, and secret-safe.
- Use the existing `provider-conformance` call unchanged. Rejected because it has no injection/egress guard and is designed to contact configured real endpoints.

## Decision: Separate founder-visible runs from CI evidence

**Rationale**: The same fixture can use a requested free local port and a headed fresh browser context for a founder walkthrough, or an ephemeral port/headless context for automated checks. Both record a redacted evidence bundle, but only CI-safe diagnostics are retained. Native trace files are disabled for this journey until a trace-redaction pipeline exists because they can contain dashboard authentication headers.

**Alternatives considered**:

- Reuse the existing `/app` browser test server. Rejected because it seeds an existing policy and tests only the feature-flagged platform shell, not first-run legacy setup.
- Reuse an existing browser profile. Rejected because local storage and cookies could make a fresh journey non-reproducible.

## Decision: Keep live validation explicitly manual and DeepSeek-only

**Rationale**: A current DeepSeek opt-in live smoke precedent exists, but no standard test may make a paid request. The initial feature provides the approval/runbook guard only. A key owner performs any future live canary locally with a defined spend cap, duration, rollback, evidence label, and revocation action. Z.ai GLM remains blocked until it is registered and routed.

**Alternatives considered**:

- Automatically read a locally available key when a visible run starts. Rejected because the standard journey must never use a real key.
- Include Z.ai GLM in the canary based on the user's available key alone. Rejected because provider availability is determined by the product registry, not the presence of a credential.
