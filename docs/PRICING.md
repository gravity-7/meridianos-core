# Pricing

## Source of truth

`pricing.mjs`'s `costFor()` computes USD cost from a committed catalog at `config.pricingPath`
(resolved relative to `AIOS_ROOT`) — not from any provider's own billing API. The gateway itself
never imports a pricing module directly: `costFn` is injected into it as a pure seam
(`gateway/index.mjs`), so a misbehaving or missing cost function degrades to `null` cost rather
than crashing a request or, worse, silently reporting `$0`. That "never fabricate a number"
discipline runs through the whole ledger — every token/cost field in `token_events` is
`number | null`, and `null` always means *genuinely unknown*, never zero. `pricing-anthropic.json`
at the repo root is a separate, hand-maintained seed file for bootstrapping Anthropic pricing; it
is not what `costFor()` reads at runtime.

## Refreshing it

There is no npm script called `aios:pricing:refresh` — despite an older reference to one, the
actual mechanisms are:

- **Automatic**: the scheduler refreshes pricing once a day (first run ~35 minutes after boot,
  then every 24h) by dynamically importing `pricing-refresh.mjs`.
- **CLI**: `node gateway/cli.mjs pricing refresh` (add `--provider <name>` to scope it);
  `node gateway/cli.mjs pricing show [--provider <name>]` to inspect the current catalog without
  refreshing it.
- **Dashboard**: the Providers &amp; Models panel's **⟳ Refresh Models** button refreshes model
  discovery and pricing together (`refreshAllModelPricing()`, wired into `dashboard/server.mjs`).

`pricing-refresh.mjs` pulls from models.dev and the OpenRouter API — it's opt-in and manual/daily,
never run as part of CI, so pricing data can be stale between refreshes rather than wrong; the
dashboard and `pricing show` both surface when a rate was last updated.
