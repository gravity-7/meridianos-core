# MeridianOS — Pricing: Source of Truth & Refresh

How MeridianOS knows what a token costs, **where those prices come from**, and how to keep them
current. TL;DR: prices are committed **data** in `pricing.json`, refreshed **manually/opt-in** from
public no-auth sources, and never guessed — an unknown price is `null` cost, never a fabricated `$0`.

---

## The three pieces

| Piece | File | Role |
|---|---|---|
| The catalog | `pricing.json` (at `config.pricingPath`; PV: `tools/aios/pricing.json`) | committed price data |
| The reader | [`pricing.mjs`](../pricing.mjs) | `loadPricing()` + `costFor()` — reads & computes, never guesses |
| The refresher | [`pricing-refresh.mjs`](../pricing-refresh.mjs) | fetches → normalizes → diffs → writes |

### Catalog format
`provider → model → { inputPerM, outputPerM, cachedInputPerM? }` — **USD per 1,000,000 tokens** (the
models.dev unit). Example:
```json
{
  "deepseek": {
    "deepseek-v4-flash": { "inputPerM": 0.14, "outputPerM": 0.28, "cachedInputPerM": 0.0028 }
  }
}
```
`cachedInputPerM` is captured for a future refinement (split cached vs uncached input); `costFor`
today prices *all* input at the uncached `inputPerM` because the meter doesn't yet split cached input
per run.

### How cost is computed (`costFor`)
`cost = (inputTokens/1e6)*inputPerM + (outputTokens/1e6)*outputPerM`. If the provider/model has **no
catalog entry**, `costFor` returns **`null`** — never `$0`. Callers (budget breakdowns, the gateway
ledger's cost fields) treat `null` as "cost unknown," counted separately, not as free.

**The gateway ledger** (bite: ledger cost) now records this per event: `assembleGateway`
(`gateway/index.mjs`) loads the catalog once and injects a `costFn` seam into `startGateway`
(`gateway/server.mjs`) that calls `costFor(...).totalCost` for every metered call — `server.mjs`
itself never imports `pricing.mjs` (the gateway only ever takes injected sinks/seams). Every
`token-event`'s `costUsd` is that real dollar figure, or `null` when the model has no catalog entry
— e.g. a heavy-cache-read call can log a huge token count but a near-zero real cost, which token
counts alone can't show (this is what the DeepSeek dogfood surfaced).

---

## Where prices come from (the source of truth)

**Two upstream sources, chosen per provider — this is the answer to "from which source do we always
pull":**

1. **models.dev** — `https://models.dev/api.json` — for **every provider EXCEPT OpenRouter**
   (currently Anthropic + DeepSeek). Its `cost.{input,output,cache_read}` are already **USD per 1M**,
   so `normalizeModelsDev` just reshapes, no unit conversion.
   - (models.dev also exposes `/api/pricing.json`, but that alias currently 302-redirects to the
     homepage instead of serving JSON — so we hit the stable `/api.json` directly.)
2. **The provider's own API** for aggregators — **OpenRouter** prices come from
   `https://openrouter.ai/api/v1/models` (NOT models.dev's OpenRouter mirror — always price
   OpenRouter from OpenRouter). Its `pricing.{prompt,completion}` are USD-per-*token* strings, so
   `normalizeOpenRouter` multiplies ×1e6 (rounded to 6dp to avoid float-noise diffs).

**The registry gates what gets priced.** `providers.mjs` (`PROVIDERS`) is the source of truth for
*which* providers matter; the refresher only ever fills prices for providers already registered — an
upstream model we don't track is ignored, never added blindly.

---

## How to refresh (and verify it's already current)

```bash
# From the meridianos-core repo (or the PV tenant runner):
npm run aios:pricing:refresh              # fetch, diff, write only if changed
npm run aios:pricing:refresh -- --skip-openrouter   # models.dev only (skip the OpenRouter fetch)
```

Behavior of `refresh()` (`pricing-refresh.mjs`):
1. Load the current `pricing.json` (the "previous" catalog).
2. Fetch models.dev + (optionally) OpenRouter; `normalize*` each into the per-1M shape.
3. `mergeCatalog(previous, fresh)` — each fetched provider section **fully replaces** its previous
   one (a model that vanished upstream vanishes here too, rather than lingering stale); a provider
   NOT in the fetch (e.g. OpenRouter skipped) is left exactly as-is.
4. `diffCatalogs(previous, next)` — prints every `[added]/[removed]/[changed]` price.
5. **Writes only if there are changes.** No changes → prints `pricing.json: no changes.` and writes
   nothing. So the refresh doubles as the **"is what we have already current?"** check: run it, read
   the diff — an empty diff means MeridianOS is already up to date.

**Safety properties:**
- **Opt-in, manual-only.** Guarded by the `import.meta.url` check — importing the module (as tests
  do) never touches the network. It never runs in CI or any hot path.
- **No-auth, public sources.** No keys involved in a refresh.
- **Never guesses.** A model with a non-numeric/missing input or output price is skipped, not
  invented.

---

## When to refresh (operational triggers)
- A provider announces a price change (e.g. a DeepSeek pricing-page update).
- You add/rename models (e.g. the **DeepSeek `deepseek-chat`/`deepseek-reasoner` → `deepseek-v4-flash`/
  `deepseek-v4-pro` migration**, completed 2026-07-15 — see [PROVIDERS.md](./PROVIDERS.md)): update
  `providers.mjs`, then refresh so the catalog re-keys.
- Periodically (low-effort): run it, eyeball the diff, commit if non-empty.

## Future refinement (noted, not built)
- Split cached vs uncached input cost (`cachedInputPerM` is already captured) once the meter reports
  cached-input tokens per run — the gateway's token-event already carries `cacheReadTokens`, so the
  gateway path can feed this sooner than the legacy transcript readers could.
