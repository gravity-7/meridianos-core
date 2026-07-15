/**
 * model-router — intelligent per-task model selection.
 *
 * Picks the cheapest model that can handle a task well, using:
 *   1. The task's complexity (1–5 scale) and risk_tags
 *   2. A category taxonomy that maps work types to complexity tiers
 *   3. The policy's model_routing section (founder-tunable model assignments per tier)
 *   4. Budget state (downgrade one tier when at warn)
 *
 * Grounded in the LLM model research (July 2026) covering both Claude Code and
 * Antigravity model lineups. The defaults encode the optimal model for each tier
 * based on capability/cost analysis.
 *
 * Complexity tiers (in ascending cost):
 *   simple      → repetitive, boilerplate, classification, formatting
 *   medium      → standard coding, CRUD, docs, routine testing
 *   medium_high → debugging, code review, integration, multi-file reasoning
 *   complex     → architecture, security, schema design, financial logic
 *   critical    → whole-repo migration, release audit, multi-service refactor (top 1–2%)
 */
import { parseJsonArray } from './state.mjs';
import { resolveProvider, modelForTier } from './providers.mjs';

// ─── Complexity tiers ──────────────────────────────────────────────────────

export const TIERS = ['simple', 'medium', 'medium_high', 'complex', 'critical'];
const TIER_INDEX = Object.fromEntries(TIERS.map((t, i) => [t, i]));

// ─── Task categories ──────────────────────────────────────────────────────
// Each category defines a default complexity tier and a description.
// The tier can be overridden upward by the task's own complexity field.

export const TASK_CATEGORIES = {
  // ── Simple (cheap/free models) ──────────────────────────────────────────
  scaffolding:    { tier: 'simple',      desc: 'Project setup, boilerplate, file creation' },
  formatting:     { tier: 'simple',      desc: 'Code formatting, linting fixes, style cleanup' },
  copy:           { tier: 'simple',      desc: 'Text content, labels, translations, tone edits' },
  tagging:        { tier: 'simple',      desc: 'Metadata tagging, labeling, classification' },
  extraction:     { tier: 'simple',      desc: 'Data extraction, parsing, structured output' },
  configuration:  { tier: 'simple',      desc: 'Env files, config, feature flags, settings' },

  // ── Medium (balanced models — ~70% of work) ─────────────────────────────
  crud:           { tier: 'medium',      desc: 'Standard create/read/update/delete operations' },
  'ui-component': { tier: 'medium',      desc: 'Component creation, styling, responsive layout' },
  'api-endpoint': { tier: 'medium',      desc: 'REST/GraphQL endpoint implementation' },
  documentation:  { tier: 'medium',      desc: 'Docs, READMEs, API docs, inline comments' },
  'testing-unit': { tier: 'medium',      desc: 'Unit and snapshot test writing' },
  'design-tokens':{ tier: 'medium',      desc: 'Theme tokens, typography, spacing, colors' },
  analytics:      { tier: 'medium',      desc: 'Tracking events, metrics, dashboard widgets' },
  'data-seed':    { tier: 'medium',      desc: 'Seed data, fixtures, mock data generation' },

  // ── Medium-high (capable models) ────────────────────────────────────────
  debugging:      { tier: 'medium_high', desc: 'Bug investigation, error tracing, fix implementation' },
  refactoring:    { tier: 'medium_high', desc: 'Code restructuring, DRY, pattern extraction' },
  integration:    { tier: 'medium_high', desc: 'Third-party API integration, SDK wiring' },
  'code-review':  { tier: 'medium_high', desc: 'PR review, code audit, quality checks' },
  'testing-e2e':  { tier: 'medium_high', desc: 'End-to-end and integration test suites' },
  performance:    { tier: 'medium_high', desc: 'Optimization, caching, profiling, lazy loading' },
  multimodal:     { tier: 'medium_high', desc: 'Image/screenshot analysis, design-to-code' },
  a11y:           { tier: 'medium_high', desc: 'Accessibility audit, ARIA, screen-reader compliance' },

  // ── Complex (premium models) ────────────────────────────────────────────
  architecture:   { tier: 'complex',     desc: 'System design, service boundaries, trade-offs' },
  security:       { tier: 'complex',     desc: 'Auth, authorization, vulnerability remediation' },
  migration:      { tier: 'complex',     desc: 'Schema migration, data migration, version upgrade' },
  'schema-design':{ tier: 'complex',     desc: 'Database modeling, data architecture, ERDs' },
  'data-pipeline':{ tier: 'complex',     desc: 'ETL, data processing, transformation pipelines' },
  devops:         { tier: 'complex',     desc: 'CI/CD, infrastructure, deployment pipelines' },

  // ── Critical (frontier models — top 1–2%) ───────────────────────────────
  'release-audit':        { tier: 'critical', desc: 'Full release quality check, regression sweep' },
  'repo-migration':       { tier: 'critical', desc: 'Whole-repository restructuring, monorepo split' },
  'multi-service-refactor':{ tier: 'critical', desc: 'Cross-cutting concerns across multiple services' },
};

