# Quickstart Validation Guide: Foundation Hardening

**Created**: 2026-07-27 | **Plan**: [plan.md](./plan.md)

## Purpose

This guide documents runnable validation scenarios that prove Phase 0 features work end-to-end. Each scenario is independently testable and verifies one or more functional requirements from the [spec](./spec.md).

---

## Prerequisites

- Node.js 24+
- Repository cloned at `c:\projects\meridianos-core` (or equivalent)
- `npm test` passes with 915 tests, 0 failures (baseline)
- A test Anthropic API key set as `ANTHROPIC_API_KEY` environment variable (for gateway tests)
- Optional: A test OpenAI-compatible API key for OpenCode injection tests

---

## Scenario 1: OpenAI Wire Injection (P0-F1)

**Validates**: FR-001, FR-002, FR-003, FR-004, SC-001, SC-014

### Setup
```powershell
# No special setup needed — tests use cassette mocks
```

### Run
```powershell
node --test tests/gateway/inject-openai.test.mjs
node --test tests/gateway/server-openai.test.mjs
```

### Expected Results
- All OpenAI injection tests pass
- Existing inject tests produce byte-identical output (Anthropic regression check)
- Zero test failures

### Manual Verification
```powershell
# Start the daemon with a gateway-enabled config
# Spawn an OpenCode agent task
# Query the ledger:
sqlite3 .ai/gateway/ledger.db "SELECT provider, model, total_tokens FROM token_events WHERE source='agent' ORDER BY ts DESC LIMIT 1"
```
- Shows provider/model with non-null token counts
- Gateway log shows `"openai-wire agent traffic routed through gateway"`

---

## Scenario 2: Gateway Default-ON (P0-F2)

**Validates**: FR-005, FR-006, FR-007, FR-008, SC-002

### Setup
Ensure `policy.yaml` does NOT have `gateway.disabled: true`.

### Run
```powershell
node -e "
import { createAios } from './config.mjs';
import { start } from './scheduler.mjs';
// ... minimal start test
"
```

### Expected Results
- `config.gateway.gatewayActive === true` after daemon start
- Gateway starts without manual `--gateway` flag or `gateway.enabled: true`
- Budget module reads from ledger as primary source

### Opt-Out Verification
```yaml
# policy.yaml
gateway:
  disabled: true
```
- Daemon starts but gateway does NOT start
- Budget falls back to usage readers with a log warning

---

## Scenario 3: Unified Configuration (P0-F3)

**Validates**: FR-009, FR-010, FR-011, FR-012, SC-003

### Setup
Create a minimal `policy.yaml` with agent definitions:
```yaml
agents:
  - builder
  - reviewer
model_routing:
  builder:
    simple:
      provider: anthropic
      model: claude-sonnet-4-20250514
```

### Run
```powershell
Remove-Item .ai/tenant.yaml -ErrorAction SilentlyContinue
node daemon-entry.mjs 2>&1 | Select-Object -First 20
```

### Expected Results
- Agent roster loads from `policy.yaml` agents field
- Board is created with builder and reviewer agents
- No error about missing tenant.yaml

### Backward Compatibility
```powershell
# Restore tenant.yaml, add a different agent
# Daemon boots with deprecation warning but works correctly
```

---

## Scenario 4: Traffic Source Classification (P0-F4)

**Validates**: FR-013, FR-014, FR-015, SC-004

### Run
```powershell
sqlite3 .ai/gateway/ledger.db ".schema token_events"
```

### Expected Results
- Schema output includes `source TEXT NOT NULL DEFAULT 'agent'`
- All existing rows have `source = 'agent'`
- New token events include correct source value

### Query Verification
```powershell
sqlite3 .ai/gateway/ledger.db "SELECT source, COUNT(*) FROM token_events GROUP BY source"
```
- Shows breakdown by traffic source

---

## Scenario 5: Provider Health Monitoring (P0-F5)

**Validates**: FR-016, FR-017, FR-018, FR-019, SC-005

### Run
```powershell
# Start daemon with gateway enabled
# Query dashboard endpoint:
Invoke-RestMethod -Uri "http://localhost:4317/api/providers" | ConvertTo-Json -Depth 3
```

### Expected Results
- Each provider has `health: { status, latencyMs, lastCheck }`
- Status is `ok` for reachable providers
- Status transitions to `degraded` then `down` when a provider is unreachable (within 60s)

---

## Scenario 6: Cross-Platform Scripts (P0-F6)

**Validates**: FR-021, FR-022, FR-023, SC-006

### Run (Windows)
```powershell
node scripts/publish.mjs --dry-run
node scripts/register-conductor.mjs --dry-run
```

### Expected Results
- Publish script uses `node:crypto` (no DPAPI dependency)
- Register script detects Windows and prints Task Scheduler command
- Both scripts run without PowerShell-specific dependencies

### Cross-Platform Check
- On macOS: register script should detect launchd
- On Linux: register script should detect systemd

---

## Scenario 7: Architecture Diagrams (P0-F7)

