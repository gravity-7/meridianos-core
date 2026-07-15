# MeridianOS — Provider Reference

A per-provider debugging & API reference. One section per provider MeridianOS can spawn agents
against. Use it to resolve/route/price/debug provider issues without re-deriving the details each
time.

> **Scope of truth.** The machine-readable source of truth for *which* providers exist and their
> wiring is [`providers.mjs`](../providers.mjs) (the `PROVIDERS` registry). Prices live in
> `pricing.json` (see [PRICING.md](./PRICING.md)). This document is the *human* reference: it adds
> the context, quirks, and official-doc links that code can't carry. When code and this doc
> disagree, code wins — and this doc has a bug; fix it.

---

## How providers work in MeridianOS (read first)

Every provider is a descriptor in `PROVIDERS` (`providers.mjs`) with this shape:

| Field | Meaning |
|---|---|
| `name` | registry key (must equal the object's `name`) |
| `baseUrl` | OpenAI-wire endpoint base, or `null` = "use the harness's own login" (native Anthropic) |
| `anthropicBaseUrl` | (optional) an Anthropic-wire endpoint, for harnesses that only speak Anthropic wire |
| `wire` | `'anthropic'` or `'openai'` — the request/response format |
| `keyEnv` | the **name of an env var** holding the API key — **never a literal key** (BYO-key) |
| `models` | per-tier model ids: `simple`, `medium`, `medium_high`, `complex`, `critical` |

**Key rules that bite you if forgotten:**
- **BYO-key:** `keyEnv` is a *variable name* (`DEEPSEEK_KEY`), read from `process.env` at use-time.
  No secret ever lives in the registry, the catalog, or a pushed gateway registry.
- **Wire ≠ harness.** `claude-code` speaks Anthropic wire; `opencode` speaks OpenAI wire. A provider
  is usable by a harness only if it exposes that harness's wire (see each section's *Harness fit*).
- **Tiers → models.** `model-router.mjs` maps a task's complexity tier to `models[tier]`. Policy
  (`.ai/policy.yaml` → `model_routing`) can override any tier without restating the others.
- **The gateway** (see [GATEWAY.md](./GATEWAY.md)) sits in front of all of this: it dials the real
  `upstreamUrl` and injects the real key server-side, so a worker/harness only ever holds a gateway
  token, never the provider key.

---

## Anthropic

**Overview.** The native/default provider. Used by the live PropertyVerdict daemon via `claude-code`'s
own login (OAuth/keychain), not a BYO key.

- **Wire:** `anthropic`.
- **Endpoints:** `baseUrl: null` → nothing is injected; the harness uses its own `claude login`
  session. There is no BYO-key HTTP base for the native path.
