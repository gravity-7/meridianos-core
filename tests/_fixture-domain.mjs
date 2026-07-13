/**
 * _fixture-domain — the NEUTRAL DomainPlugin core tests inject in place of a real tenant.
 *
 * Core (`packages/aios-core`) has no default tenant as of ★③.2 Part B — `resolvePaths`/`createAios`
 * REQUIRE an explicit `{domain}` and throw without one. Core tests must NOT import Property
 * Verdict's own tenant module (`tools/aios/pv-domain.mjs` — that lives in the PV RUNNER, not core,
 * and core tests proving core is tenant-agnostic shouldn't reach outside the package for it). This
 * fixture is a complete, recognizably NON-PV plugin — every field is populated (nothing here is
 * ever field-merged onto a hidden default; see config.mjs's resolveDomain) — that the bulk of core
 * tests inject via `resolvePaths({ domain: FIXTURE_DOMAIN })` wherever they previously called
 * `resolvePaths()`/`createAios()` with no domain at all.
 *
 * Tests specifically proving the DomainPlugin injection MECHANISM (domain-plugin.test.mjs,
 * multi-tenant.test.mjs, second-tenant.test.mjs) construct their own additional inline plugins
 * alongside this fixture, to prove core has no leftover affinity for any one plugin's values.
 *
 * `defaultModels`/`agentHarness`/`taskCategories`/`tagToCategory` below (§1.4 full polish) are
 * populated with PropertyVerdict's OWN exact values (not neutral fixture placeholders) — the
 * model-router tests that assert against 'claude'/'antigravity' agent ids and money-math/payments
 * routing use THIS fixture to prove that behavior is now sourced entirely from an injected domain,
 * byte-identical to the old core-baked defaults. This is deliberate reuse, not a naming mismatch:
 * `agents` stays the neutral agent-a/agent-b roster for the roster-mechanism tests, while these
 * four model/harness/taxonomy fields piggyback PV's real data purely for regression coverage.
 */

export const FIXTURE_DOMAIN = {
  agents: ['agent-a', 'agent-b'],
  prompts: {
    implRules: [
      '- Follow the fixture handbook',
      '- Stay within your assigned zone',
      '- Do NOT modify policy.yaml',
    ],
    reviewCriteria: [
      '- Correctness bugs (logic errors, off-by-one, unhandled edge cases)',
      '- Zone violations (is the author working outside their assigned area?)',
      '- Handbook/policy violations',
      '- Missing test coverage for new logic',
      '- Tone guardrail violations',
    ],
  },
  guardrailCheck: null,
  boardTitle: 'Test Board',
  riskToAction: {
    payments: 'spend_money',
    spend_money: 'spend_money',
    external: 'external_send',
    deploy: 'deploy',
    schema: 'schema_change',
  },
  knownRiskTags: ['budget', 'schema', 'auth', 'payments', 'external', 'ui', 'copy', 'docs', 'a11y', 'tokens'],
  // PropertyVerdict's exact defaultModels (copied verbatim from pv-domain.mjs's PV_DOMAIN) — see
  // the file-level doc comment for why this fixture piggybacks PV's real model/harness/taxonomy
  // data instead of neutral placeholders.
  defaultModels: {
    claude: {
      simple:      'claude-haiku-4-5-20251001',
      medium:      'claude-sonnet-5',
      medium_high: 'claude-sonnet-5',
      complex:     'claude-opus-4-8',
      critical:    'claude-fable-5',
    },
    antigravity: {
      simple:      'gpt-oss-120b',
      medium:      'gemini-3.5-flash',
      medium_high: 'gemini-3.5-flash',
      complex:     'gemini-3-pro',
      critical:    'claude-opus-4-6',
    },
  },
  agentHarness: { claude: 'claude-code', antigravity: 'antigravity' },
  taskCategories: {
    'money-math': { tier: 'complex', desc: 'Financial calculations, tax engine, currency logic' },
  },
  tagToCategory: { 'money-math': 'money-math', payments: 'money-math' },
};
