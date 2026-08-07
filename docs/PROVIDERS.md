# Providers

Per Constitution Principle I (Provider &amp; Model Agnosticism): every LLM provider must be
addable without source code changes. This page covers the mechanism, not a marketing-style
per-provider comparison — pricing and quirks change on the provider's own schedule, so the
in-product provider wizard (dashboard → Providers &amp; Models → **+ Add Provider**, or
`node gateway/cli.mjs provider add --auto`) is the source of truth for what's currently
auto-detectable, not this file.

## Two related but different registries

- **The provider registry** (`gateway/provider-registry.mjs`, built by
  `gateway/registry-source.mjs` from `providers.mjs` + `policy.yaml`) is what the gateway actually
  routes on: an envelope of `providers` + `routes`, where each route names an `upstreamUrl`, a
  `wire` protocol, and a `keyEnv` — the *name* of an environment variable, never a literal secret
  (asserted at build time). `gateway/known-providers.json` is a curated catalog the provider
  wizard uses for auto-fill (base URL, default `keyEnv` name) when you pick a provider by name; it
  is not consulted by the runtime router itself.
- **The model-discovery registry** (`model-registry.mjs`, `model-discovery.mjs`) is a separate,
  SQLite-backed auto-discovery cache with its own `quick`/`medium`/`best` tiering — unrelated to
  `model-router.mjs`'s `simple`/`medium`/`medium_high`/`complex`/`critical` complexity tiers used
  for actual task routing. It only feeds the dashboard's Providers &amp; Models panel and the
  `models` CLI subcommand.

## Adding a provider (no code)

Three equivalent paths, all ending at the same `providers.mjs` + `policy.yaml` config:

1. **Dashboard**: Providers &amp; Models → **+ Add Provider** → pick a name from the dropdown (or
   enter a custom one) → paste the API key. The 15 built into the wizard's dropdown today: Anthropic,
   OpenAI, DeepSeek, OpenRouter, Ollama, Groq, Together, Fireworks, Google Gemini, Mistral, Cohere,
   Perplexity, xAI, Azure OpenAI, AWS Bedrock — each with its conventional `keyEnv` name pre-filled.
2. **CLI**: `node gateway/cli.mjs provider add --auto` scans the environment for known key
   patterns and self-configures matching routes; `node gateway/cli.mjs provider add` walks an
   interactive prompt; `node gateway/cli.mjs provider test <name>` runs a conformance probe
   (`provider-conformance.mjs`) before you commit to it; `node gateway/cli.mjs provider list`
   shows what's configured, including live health (`provider-health.mjs` probes every 60s).
3. **Directly in `policy.yaml`**: add an entry under the provider registry's `providers`/`routes`
   shape by hand. See `schema/provider.schema.json` for the fields it validates.

None of these require touching gateway or router source code — that's the point of the registry.

## Adding a wire protocol

A *provider* using an existing wire protocol needs no code. A genuinely new **wire protocol**
(how requests/responses are shaped and how usage is extracted from them) needs a module dropped
into `gateway/wire-adapters/`, auto-discovered at boot by `gateway/wire-adapter-registry.mjs`.
Three ship today: `anthropic.mjs`, `openai.mjs`, and `generic-http.mjs` (a best-effort passthrough
for anything else — it tries to parse the response as Anthropic-shaped, then OpenAI-shaped, and
emits `null` usage rather than a fabricated number if neither matches). See the WireAdapter
contract appendix in [plugin-development.md](plugin-development.md) for the exact interface.
Model *discovery* (listing what models a provider offers) is separate again — four adapters under
`gateway/model-discovery-adapters/` (`anthropic`, `openai`, `google-ai`, `generic-http`); Google's
models are discovered via its own adapter but still routed for actual calls over the `generic-http`
wire, since there is no dedicated Google wire adapter.

## Fallback chains and routing

Which provider/model a task actually gets is `model-router.mjs`'s job, not this registry's — see
[diagrams/component-relationships.md](diagrams/component-relationships.md) for how `router.mjs`'s
`decide()` and `model-router.mjs`'s `routeModel()` fit together, and `policy.yaml`'s
`model_routing` block for where fallback chains and per-tier assignments are configured.
