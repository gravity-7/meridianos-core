# Journey Catalog Contract

The catalog is the authoritative inventory used by human reviewers, AI test agents, future browser automation, and the release scorecard.

## Required top-level collections

```yaml
catalog_version: 1
personas: { persona-id: { label: Name, goal: Outcome, access: Boundary } }
fixture_profiles: { fixture-id: { purpose: State, reset: Rule, dependency_mode: Mode } }
dependency_scenarios: { dependency: Controlled variants }
journeys: { JRN-001: Journey record }
```

## Required journey shape

```yaml
JRN-001:
  title: Short journey title
  persona: individual-first-time
  user_goal: The outcome the persona needs
  business_value: Why the outcome matters
  priority: P1
  domains: onboarding; providers-models
  risk_level: critical | high | medium | low
  preconditions: Safe fixture starting state
  fixture_profile: fixture-first-value
  synthetic_data_needs: Generated records and dependency state
  dependency_scenarios: provider; browser_system
  numbered_actions: 1 action; 2 action
  expected_outcomes: Observable result
  recovery_expectations: Safe retry or exit
  verification_method: Contract and browser lanes
  truth_state: CURRENT-SIMULATED | PLANNED
  evidence_status: PASS | FAIL | BLOCKED | SKIPPED | MANUAL-CANARY
  review_status: DRAFT | REVIEWED-FOR-INTERNAL | APPROVED-FOR-CLIENT
  owner: qa-owner
  verification_lanes: Browser and contract lanes for P1
  browser_expectations: Desktop, narrow, keyboard, and recovery expectations
  runbook: runbooks/JRN-001-example.md
```

## Invariants

1. Journey mapping keys are unique, stable `JRN-###` identifiers after publication.
2. Persona and fixture references resolve to entries in their top-level mappings.
3. Every journey carries the replay, safety, and review fields shown above; every P1 also has owner, lanes, browser expectations, and a runbook.
4. Every browser-visible P1 journey declares desktop, narrow, keyboard, and recovery expectations in its browser field or the linked P1 matrix.
5. Catalog values contain no secret, session token, personal data, production hostname, or unsupported live-certification claim.
6. `manual-canary` is not equivalent to `passing`; it links to a dated human-approved canary.
