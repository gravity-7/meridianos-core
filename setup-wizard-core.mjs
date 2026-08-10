/**
 * setup-wizard-core — shared step logic for the browser (`GET /setup`) and CLI (`gateway/cli.mjs
 * setup`) setup wizards (008 — End-User Configurability, US3). Detects environment, reuses P2's
 * `autoDetectProviders()`, computes a dollar-budget → token-cap breakdown, and assembles the
 * final `.ai/policy.yaml` / `.ai/tenant.yaml` / `.env` content.
 *
 * Deliberately split in two: `buildSetupPlan()` is a pure function that returns a plan object
 * (file contents, never touches disk) so callers can show a review/diff step before committing to
 * anything; `writeSetupPlan()` is the only function that writes, and refuses to overwrite an
 * existing `.ai/policy.yaml` unless `{ force: true }` is passed (FR-010).
 *
 * This is intentionally a NEW, standalone module — it does not refactor or call into `init.mjs`
 * (a separate, interactive-only readline script with no exported functions, generating
 * `.env.example` rather than the wizard's real `.env`) or `provider-wizard.mjs`'s policy-mutation
 * helpers (which operate on an EXISTING policy.yaml, not a from-scratch scaffold).
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync, chmodSync, renameSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from './yaml-lite.mjs';
import { autoDetectProviders } from './provider-wizard.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export const ONBOARDING_LIFECYCLE_EVENTS = new Set([
  'onboarding_started', 'onboarding_step_completed', 'provider_test_failed',
  'onboarding_completed', 'workflow_abandoned',
]);

const ONBOARDING_OUTCOMES = new Set([
  'valid', 'invalid', 'unreachable', 'timeout', 'committed', 'rejected',
  'storage_unavailable', 'existing_installation', 'abandoned',
]);

/** Construct the only onboarding event shape permitted to reach local logs. */
export function createOnboardingLifecycleEvent({ event, providerId, agentCount, outcome, elapsedMs } = {}) {
  if (!ONBOARDING_LIFECYCLE_EVENTS.has(event)) throw new Error('unsupported onboarding lifecycle event');
  return {
    event,
    providerId: typeof providerId === 'string' && /^[a-z0-9_-]{1,64}$/i.test(providerId) ? providerId : null,
    agentCount: Number.isInteger(agentCount) && agentCount >= 0 && agentCount <= 100 ? agentCount : null,
    outcome: ONBOARDING_OUTCOMES.has(outcome) ? outcome : null,
    elapsedMs: Number.isFinite(elapsedMs) ? Math.max(0, Math.min(Math.round(elapsedMs), 60 * 60 * 1000)) : null,
  };
}

// ─── Detection ──────────────────────────────────────────────────────────────

/** Lightweight environment snapshot — informational only, never blocks the wizard. */
export function detectEnvironment() {
  return {
    nodeVersion: process.version,
    platform: process.platform,
    cwd: process.cwd(),
  };
}

/** Re-exported for wizard callers so they only need to import from this module. */
export { autoDetectProviders as detectProviders };

/** Does `repoRoot` already have a `.ai/policy.yaml`? (FR-010 — the wizard must not silently
 *  overwrite an existing installation.) */
export function detectExistingConfig(repoRoot) {
  const policyPath = join(repoRoot, '.ai', 'policy.yaml');
  return { exists: existsSync(policyPath), policyPath };
}

/** Classify first-run state without reading or exposing secret-file contents. */
export function detectOnboardingInstallation(repoRoot) {
  const policyPath = join(repoRoot, '.ai', 'policy.yaml');
  const tenantPath = join(repoRoot, '.ai', 'tenant.yaml');
  const envPath = join(repoRoot, '.env');
  const present = { policy: existsSync(policyPath), tenant: existsSync(tenantPath), environment: existsSync(envPath) };
  const count = Object.values(present).filter(Boolean).length;
  return {
    state: count === 0 ? 'fresh' : (present.policy && present.tenant ? 'configured' : 'repair_needed'),
    exists: count > 0,
    present,
  };
}

