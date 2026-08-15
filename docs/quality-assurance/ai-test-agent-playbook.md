# AI test-agent playbook

## Inputs an agent must receive

Give the agent one journey ID, fixture profile/revision, repository commit,
allowed local URL, expected evidence class, and stop conditions. The catalog and
matching runbook are its source of truth; it must not invent a new persona,
provider, account, or product claim.

## Allowed default actions

- Start only the named local fixture and inspect its generated manifest.
- Use Playwright MCP or Playwright against the allowed local URL.
- Follow visible runbook steps, inspect DOM/accessibility state, use keyboard,
  and capture redacted screenshots.
- Save internal evidence under `artifacts/qa/<run-id>/` and emit a concise
  result or a [triage record](templates/triage-record.md).

## Prohibited default actions

- Sign in to a real account; create a real invitation; use a production key;
  enter a payment flow; call an external URL; change live configuration; or
  disclose raw diagnostics outside the evidence bundle.
- Mark a planned flow as current, an illustrative report as factual, or a
  failed/blocked result as passed.

## Exploration procedure

1. Read the catalog entry and runbook; reject unknown fixture/dependency mode.
2. Confirm loopback-only endpoint, synthetic identity, unique run ID, and zero
   planned external calls before opening the browser.
3. Execute numbered visible steps exactly once; then perform only the stated
   recovery and keyboard checks.
4. Compare actual and expected result per step. Capture a screenshot only when
   it is useful evidence and contains no secret/sentinel.
5. Scan storage, URLs, console/network summaries, and screenshots. Stop if a
   sentinel, secret-like value, non-loopback request, cost, or real person is
   detected.
6. Emit `PASS`, `FAIL`, `BLOCKED`, or `SKIPPED` with evidence links. On failure,
   write a reproduction-focused triage record; do not attempt an unapproved fix.

## Agent handoff prompt skeleton

`Run <journey ID> using <fixture profile>. This is deterministic simulated
testing. Use only <local URL>. Follow the linked runbook, capture internal
evidence, and stop on any external request, secret/sentinel exposure, paid
action, real identity, or scope ambiguity. Report outcome per step and create a
triage record for non-pass results.`
