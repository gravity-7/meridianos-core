# Research & Technical Decisions: Foundation Hardening

**Created**: 2026-07-27 | **Plan**: [plan.md](./plan.md)

## Phase 0 Research Summary

Phase 0 hardens existing code — no new technology choices, no new dependencies, no architectural pivots. All decisions are about how to implement changes within the existing system constraints. Below are the key technical decisions resolved from codebase analysis.

---

## Decision 1: OpenAI Wire Injection Strategy

**Decision**: Add an `openai` wire branch to `applyGatewayInjection()` in `gateway/inject.mjs` that rewrites file-based `opencode.json` config (not env vars — OpenCode uses a JSON config file, not environment variables for `baseURL`/`apiKey`).

**Rationale**:
- The existing `applyGatewayInjection()` works by rewriting env vars (`ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`) for Claude Code's anthropic-wire path.
- OpenCode uses a file-based config (`opencode.json`) with `baseURL` and `apiKey` fields — not env vars.
- The harness adapter (`harness-adapters.mjs`, `openCodeAdapter()`) already produces `files: [{ path: 'opencode.json', content: ... }]` in the spawn plan.
- The injection must: (1) parse the file content from the existing plan, (2) replace `baseURL` with the gateway URL, (3) replace `apiKey` with the minted gateway token, (4) return updated files array.
- Gateway server-side (`gateway/server.mjs`): add `case 'openai'` to `buildForwardHeaders()` to construct `Authorization: Bearer ${apiKey}` (matching how OpenAI clients send auth).

**Alternatives considered**:
- Env-var based injection for OpenCode: Rejected — OpenCode doesn't read env vars for its API endpoint; it reads `opencode.json`.
- Creating a separate injection module: Rejected — keeps injection logic co-located in `gateway/inject.mjs` for maintainability.

---

## Decision 2: Gateway Default-ON Implementation

**Decision**: Modify `maybeStartGateway()` in `scheduler.mjs` to remove the `policy?.gateway?.enabled !== true` gate. The gateway always starts. A new `policy.gateway.disabled: true` flag is the ONLY way to prevent startup.