- **Auth / `keyEnv`:** `null` (no key needed — the CLI's own session authenticates). This is the
  ONLY provider that is *not* gateway-routable, because it has no dial-able upstream URL/key; native
  Anthropic runs bypass the gateway and keep the CLI-login path. (See [GATEWAY.md](./GATEWAY.md).)
- **Models & tiers** (`providers.mjs`): `simple` = `claude-haiku-4-5-20251001`, `medium` /
  `medium_high` = `claude-sonnet-5`, `complex` = `claude-opus-4-8`, `critical` = `claude-fable-5`.
- **Pricing** (USD / 1M tokens, from `pricing.json`): haiku 1 / 5, sonnet 2 / 10, opus 5 / 25,
  fable 10 / 50 (input / output; cached-input is 10% of input). Sourced via **models.dev** — see
  [PRICING.md](./PRICING.md).
- **Streaming:** standard Anthropic SSE — `message_start` (carries `usage.input_tokens` +
  `cache_creation_input_tokens` + `cache_read_input_tokens`), `message_delta` (cumulative
  `usage.output_tokens`), `message_stop`. The gateway's SSE tracker reads exactly these.
- **Gotchas:**
  - **Silent-fallback (historically the #1 bug):** a `claude-code` CLI with an active `claude login`
    will silently authenticate with the stored OAuth token even when `ANTHROPIC_BASE_URL` points
    elsewhere. `harness-adapters.mjs` uses `--bare` + `ANTHROPIC_DEFAULT_{HAIKU,SONNET,OPUS}_MODEL`
    to close this on the third-party path; the gateway closes it structurally (traffic must pass the
    meter). See [aios-provider-harness-roadmap] history.
- **Official docs:** https://docs.claude.com/en/api · https://docs.claude.com/en/docs/build-with-claude/streaming

---

## DeepSeek

**Overview.** The primary BYO-key third-party provider and the one we've dogfooded live through the
gateway (a real call metered exactly: 9 in / 1 out / 10 total). Cheap, Anthropic-*and*-OpenAI-wire.

- **Wire:** `openai` (registry default), **but also exposes an Anthropic-wire endpoint** —
  `anthropicBaseUrl` — so `claude-code` can use it too.
- **Endpoints:**
  - OpenAI wire: `https://api.deepseek.com` (→ `/v1/chat/completions`).
  - Anthropic wire: `https://api.deepseek.com/anthropic` (→ `/v1/messages`). **The base path
    `/anthropic` matters** — the gateway must preserve it (a bug where `new URL(path, base)` dropped
    it caused 404s; fixed). Confirmed live: returns Anthropic-shaped `usage`
    (`input_tokens`/`output_tokens`/`cache_*`).
- **Auth / `keyEnv`:** `DEEPSEEK_KEY`. Anthropic-wire uses the `x-api-key` header; OpenAI-wire uses
  `Authorization: Bearer`. For a dogfood, put `DEEPSEEK_KEY=sk-...` in the gitignored PV `.env`.
- **Harness fit:** `claude-code` (via `anthropicBaseUrl`) **and** `opencode` (via `baseUrl`, OpenAI
  wire + a generated `opencode.json`).
- **Models & tiers** (`providers.mjs`, **legacy names — see migration below**): `simple`/`medium`/
  `medium_high` = `deepseek-chat`, `complex`/`critical` = `deepseek-reasoner`.
- **⚠️ Model migration (ACTION NEEDED).** As of DeepSeek's docs (July 2026) the lineup is now
  **`deepseek-v4-flash`** and **`deepseek-v4-pro`**; the legacy **`deepseek-chat` / `deepseek-reasoner`
  names are deprecated (per docs, ~July 24 2026)** and map to v4-flash's non-thinking / thinking
  modes. MeridianOS still registers the legacy names in `providers.mjs` + `pricing.json`. **Before
  the deprecation date, update both** (`deepseek-chat`→`deepseek-v4-flash`, add `deepseek-v4-pro`).
  Verify against https://api-docs.deepseek.com/quick_start/pricing before changing.
- **Pricing** (USD / 1M tokens):
  | Model | Input | Output | Context | Max out |
  |---|---|---|---|---|
  | deepseek-v4-flash (= legacy deepseek-chat) | 0.14 | 0.28 | 1M | 384K |
  | deepseek-v4-pro | 0.435 | 0.87 | 1M | 384K |
  `pricing.json` currently tracks the legacy names at 0.14 / 0.28 (cached-input 0.0028) — accurate
  for v4-flash. Sourced via **models.dev** (see [PRICING.md](./PRICING.md)).
- **Streaming & keep-alive:** OpenAI-wire streaming puts `usage` in the terminal chunk (when the
  client sends `stream_options: {include_usage: true}`); Anthropic-wire uses standard Anthropic SSE.
  DeepSeek sends **SSE `: keep-alive` comment lines** during long inference — our SSE tracker
  correctly ignores comment lines (only `data:` lines are parsed). For **non-streaming**, DeepSeek
  "continuously returns empty lines" while inferring; these are leading whitespace and don't break
  `JSON.parse`.
- **Rate limits:** account-level **hard concurrency** limits — **v4-flash: 2,500** concurrent,
  **v4-pro: 500** concurrent; exceeding → **HTTP 429**. Capacity expansion is free on request. A
  `user_id` request param gives per-user concurrency/KVCache/scheduling isolation. **Connections
  close if inference hasn't started within 10 minutes** — note the gateway has no explicit upstream
  timeout today (relies on the provider closing); consider adding one (follow-up).
- **Official docs:** https://api-docs.deepseek.com/ · pricing:
  https://api-docs.deepseek.com/quick_start/pricing · rate limits:
  https://api-docs.deepseek.com/quick_start/rate_limit · Anthropic-API compat:
  https://api-docs.deepseek.com/guides/anthropic_api

---

## OpenRouter

**Overview.** A universal aggregator — one key, hundreds of models across vendors. In MeridianOS it's
the **cheap multi-model eval** lane (test many models against one key), not a production route.

- **Wire:** `openai`.
- **Endpoints:** `https://openrouter.ai/api/v1` (→ `/chat/completions`, `/models`).
- **Auth / `keyEnv`:** `OPENROUTER_KEY` (`Authorization: Bearer`).
- **Harness fit:** `opencode` (OpenAI wire). Not `claude-code` (no Anthropic endpoint configured).
- **Models & tiers:** every tier points at `openrouter/auto` in the registry — model *choice* on
  OpenRouter is that eval task's concern, not the router's. Real routing uses `provider/model` ids
  (e.g. `deepseek/deepseek-chat`).
- **Pricing:** sourced **from OpenRouter itself** (`/api/v1/models`), NOT models.dev — its
  `pricing.prompt`/`pricing.completion` are USD-per-*token* strings, normalized ×1e6 to per-1M. The
  `openrouter` section of `pricing.json` is empty until a refresh populates it.
- **Gotchas:** per-model pricing/availability changes frequently → re-run the pricing refresh before
  trusting a cost. `openrouter/auto` picks a model for you (cost varies run-to-run).
- **Official docs:** https://openrouter.ai/docs · models+prices API: https://openrouter.ai/api/v1/models

---

## Adding a new provider (checklist)

1. Add a descriptor to `PROVIDERS` in `providers.mjs` (name, baseUrl/anthropicBaseUrl, wire, keyEnv,
   per-tier models). Keep `keyEnv` a NAME.
2. Confirm harness fit (Anthropic-wire → `claude-code`; OpenAI-wire → `opencode`).
3. Run the pricing refresh (see [PRICING.md](./PRICING.md)); confirm the provider's models get priced
   (models.dev for most; the provider's own API if it's an aggregator like OpenRouter).
4. Add a section here: overview, endpoints, auth, models/tiers, pricing+source, streaming, rate
   limits, gotchas, official-doc links.
5. If BYO-key, the gateway will route it once the pushed registry includes its `route`
   (`registry-source.mjs` builds routes for every non-native provider).
