# Operational Readiness Requirements Checklist: Operational Overview

**Purpose**: Validate the clarity, completeness, consistency, measurability, safety, accessibility, and traceability of UXF-004 requirements before implementation approval.
**Created**: 2026-08-11
**Feature**: [spec.md](../spec.md)

## Requirement Completeness

- [x] CHK001 Are requirements defined for the default attention queue, health strip, active/queued work, failed/blocked work, and cost/budget context? [Completeness, Spec §FR-404]
- [x] CHK002 Are the canonical alert fields, lifecycle states, severities, deduplication identity, related entities, suppression evidence, version, and audit links all specified? [Completeness, Spec §FR-405; Data Model §AlertOccurrence]
- [x] CHK003 Are task and run identity, state, attribution, timeline, retry history, log evidence, related records, and retention gaps covered? [Completeness, Spec §FR-403]
- [x] CHK004 Are gateway health, request/error/latency, token, cost, budget, unattributed, and supporting usage-record requirements documented? [Completeness, Spec §FR-404; Contract §Read endpoints]
- [x] CHK005 Are alert acknowledge, reopen, resolve, suppression, escalation, retry, restart, denial, conflict, and definitive-outcome evidence requirements present? [Completeness, Spec §FR-403–FR-405]
- [x] CHK006 Are provider/notification credential editing, user/role administration, and broad alert-rule administration explicitly excluded? [Scope, Spec §Assumptions; Plan §Global Constraints]

## Requirement Clarity

- [x] CHK007 Is the shared scope unambiguous about auth-derived tenant, authorized project/provider, UTC half-open interval, exact preset timestamps, and 24-hour default? [Clarity, Spec §FR-401]
- [x] CHK008 Is every required drill-down destination defined with stable identity, labelled route behavior, compatible scope preservation, and missing-evidence recovery? [Clarity, Spec §FR-402; Contract §Browser route grammar]
- [x] CHK009 Are the 50-record default, 200-record maximum, snapshot stability, cursor/scope binding, ordering, and expired-cursor response precise? [Clarity, Spec §FR-403; Data Model §RunPage]
- [x] CHK010 Are `info`, `warning`, and `critical` meanings plus `warn` normalization and severity-escalation behavior explicit? [Clarity, Spec §Product Decisions]
- [x] CHK011 Is acknowledgement distinguished from resolution and is duplicate suppression distinguished from in-app visibility and rule cooldown? [Clarity, Spec §FR-405; Product Decisions]
- [x] CHK012 Are retryability, duplicate protection, operator/admin authority, finance/viewer read-only behavior, and admin-only confirmed restart boundaries precise? [Clarity, Spec §FR-403; Product Decisions]

## Requirement Consistency

- [x] CHK013 Are resolved-alert recurrence requirements consistent across the spec, research, data model, API contract, and lifecycle tasks as a new linked occurrence? [Consistency, Spec §FR-405; Research §5; Data Model §Lifecycle transitions]
- [x] CHK014 Are metric source and filter definitions consistent between overview totals, charts, tables, exports, and drill-down records? [Consistency, Spec §FR-401, §FR-404; Contract §Read endpoints]
- [x] CHK015 Are existing notification cooldown state, canonical alert lifecycle state, gateway metering facts, and audit evidence assigned non-conflicting ownership? [Consistency, Research §2; Plan §Backend boundaries]
- [x] CHK016 Are existing authorization semantics applied consistently to direct URLs, reads, lifecycle mutations, retry, restart, SSE, and shared links? [Consistency, Spec §FR-402–FR-405, §NFR-403]
- [x] CHK017 Are fixed monthly budget periods consistently labelled as exceptions while compatible entity filters remain inherited? [Consistency, Spec §FR-401, §FR-404]

## Acceptance Criteria Quality

