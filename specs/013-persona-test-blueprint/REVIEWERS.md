# Reviewer Guide: Persona Testing Blueprint

**Feature:** `013-persona-test-blueprint`
**Status:** Ready for implementation review
**Created:** 2026-08-14

## Purpose

This feature establishes the source-of-truth materials for safe, repeatable
persona testing. It addresses the gap between the current browser-shell checks
and the dashboard, gateway, desktop, provider, role, budget, and deployment
workflows that need a clear release-quality story.

## What reviewers should expect

- A catalog with at least seven personas and fifteen journeys, each with
  priority, owner, fixture, evidence class, automation target, and truth state.
- A fixture safety design that uses temporary, synthetic, loopback-only data;
  normal runs must not call providers, payment processors, mail services, or
  real customer systems.
- Client-safe P1 runbooks, including their claim boundaries and recovery paths.
- An agent-playbook/evidence/release model that keeps raw diagnostics in
  ignored CI artifacts and only approved, redacted illustrations in Git.
- A focused source-quality test that prevents unsafe or incomplete blueprint
  artifacts from being accepted.

## Important implementation facts

1. The current Playwright coverage exercises the feature-flagged `/app` shell,
   not the legacy dashboard flows. New P1 browser work must target a real
   dashboard fixture rather than expanding the shell-only server.
2. Unified `/app/setup` onboarding is planned in a Draft specification. The
   live catalog must label it `PLANNED`, while the existing `/setup` journey is
   the executable current flow.
3. Dashboard/auth stores retain module-level singleton state. Future browser
   workers need isolated server processes or serialisation until fixture
   injection and reset seams exist.
4. Billing checkout/portal E2E needs a Stripe-client injection seam. Until
   then, normal tests cover local webhook, entitlement, and error states only.
5. SOC2 is the only compliance report currently backed by real data. SSO and
   illustrative compliance reports must never be positioned as working
   prospect-demo capabilities.

## Review checklist

- [ ] Catalog terminology distinguishes current, planned, simulated, and live-canary claims.
- [ ] Every P1 journey has a safe fixture and a plain-language runbook.
- [ ] Fixture rules prohibit real keys, people, provider calls, payments, and invitations.
- [ ] Evidence retention/redaction is practical for CI and client demonstrations.
- [ ] The focused validation test enforces the public file contract without network access.
- [ ] Documentation links make the next automation increment unambiguous.

## Deferred decisions

The next implementation feature should choose the fixture-server API, introduce
the Stripe client seam, and decide the visual-baseline review/approval workflow.
Those decisions are intentionally not hidden as completed E2E coverage here.
