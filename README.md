# MeridianOS core

Provider/harness-agnostic autonomous agent-orchestration core. Tenant behavior
(agents, prompts, guardrails, board title, risk taxonomy, budget meter, default
models, agent harness, task categories) is injected via a `DomainPlugin` passed
to `createAios`/`resolvePaths` in `config.mjs` — this package contains no
product-specific defaults.

Extracted from the `propertyverdict` monorepo (`packages/aios-core/`) at source
commit `8586747`.
