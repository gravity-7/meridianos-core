# MeridianOS — Gateway Sidecar

The gateway is a **local forward-proxy that every agent→provider LLM call routes through**, so
MeridianOS can **meter and enforce spend inline** — the enforcement boundary that structurally kills
the silent-fallback bug class and replaces the fragile per-harness usage scrapers. It is the core of
the "cost governance + control plane for heterogeneous agent fleets" wedge.

Status: **built, tested, and proven live** (a real DeepSeek call metered exactly end-to-end). The
daemon can now assemble and run it inline via a policy flag — **opt-in, off by default** (see
*Running the gateway inside the daemon*).

---

## The loop, in one line

```
harness ──(gateway token)──▶ GATEWAY ──(real key, server-side)──▶ provider
                               │  meter every call → ledger
                               │  check budget verdict → allow / DENY(429)
```

Three payoffs, all on-strategy: (1) silent-fallback is *impossible* (no traffic reaches a provider
except through the meter); (2) the per-harness usage-readers can be retired; (3) **keys leave the
worker** — the harness only ever holds a short-lived gateway token; the real key is injected
server-side.

---

## Modules (all under `gateway/`)

| Module | Role |
|---|---|
| `token-event.mjs` | the authoritative per-call usage record (up). `makeTokenEvent`/`validateTokenEvent`/`tokenEventToUsage`. Every usage field is `number\|null`; **null = unknown, never fabricated as 0**. |
| `provider-registry.mjs` | the pushed registry envelope (down): `{ version, generatedAt, tenant, providers, routes, enforcement? }`. `validateProviderRegistry`/`resolveRoute`. `route.keyEnv` must be a NAME, never a literal secret. |
| `run-registry.mjs` | in-memory token→run-context map (`registerRun`/`resolveRun`/`unregisterRun`). Tokens are ephemeral per run. |
| `server.mjs` | `startGateway(...)` — the HTTP proxy: auth token → resolve route → **verdict (once)** → forward with server-side key → **meter** → return. Handles buffered *and* SSE-streaming responses. |
| `ledger.mjs` | the gateway-OWNED append-only token-event store (its **own** SQLite file, `.ai/gateway/ledger.db` — never the board DB). `openLedger`/`appendEvent`/`queryWindow`/`listEvents`/`pruneEvents`. |
| `windows.mjs` | ledger-backed 5h/weekly budget verdict, **reusing `budget.mjs`'s `verdictFor`**. `agentBudgetVerdict` → `toEnforcementDecision` (halt→deny). `makeCheckVerdict(...)` = the real `checkVerdict` for `startGateway`. |
| `registry-source.mjs` | builds the registry envelope from `providers.mjs` + policy (in-process, tenant #0). `buildProviderRegistry`/`serializeRegistry`. Guarantees `keyEnv` is a NAME on both halves. |
| `registry-pull.mjs` | the sidecar's active-registry store + pull loop. `createRegistryStore` (validate-before-swap, strict version monotonicity), `pullOnce`, `startRegistryPoll`. Transport-agnostic (`source` injected). |
| `index.mjs` | **the assembly** — `assembleGateway({ config, policy, ... })` wires all of the above into one runnable sidecar; `refreshRegistry(store, ...)` pushes a newer envelope live. |
| `inject.mjs` | launcher-side: rewrites a harness spawn plan to point at the gateway + a per-run token (opt-in; anthropic wire; see *Launcher wiring*). |

---

## Request lifecycle (`server.mjs handleRequest`)

1. **Auth:** read the per-run token from `x-gateway-token`, then `x-api-key` (Anthropic-wire harness
   sends its token here), then `Authorization: Bearer` (OpenAI-wire). Unknown token → 401.
2. **Route:** `resolveRoute(activeRegistry, ctx.provider)` — `registry` may be a plain envelope OR a
   `() => store.get()` function resolved per request (live registry swaps). No route → 502.
3. **Verdict (exactly once):** `checkVerdict(ctx)`. `deny` → emit a deny token-event (null usage) +
   **429 in the client's wire format** (`rate_limit_error` / `rate_limit_exceeded`), never forwarded.
   Any other decision → forward. (`degrade` = documented follow-up, currently forwards.)
4. **Forward:** to `route.upstreamUrl` (**base path preserved** — e.g. DeepSeek's `/anthropic`),
   injecting the real key server-side (`x-api-key` for anthropic, `Authorization: Bearer` for
   openai), and forcing **`accept-encoding: identity`** so the metering parse never hits compressed
   bytes.
5. **Meter:**
   - **Buffered** (JSON response): parse the `usage` block per wire (anthropic
     `input_tokens`/`output_tokens`/`cache_*`; openai `prompt_tokens`/`completion_tokens`/
     `prompt_tokens_details.cached_tokens`).
   - **Streaming** (`content-type: text/event-stream`): pipe bytes to the client live while a
     `createSseUsageTracker` reads the terminal usage from the SSE events (anthropic `message_start`
     input/cache + cumulative `message_delta` output; openai final usage chunk). Meters **once** at
     stream end/error. SSE `:` comment lines (keep-alives) are ignored.
6. **Emit:** exactly one `token-event` per request (success *or* failure — metering is never silently
   skipped; a forward/parse failure emits with null usage). The event's `costUsd` is computed via an
   injected `costFn` seam (a pure `(provider, model, usage) => number|null`, default `() => null`) —
   `server.mjs` never imports pricing itself; `assembleGateway` (`index.mjs`) builds the real one from
   the pricing catalog (`pricing.mjs`'s `costFor`) once at assembly time. `costUsd` is `null` whenever
   the catalog has no entry for that provider/model (never a fabricated `$0`), and a throwing `costFn`
   degrades to `null` rather than breaking the request.

---

## Enforcement semantics

- The verdict is computed **before** forwarding, from the ledger's rolling trailing 5h/week windows
  vs the agent's caps in `policy.agent_budget.<agent>` (`verdictFor`: `ok`/`warn`/`halt`; `warn` is
  advisory, `halt` → deny).
- **Trip-wire, not guillotine:** the call that crosses the line completes; the *next* call is denied.
  You never cut off an in-flight response.
- Denies are **inline** — the actual spender is gated (no way around the limit) and the numbers are
  real-time (the previous call was metered a millisecond ago).

---

## Thinking / reasoning mode

DeepSeek's v4 models support a "thinking" (reasoning) mode enabled by a request-body parameter,
identical on both wires: `"thinking": {"type": "enabled"}`. Because harness CLIs (claude-code,
opencode) build that request body themselves, the gateway — which already buffers the full body
before forwarding — is the clean, harness-agnostic place to inject it. No agent or harness code
needs to change.

- **Enable via policy:** `.ai/policy.yaml`'s `providers.<name>.thinking` — either `true` (enable,
  no effort hint) or `{ effort: 'low' | 'medium' | 'high' }`. It flows through
  `resolveProvider`'s policy overlay → `registry-source.mjs`'s `buildProviderRegistry` →
  `provider-registry.mjs`'s `resolveRoute` → `server.mjs`'s `applyThinkingToBody`, which injects
  it into the buffered request body right before forwarding.
- **Off by default:** a route with no `thinking` config is untouched — the forwarded body is
  byte-identical to today.
- **Both wires get `{"type":"enabled"}`.** The OpenAI wire additionally gets `reasoning_effort`
  set from `thinking.effort` when present. The Anthropic wire never gets `reasoning_effort` or
  `budget_tokens` — DeepSeek ignores `budget_tokens` on that wire, so it's deliberately never sent.
- **Client wins:** if the request body already has a top-level `thinking` key, the gateway leaves
  it untouched rather than overriding the caller's explicit choice.
- **Never breaks a request:** a non-JSON, empty, or unparseable body is forwarded unchanged rather
  than throwing — thinking injection is best-effort and never the reason a call fails.

---

## Key custody (the Model-B story)

- The pushed registry carries **routing config + `keyEnv` names only** — never secrets. Keys stay
  worker-side in `process.env`.
- The gateway reads `process.env[route.keyEnv]` at forward-time and injects it server-side. The
  harness/worker only ever holds the gateway token. This is what lets the crown-jewel governance +
  keys live on the operator's side in the connected (Model B) deployment.

---

## Running it (assembly + dogfood)

```js
import { assembleGateway } from './gateway/index.mjs';
const { gateway, ledger, runs, store, url, close } = await assembleGateway({ config, policy, port });
// register a run's token → ctx, point a harness's ANTHROPIC_BASE_URL at `url`, done.
```
A minimal live dogfood (one real DeepSeek call, key read from a gitignored `.env`, never printed) is
the reference for wiring it end-to-end — it proved metering (9 in / 1 out / 10 total) and is what
surfaced the `accept-encoding` fix.

**Launcher wiring (opt-in):** `launchAgent` routes through the gateway only when
`config.gateway.enabled === true` AND the run's provider resolves to an anthropic-wire route
(`inject.mjs`); otherwise it's byte-identical to before. Native-Anthropic providers have no route and
correctly bypass.

---

## Running the gateway inside the daemon

The daemon (`scheduler.mjs` `start()`) can assemble and run the gateway sidecar itself, wiring
`config.gateway` before the runner ever fires an agent — no code change needed per project.

- **Enable via policy:** set `policy.gateway.enabled: true`. Optional knobs: `policy.gateway.port`
  (default `0` — ephemeral, OS-assigned) and `policy.gateway.tenant` (default `'pv'`). An
  `AIOS_GATEWAY_PORT` env var overrides the policy port if set.
- **What happens:** at boot, after the dashboard listener comes up and before the watchdog/runner are
  scheduled, the daemon calls the exported `maybeStartGateway({ config, policy, port, tenant })`
  helper. When enabled, it assembles the sidecar (`assembleGateway`) and sets `config.gateway = {
  enabled, url, runs, registry }` — the exact shape `launcher.mjs`'s opt-in injection already
  consumes. From that point on, `launchAgent` routes anthropic-wire BYO-key providers (e.g. DeepSeek
  via `/anthropic`) through the gateway: metered, budget-enforced, and thinking-injected, per the
  request lifecycle above.
- **Off by default:** a tenant with no `policy.gateway` block (or `enabled` not `=== true`) is
  **completely unaffected** — the daemon never calls `assembleGateway`, `config.gateway` is never
  set, and `launchAgent` runs byte-identical to before the gateway existed.
- **Fail hard, not silent:** if `policy.gateway.enabled === true` and assembly throws, `start()`
  rejects and the process exits rather than continuing unmetered — the scheduled task (restart-on-
  failure) relaunches a clean process. Running agents unmetered when a hard cap was explicitly
  requested is worse than a restart.
- **Shutdown:** the sidecar is closed (best-effort) alongside the rest of the daemon's graceful
  shutdown (`SIGINT`/`SIGTERM`).

---

## Known follow-ups (not yet built)
- **Cross-wire translation** (anthropic-in → openai-out) — deliberately deferred; v1 is a
  same-wire transparent metering proxy.
- **OpenAI/opencode launcher injection** — `inject.mjs` covers the anthropic wire; opencode's
  file-based `opencode.json` baseURL rewrite is a follow-up (3.2d-ii).
- **`degrade` enforcement** — reroute to a cheaper provider instead of a hard deny.
- **Upstream request timeout** — the gateway relies on the provider closing idle connections (e.g.
  DeepSeek's 10-min cap); an explicit timeout would be more robust.
- **Streaming multi-byte safety** — the SSE tracker decodes chunks with `toString('utf8')`; a
  `StringDecoder` would handle a multi-byte char split across chunks (harmless today — usage events
  are ASCII and the client gets raw bytes).
- **Retire the per-harness usage-readers (3.3c)** — gated on the daemon actually routing through the
  gateway so the ledger is populated; retiring them before that would break live budget metering.