// ─── Budget math ────────────────────────────────────────────────────────────

/**
 * Convert a monthly USD budget into token caps, using claude-sonnet-5 (this repo's own scaffolded
 * "standard" tier default, see init.mjs) as the reference rate and an assumed 3:1 input:output
 * token ratio (a documented heuristic for coding-agent workloads: much more context read than
 * generated — NOT a measured average, and intentionally conservative rather than optimistic, so
 * the resulting caps under-promise rather than run out mid-week).
 *
 * The 5h:weekly ratio (37.5) is taken directly from this repo's own init.mjs default
 * (token_cap_5h: 200000, weekly_token_cap: 7500000 → 7500000/200000 = 37.5), so a wizard-generated
 * policy.yaml has the same shape of caps a manually-scaffolded one would, just sized to budget.
 *
 * @param {number} monthlyBudgetUsd
 * @param {number} agentCount
 */
export function computeBudgetFromDollars(monthlyBudgetUsd, agentCount) {
  if (!(monthlyBudgetUsd > 0)) throw new Error('monthly budget must be a positive number');
  if (!(agentCount > 0)) throw new Error('agent count must be a positive number');

  const REFERENCE_INPUT_PER_M = 3.00;
  const REFERENCE_OUTPUT_PER_M = 15.00;
  const INPUT_OUTPUT_RATIO = 3; // 3 input tokens per 1 output token (documented assumption above)
  const WEEKS_PER_MONTH = 4.345; // 365.25 / 7 / 12
  const FIVE_H_TO_WEEKLY_RATIO = 7_500_000 / 200_000; // init.mjs's own default proportions

  const blendedRatePerM = (INPUT_OUTPUT_RATIO * REFERENCE_INPUT_PER_M + REFERENCE_OUTPUT_PER_M) / (INPUT_OUTPUT_RATIO + 1);
  const monthlyTokens = (monthlyBudgetUsd / blendedRatePerM) * 1_000_000;
  const weeklyTokenCap = Math.round(monthlyTokens / WEEKS_PER_MONTH);
  const token_cap_5h = Math.round(weeklyTokenCap / FIVE_H_TO_WEEKLY_RATIO);
  const perAgentWeeklyTokenCap = Math.round(weeklyTokenCap / agentCount);

  return {
    monthlyBudgetUsd,
    blendedRatePerM,
    weeklyTokenCap,
    token_cap_5h,
    perAgentWeeklyTokenCap,
  };
}

// ─── Plan assembly (pure — never writes) ────────────────────────────────────

function loadProvidersDefaults() {
  const defaultsPath = join(HERE, 'providers.defaults.yaml');
  try {
    if (!existsSync(defaultsPath)) return {};
    return parseYaml(readFileSync(defaultsPath, 'utf8'))?.providers ?? {};
  } catch {
    return {};
  }
}

/**
 * Build the full set of file contents the wizard would write, without touching disk. `providers`
 * is an array of `{ name, keyEnv, apiKey? }` — `apiKey` (if given) is written ONLY to the `.env`
 * content, never to policy.yaml/tenant.yaml (FR-008).
 *
 * @param {object} opts
 * @param {string} opts.tenantName
 * @param {string[]} opts.agents - non-empty agent roster
 * @param {Array<{name: string, keyEnv: string, apiKey?: string}>} opts.providers
 * @param {number} opts.monthlyBudgetUsd
 * @returns {{ files: Record<string,string>, budget: object }}
 */