// ─── Risk-tag → category mapping ──────────────────────────────────────────
// Maps existing risk_tags (from policy.yaml capability_matrix) to categories.
const TAG_TO_CATEGORY = {
  schema:           'schema-design',
  auth:             'security',
  backend:          'api-endpoint',
  'ui-components':  'ui-component',
  testing:          'testing-unit',
  verification:     'code-review',
  docs:             'documentation',
  copy:             'copy',
  a11y:             'a11y',
  tokens:           'design-tokens',
  data:             'data-seed',
  tooling:          'configuration',
  e2e:              'testing-e2e',
  devops:           'devops',
  // Additional common tags
  ui:               'ui-component',
  external:         'integration',
};

// ─── Complexity mapping from numeric field ─────────────────────────────────
// task.complexity (1–5) → base tier. risk_tags can push it higher.
const COMPLEXITY_TO_TIER = { 1: 'simple', 2: 'medium', 3: 'medium', 4: 'medium_high', 5: 'complex' };

// ─── Provider/harness selection (1.4) ──────────────────────────────────────
// Per-agent default model lineup and default harness now live on the injected DomainPlugin
// (`domain.defaultModels`, `domain.agentHarness`) — this module has no baked-in tenant identity
// or model lineup of its own (§1.4 full polish). See tools/aios/pv-domain.mjs's PV_DOMAIN for
// PropertyVerdict's values.

// The harness a NAMED provider implies when a policy's object-form routing entry omits
// `harness`: native anthropic speaks Claude Code's own wire directly; anything else is a
// third-party OpenAI-format endpoint, which only the opencode harness knows how to drive.
function defaultHarnessForProvider(providerName) {
  return providerName === 'anthropic' ? 'claude-code' : 'opencode';
}

/**
 * Map a task's status to a routing ROLE (the stage/role axis, separate from the complexity
 * tier). `policy.model_routing.<agent>.roles.<role>` takes precedence over the tier route when
 * present — see routeModel. Unknown/null/undefined status is treated as implementation work
 * (the safe default: most tasks in flight are being implemented, not spec'd or designed).
 *
 * @param {string|null|undefined} status - the task's board status (e.g. 'spec', 'designing',
 *   'ready-for-impl', 'in-progress')
 * @returns {'spec'|'design'|'impl'}
 */
export function roleForStatus(status) {
  switch (status) {
    case 'spec': return 'spec';
    case 'designing': return 'design';
    case 'ready-for-impl': return 'impl';
    case 'in-progress': return 'impl';
    default: return 'impl';
  }
}

/**
 * Resolve a routing entry (the value found at `model_routing.<agent>.<tier>` or
 * `model_routing.<agent>.roles.<role>`) into a concrete {providerName, model, harness}. Shared by
 * both the tier route and the role route in routeModel — see each call site for the form
 * conventions of `rawEntry` at that call site (the role call site pre-normalizes a bare string
 * into `{ provider: <string> }` before calling this, since a role's bare string names a
 * PROVIDER, not a literal legacy model id — unlike the tier route's bare-string form).
 *
 * Two forms of `rawEntry` are handled here:
 *   - object form `{ provider, model?, harness? }` → the named provider; `model` defaults to
 *     that provider's `effectiveTier` model (modelForTier) when omitted; `harness` defaults via
 *     defaultHarnessForProvider when omitted.
 *   - legacy string form: a bare model-id string → provider 'anthropic' (native), that model,
 *     the agent's usual harness (`domain.agentHarness[agent] ?? 'claude-code'`).
 *   - anything else (no entry) → falls back to `defaults[effectiveTier] ?? defaults.medium`.
 *
 * `label` is the dotted policy path this entry came from (e.g. `model_routing.claude.complex` or
 * `model_routing.claude.roles.spec`) — used only to keep thrown error messages diagnosable.
 *
 * @throws {Error} if the object form names an unknown provider, or resolves to no model.
 */
