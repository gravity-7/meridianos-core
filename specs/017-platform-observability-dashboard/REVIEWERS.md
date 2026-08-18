# Review Guide: Platform Observability Dashboard & Legacy-Parity Polish

**Date**: 2026-08-18
**Spec**: [spec.md](spec.md)

## Why This Change

The new platform shell is now the default root route, but it does not yet provide the complete observability board users expect from the existing product direction. Valuable legacy charts and widgets are split across routes or absent from the new landing experience, and the visual system needs a coherent responsive and themeable treatment. This feature closes that gap while retaining a truthful local-data boundary and an immediately usable legacy fallback.

## What Changes

The root dashboard becomes a complete operational board with attention, health, work, budget, trend, and evidence widgets. Legacy operational and analytics capabilities receive an explicit migrate/retain/retire disposition and are brought into the new routes where appropriate. The interface gains a Grafana-inspired information hierarchy, mobile-first responsive behavior, System/Light/Dark themes, and deterministic populated demo telemetry only in disposable fixtures. `/legacy`, existing APIs, authorization, and safe mutation boundaries remain available.

## How It Works

The platform overview composes the existing scoped operational read models and chart/table contracts rather than creating a second ledger path. Shared widget, trend, theme, navigation, and parity contracts keep state, scope, freshness, and drill-down behavior consistent. Existing native CSS/DOM is the default visual implementation; a framework is allowed only after a concrete acceptance failure and a documented constitution exception. The supplied references are the visual acceptance baseline for the dense dark panel grid and left navigation rail. Disposable fixtures add deterministic synthetic records for local demonstrations and reject external/key-shaped inputs.

## When It Applies

### Applies when

- The user opens the platform root `/` or one of the new operational routes.
- An authorized scope contains real ledger evidence or an explicit labelled disposable demo fixture is active.
- The user changes time/project/provider scope, theme, viewport, or an operational drill-down.

### Does not apply when

- A user explicitly uses `/legacy` as the retained rollback/reference dashboard.
- The workflow would require real provider keys, external services, payment/email, customer data, production deployment, or an unavailable browser/platform gate.
- A future UI framework is proposed without a concrete native-stack failure and dependency/constitution review.

## Key Decisions

1. **Compose canonical operational data**: reuse existing gateway-ledger read models instead of querying legacy DOM or creating duplicate metering; this preserves totals and authorization.
2. **Match the supplied visual reference without cloning identity**: provide the dense dark panel grid, chart/gauge families, and left navigation shown in the references using MeridianOS-owned visual language and no third-party branding/assets.
3. **Keep native CSS/DOM as the default**: the current stack can express responsive tokens, themes, cards, charts, and accessible tables; a framework is not justified merely by aesthetic preference.
4. **Keep synthetic telemetry fixture-only**: normal installations remain data-truthful, while explicit demos become visually meaningful and disposable.
5. **Make parity auditable**: every in-scope legacy capability receives one disposition and evidence before convergence; `/legacy` remains the fallback.

## Areas Needing Attention

- Verify that the root board does not duplicate or contradict the existing Cost, Usage, Gateway, and legacy panels.
- Check that every visual chart retains an equivalent table/text representation and safe drill-down.
- Check responsive behavior at 320px, keyboard focus, reduced motion, and forced colors; do not infer unavailable screen-reader/platform approval from Chrome automation.
- Check that theme preference cannot affect authorization, policy, secrets, or synthetic-data activation.
- Check fixture cleanup after interruption and ensure normal installations are never seeded.
- If a framework is proposed, demand the concrete acceptance criterion native code failed, dependency impact, and constitution re-check.

## Open Questions

No blocking open questions identified. Framework use remains an implementation checkpoint, not a default requirement.

## Review Checklist

- [ ] Root `/` contains the full scoped operational board and truthful states.
- [ ] Desktop root matches the supplied dense dark panel hierarchy, compact metric/chart/gauge families, and persistent left navigation rail; Light/System equivalents remain coherent.
- [ ] Cost, tokens, and budget use the supplied circled meter treatment with central value, unit, threshold/status text, and accessible numeric equivalent.
- [ ] Mobile root collapses the rail into a usable drawer/rail with focus return and no horizontal scrolling.
- [ ] `/legacy`, `/index.html`, `/setup`, APIs, authorization, and mutation boundaries remain compatible.
- [ ] Parity inventory has no unclassified in-scope capability.
- [ ] Scope, freshness, fixed budget period, drill-downs, Back/Forward, and refresh remain coherent.
- [ ] Charts include units, table/text alternatives, empty/error states, and safe evidence links.
- [ ] System, Light, and Dark themes are selectable, persistent, readable, and non-color dependent.
- [ ] Desktop and 320px mobile journeys work without horizontal page scrolling.
- [ ] Synthetic telemetry is deterministic, labelled, fixture-only, loopback-only, redacted, and cleaned up.
- [ ] Focused tests, browser tests, full regression, `git diff --check`, and convergence are recorded.
- [ ] Unavailable Safari/macOS, NVDA/VoiceOver, Electron, independent accessibility, production, canary, and release gates remain explicitly unclaimed.