export function buildSetupPlan({ tenantName, agents, providers = [], monthlyBudgetUsd }) {
  if (!Array.isArray(agents) || agents.length === 0) {
    throw new Error('at least one agent is required to build a setup plan');
  }
  const budget = computeBudgetFromDollars(monthlyBudgetUsd, agents.length);
  const name = tenantName || 'My Tenant';

  const tenantYaml = `# ${name} — MeridianOS tenant config (generated by the setup wizard)
# This is a DECLARATIVE DomainPlugin — no JS code required.

agents: [${agents.join(', ')}]
boardTitle: "${name} AI Board"

prompts:
  implRules: |
    Write clean, well-tested code. Follow the project conventions. Write tests for all new code.
  reviewCriteria: |
    Verify against acceptance criteria. Check for security issues, performance regressions, and code style.

budgetMeter:
${agents.map((a) => `  ${a}: transcript`).join('\n')}

defaultModels:
${agents.map((a) => `  ${a}:
    simple: deepseek-chat
    standard: claude-sonnet-5
    complex: claude-sonnet-5`).join('\n')}

agentHarness:
${agents.map((a) => `  ${a}: claude-code`).join('\n')}

knownRiskTags: [data-model, deploy, security, ui, api, docs]
riskToAction:
  data-model: APPROVE
  deploy: APPROVE
  security: APPROVE

cliPath: tools/aios/cli.mjs
`;

  const primaryProvider = providers[0] ?? { name: 'deepseek', models: {} };
  const primaryName = String(primaryProvider.name || 'deepseek');
  const modelFor = (tier, fallback) => primaryProvider.models?.[tier] ?? fallback;
  const policyYaml = `# ${name} — MeridianOS policy (generated by the setup wizard)
# Budget computed from a $${monthlyBudgetUsd}/month figure — see setup-wizard-core.mjs's
# computeBudgetFromDollars() doc comment for the reference rate and assumptions used.

agent_budget:
  token_cap_5h: ${budget.token_cap_5h}
  weekly_token_cap: ${budget.weeklyTokenCap}
  warn_pct: 80
  halt_pct: 98

cadence: hourly
max_parallel: 2
wip_per_agent: 1
lease_ttl_min: 30

model_routing:
  simple:
    provider: ${primaryName}
    model: ${modelFor('simple', 'deepseek-chat')}
  standard:
    provider: ${primaryName}
    model: ${modelFor('standard', 'claude-sonnet-5')}
  complex:
    provider: ${primaryName}
    model: ${modelFor('complex', 'claude-sonnet-5')}

kill_switch: false
`;

  const envLines = [
    `# ${name} — Provider API Keys (generated by the setup wizard)`,
    '# .env is gitignored — never commit it.',
    '',
  ];
  const allDefaults = loadProvidersDefaults();
  const selectedNames = new Set(providers.map((p) => p.name));
  for (const p of providers) {
    envLines.push(`${p.keyEnv}=${p.apiKey ?? 'your-key-here'}`);
  }
  for (const [name2, def] of Object.entries(allDefaults)) {
    if (selectedNames.has(name2) || !def.keyEnv) continue;
    envLines.push(`# ${def.keyEnv}=your-key-here  # ${def.displayName ?? name2}, optional`);
  }
  const envContent = envLines.join('\n') + '\n';

  return {
    budget,
    files: {
      '.ai/tenant.yaml': tenantYaml,
      '.ai/policy.yaml': policyYaml,
      '.env': envContent,
    },
  };
}

/** A preview is deliberately semantic: no generated file bodies or credentials cross the UI boundary. */
export function buildOnboardingPreview({ draft, provider }) {
  if (!draft || typeof draft !== 'object') throw new Error('setup draft is required');
  if (!provider?.name || !provider?.keyEnv) throw new Error('selected provider is required');
  const plan = buildSetupPlan({
    tenantName: draft.installationName,
    agents: draft.agents,
    providers: [{ ...provider, apiKey: undefined }],
    monthlyBudgetUsd: draft.monthlyBudgetUsd,
  });
  return {
    revision: draft.revision,
    provider: { id: provider.name, label: provider.displayName ?? provider.name },
    agents: [...draft.agents],
    monthlyBudgetUsd: plan.budget.monthlyBudgetUsd,
    budget: plan.budget,
    files: Object.keys(plan.files),
  };
}