**Rationale**:
- Current code (`scheduler.mjs:421-422`): `if (policy?.gateway?.enabled !== true) return { gatewayConfig: undefined, close: () => {} };` — purely opt-in.
- The change is minimal: reverse the condition to check for `disabled: true` instead of `enabled: true`.
- In `launcher.mjs:273`, the check `gwConfig?.enabled === true` becomes a check for `gwConfig?.url` presence instead — any started gateway enables injection.
- In `budget.mjs`, `currentUsage()` must try `ledgerWindowUsage()` first, falling back to `usageReaderUsage()` on error. The existing `ledgerWindowUsage` (via `gateway/windows.mjs`'s `agentBudgetVerdict`) and usage-reader functions both already exist — just the call order changes.

**Alternatives considered**:
- Separate `gateway.mode: 'auto' | 'manual'` flag: Rejected — adds config surface complexity for no real user benefit.
- Gateway always on with no opt-out: Rejected — operators need an escape hatch for debugging or when running without any providers configured.

---

## Decision 3: Unified Config Merge Strategy

**Decision**: Extend `config.mjs`'s `resolveDomain()` to merge `policy.agents` into the domain plugin when `tenant.yaml` is absent. `tenant-config.mjs`'s `resolveTenantConfig()` adds a `console.warn()` deprecation notice and delegates to reading from policy.

**Rationale**:
- Current `resolveDomain()` already has a chain: explicit `domain` object → `$AIOS_TENANT_CONFIG` env → `.ai/tenant.yaml` → throw.
- The change adds a step BEFORE tenant.yaml: check `policy.agents` field. If present, use it. If not, fall through to tenant.yaml.
- This preserves 100% backward compatibility — existing tenant.yaml deployments continue working with a deprecation warning.
- The constitution's Principle II (Configuration over Code) favors a single config surface.

**Alternatives considered**:
- Hard cutover (remove tenant.yaml support immediately): Rejected — violates backward compatibility and the constitution's guidance on deprecation.
- Auto-migrate tenant.yaml → policy.yaml on boot: Rejected — auto-modifying user config files is dangerous; a migration guide is safer.

---

## Decision 4: Traffic Source Column Implementation

**Decision**: `ALTER TABLE token_events ADD COLUMN source TEXT NOT NULL DEFAULT 'agent'` — pure SQLite schema addition. No data migration needed; SQLite's `ADD COLUMN` with a `DEFAULT` is O(1) (only updates schema, not rows). Existing rows implicitly get `'agent'`.

**Rationale**:
- SQLite's `ALTER TABLE ADD COLUMN` with a non-null default is a metadata-only operation — the default value is stored in the schema, not written to every row.
- The source values are: `agent`, `ide`, `cli`, `api`. These are determined at request time by the gateway server based on the request context (currently always `agent` since only agent traffic goes through the gateway; IDE/CLI/API will be added in P1/P4).
- `makeTokenEvent()` in `gateway/token-event.mjs` needs `source` added to its parameter list.
- `listEvents()` and `queryWindow()` in `gateway/ledger.mjs` need to SELECT and optionally filter/group by `source`.

**Alternatives considered**:
- Separate `traffic_sources` lookup table: Rejected — over-normalized for 4 enum-like values.
- ENUM type: Rejected — SQLite doesn't have native ENUM; TEXT with validation is the standard pattern.

---

## Decision 5: Provider Health Check Architecture

**Decision**: New module `provider-health.mjs` with a `startHealthLoop({ registry, intervalMs: 60000, onHealthChange })` function. Uses `node:http`/`node:https` for lightweight GET probes (not a full API call — no token consumption). Health states: `unknown` → `ok` → `degraded` (1 failure) → `down` (2+ consecutive failures).

**Rationale**:
- Lightweight GET to provider base URL avoids consuming paid tokens on health checks.
- 5-second timeout prevents hung checks from blocking the loop.
- Consecutive failure tracking prevents flap: a single network blip shows `degraded`, not `down`.
- Integration point: `gateway/index.mjs`'s `assembleGateway()` starts the loop; dashboard `GET /api/providers` reads health state from an in-memory Map updated by the loop.
- The loop can accept an `onHealthChange` callback for future alerting integration.

**Alternatives considered**:
- Health check inside `gateway/server.mjs`: Rejected — health checking is an infrastructure concern separate from the proxy server; better as a standalone module.
- Using the model router for health: Rejected — the router needs health info to make decisions; it shouldn't own the health check itself (circular dependency risk).

---

## Decision 6: Cross-Platform Script Strategy

**Decision**: Rewrite `scripts/publish.ps1` → `scripts/publish.mjs` using `node:crypto` for key generation (replacing Windows DPAPI). Rewrite `scripts/register-conductor.ps1` → `scripts/register-conductor.mjs` with OS detection (`process.platform`) and platform-specific service registration.

**Rationale**:
- `process.platform` returns `'win32'`, `'darwin'`, or `'linux'` — sufficient for OS dispatch.
- Windows: `child_process.execSync('schtasks ...')` for Task Scheduler.
- macOS: Write a `.plist` to `~/Library/LaunchAgents/` and `launchctl load`.
- Linux: Write a `.service` file to `~/.config/systemd/user/` and `systemctl --user enable`.
- `node:crypto` provides `randomUUID()`, `randomBytes()`, `createHash()` — all the DPAPI replacement needed.
- The old `.ps1` files are kept as-is (no breaking change) with a deprecation comment pointing to the `.mjs` equivalents.

**Alternatives considered**:
- Using a shell script wrapper (bash): Rejected — bash on Windows requires WSL/Git Bash; Node.js is already required.
- Third-party cross-platform service library: Rejected — violates zero-dependency constraint; the registration logic is <50 lines per platform.

---

## Decision 7: Diagram Fix Approach

**Decision**: Edit diagram source files (Mermaid `.md` or Draw.io `.drawio`) in `docs/diagrams/`, fix identified issues, re-export all 5 PNGs. If source files are missing for any diagram, recreate from codebase analysis.

**Rationale**:
- The identified issues from the master plan: floating text in high-level-architecture, garbled "propoAReclaim" in processing-pipeline, missing Filesystem Inbox node, incorrect leases box in data-model, missing Done/Complete states.
- These are rendering/accuracy fixes, not redesigns — the diagram structure stays the same.
- SVG preferred over PNG for future editability, but PNG is needed for README embedding.

**Alternatives considered**:
- Redesigning diagrams from scratch: Rejected — Phase 0 scope is fix, not redesign; diagram overhaul belongs in documentation epic.

---

## Decision 8: Budget Sentinel Semantics Fix

**Decision**: In `gateway/windows.mjs`'s `verdictFor` (actually `budget.mjs`'s `verdictFor` which windows.mjs reuses), fix the `!r.cap` check: `cap === 0` should NOT be treated as "no cap" — it should be treated as a real cap of 0, which always halts. Only `cap === null || cap === undefined` means "no cap."

**Rationale**:
- Current code: `if (!r.cap) return { ...r, pct: null, state: 'no-cap' };` — this treats `0` (falsy) the same as `null`/`undefined`.
- Fix: change to `if (r.cap == null)` — only null/undefined bypasses enforcement.
- `0` as a cap means "block everything" — useful for temporarily disabling an agent's API access.
- This is a one-line change in `budget.mjs`'s `verdictFor()` and `gateway/windows.mjs`'s `costVerdictFor()`.

