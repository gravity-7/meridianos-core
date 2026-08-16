# Review Guide: Visible Onboarding Journey

**Generated**: 2026-08-14 | **Spec**: [spec.md](spec.md)

## Why This Change

The current legacy `/setup` page is a useful first-run scaffold, but its provider step only reports that an environment variable exists. A new individual cannot choose a provider or model, validate a connection, recover safely from a failure, or see a truthful configured route before writing files. The product also lacks a repeatable, observable walkthrough that proves the real browser workflow without using a founder's credentials or touching an existing installation.

## What Changes

The legacy setup route becomes a narrow compatibility bridge for first-time BYOK onboarding: a registered provider/model is selected and validated, its review is redacted and explicit, and only a confirmed commit configures a fresh root. The same workflow gains an isolated loopback fixture, browser-visible tests, safe evidence, a founder walkthrough, and a manual DeepSeek-canary preparation layer. The planned unified `/app/setup` experience is not delivered by this change.

## How It Works

Safe provider/model metadata comes from the existing registered-provider sources rather than a new hard-coded UI list. A raw key is sent once to a local authenticated validation endpoint, retained only in a short-lived server-memory session, and replaced in the browser by an opaque validation identifier. `setup-wizard-core.mjs` creates a redacted route-aware review and writes the generated secret content only during a successful matching commit. The fixture starts a temporary root, a loopback mock provider/gateway, and a dashboard in a sanitized process; the browser asserts the same visible controls at wide/narrow sizes and records sanitized evidence without raw traces.

## When It Applies

**Applies when**:

- A first-time individual starts the existing browser `/setup` flow on a fresh local installation.
- A developer or CI worker runs the named synthetic onboarding fixture.
- A founder wants to watch the actual setup interactions on a disposable local dashboard.

**Does not apply when**:

- An installation already contains any setup target; first-run setup must return safely rather than overwrite it.
- The feature-flagged `/app` platform, organization roles, billing, Docker, or Electron onboarding is being tested.
- A provider is unregistered, including Z.ai GLM today; it cannot be presented as a supported or live-canary-ready option.
- A real provider check is requested; the standard path remains synthetic, and a future DeepSeek canary requires explicit local approval.

## Key Decisions

1. **Extend legacy setup instead of claiming the planned unified UI exists.** The current route is the only implemented browser setup surface, so the compatibility bridge delivers visible value now without a parallel rewrite.
2. **Use a short-lived server-only secret handoff.** Browser persistence and plan responses cannot contain credentials; resubmitting the key at commit or storing it in local storage would increase exposure.
3. **Generate the route from the provider registry.** DeepSeek has an existing registered contract; Z.ai GLM does not. A credential alone never establishes provider support.
4. **Use loopback-only fixtures and redacted evidence.** Founder/CI proof must not use inherited keys, paid services, customer data, or raw traces that can contain dashboard credentials.
5. **Block any pre-existing setup target.** Protecting only `policy.yaml` can still overwrite a tenant file or `.env`; normal first-run setup must not do that.

## Areas Needing Attention

- Inspect every request/response/log/evidence path for secret reflection, including error handling and browser storage after retry/cancel/expiry.
- Confirm the selected provider/model produces a valid gateway-routable configuration rather than retaining the previous hard-coded routing defaults.
- Ensure the provider-validation operation is clearly separated from ordinary metered model execution and that fixture AI traffic still remains behind the loopback gateway.
- The dashboard currently has process-global state; onboarding fixtures must use one isolated process per run and must always clean up their temporary root and dependencies.
- Changing the plan response from generated file content to a redacted summary is a security improvement but can affect existing private callers; cover it with focused HTTP contract tests.

## Open Questions

No open questions identified for the synthetic first-time individual scope. Z.ai GLM registration and any real provider canary execution are explicitly deferred.

## Review Checklist

- [ ] Provider/model catalog comes from registered metadata and excludes unregistered providers.
- [ ] A raw provider key never reaches browser persistence, URLs, review/plan responses, logs, screenshots, artifacts, or raw traces.
- [ ] Validation identifiers expire, bind to the right session/choice, and are one-use at commit.
- [ ] Review remains non-writing and commit cannot touch an existing setup target.
- [ ] Standard fixture blocks non-loopback egress and inherited real provider keys.
- [ ] Browser proof covers wide/narrow, keyboard, explicit pre-commit, commit, and recovery.
- [ ] DeepSeek live-canary documentation is manual/approved only and Z.ai GLM is not misrepresented.

---

## Phase 2: Visible automation and recovery (2026-08-15)

### What Changed

Phase 2 adds the disposable loopback onboarding fixture, sanitized child process, browser journey, redacted evidence writer, headed founder launcher, and controlled authorization/timeout/unavailable recovery coverage. The browser proof exercises the existing `/setup` route only, including review-before-commit, explicit commit, wide/narrow layouts, keyboard focus, and retry-to-success.

### Spec Compliance

The Phase 2 review covers FR-001 through FR-009 and FR-011 as exercised by T015–T022. The focused fixture and browser checks passed; evidence reports loopback-simulated dependencies, zero external attempts, no raw traces, cleanup status, and sentinel-scan results. FR-010 and T023–T027 remain outside this phase and are not marked complete.

### Focus Areas for Review

- Verify that the child environment is allowlisted and never inherits provider-key names or values.
- Verify exact loopback origin/dependency checks, redirect rejection, and absence of `/app/setup` claims; `/app/setup` remains a redirect to `/setup`.
- Inspect the browser evidence path for DOM, URL, storage, console, screenshot, and generated-artifact sentinel scanning.
- Confirm failed validation clears the key, focuses a safe recovery alert, blocks progression, preserves non-secret choices, and allows a successful retry.
- Confirm fixture cleanup removes only its generated temporary root and dashboard/dependency processes.

### AI Assumptions

- Provider validation uses the existing conformance seam with an exact loopback provider URL; no simulated model execution is introduced, so the loopback gateway is provisioned but not exercised by this setup-only journey.
- The headed launcher uses the installed Chrome channel when available and falls back to an ephemeral loopback dashboard port if the requested port is occupied.
- Full `npm test` was intentionally not run because the phase request restricts verification to focused relevant tests.