/**
 * Commit a validated onboarding draft. The browser credential is accepted only
 * at this boundary and is not returned or stored in an intermediate plan.
 */
export function commitOnboardingSetup({ draft, provider, credential, repoRoot, credentialStore = 'env' }) {
  if (detectOnboardingInstallation(repoRoot).exists) throw new Error('existing installation requires recovery');
  if (!draft?.reviewConfirmed) throw new Error('review confirmation is required');
  if (!provider?.name || !provider?.keyEnv) throw new Error('selected provider is required');
  if (!['env', 'keychain'].includes(credentialStore)) throw new Error('unsupported credential storage');
  if (credentialStore === 'env' && (typeof credential !== 'string' || !credential.trim())) throw new Error('provider credential is required');
  const plan = buildSetupPlan({
    tenantName: draft.installationName,
    agents: draft.agents,
    // A keychain-backed desktop commit never puts the value into the generated
    // plan. The browser value reaches this function only while the `.env` file
    // is being staged for this one explicit final commit.
    providers: [{ ...provider, apiKey: credentialStore === 'env' ? credential : undefined }],
    monthlyBudgetUsd: draft.monthlyBudgetUsd,
  });
  const files = credentialStore === 'env'
    ? plan.files
    : Object.fromEntries(Object.entries(plan.files).filter(([path]) => path !== '.env'));
  writeOnboardingPlan({ ...plan, files }, repoRoot);
  if (credentialStore === 'env') {
    const envPath = join(repoRoot, '.env');
    try { chmodSync(envPath, 0o600); } catch { /* Windows and constrained filesystems may not support POSIX modes. */ }
  }
  return { filesWritten: Object.keys(files), budget: plan.budget };
}

/**
 * Stage onboarding files beside their destinations and publish them only after
 * every staged write succeeds. The feature creates a fresh installation, so
 * refusing existing targets also prevents a partial setup from being silently
 * overwritten on retry.
 */
export function writeOnboardingPlan(plan, repoRoot) {
  const staged = [];
  const published = [];
  try {
    for (const [relPath, content] of Object.entries(plan.files)) {
      const target = join(repoRoot, relPath);
      if (existsSync(target)) throw new Error(`onboarding target already exists: ${relPath}`);
      mkdirSync(dirname(target), { recursive: true });
      const temp = `${target}.onboarding-${process.pid}-${Math.random().toString(16).slice(2)}.tmp`;
      writeFileSync(temp, content, { encoding: 'utf8', mode: relPath === '.env' ? 0o600 : undefined });
      staged.push({ target, temp });
    }
    for (const entry of staged) { renameSync(entry.temp, entry.target); published.push(entry.target); }
  } catch (error) {
    for (const entry of staged) { try { rmSync(entry.temp, { force: true }); } catch {} }
    // No prior target was allowed. Removing only files published by this call
    // restores the fresh-install state if a later publish fails.
    for (const target of published) { try { rmSync(target, { force: true }); } catch {} }
    throw error;
  }
}

// ─── Writing (the only function that touches disk) ──────────────────────────

/**
 * Write a plan built by buildSetupPlan() to `repoRoot`. Refuses to overwrite an existing
 * `.ai/policy.yaml` unless `{ force: true }` (FR-010) — the pre-existing file is left completely
 * untouched on rejection, not partially written.
 */
export function writeSetupPlan(plan, repoRoot, { force = false } = {}) {
  const { exists } = detectExistingConfig(repoRoot);
  if (exists && !force) {
    throw new Error(`.ai/policy.yaml already exists at ${repoRoot} — pass { force: true } to overwrite`);
  }
  for (const [relPath, content] of Object.entries(plan.files)) {
    const fullPath = join(repoRoot, relPath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, 'utf8');
  }
}