**Alternatives considered**:
- Adding a separate `enabled: false` flag: Rejected — `cap: 0` is a natural expression of "no tokens allowed"; adding another flag is redundant.

---

## Decision 9: Per-Provider Headers

**Decision**: Remove `const DEFAULT_ANTHROPIC_VERSION = '2023-06-01'` from `gateway/server.mjs`. Instead, headers are read from `route.providerHeaders` (from the provider registry). If `providerHeaders` is absent/empty, no provider-specific headers are added.

**Rationale**:
- Current code sends `anthropic-version: 2023-06-01` to EVERY provider unconditionally — a bug for non-Anthropic endpoints.
- The provider registry (built by `gateway/registry-source.mjs`) already supports per-route configuration — adding `providerHeaders: { "anthropic-version": "..." }` to the Anthropic route definition is straightforward.
- Other providers get no extra headers unless explicitly configured.
- This is a pure server-side change — no injection, ledger, or launcher impact.

**Alternatives considered**:
- Per-wire header defaults: Rejected — headers are provider-specific, not wire-specific (two providers could use the same wire but need different headers).

---

## Decision 10: Harness Adapter Audit Strategy

**Decision**: Manual audit of all three harness adapters (claudeCodeAdapter, openCodeAdapter, antigravityAdapter) in `harness-adapters.mjs` followed by automated gateway-side detection of ledger-vs-reader discrepancy.

**Rationale**:
- The Claude Code adapter already has `--bare` flag and `ANTHROPIC_DEFAULT_*_MODEL` env vars for third-party hardening. The audit verifies these are correctly applied.
- OpenCode adapter: verify `baseURL` in the generated `opencode.json` is correctly overridden.
- Antigravity adapter: verify the `AGY_BASE_URL` env var is set correctly.
- Gateway-side detection: compare `queryWindow()` totals against `usageReaderWindowUsage()` totals every 5 minutes. If discrepancy >10%, log warning with details. This is a new periodic check in the gateway's event loop.
- Known limitations (Claude Code OAuth fallback with `--bare` not fully preventing it in all scenarios) documented in `docs/KNOWN-ISSUES.md`.

**Alternatives considered**:
- Runtime hook into each harness process: Rejected — too invasive; harnesses are external CLIs we don't control.
- Blocking non-gateway traffic at network level: Rejected — requires OS-level firewall rules, not portable.

---

## Decision 11: Self-Healing Bootstrap

**Decision**: In `boot-guard.mjs`, add pre-flight directory creation using `fs.mkdirSync(dir, { recursive: true })` for all required `.ai/` subdirectories before any other boot logic runs. In `daemon-entry.mjs`, add `--init` flag that calls `init.mjs` scaffold logic. All error messages follow `"[MERIDIANOS] ${check}: ${problem}. Fix: ${action}."` format.

**Rationale**:
- The current bootstrap crashes with `ENOENT` errors when `.ai/` directories don't exist.
- `fs.mkdirSync` with `{ recursive: true }` is idempotent — safe to call even when directories exist.
- The `--init` flag provides a deliberate "first run" experience distinct from normal daemon start.
- Error format standardization makes logs grep-able and actionable.

**Alternatives considered**:
- Auto-create on every module import: Rejected — side effects at import time are hard to test and reason about.
- Separate `meridianos init` CLI command: Rejected — adds complexity; `--init` flag on the daemon is simpler.

---

## Decision 12: JSON Schema Validation

**Decision**: Create `schema/policy.schema.json` using JSON Schema draft-07. Validate at boot in `policy-validate.mjs` using a lightweight schema validator built on Node.js built-ins (no `ajv` dependency — zero-dependency constraint).

**Rationale**:
- JSON Schema draft-07 is widely supported and sufficient for config validation.
- A minimal validator focused on our specific needs (required fields, enum values, type checking, cross-references) can be built in ~200 lines using `node:fs` and basic object traversal.
- The validator must NOT pull in `ajv` or any other npm package — zero-dependency constraint is non-negotiable.
- Unknown fields produce warnings (not errors) for forward compatibility.

**Alternatives considered**:
- Using `ajv`: Rejected — would violate zero-dependency constraint.
- YAML Schema: Rejected — less ecosystem support than JSON Schema; YAML is a superset of JSON so JSON Schema applies naturally.
- No schema, just programmatic validation: Rejected — a schema file serves as documentation for operators.

---

## Summary

All 12 decisions are straightforward refinements within the existing architecture. No new technology choices, no dependency additions, no architectural pivots. Each decision maps to exactly one feature in the spec (P0-F1 through P0-F12), and each feature is independently implementable and testable.
