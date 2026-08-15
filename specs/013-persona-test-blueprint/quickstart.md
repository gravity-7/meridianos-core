# Quickstart: Use the Persona Testing Blueprint

## Validate the blueprint

1. Open `docs/quality-assurance/README.md`.
2. Confirm `journey-catalog.yaml` lists seven personas and at least fifteen journeys.
3. Select `JRN-001` and check its fixture, dependency variants, browser expectations, status, and runbook link.
4. Read the linked runbook as a founder preparing a prospect demonstration. It must make customer value, synthetic data, actions, expected result, and recovery clear without source-code reading.
5. Confirm `safe-fixture-design.md` prohibits production data, real provider requests, external payments, live invitations, and uncontrolled agent work in the standard fixture.
6. Run the focused blueprint validation test after implementation. It must make no network call.

## Start a future AI-agent exploratory run

1. Select one P1 journey.
2. Prepare only its named safe fixture profile.
3. Supply the journey ID and `ai-test-agent-playbook.md` to the agent.
4. Require an evidence bundle or triage record; require a stop and approval request for any live-only step.
5. Update the reviewed runbook after a meaningful demonstration change; do not share raw artifacts.

## Evidence classes

- **Deterministic**: isolated repeatable result suitable for CI confidence.
- **Exploratory**: agent/human investigation that may reveal a regression candidate.
- **Manual demonstration**: founder-led explanation using reviewed synthetic data.
- **Live canary**: explicitly approved, time-bound real-integration proof.