**Validates**: FR-024, FR-025, FR-026, FR-027, SC-007

### Run
Open each of the 5 diagram PNGs in `docs/diagrams/`:
1. `high-level-architecture.png`
2. `processing-pipeline.png`
3. `data-model.png`
4. `gateway-architecture.png`
5. `deployment.png`

### Expected Results
- No floating/overlapping text elements
- No garbled labels (e.g., "propoAReclaim" → correct label)
- All expected nodes present (Filesystem Inbox, Done/Complete states)
- Data model entities match actual SQL schema

---

## Scenario 8: Budget Sentinel Values (P0-F8)

**Validates**: FR-028, FR-029, FR-030, SC-008

### Run
```powershell
node --test --test-name-pattern="budget.*sentinel|windows.*zero" tests/
```

### Expected Results
- `per_5h_tokens: 0` → all requests blocked (403)
- `per_5h_tokens` omitted → requests allowed (unlimited)
- `per_5h_tokens: 50000` → normal enforcement at 50k tokens

---

## Scenario 9: Per-Provider Headers (P0-F9)

**Validates**: FR-031, FR-032, FR-033, SC-009

### Run
```powershell
node --test tests/gateway/server.test.mjs
```

### Expected Results
- Anthropic requests include `anthropic-version` header
- DeepSeek requests do NOT include `anthropic-version`
- Google AI requests include `x-goog-api-version` (if configured)

---

## Scenario 10: Harness Adapter Audit (P0-F10)

**Validates**: FR-034, FR-035, FR-036, SC-010

### Run
```powershell
# Run a Claude Code agent through the gateway, then compare:
node -e "
import { openLedger, queryWindow } from './gateway/ledger.mjs';
import { claudeUsage } from './claude-usage.mjs';
// Compare ledger total vs usage reader total
"
```

### Expected Results
- Ledger vs usage reader discrepancy < 5%
- If >10%, warning logged with details
- `docs/KNOWN-ISSUES.md` documents Claude Code OAuth fallback limitation

---

## Scenario 11: Self-Healing Bootstrap (P0-F11)

**Validates**: FR-037, FR-038, FR-039, FR-040, SC-011

### Run (fresh clone test)
```powershell
# In a clean directory:
Remove-Item .ai -Recurse -Force -ErrorAction SilentlyContinue
node daemon-entry.mjs 2>&1 | Select-Object -First 30
```

### Expected Results
- `.ai/` and all subdirectories auto-created
- No crashes, no stack traces
- All error messages follow `"[MERIDIANOS] check: problem. Fix: action."` format

### --init Flag
```powershell
node daemon-entry.mjs --init
```
- Scaffolds default `policy.yaml` with inline documentation
- Prints getting-started instructions

---

## Scenario 12: Configuration JSON Schema Validation (P0-F12)

**Validates**: FR-041, FR-042, FR-043, SC-012

### Run
```powershell
# Test with invalid config:
$invalidYaml = @"
model_routing:
  builder:
    simple:
      provider: nonexistent-provider
"@
$invalidYaml | Out-File -Encoding utf8 .ai/policy.yaml
node daemon-entry.mjs 2>&1 | Select-String "validation|error"
```

### Expected Results
- Boot produces error: `"policy.yaml: model_routing.builder.simple references unknown provider 'nonexistent-provider'"`
- Error includes file path, field path, and valid options
- Valid config boots silently

---

## Full Regression Check

**Validates**: FR-044, FR-045, FR-046, SC-013

### Run
```powershell
npm test
```

### Expected Results
- **≥915 tests pass**
- **0 test failures**
- Zero `.only()` markers in committed code
- All new Phase 0 tests pass alongside existing tests

---

## Verification Matrix

| # | Scenario | Command | Expected |
|---|----------|---------|----------|
| 1 | OpenAI injection | `node --test tests/gateway/inject-openai.test.mjs` | All pass, Anthropic byte-identical |
| 2 | Gateway default-ON | Start daemon, check `config.gateway.url` | Present without `enabled: true` |
| 3 | Unified config | Boot with only policy.yaml | Agent roster loaded |
| 4 | Source column | `.schema token_events` | `source TEXT NOT NULL DEFAULT 'agent'` |
| 5 | Provider health | `GET /api/providers` | Health status per provider |
| 6 | Cross-platform scripts | `node scripts/publish.mjs --dry-run` | Runs on all 3 platforms |
| 7 | Diagrams | Visual inspection of 5 PNGs | No artifacts, all elements present |
| 8 | Budget sentinels | `per_5h_tokens: 0` → 403 | Null/absent → allowed |
| 9 | Provider headers | DeepSeek request inspection | No `anthropic-version` |
| 10 | Harness audit | Ledger vs reader comparison | <5% discrepancy |
| 11 | Bootstrap | Fresh `.ai/` dir | Auto-created, no crash |
| 12 | Schema validation | Invalid policy boot | Specific error with line/field |
| 13 | Full suite | `npm test` | 915+ pass, 0 fail |
