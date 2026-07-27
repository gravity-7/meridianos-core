### Verdict: ⚠️ CHANGES REQUESTED

### Spec Compliance

| User Story | Acceptance Scenario | Status | Evidence |
|---|---|---|---|
| US1 (OpenAI wire injection) | AC1/AC2 rewrite opencode.json | ✅ | `gateway/inject.mjs:50-76` rewrites `provider.<name>.options.{baseURL,apiKey}`; `gateway/tests/inject-openai.test.mjs` covers it |
| US1 | AC3 byte-identical anthropic path | ✅ | anthropic branch (`inject.mjs:33-48`) unchanged in shape from prior bite |
| US2 (Gateway default-ON) | AC1/AC2 auto-start, opt-out flag | ✅ | `scheduler.mjs:420-427` — `maybeStartGateway` always assembles unless `policy.gateway.disabled === true` |
| US2 | AC3 budget reads ledger as primary | ✅ | `budget.mjs:275` gates on `config.gateway.url != null` |
| US3 (Unified config) | AC1 agents from policy.yaml | ✅ | `config.mjs:74-86,105-112` `resolveFromPolicy` fallback |
| US3 | AC2 tenant.yaml deprecation warning | ⚠️ not verified in this pass | not directly inspected |
| US3 | AC3 line-number/field-path errors | ❌ | see Constitution/Quality findings below — no line numbers ever produced, and the schema path is never invoked at boot |
| US4 (Source classification) | AC1 source column populated | ⚠️ partial | column exists and defaults correctly, but classification is just an unvalidated client header passthrough (`gateway/server.mjs:428`), not real detection |
| US4 | AC2 migration defaults existing rows | ✅ | `gateway/ledger-schema.sql:22` `DEFAULT 'agent'` |
| US4 | AC3 dashboard filter/group by source | ⚠️ not verified — no dashboard UI check performed for this specific view |
| US5 (Provider health) | AC1 60s background probe loop | ✅ | `provider-health.mjs:58-125` |
| US5 | AC2 dashboard green indicator | ❌ | `/api/providers` (`dashboard/server.mjs`) has no frontend consumer anywhere in the repo |
| US5 | AC3 red within 60s of failure | ❌ | state machine requires 2 consecutive failed probes (~120s) to reach `down` (`provider-health.mjs:77-86`) |
| US8 (Budget sentinel 0-vs-null) | AC1/AC2/AC3 | ✅ | `budget.mjs:64`, `gateway/windows.mjs:76` both correctly treat `cap == null` as no-cap, `cap === 0` as hard-block |
| US9 (Per-provider headers) | AC1/AC2/AC3 | ✅ | `gateway/server.mjs:162-168`, `gateway/provider-registry.mjs:115-122`, tested at `gateway/tests/server.test.mjs:129` |
| US11 (Bootstrap) | AC1 auto-create `.ai/*` dirs | ✅ | `boot-guard.mjs` `ensureDirectories` |
| US12 (JSON Schema validation) | AC1 boot-time validation with specific errors | ❌ | dead code — see below |

### Constitution Violations

| Principle | Violation | File:Line | Fix |
|---|---|---|---|
| V. Configuration over Code / boot-time validation | `validatePolicySchema()` and the new `schema/policy.schema.json` are never wired into any boot path — the daemon boots with zero schema enforcement despite the PR claiming this feature is delivered | `policy-validate.mjs:19,115`; not called from `scheduler.mjs` or `dashboard/server.mjs` | Call `validatePolicySchema(policy)` from `scheduler.mjs`'s `start()` (or wherever `loadPolicy` runs at boot) and fail/warn loudly; or actually load and validate against `schema/policy.schema.json` with a lightweight validator |
| V. Configuration over Code | Boot-time errors never include a line number even though spec.md (US3 AC3, US12 AC1) requires one | `policy-validate.mjs:124,128,136,139,147` | Either compute line numbers during YAML parse (`yaml-lite.mjs` would need to preserve source positions) or drop the line-number claim from the spec/PR description to match reality |
| II. Gateway as single source of truth / traffic attribution integrity | `source` traffic classification trusts an arbitrary client-supplied header with no enum validation, contradicting the closed classification set the constitution/spec both describe | `gateway/server.mjs:428` | Validate `source` against `['agent','ide','cli','api']`, default to `'agent'` on anything else, before it reaches `token-event.mjs` |

### Code Quality Issues
- `dashboard/server.mjs` `/api/providers` handler dynamically `import()`s `provider-health.mjs` inside a per-provider loop on every request — harmless after the first call (module cache) but unnecessary; import it once at module scope like every other dependency in the file.
- `provider-health.mjs:32` `probeProvider` resolves `ok: true` for literally any HTTP response including 5xx — fine per the doc comment's intent ("reachable, not necessarily healthy"), but the exported `HealthState.status` values (`ok`/`degraded`/`down`) then get consumed by nothing (no frontend, see finding above), so right now this whole module has no observable effect on an operator.
- ES module / `.mjs` / `node:` prefix conventions are followed correctly throughout the reviewed files (`node:http`, `node:crypto`, `node:fs`, etc.) — no violations found.

### Test Assessment
- New tests were added for OpenAI wire injection (`gateway/tests/inject-openai.test.mjs`), OpenAI server proxying (`gateway/tests/server-openai.test.mjs`), and budget sentinel semantics appear covered via existing `windows.test.mjs`/`budget-ledger.test.mjs` updates.
- **No tests exist** for `provider-health.mjs`'s state-transition logic (the very thing found broken above would have been caught by a test asserting `down` after exactly one failed check), for `validatePolicySchema` (0 references outside its own file), or for the `/api/providers` dashboard endpoint's actual UI rendering.
- `tests/budget-ledger.test.mjs:145`'s stated intent (gate on `gateway.enabled`) has drifted from the code it exercises (`budget.mjs` now gates on `gateway.url`) — passes today only incidentally.

**Bottom line:** the PR is broad and mostly solid (US1/US2/US8/US9/US11 look correctly implemented and tested), but two headline stories — US5 (provider health) and US12 (schema validation) — are not actually wired up to do what the spec and PR description claim, and US4's source classification is a passthrough rather than real classification. These should be fixed or the PR description/spec scoped down before merge.
