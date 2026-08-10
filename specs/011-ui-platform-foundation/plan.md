# Implementation Plan: UI Platform Foundation

**Branch**: `spec/011-ui-platform-foundation` | **Spec**: [spec.md](spec.md)

## Summary

Establish an independently releasable application platform under `/app` while retaining the legacy dashboard and every public API contract. The platform is selected by a configuration-controlled flag, uses shared tokens and accessible primitives, presents service data through typed boundaries, and is proven with browser evidence.

## Technical Context

- **Runtime**: Node.js 24+, ES modules, existing dashboard server and static assets.
- **UI approach**: Introduce a route-aware application shell and component boundary without changing legacy dashboard behavior; decide the exact framework/dependency choice during implementation only after proving it is necessary under the zero-dependency constitution principle.
- **Configuration**: `policy.yaml` owns the release flag and eligibility; secrets remain environment-only.
- **APIs**: Existing `/api/*` and `/api/v1/*` are read as-is through application boundary modules; no endpoint behavior changes.
- **Testing**: Native Node tests plus browser automation for the stated browser/viewport/state matrix.

## Constitution Check

| Principle | Plan response |
|---|---|
| Gateway single metering path | No new LLM or provider traffic is introduced. |
| Zero dependencies | Prefer existing browser tooling and built-ins; any new dependency needs explicit justification. |
| Configuration over code | Flag, eligibility, and rollback are policy-controlled. |
| Test-first discipline | Unit, contract, route, and browser evidence are tasks before release. |
| Non-technical usability | Accessible primitives, clear feedback, themes, and reversible rollout are first-class. |

## Architecture Decisions

1. **Route ownership**: `/app` owns the new shell and routes; legacy paths remain served by the existing dashboard. The application server must return the shell for known application routes and a recoverable in-app not-found view for unsupported application routes.
2. **Release control**: One policy-defined feature flag determines platform eligibility. The safe default remains legacy. Disabling it restores legacy routing without migration.
3. **Information architecture**: First release supplies the shell, route registry, navigation, route-level recovery, and placeholder foundation destinations only; it does not move onboarding or business workflows.
4. **Visual system**: Tokens are the sole source for foundational color, type, space, focus, motion, and elevation decisions. Theme values use the same semantic token names.
5. **Interaction system**: Primitives own keyboard, focus, semantic, announcement, and state conventions; route features compose those primitives rather than recreating them.
6. **Application data boundary**: Per-domain adapters translate validated public API responses to platform view models and normalized failures. Adapters must not change requests or public responses.
7. **Evidence**: Browser tests produce screenshots and assertions for routes, history, themes, viewports, loading, empty, error, and action outcomes.

## Artifacts

- [research.md](research.md): decisions and alternatives.
- [data-model.md](data-model.md): route, flag, token, action state, and application-boundary entities.
- [contracts/ui-platform.md](contracts/ui-platform.md): platform route, flag, and API-boundary contract.
- [quickstart.md](quickstart.md): end-to-end validation evidence.

## Delivery Phases

1. Establish the policy flag, route registry, and server-side direct-load behavior.
2. Add shell, tokens, themes, accessible primitives, and state conventions.
3. Add typed adapters and contract-preservation tests.
4. Add complete browser evidence, accessibility checks, performance checks, and rollback validation.

## Risk Controls

- Keep the flag disabled by default and validate rollback before broad enablement.
- Snapshot representative public API contracts before and after platform enablement.
- Make unsupported `/app` routes recoverable rather than falling through to legacy ambiguity.
- Block release on any critical/high accessibility, API, or rollback finding.