function resolveRoutingEntry(rawEntry, effectiveTier, agent, policy, domain, defaults, label) {
  let providerName, model, harness;

  if (rawEntry && typeof rawEntry === 'object') {
    providerName = rawEntry.provider ?? 'anthropic';
    if (!resolveProvider(providerName, policy)) {
      throw new Error(`${label} references unknown provider '${providerName}'`);
    }
    model = rawEntry.model ?? modelForTier(providerName, effectiveTier, policy) ?? null;
    if (!model) {
      throw new Error(`${label} (provider '${providerName}') resolved to no model for tier '${effectiveTier}'`);
    }
    harness = rawEntry.harness ?? defaultHarnessForProvider(providerName);
  } else {
    providerName = 'anthropic';
    model = (typeof rawEntry === 'string' && rawEntry) ? rawEntry : (defaults[effectiveTier] ?? defaults.medium ?? null);
    harness = domain?.agentHarness?.[agent] ?? 'claude-code';
  }

  return { providerName, model, harness };
}

/**
 * Infer the task category from its risk_tags. Returns the highest-tier category found,
 * or null if no tags match.
 *
 * `domain` (optional — the injected DomainPlugin, i.e. `config.domain`) supplies tenant-specific
 * taxonomy that's MERGED OVER the generic core defaults: `domain.tagToCategory` over
 * `TAG_TO_CATEGORY`, `domain.taskCategories` over `TASK_CATEGORIES`. Absent `domain` ⇒ core's
 * generic taxonomy only (no crash — every tenant-specific category is simply unknown without its
 * domain injected).
 */
export function inferCategory(task, domain) {
  const tagToCategory = { ...TAG_TO_CATEGORY, ...(domain?.tagToCategory) };
  const taskCategories = { ...TASK_CATEGORIES, ...(domain?.taskCategories) };
  const tags = parseJsonArray(task.risk_tags);
  let best = null;
  let bestIdx = -1;

  for (const tag of tags) {
    const cat = tagToCategory[tag];
    if (!cat) continue;
    const def = taskCategories[cat];
    if (!def) continue;
    const idx = TIER_INDEX[def.tier] ?? 0;
    if (idx > bestIdx) { best = cat; bestIdx = idx; }
  }
  return best;
}

/**
 * Compute the complexity tier for a task.
 *
 * Priority (highest wins):
 *   1. Explicit task.task_type (if the planner/founder set it)
 *   2. Inferred category from risk_tags
 *   3. Numeric complexity field → tier mapping
 *   4. Fallback to 'medium'
 *
 * The final tier is the MAX of the category tier and the complexity-derived tier,
 * so a task is never under-served. A "copy" task with complexity=5 gets a complex model.
 *
 * `domain` (optional) is forwarded to `inferCategory` and merged into the `task.task_type`
 * lookup the same way (`domain.taskCategories` over core's `TASK_CATEGORIES`).
 */
export function complexityTier(task, domain) {
  const taskCategories = { ...TASK_CATEGORIES, ...(domain?.taskCategories) };

  // From explicit task_type
  const explicitCat = task.task_type ? taskCategories[task.task_type] : null;
  const explicitIdx = explicitCat ? (TIER_INDEX[explicitCat.tier] ?? 1) : -1;

  // From risk_tags → category
  const inferred = inferCategory(task, domain);
  const inferredDef = inferred ? taskCategories[inferred] : null;
  const inferredIdx = inferredDef ? (TIER_INDEX[inferredDef.tier] ?? 1) : -1;

  // From numeric complexity
  const numericTier = COMPLEXITY_TO_TIER[task.complexity] ?? 'medium';
  const numericIdx = TIER_INDEX[numericTier] ?? 1;

  // Take the max
  const maxIdx = Math.max(explicitIdx, inferredIdx, numericIdx);
  return TIERS[maxIdx] ?? 'medium';
}

