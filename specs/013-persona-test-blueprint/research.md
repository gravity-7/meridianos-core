# Research: Persona Testing Blueprint

## Existing evidence

- `playwright.config.mjs` runs Chrome, Edge, and Firefox against an isolated local server, retains traces and screenshots on failure, and writes an HTML report beneath `artifacts/browser/`.
- `scripts/start-ui-platform-test-server.mjs` creates a temporary repository root, writes an isolated policy, injects `FIXTURE_DOMAIN`, and starts `createDashboardServer()`. It is the right safety boundary for future browser fixtures.
- `tests/server.test.mjs`, API tests, and integration tests repeatedly use a temporary root plus `FIXTURE_DOMAIN`; `test/mock-provider.mjs` supplies loopback OpenAI/Anthropic response, error, and streaming scenarios. Webhook and Stripe-webhook tests already use local/in-memory seams.
- The current `browser-tests/ui-platform.spec.mjs` covers only the feature-flagged `/app` shell. It does not yet exercise the legacy dashboard, authentication, projects, teams, billing, providers, setup wizard, Electron, or provider traffic.
- `tests/deepseek-e2e.test.mjs` and `tests/ollama-e2e.test.mjs` are opt-in live tests; real verification must therefore be a distinct, recorded canary lane rather than normal CI.
- `.gitignore` excludes both `artifacts/` and `.playwright-mcp/`, while browser CI uploads `artifacts/`. Raw diagnostics should stay transient; only reviewed/redacted visuals belong in a runbook.

## Important fixture hazards

- Dashboard/auth/control-plane state uses module-level singleton state in several places. Persona browser tests must start isolated server processes, avoid concurrent workers against shared control-plane data, and close/wipe fixture state reliably.
- Provider-test routes read configured environment-key names. Future fixtures must use generated test-only values and loopback URLs, never a developer's provider credentials.
- Current billing checkout/portal routes construct real Stripe clients. Standard browser coverage is limited to deterministic entitlement/status/error displays and signed local webhook events until a Stripe client factory can be injected.
- Unified onboarding is still a draft specification; the current implemented setup flow is the legacy `/setup` flow. Catalog entries must label planned flows rather than report them as tested.

## Decisions

### Canonical catalog plus runbooks

**Decision**: Keep a YAML source of truth for agents/automation and a reviewed Markdown runbook for every P1 journey.

**Rationale**: Stable journey IDs make the same workflow usable for a test, a defect report, a release scorecard, founder learning, and a prospect demonstration.

**Alternatives considered**: Test code as the sole source of truth is not understandable to non-technical reviewers. Free-form Markdown alone is difficult for agents to verify consistently.

### Default-safe environment

**Decision**: Use synthetic users, generated fixture identifiers, temporary roots, local/controlled dependencies, test gateway metering, and per-run cleanup. Reject non-loopback dependency URLs and real-looking keys in the standard fixture.

**Rationale**: It follows established repository practice while keeping the full dashboard path testable.

**Alternatives considered**: Live environment testing introduces secret, cost, terms-of-service, and production-state risk; static demos do not prove the product.

### Evidence lifecycle

**Decision**: CI/MCP traces, logs, network records, and failure screenshots are transient evidence. Only human-reviewed, redacted example visuals may be committed with a runbook.

**Rationale**: Client demonstrations and diagnostic artifacts have different privacy, stability, and retention needs.

### AI-agent operating model

**Decision**: Give an agent one journey, fixture profile, allowed action set, stop conditions, and evidence template. A reproducible exploratory finding becomes a candidate regression test.

**Rationale**: It supports safe parallel testing and gives the founder a compact report to review.

### Browser progression

**Decision**: Define desktop, narrow-screen, keyboard, error/recovery, and visual expectations in the catalog before creating browser automation. Implement P1 in risk/priority order.

**Rationale**: One all-encompassing browser test would be slow, opaque, and a poor source of client-facing workflow knowledge.
