# MeridianOS Quality Assurance Blueprint

This directory is the shared source of truth for people and AI agents testing
MeridianOS. It defines *what* to test, *which safe fixture* to use, *what a
result proves*, and *how to explain a workflow without overstating a product
claim*.

## Start here

1. Select a persona and journey in [journey-catalog.yaml](journey-catalog.yaml).
2. Read [safe-fixture-design.md](safe-fixture-design.md) before starting a
   server, browser, desktop app, or external integration.
3. For a P1 journey, rehearse the corresponding [runbook](runbooks/).
4. Use [ai-test-agent-playbook.md](ai-test-agent-playbook.md) when delegating
   browser exploration to an agent or Playwright MCP.
5. Record and assess the result using
   [evidence-and-release-model.md](evidence-and-release-model.md) and the
   [release scorecard](release-scorecard.md).

## Vocabulary

| Term | Meaning |
| --- | --- |
| **Journey** | A bounded persona goal, with a fixture, expected result, and evidence target. |
| **P1** | Release-critical workflow; it gets a reviewed runbook and automated-browser target. |
| **Fixture profile** | Reusable, synthetic state and dependency behavior for a journey. |
| **Deterministic simulated** | Default test lane: generated data and loopback fakes only. |
| **Live canary** | Explicitly approved, tightly scoped use of a real external dependency. Never the default. |
| **Illustrative** | A UI/report can be shown as a mock or concept but is not proof of a live capability. |
| **Raw evidence** | CI-only traces, console/network summaries, and unreviewed screenshots under `artifacts/qa/`. |
| **Approved illustration** | Redacted, reviewed asset that may be linked from a runbook. |

## Truthful sharing rule

Runbooks are deliberately useful for founder demos and prospect conversations.
They must say whether every material step is current, planned, simulated, or a
live-canary-only action. Do not attach raw CI traces, browser storage, tokens,
headers, real account names, or unreviewed screenshots to a runbook.

The catalog is validated by `node --test tests/quality-assurance-blueprint.test.mjs`.