- [x] CHK018 Can highest-priority attention identification be measured against a five-second threshold and a defined unacknowledged ordering? [Measurability, Spec §SC-401; FR-404]
- [x] CHK019 Can durable URL and exact scope preservation be objectively assessed for direct load, refresh, Back, Forward, widgets, rows, and entities? [Measurability, Spec §SC-402]
- [x] CHK020 Is the alert-to-run outcome quantified by participant count, median duration, success rate, and required evidence/action endpoint? [Measurability, Spec §NFR-402; SC-403]
- [x] CHK021 Is chart performance quantified by point count, p95 threshold, longest-task ceiling, browser context, zoom, and narrow viewport? [Measurability, Spec §NFR-401; SC-406]
- [x] CHK022 Are finance attribution, audit coverage, accessibility, realtime resilience, responsive behavior, and API compatibility expressed as measurable outcomes? [Measurability, Spec §SC-404–SC-410]

## Scenario and Recovery Coverage

- [x] CHK023 Are primary operator attention, failed-alert investigation, finance attribution, and lifecycle/audit scenarios independently defined and prioritized? [Coverage, Spec §User Stories 1–4]
- [x] CHK024 Are empty, stale, partial, unavailable, reconnecting, and synthetic/demo states specified without inventing live values or mutation authority? [Coverage, Spec §User Story 1; Edge Cases]
- [x] CHK025 Are unauthorized/deleted scope, missing/legacy/expired entities, retention gaps, and safe return destinations addressed? [Recovery, Spec §Edge Cases; FR-402–FR-403]
- [x] CHK026 Are mutation duplication, stale versions, actor races, client disconnect after success, failed remediation, and denied attempts covered with traceable outcomes? [Recovery, Spec §User Story 4; Edge Cases]
- [x] CHK027 Are SSE unsupported/disconnected/duplicated/out-of-order/unresumable states and hidden/offline/filter-change races specified with a polling/manual-refresh recovery? [Recovery, Spec §NFR-403; Edge Cases]

## Non-Functional, Security, and Accessibility Requirements

- [x] CHK028 Are chart/table parity requirements complete for title, unit, scope, freshness, series meaning, summary, empty/error state, and identical drill-down? [Accessibility, Spec §FR-404]
- [x] CHK029 Are keyboard, screen-reader, visible-focus, non-color status, reduced-motion, forced-colors, 320 px, and 200%-zoom requirements covered across critical routes/actions? [Accessibility, Spec §Edge Cases; SC-405, SC-409]
- [x] CHK030 Are alert, audit, SSE, metric, run-evidence, and error payload prohibitions sufficient to prevent secret, prompt, header, raw-provider, and unrestricted-output disclosure? [Security, Spec §Assumptions; Contract §Common request scope]
- [x] CHK031 Are direct-ID and filter authorization requirements written to prevent resource enumeration and URL-based privilege expansion? [Security, Spec §FR-401–FR-403; Contract §Common request scope]
- [x] CHK032 Are realtime opt-in, same-origin authorization, ordered IDs, resume/reset, failure threshold, one polling interval, visibility pause, pending-mutation protection, and demo disablement all explicit? [Resilience, Spec §NFR-403]
- [x] CHK033 Are alert/audit retention and independent run-log/gateway-ledger retention boundaries explicit, including earliest-evidence disclosure? [Retention, Spec §FR-405; Product Decisions]

## Dependencies, Traceability, and Assumptions

- [x] CHK034 Are the merged UXF-002 shell, UXF-003 onboarding, canonical gateway ledger, legacy compatibility fallback, and existing authorization dependencies explicit? [Dependency, Spec §Assumptions; Plan §Constitution Check]
- [x] CHK035 Does every FR/NFR map to named implementation tasks and acceptance-evidence tasks without relying on an unstated implementation choice? [Traceability, Tasks §Requirement and acceptance-evidence coverage]
- [x] CHK036 Are the no-new-dependency, Node.js 24+, `.mjs`/ESM, policy configuration, gateway metering, and public-compatibility constraints explicit for every task? [Dependency, Plan §Global Constraints; Tasks §Global Constraints]

## Notes

- All 36 requirement-quality items pass against the current specification package.
- This is a formal pre-implementation PR-review checklist. It assesses the written requirements, not the Stage 2 implementation.
- Re-run this checklist if review changes lifecycle semantics, scope/authorization, metrics, retention, recovery, realtime, or acceptance thresholds.
