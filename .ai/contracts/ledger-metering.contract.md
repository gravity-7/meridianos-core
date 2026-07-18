# Contract — Ledger-canonical metering (card C4) + budget wiring (card C9)

Scope item 5. When `gateway.enabled`, the **gateway ledger is the metering source of truth**;
per-harness usage-readers demote to a **fallback** used only when the gateway is off or the ledger
has no event for a run. Additive + backward-compatible: gateway-off behavior is byte-identical.

## Current state
- `usage-readers.mjs` → `readUsage(harness, run, result, overrides)` reads each harness's own
  post-run accounting. This is the only metering entry point today.
- `gateway/ledger.mjs` → `queryWindow(ledger, {tenant, agent, since, until})` and
  `listEvents(ledger, {limit, tenant, agent})` already expose per-tenant/agent token+cost totals.

## C4 deliverables (`usage-readers.mjs`)
Add a canonical-first resolution **without breaking `readUsage`'s signature or its fallback path**:
```
export function readUsage(harness, run, result, overrides) { /* unchanged behavior */ }

// NEW — the canonical path:
export function meterRun(run, result, { config, ledger } = {}) → {
  tokensIn, tokensOut, costUsd, source: 'ledger' | 'usage-reader'
}
```
- `meterRun` prefers the ledger when `config.gateway?.enabled` AND a ledger event matches this run
  (match on tenant + agent + time window of the run). Else it falls back to `readUsage(...)` and
  tags `source:'usage-reader'`.
- **Never guess.** If neither ledger nor reader yields a number, return zeros with an explicit
  `source` and let the caller decide — do not fabricate.
- Read-only import of `gateway/ledger.mjs` (`queryWindow`). C4 does **not** modify the gateway.

## Acceptance criteria (C4)
- **AC1** Given `gateway.enabled=true` and a ledger event for the run, `meterRun` returns the
  ledger's tokens/cost with `source:'ledger'`.
- **AC2** Given `gateway.enabled=false`, `meterRun` returns the usage-reader result with
  `source:'usage-reader'` — byte-identical numbers to today's `readUsage`.
- **AC3** Given `gateway.enabled=true` but NO matching ledger event, `meterRun` falls back to the
  usage-reader and tags `source:'usage-reader'`.
- **AC4** Existing `usage-readers` tests stay green unmodified.

## C9 deliverables (`budget.mjs`) — depends on C4
Route the budget window computation through `meterRun`'s canonical numbers when the gateway is on,
so budget verdicts (`ok`/`warn`/`halt`) reconcile with the ledger the gateway already enforces on.
- **AC5** With the gateway on, a per-agent budget window computed from the ledger matches
  `queryWindow` totals for that tenant+agent+window (the sales claim: one canonical ledger).
- **AC6** With the gateway off, budget verdicts are byte-identical to today.

## Out of scope
Changing the gateway's own inline metering/enforcement; removing usage-readers (they remain the
documented fallback); dashboard changes.
