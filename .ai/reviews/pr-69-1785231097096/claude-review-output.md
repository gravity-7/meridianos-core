### Verdict: ⚠️ CHANGES REQUESTED

The refactor of Anthropic/OpenAI wire logic into adapters is solid and well-tested (23 passing tests), but three of the six headline features in the PR description — **request logging, multi-key rotation, and cross-wire translation** — are never wired into the live request path in `server.mjs`. They exist only as importable modules exercised by unit tests, not by the actual proxy.

### Spec Compliance

| User Story | Acceptance Scenario | Status | Evidence |
|---|---|---|---|
| Wire-adapter registry / auto-discovery | Adapters loaded, validated, no-op defaults | ✅ Pass | `wire-adapter-registry.mjs:32-92`, 23 passing tests |
| `GET /api/wire-adapters` endpoint | Lists discovered adapters | ✅ Pass | `server.mjs:474-488` |
| Generic HTTP passthrough | Best-effort usage extraction, route-config activated | ✅ Pass | `wire-adapters/generic-http.mjs:13-48`; `VALID_WIRES` includes `generic-http` (`provider-registry.mjs:16`, `token-event.mjs:18`) |
| Multi-key rotation | Round-robin selection, 401 cooldown, mark failed/success | ❌ **Fail** | `createKeyRotator`/`selectKey`/`markKeyFailed`/`markKeySuccess` (`provider-registry.mjs:161-224`) are never called from `handleRequest` in `server.mjs`. `keyRotators` is accepted as a `startGateway` option (`server.mjs:451`) and threaded into the object passed to `handleRequest` (`server.mjs:523`), but `handleRequest`'s destructured parameter list (`server.mjs:542`) omits it entirely — it's silently dropped. A single key is always resolved via `resolveKey(route.keyEnv)` (`server.mjs:172`, `595`), so on 401 nothing rotates and nothing cools down. |
| Append-only request logging | Every proxied request/response logged (redacted) to `request_logs` | ❌ **Fail** | `logRequestResponse` (`logging.mjs:42`) is never called anywhere in `server.mjs`'s proxy path. `logging` and `ledger` are also dropped by the same `handleRequest` destructuring bug as above. Only the read-side management endpoints (`GET /api/gateway/logs`, `GET /api/gateway/logs/:id`, `POST /api/gateway/replay/:id`) exist — they'll always return empty results because nothing ever inserts rows. |
| Bidirectional Anthropic↔OpenAI translation | Route with `translate` flag rewrites request/response cross-wire | ❌ **Fail** | `translate.mjs`'s `anthropicToOpenai`/`openaiToAnthropic`/`*ResponseTo*` functions are exported but never imported by `server.mjs` or `index.mjs` (confirmed via grep — zero call sites outside `translate.mjs` itself). `resolveRoute` does pass through `route.translate` (`provider-registry.mjs:122`), but nothing in `handleRequest` reads it or invokes the translator. This is dead code from the live proxy's perspective. |
| Zero-config bootstrap (`--init`, auto-detect) | CLI detects keys, writes starter config, rich startup banner | ✅ Pass | `cli.mjs:autoDetectProviders`, `generateInitConfig`, `printStartupMessage` all wired into `main()`/`startCli` |

### Constitution Violations

| Principle | Violation | File:Line | Fix |
|---|---|---|---|
| II. Gateway as Single Source of Truth — no silent bypass paths | Request logging is advertised as a privacy/audit feature (`cli.mjs` prints a privacy warning when `loggingEnabled`, `server.mjs:449` accepts a `logging` flag) but the actual logging call is never made, so operators who believe logging/replay is active get silent no-ops — an inverted but analogous "silent bypass": a control-plane feature that appears configured but does nothing. | `server.mjs:542` (missing `logging`/`ledger` in destructure), `logging.mjs:42` (never called) | Either call `logRequestResponse(ledger, {...})` at the point the response is read in `handleRequest`, or remove the logging management endpoints/CLI banner until it's wired. |
| IV. Test-First Discipline | The 23 new tests cover `wire-adapter-registry.mjs` in isolation (load/discover/dispatch) but there is no integration test asserting that `handleRequest` actually invokes key rotation, logging, or translation end-to-end — which is exactly the gap that let this ship unwired. | `gateway/tests/wire-adapter-registry.test.mjs` (whole file) | Add an integration test that starts the gateway with `logging: true` + multiple `keyEnv` values and asserts a `request_logs` row / key-rotation state change after a proxied call. |

### Code Quality Issues
- `gateway/server.mjs:542` — `handleRequest(req, res, { registry, runs, onTokenEvent, resolveKey, now, checkVerdict, costFn, adapters })` silently drops `logging`, `ledger`, `keyRotators` from the options object passed in at line 523. This is the root cause of the two dead features above — add the missing destructured fields and actually use them, or stop passing them.
- `gateway/wire-adapter-registry.mjs:133` `dispatchAdapter` — unused in production code; `server.mjs` instead does a direct `adapters.get(route.wire)` lookup (`server.mjs:570`), making `detectRequest` on every adapter (the one *required* interface method most adapters implement) functionally dead in the live server. Either use `dispatchAdapter` for wire auto-detection or document that `detectRequest` is currently vestigial/test-only.
- `gateway/provider-registry.mjs:148-156` `resolveApiKey` — the `'oauth'` mode returns `null` unconditionally with a comment "Not implemented", but nothing calls this function from `server.mjs` either (only `resolveKey` closures using single `process.env[k]` lookups are used) — another half-wired seam.
- `gateway/logging.mjs:220` — file is truncated in the diff at a `checkDiskSpace`-looking function; worth confirming it's complete and actually exported/used somewhere (currently no callers found for any of `pruneOldLogs`, disk-space check either).

### Test Assessment
- New tests added: yes, but scoped only to `wire-adapter-registry.mjs` (discovery/validation/dispatch) — 23 tests, all passing.
- Do existing tests cover the change paths: **no** — there is no test exercising `logRequestResponse`, `createKeyRotator`/`selectKey`, or the `translate.mjs` functions being invoked from the actual gateway HTTP path. Given the destructuring bug in `handleRequest`, such a test would have caught the gap immediately (it would fail to find any `request_logs` rows after a proxied request).

**Recommendation:** wire `keyRotators` and `logging`/`ledger` through `handleRequest`, invoke `translate.mjs` when `route.translate` is set, add integration tests proving each behavior end-to-end, or descope the PR description/commit message to match what's actually connected (adapter extraction + generic-http + zero-config bootstrap only).
