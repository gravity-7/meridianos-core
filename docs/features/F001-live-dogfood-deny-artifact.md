# F001 – Live Dogfood Deny Artifact

**Feature ID:** F001
**Area:** Foundation
**Wedge:** Governance Gateway (Wedge 1)
**Status:** Proposed
**Priority:** P0 — Critical Path
**Estimated Effort:** 2 hours
**Assigned To:** Founder
**Dependencies:** None (this is the first feature)
**Blocks:** F003, F004, F008, F009

---

## Business Context

### Problem
The MeridianOS gateway's inline budget enforcement (non-retryable 403 on over-cap) is implemented and unit/integration-tested against offline stubs. However, **no primary artifact exists proving enforcement fires against live paid provider traffic.** The surviving dogfood ledger (`.ai/gateway/ledger.db`, queried 2026-07-18) contains 64 rows — ALL `enforcement_decision: 'allow'`, ZERO denies. This is the single biggest gap between what the product claims and what it can prove.

### Why This Matters
- Every GTM claim about "inline enforcement" is currently backed by offline tests only
- Prospects will ask: "Has this actually blocked a real call?" — we cannot answer yes
- A screenshot of a real `deny` row against a real DeepSeek endpoint is the most persuasive artifact the product can have
- The cost to close this gap is ~$0.006 USD

### Success Criteria
A queryable SQLite ledger row exists with:
- `enforcement_decision = 'deny'`
- `cap_window = '5h'`
- `upstream_status = null` (never forwarded to provider)
- `provider = 'deepseek'`
- `cost_usd` computed from real `pricing.json` rates
- At least one preceding `allow` row in the same session (proving the trip-wire design: call N completes, call N+1 is denied)

### Recipe Reference
The exact procedure is documented in `docs/dogfood-29-confirm.md`. This feature IS the execution of that recipe.

---

## Functional Requirements

### FR1: Gateway Boot with Budget Cap
The gateway sidecar SHALL boot with a policy that sets:
- `gateway.enabled: true`
- `agent_budget.<agent>.per_5h_tokens: 50` (smallest functional cap — 0 is a footgun treated as "no cap")
- Provider route for DeepSeek (Anthropic wire via `/anthropic`)

### FR2: Real DeepSeek Call (Turn 1 — Allow)
A real agent invocation SHALL be made against the live DeepSeek API through the gateway.
- The call SHALL complete successfully (cold cap → 0 prior usage → trip-wire allows first call)
- The gateway SHALL meter the response: parse `input_tokens`, `output_tokens`, compute `cost_usd` via `pricing.mjs`'s `costFor()`
- The ledger SHALL contain exactly one new `allow` row with real token counts and real USD cost

