# Data Model: Persona Testing Blueprint

## Persona Profile

| Field | Description | Validation |
|---|---|---|
| mapping key | Stable persona identifier | Unique lower-case slug |
| `label` | Human-readable persona name | Required |
| `goal` | Outcome the persona needs | Required |
| `access` | Expected access boundary | Required for role-based personas |

## Journey

| Field | Description | Validation |
|---|---|---|
| mapping key | Stable workflow identifier | Unique `JRN-###` value |
| `persona` | Persona that uses it | Valid persona mapping key |
| `priority` | Release priority | `P1`, `P2`, or `P3` |
| `domains` | Product capabilities exercised | One or more controlled domain labels |
| `risk_level` | Consequence of failure | `critical`, `high`, `medium`, or `low` |
| `user_goal` and `business_value` | User outcome and customer value | Required |
| `preconditions` and `synthetic_data_needs` | Isolated starting state and generated data | Required |
| `fixture_profile` | Synthetic starting state | Valid fixture profile ID |
| `dependency_scenarios` | Relevant controlled dependency modes | Valid dependency-scenario mapping keys |
| `numbered_actions`, `expected_outcomes`, `recovery_expectations` | Replayable actions, result, and safe recovery | Required |
| `verification_method` | Planned proving method | Required |
| `verification_lanes` and `browser_expectations` | Browser/contract lanes and desktop/narrow/keyboard/recovery expectations | Required for P1 |
| `truth_state`, `evidence_status`, `review_status` | Product claim, current evidence, and review state | Required |
| `owner` and `runbook` | Accountability and human explanation | Required for P1 |

## Fixture Profile

A fixture profile has an ID, purpose, synthetic users/roles, seeded projects/tasks/history, policy/budget/provider state, dependency scenarios, reset rule, and prohibited actions. It may never contain a real key, session token, customer identity, or production address.

## Dependency Scenario

A dependency scenario has an ID, dependency type, controlled outcome (`success`, `validation-error`, `denied`, `timeout`, or `unavailable`), safe response, and expected product recovery state.

## Workflow Runbook

A runbook links to one P1 journey and includes its audience, synthetic-data label, customer value, preconditions, numbered visible actions, expected outcome, recovery path, approved evidence, review status, and last verified date.

## Evidence Bundle and Triage Record

An evidence bundle records the journey ID, fixture revision, run type, browser/viewport where applicable, timestamps, outcome, safety checks, and links to transient diagnostics. A triage record links a failure or blocker to the bundle and records reproduction, expected/actual outcomes, severity, owner, and regression decision.
