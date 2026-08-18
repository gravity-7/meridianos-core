# Review Guide: Client-Ready Demo Package

**Date**: 2026-08-16  
**Specification**: [spec.md](spec.md)

## Why This Change

MeridianOS has a safe visible onboarding baseline and a locally runnable cloud control plane, but no single presentation package that lets a founder demonstrate them consistently to a prospect. Existing UXF-006 browser evidence does not equal a client-ready story, and its external release gates remain open. This feature supplies the demo workflow, narrative, evidence boundary, and recovery rules without changing the already-merged UXF-006 work.

## What Changes

The future implementation adds a repeatable local client-operations walkthrough alongside the existing `/setup` walkthrough, plus presenter and capture documentation. It uses only deterministic fictional data, requires visible checkpoints and teardown, and gives reviewers a precise line between local demonstration evidence and production/release approval. No public API, customer workflow, provider connection, or hosted deployment changes.

## How It Works

The existing `run-visible-onboarding.mjs` stays unchanged and is documented as the onboarding baseline. A new fixture will create an ephemeral cloud-control-plane database and synthetic records through current supported control-plane behavior; a new local launcher will open a headed browser at the cloud server's root route, produce redacted safe evidence, and remove temporary state. Tests cover route separation, loopback-only constraints, redaction, interruption cleanup, visible client flow, and the presenter/capture contract; Markdown runbooks carry the founder narrative and human-only capture approval process.

## When It Applies

**Applies when**:

- A founder or presenter needs an in-person or remote local demonstration of onboarding and fictional client operations.
- The host has Node.js, dependencies, a headed browser, and a free loopback port.
- The presentation must be reproducible and safe without a provider key, customer record, or internet-dependent service.

**Does not apply when**:

- Demonstrating a customer environment, provider integration, payment/email flow, or hosted control plane; these are intentionally excluded.
- Making production, client-readiness, accessibility, platform, performance, visual-baseline, canary, or release claims; separate explicit evidence and named approval are required.
- Navigating to `/app/setup` or `/cloud/dashboard/index.html` as a live demo destination; the first is redirect-only and the second is test-static only.

## Key Decisions

1. **Adopt the current onboarding launcher.** The alternative was a new onboarding implementation; preserving the verified synthetic `/setup` baseline avoids revisiting Spec 014 and UXF-006.
2. **Use the cloud server's root route.** The browser-test static URL was rejected because it uses test-server mapping and stubs rather than the actual local control-plane server behavior.
3. **Create a disposable deterministic cloud fixture.** Reusing developer state or a hosted deployment would invalidate the synthetic-only, no-external-request boundary.
4. **Stop by default at policy confirmation.** The preview/confirmation boundary is part of the product story; automatic confirmation would obscure a human operational decision.
5. **Write capture instructions, not assets.** Existing browser-test images have no human visual approval; future capture is optional and human-owned.

## Areas Needing Attention

- Confirm the future fixture seeds machine/health data through supported control-plane functions rather than test-only browser stubs.
- Verify the launcher rejects inherited credentials and every non-loopback input before starting any listener.
- Keep fixture-only cloud sign-in values out of final client-facing recording material unless the Security/Privacy Owner approves their exact display.
- Ensure optional synthetic confirmation cannot be misunderstood as remote policy delivery or rollback.
- Preserve the UXF-006 external-gate wording verbatim enough that a local demo cannot be read as release sign-off.

## Open Questions

No implementation-blocking questions remain. Human assignment of the Founder/Demo, Product/UX, and Security/Privacy owner roles is intentionally deferred; optional visual/recording capture cannot be approved until those roles are named.

## Review Checklist

- [ ] The onboarding narrative starts at `/setup` and never describes `/app/setup` as implemented.
- [ ] The live client walkthrough uses the cloud server root URL, never `/cloud/dashboard/index.html`.
- [ ] Every fixture record is fictional, deterministic, loopback-only, and removed on every terminal path.
- [ ] Tests prove no real provider key, provider call, payment/email action, customer data, raw request body, or external network request enters the demo.
- [ ] Preview, confirmation, and rollback wording preserves the no-push/default-stop boundary.
- [ ] Runtime evidence is redacted, ignored, and limited to safe manifest/result/triage material.
- [ ] Capture instructions produce no screenshot or recording automatically and require named human approval later.
- [ ] All inherited UXF-006 Safari/macOS, NVDA/VoiceOver, Electron, performance, visual, canary, ownership, and release gates remain explicitly unresolved.
- [ ] No Spec 014/015 or UXF-006 implementation/release-gate artifact is changed.