### FR3: Denied Second Call (Turn 2 — Deny)
A second agent invocation SHALL be attempted through the same gateway session.
- The gateway SHALL compute the verdict BEFORE forwarding (as per `server.mjs`'s `checkVerdict` → `sendDeny` path)
- The verdict SHALL be `deny` because Turn 1's usage already exceeds the 50-token cap
- The gateway SHALL return HTTP 403 with `x-should-retry: false` and wire-shaped `permission_error` body
- The gateway SHALL emit a `deny` token-event with `upstream_status: null` (never dialed)
- The agent process SHALL exit non-zero

### FR4: Ledger Verification
After the run:
- `listEvents(openLedger('.ai/gateway/ledger.db'), { tenant: 'pv', agent: '<agent>' })` SHALL return at least 2 rows
- At least 1 row SHALL have `enforcement_decision: 'allow'`
- Exactly the LAST row for the session SHALL have `enforcement_decision: 'deny'` and `cap_window: '5h'`
- The deny row's `upstream_status` SHALL be `null`
- Both rows SHALL have non-null `cost_usd`, `input_tokens`, `output_tokens`

### FR5: Artifact Capture
The following SHALL be captured as immutable evidence:
- Screenshot of the ledger query output showing the deny row
- Copy of the exact `agent_budget` policy fragment used
- The run-log entry showing `outcome: failed` / `reason: budget`
- The exact cost in USD (from `cost_usd` column) as proof of real spend

---

## Technical Requirements

### TR1: Gateway Assembly
Use `assembleGateway` from `gateway/index.mjs` with:
- `policy` containing the budget cap and provider route
- `tenant: 'pv'`
- `ledgerPath` pointing to a persistent ledger file (NOT `:memory:`)
- `config` providing `pricingPath` so `costFn` resolves real prices

### TR2: Provider Configuration
- Provider: DeepSeek
- Wire: Anthropic (via `anthropicBaseUrl: 'https://api.deepseek.com/anthropic'`)
- Key: Read from `process.env.DEEPSEEK_KEY` (never hardcoded, never printed)
- Model: `deepseek-v4-flash` (lowest cost tier per `providers.mjs`)

### TR3: Agent Invocation
Use `claude-code` harness with `--bare` flag:
- `ANTHROPIC_BASE_URL` → gateway's local URL
- `ANTHROPIC_API_KEY` → gateway's per-run token
- `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`
- Simple prompt: e.g., "Write the current date to a file called scratch.txt"

### TR4: Safety Constraints
- `DEEPSEEK_KEY` read from gitignored `.env` file — NEVER committed
- Gateway token is ephemeral (per-run UUID)
- After the run, REVERT the budget cap in policy and restart daemon
- Maximum expected cost: < $0.01 USD

### TR5: Reversibility
After capturing the artifact:
- Remove or comment out the `agent_budget.<agent>` entry
- Set `gateway.enabled: false` if not already on for other reasons
- Restart daemon so production runs are unaffected

---

## Architecture

### Component Interaction
```
┌──────────┐     ┌───────────────┐     ┌──────────────┐
│ claude   │────▶│   GATEWAY     │────▶│  DeepSeek API │
│ (--bare) │     │ :8787         │     │ (live, paid)  │
│          │     │               │     │               │
│ Turn 1   │     │ verdict=allow │     │ real response  │
│          │◀───│ meter → ledger │◀────│                │
│          │     │               │     │               │
│ Turn 2   │     │ verdict=DENY  │     │ NEVER DIALED   │
│          │◀───│ 403, emit deny │     │                │
│ exit≠0   │     │               │     │                │
└──────────┘     └───────────────┘     └──────────────┘
```

### Data Flow
1. `assembleGateway` → `startGateway` → HTTP server on ephemeral port
2. Agent Turn 1: `POST /anthropic/v1/messages` → `handleRequest` → `checkVerdict(ok)` → forward to `https://api.deepseek.com/anthropic` with real key → parse `usage` → `emitEvent(allow)` → return response
3. Agent Turn 2: `POST /anthropic/v1/messages` → `handleRequest` → `checkVerdict(deny)` → `sendDeny(403)` → `emitEvent(deny, upstreamStatus: null)` → never forward
4. Query ledger: `listEvents()` → verify allow + deny rows exist

### Ledger Schema (relevant columns)
From `gateway/ledger-schema.sql`:
- `enforcement_decision TEXT NOT NULL` — 'allow' | 'deny' | 'degrade'
- `cap_window TEXT` — '5h' | 'week' | null
- `upstream_status INTEGER` — HTTP status, null if never forwarded
- `cost_usd REAL` — from pricing catalog, null if unknown
- `input_tokens INTEGER`, `output_tokens INTEGER`, `total_tokens INTEGER`

---

## Database Changes

**None.** This feature uses the existing gateway ledger schema (`gateway/ledger-schema.sql`). No migrations needed.

---

## Security

- **Credential handling:** `DEEPSEEK_KEY` is read from `process.env` at forward-time inside `server.mjs`'s `resolveKey`. The key NEVER appears in: command-line arguments, stdout/stderr, log files, ledger rows, or committed files.
- **Network scope:** Only `127.0.0.1` (gateway) and `api.deepseek.com:443` (upstream). No other outbound connections.
- **Post-run cleanup:** Budget cap is immediately reverted to prevent accidental production impact.
- **Cost ceiling:** The 50-token cap limits maximum spend to fractions of a cent even if something goes wrong.

---

## Validation

### Pre-execution Checks
- [ ] `DEEPSEEK_KEY` env var is set and non-empty
- [ ] `claude` CLI is on PATH (`claude --version` exits 0)
- [ ] No existing agent is mid-run (check daemon status)
- [ ] `pricing.json` has entry for `deepseek-v4-flash`
- [ ] Policy file is backed up before editing

### Post-execution Checks
- [ ] Ledger contains ≥2 new rows for the test session
- [ ] At least 1 row has `enforcement_decision = 'deny'`
- [ ] Deny row has `upstream_status IS NULL`
- [ ] Allow row has `upstream_status = 200`
- [ ] `cost_usd` is non-null on both rows
- [ ] Agent process exited non-zero
- [ ] Total spend < $0.01 USD (verify via `cost_usd` sum)
- [ ] Policy reverted to pre-test state
- [ ] Daemon restarted with reverted policy

---

## Testing

### Automated
The deny path is ALREADY tested offline:
- `gateway/tests/server.test.mjs` — HTTP contract: 403 shape, `x-should-retry: false`, wire-format error body
- `gateway/tests/index.test.mjs` — end-to-end: meter → verdict → enforce loop against offline stub
- `tests/exit-confirm-e2e.test.mjs` — real `claude` CLI process exits non-zero against deny
- `gateway/tests/windows.test.mjs` — the `per_5h_tokens: 0` footgun test

### Manual (THIS FEATURE)
- One real DeepSeek call through the live gateway
- Visual verification of deny row in ledger
- Screenshot captured as permanent artifact

---

## Edge Cases

| Scenario | Expected Behavior |
|---|---|
| Turn 1 uses < 50 tokens (very small prompt) | Turn 2 may also be allowed. Lower cap to 1 token if needed, retry. Never set cap to 0. |
| DeepSeek API returns 5xx on Turn 1 | Gateway records the failure (null usage, allow decision — the call was allowed but failed upstream). Not a deny. Retry. |
| `claude` CLI not installed | Feature is blocked. Use the standalone gateway + curl instead. |
| `DEEPSEEK_KEY` expired or invalid | Gateway forwards, gets 401 from DeepSeek. Metered as upstream failure. Not a deny. Fix key, retry. |
| Gateway fails to start (port conflict) | `assembleGateway` with `port: 0` uses ephemeral port — no conflict possible. |
| Ledger file locked by another process | `busy_timeout = 5000` in `openLedger` waits 5s. Should not happen in single-tenant test. |

---

## Acceptance Criteria

1. ✅ A real DeepSeek API call is made through the gateway and metered successfully (allow row in ledger)
2. ✅ A subsequent call through the same gateway session is DENIED before reaching DeepSeek (deny row in ledger)
3. ✅ The deny row has: `enforcement_decision = 'deny'`, `cap_window = '5h'`, `upstream_status = null`
4. ✅ Both allow and deny rows have non-null `cost_usd`, `input_tokens`, `output_tokens`
5. ✅ A screenshot of the ledger query output exists and is saved to `docs/gtm/artifacts/`
6. ✅ Total spend for the test is verifiable and < $0.01 USD
7. ✅ Policy is reverted to pre-test state after the run
8. ✅ The deny artifact is referenced in `battle-card.md` and `wedge-and-icp.md` (replacing the current caveat)

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| DeepSeek API is down during test | Low | Delay feature by hours | Retry; DeepSeek has 99.9%+ uptime |
| Turn 1 uses fewer tokens than cap | Medium | No deny on Turn 2 | Lower cap to 1 token. The CLI's system prompt alone > 50 tokens, so this is very unlikely |
| Ledger shows deny but upstream was actually dialed | Very Low | Undermines the entire claim | `upstream_status: null` is mechanical proof. Also verified by `exit-confirm-e2e.test.mjs` offline |
| Cost exceeds $0.006 estimate | Low | Still negligible | DeepSeek V4 Flash pricing: $0.14/M input, $0.28/M output. 50 tokens × $0.28/1M = $0.000014 |

---

## Dependencies

- **External:** DeepSeek API availability, valid `DEEPSEEK_KEY`
- **Internal:** `gateway/index.mjs` (assembleGateway), `gateway/server.mjs` (startGateway), `pricing.mjs` (costFor), `gateway/ledger.mjs` (openLedger, appendEvent, listEvents)
- **Infra:** Node.js 24+, `claude` CLI on PATH

---

## Non-Functional Requirements

- **Cost:** Maximum $0.01 USD total spend
- **Time:** Complete execution < 5 minutes (gateway boot + 2 agent turns + ledger query)
- **Safety:** Zero risk of production impact (ephemeral policy, immediate revert)
- **Reproducibility:** The exact recipe must be reproducible by anyone with a DeepSeek key

---

## AI Implementation Guidance

### What to Build
A Node.js script (`scripts/dogfood-deny-run.mjs`) that:
1. Loads `DEEPSEEK_KEY` from `.env` (using `--env-file` or manual `process.env` set)
2. Calls `assembleGateway` with a policy containing `agent_budget.testdogfood.per_5h_tokens: 50`
3. Registers a run via `runs.registerRun`
4. Makes TWO HTTP requests to the gateway's `/anthropic/v1/messages` endpoint
5. Between requests, checks the first response succeeded (200)
6. Asserts the second response is 403 with `x-should-retry: false`
7. Queries the ledger and asserts deny row exists
8. Prints the artifact (ledger rows) to stdout as JSON
9. Cleans up: closes gateway, prints cost summary

### Key Modules to Use
- `gateway/index.mjs` → `assembleGateway`
- `gateway/ledger.mjs` → `openLedger`, `listEvents`
- `gateway/run-registry.mjs` → `createRunRegistry`
- `pricing.mjs` → `loadPricing`, `costFor`
- Node.js built-in `fetch` (Node 24) for HTTP requests

### Do NOT
- Hardcode any API key — read from `process.env.DEEPSEEK_KEY`
- Use `per_5h_tokens: 0` — that means "no cap" per `windows.test.mjs`
- Leave the budget cap in place after the script exits
- Print the API key to stdout or logs

### Script Signature
```js
// scripts/dogfood-deny-run.mjs
// Usage: DEEPSEEK_KEY=sk-... node scripts/dogfood-deny-run.mjs
// Exits 0 on success (deny row produced), non-zero on failure
```

---

## Deliverables

1. `scripts/dogfood-deny-run.mjs` — automated deny artifact producer
2. `docs/gtm/artifacts/deny-row-screenshot.png` — visual evidence
3. Updated `docs/gtm/battle-card.md` — replace caveat with "Verified: live deny against DeepSeek, 2026-07-XX"
4. Updated `docs/gtm/wedge-and-icp.md` — replace caveat with verified claim

---

*Feature spec version: 1.0 | Created: 2026-07-19 | Author: GitHub Copilot*
