# Review Guide: Operational Overview

**Generated**: 2026-08-11 | **Spec**: [spec.md](spec.md)

## Why This Change

MeridianOS currently exposes operational facts across legacy dashboard panels, task/run records, ledger analytics, and notification rules, but it lacks one dependable path from “what needs attention?” to scoped evidence and a safe response. Operators must correlate failures manually, finance users cannot consistently prove aggregate cost drivers, and acknowledgement/remediation does not have one canonical lifecycle with linked audit evidence.

## What Changes

UXF-004 specifies a shared operational overview and durable task, run, usage, cost, alert, and audit drill-down experience. It adds a canonical alert-occurrence lifecycle, authorized recovery semantics, stable cursor-paginated run evidence, accessible gateway/cost charts, and optional live updates with a polling fallback. No existing public endpoint or authorization grant is removed or broadened; all new HTTP interfaces are additive.

## How It Works

The merged dependency-free ES-module shell gains pattern routes under `dashboard/app/routes/{overview,operations,observability}` and imports them through a protected `/static/app/*` mapping. Additive `/api/operations/*` handlers derive tenant scope from authentication, validate optional project/provider and exact UTC windows, and build read models from the existing state database, append-only run log, and canonical gateway ledger. Alert lifecycle and immutable alert events live in the state database, while existing notification cooldown state and metering writes keep their current responsibilities. Existing uPlot enhances table-first metric components. Live mode uses a bounded same-origin SSE broker; authoritative reads and one consolidated ten-second poll remain the correctness fallback.

## When It Applies

**Applies when**:

- An authorized operator needs to find current attention, investigate task/run evidence, and take or explain a safe recovery action.
- An authorized finance/governance user needs scoped spend, budget, usage, and attributable cost-driver evidence.
- An operator acknowledges, reopens, resolves, retries, or invokes the existing confirmed administrator restart action and requires correlated audit proof.
- A route must retain tenant-derived/project-authorized filters and exact time scope through direct load, refresh, and browser history.

**Does not apply when**:

- Editing provider or notification-channel credentials; those sensitive administration surfaces are intentionally excluded.
- Creating users, roles, or new finance permissions; existing authorization remains authoritative.
- Broad alert-rule administration; this feature normalizes configured rules into occurrences but does not redesign rule authoring.
- Replacing the gateway metering path, ledger/run retention policy, or legacy public APIs.

## Key Decisions

1. **Keep the merged ES-module shell and existing uPlot.** A React/TypeScript migration and another chart library were considered, but neither is necessary to meet UXF-004 and both would violate the current zero-dependency direction without compensating value.
2. **Separate alert lifecycle from metering and notification cooldown.** Canonical occurrences/events use the state database; gateway ledger facts and `alert_state` cooldown retain their existing meanings. This gives atomic lifecycle/audit behavior without creating a second metering path.
3. **Use one auth-derived URL scope.** UTC `[from,to)` plus authorized project/provider filters are shared across routes; tenant is never accepted from input. Fixed monthly budget periods are explicitly labelled rather than silently adopting arbitrary windows.
4. **Treat resolution as an episode boundary.** A same-fingerprint recurrence after resolution creates a new immutable occurrence linked to its predecessor. Acknowledgement retains the current occurrence and suppresses same/lower duplicate delivery; escalation overrides suppression.
5. **Use snapshot-stable opaque cursors.** A fixed watermark, last sort key, and filter fingerprint prevent append-time duplication/skips without exposing JSONL offsets as a public contract.
6. **Make tables authoritative and charts enhancements.** Heading, scope, freshness, unit, summary, and semantic table render before uPlot, so every value and drill-down remains accessible when canvas enhancement is absent.
7. **Keep realtime optional and bounded.** Ordered SSE refresh hints improve freshness when enabled, while replay reset and a single consolidated poll keep behavior correct across disconnects and process restarts.
8. **Preserve recovery authority.** Operator/admin-equivalent roles may retry only typed eligible work; restart remains the existing admin-only confirmed action. Every attempt and definitive outcome receives a correlation ID and immutable evidence.

## Areas Needing Attention

- Confirm that state SQLite is the right owner for canonical alert lifecycle while gateway `alert_state` remains notification cooldown only.
- Review whether a 365-day default and the proposed alert/audit retention relationship match operational evidence expectations without changing independent ledger/run retention.
- Examine the `/static/app/*` source mapping and parameterized route registry for traversal safety and legacy dispatch-order compatibility.
- Validate that the bounded in-process SSE broker plus authoritative polling is sufficient; it deliberately does not promise durable cross-process event replay.
- Challenge metric definitions for missing latency, null cost, mixed currency, unattributed records, active-agent policy state, and deterministic cost-driver ties.
- Confirm the 2,000-point table-first rendering target is realistic across the repository’s supported browser/reference-hardware matrix.

## Open Questions

No open questions identified. The canonical alert model, widgets/metrics, severity and suppression, recovery authorization, pagination, retention, tenant/project scope, and realtime fallback are explicit in the specification and design artifacts.

## Review Checklist

- [ ] Key decisions are justified
- [ ] No breaking API or authorization change is proposed
- [ ] Scope matches UXF-004 and excludes credentials/user administration
- [ ] FR-401 through FR-405 map to implementation and acceptance-evidence tasks
- [ ] NFR-401 through NFR-403 have a threshold, measurement method, and browser/test evidence task
- [ ] Alert recurrence, acknowledgement, suppression, escalation, resolution, and concurrency semantics are internally consistent
- [ ] Retry/restart authorization and successful/denied/failed audit evidence are complete
- [ ] Chart/table parity and keyboard/screen-reader/zoom/contrast requirements are testable
- [ ] Existing gateway metering, legacy routes, and run/ledger retention remain compatible
- [ ] No unstated assumption is required to begin implementation after approval

---

<!-- Code phase sections are appended below this line by the phase-manager command -->