/**
 * Pick the right provider + model + harness for a task.
 *
 * `model_routing.<agent>.<tier>` accepts two forms:
 *   - legacy string form: a bare model-id string (e.g. 'some-model-5')
 *     → provider 'anthropic' (native), that model, the agent's usual harness. Byte-identical
 *       to pre-1.4 behavior.
 *   - object form:  { provider, model?, harness? }
 *     → the named provider; `model` defaults to that provider's tier model (modelForTier) when
 *       omitted; `harness` defaults via defaultHarnessForProvider when omitted.
 * When a tier has no entry at all, `domain.defaultModels[agent]` is the fallback (still native
 * anthropic).
 *
 * **Stage/role axis.** `model_routing.<agent>.roles.<role>` — where `role` is derived from the
 * task's status via `roleForStatus` (spec/design/impl) — takes PRECEDENCE over the tier route
 * above when present for the task's role. This lets a founder route spec/design work to a premium
 * model while implementation stays on the cheap tier route, independent of task complexity. It
 * accepts the same object form as a tier entry; its bare-string form is different, though — a
 * bare string names a PROVIDER (e.g. `roles.spec: 'deepseek'`), with the model resolved via
 * `modelForTier(provider, effectiveTier, policy)`, not a literal model id. When there's no
 * `roles.<role>` entry for the task's role, routing falls through to the tier route unchanged.
 * See `docs/PROVIDERS.md` for the founder-facing writeup.
 *
 * @param {string} agent - the agent id, e.g. one entry of the injected domain's roster
 * @param {object} task - the task record (needs complexity, risk_tags)
 * @param {object} policy - parsed policy
 * @param {string} budgetState - 'ok' | 'warn' | 'halt'
 * @param {object} [domain] - the injected DomainPlugin (i.e. `config.domain`); supplies
 *   `defaultModels[agent]` (per-tier model fallback), `agentHarness[agent]` (default harness),
 *   and taxonomy merged into complexityTier/inferCategory. Optional — omitted/undefined runs fine,
 *   just without any tenant-specific defaults/taxonomy.
 * @returns {{ provider: string|null, model: string|null, harness: string|null, tier: string, baseTier: string, category: string|null, reason: string }}
 */
export function routeModel(agent, task, policy, budgetState = 'ok', domain) {
  const tier = complexityTier(task, domain);
  const category = task.task_type || inferCategory(task, domain) || null;

  // Only route when model_routing is explicitly configured in policy
  const policyRouting = policy?.model_routing;
  if (!policyRouting) {
    return { provider: null, model: null, harness: null, tier, baseTier: tier, category, reason: 'model_routing not configured' };
  }

  const routing = policyRouting[agent] ?? domain?.defaultModels?.[agent] ?? {};
  const defaults = domain?.defaultModels?.[agent] ?? {};

  let effectiveTier = tier;

  // Budget-aware downgrade: at warn, step down one tier (never below simple)
  if (budgetState === 'warn' && policy?.agent_budget?.auto_downgrade_at_warn) {
    const idx = TIER_INDEX[tier] ?? 1;
    effectiveTier = TIERS[Math.max(0, idx - 1)] ?? tier;
  }

  // Role route (stage axis): model_routing.<agent>.roles.<role> takes PRECEDENCE over the tier
  // route when present. `role` is derived from the task's status (spec/design/impl). A role
  // entry's bare-string form names a PROVIDER (unlike the tier route's bare-string form, which
  // names a literal legacy model id) — so it's normalized into `{ provider: <string> }` before
  // going through the same object-form resolution as a tier entry.
  const role = roleForStatus(task.status);
  const rawRoleEntry = routing.roles?.[role];

  if (rawRoleEntry !== undefined) {
    const normalizedRoleEntry = typeof rawRoleEntry === 'string' ? { provider: rawRoleEntry } : rawRoleEntry;
    const { providerName, model, harness } = resolveRoutingEntry(
      normalizedRoleEntry, effectiveTier, agent, policy, domain, defaults,
      `model_routing.${agent}.roles.${role}`,
    );

    return {
      provider: providerName,
      model,
      harness,
      tier: effectiveTier,
      baseTier: tier,
      category,
      reason: `role:${role} → ${providerName}${effectiveTier !== tier ? ` → downgraded to ${effectiveTier} (budget warn)` : ''}`,
    };
  }

  const rawEntry = routing[effectiveTier];
  const { providerName, model, harness } = resolveRoutingEntry(
    rawEntry, effectiveTier, agent, policy, domain, defaults,
    `model_routing.${agent}.${effectiveTier}`,
  );

  return {
    provider: providerName,
    model,
    harness,
    tier: effectiveTier,
    baseTier: tier,
    category,
    reason: category
      ? `${category} (${tier}) → ${providerName}${effectiveTier !== tier ? ` → downgraded to ${effectiveTier} (budget warn)` : ''}`
      : `complexity=${task.complexity ?? '?'} → ${tier} → ${providerName}${effectiveTier !== tier ? ` → ${effectiveTier} (budget warn)` : ''}`,
  };
}

/**
 * List all categories grouped by tier — for the dashboard and planning.
 * `domain` (optional) merges `domain.taskCategories` over core's generic `TASK_CATEGORIES`.
 */
export function categoryIndex(domain) {
  const taskCategories = { ...TASK_CATEGORIES, ...(domain?.taskCategories) };
  const out = {};
  for (const tier of TIERS) out[tier] = [];
  for (const [name, def] of Object.entries(taskCategories)) {
    out[def.tier].push({ name, desc: def.desc });
  }
  return out;
}
