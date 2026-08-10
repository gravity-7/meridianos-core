# Tasks: UI Platform Foundation

**Input**: [spec.md](spec.md), [plan.md](plan.md), [contracts/ui-platform.md](contracts/ui-platform.md)

## Phase 1: Foundation and release control

- [x] T001 Add failing policy validation tests for the platform flag, default-off eligibility, and rollback semantics. [FR-005, FR-006]
- [x] T002 Add the policy schema/defaults and auditable eligibility evaluation. [FR-005, FR-006]
- [x] T003 Add a route registry for `/app`, supported destinations, and recovery destinations. [FR-001, FR-017]
- [x] T004 Add direct-load server routing and in-app unknown-route recovery with tests. [FR-002, FR-003]
- [x] T005 Add legacy/platform selection tests proving existing dashboard paths are unchanged when flag is disabled. [FR-004, FR-005]

## Phase 2: Shell, design, and accessibility

- [x] T006 [P] Define semantic design tokens for light/dark color, typography, space, elevation, borders, focus, and motion. [FR-007, FR-008]
- [x] T007 [P] Implement theme preference, system fallback, persistence, and theme tests. [FR-008]
- [x] T008 Implement the `/app` shell, navigation, and route transition behavior using the registry. [FR-001, FR-002, FR-017]
- [x] T009 [P] Implement accessible action, input, feedback, overlay, and empty-state primitives with keyboard/focus/semantic tests. [FR-009, FR-010]
- [x] T010 Define and implement the shared action-state contract and recovery messaging. [FR-011, FR-012]

## Phase 3: API boundary and compatibility

- [x] T011 Add contract fixtures for representative `/api/*` and `/api/v1/*` requests, responses, authentication outcomes, and status codes. [FR-014]
- [x] T012 Implement typed application-boundary adapters and normalized view failures. [FR-013, FR-012]
- [x] T013 Connect foundation route fixtures to loading, content, empty, and error state boundaries. [FR-011, FR-013]
- [x] T014 Verify platform enablement/disablement leaves representative public API contracts byte-for-byte compatible where applicable. [FR-014]

## Phase 4: Browser evidence and release gates

- [x] T015 Add browser coverage for direct loads, refresh, Back/Forward, unknown route recovery, and flag states. [FR-002, FR-003, FR-005]
- [x] T016 Add browser coverage for light/dark themes, narrow/wide viewports, and every action state. [FR-008, FR-011, FR-016]
- [x] T017 Add automated accessibility checks and keyboard-path evidence for shell and primitives. [FR-009, FR-010]
- [x] T018 Add browser-matrix execution and evidence retention for Chrome, Edge, Firefox, and Safari support policy. [FR-015, FR-016]
- [x] T019 Add rollback rehearsal: disable the flag after use and prove legacy recovery plus API compatibility. [FR-006, FR-014]
- [x] T020 Run full validation, record screenshots/evidence, update quickstart, and run `$speckit-converge`. [SC-001–SC-005]

## Dependency Order

`T001 → T005 → T008 → T013 → T015–T020`; T006/T007/T009 may proceed after T003; T011 precedes T012–T014; T015–T019 require their underlying route/primitives/boundary work.
