/**
 * setup-wizard-core — shared step logic for the browser (`GET /setup`) and CLI (`gateway/cli.mjs
 * setup`) setup wizards (008 — End-User Configurability, US3). Detects environment, reuses P2's
 * `autoDetectProviders()`, computes a dollar-budget → token-cap breakdown, and assembles the
 * final `.ai/policy.yaml` / `.ai/tenant.yaml` / `.env` content.
 *
 * Deliberately split in two: `buildSetupPlan()` is a pure function that returns a plan object
 * (file contents, never touches disk) so callers can show a review/diff step before committing to
 * anything; `writeSetupPlan()` is the only function that writes, and refuses every pre-existing
 * setup target. First-time onboarding never reconfigures an installation (FR-010).
 *
 * This is intentionally a NEW, standalone module — it does not refactor or call into `init.mjs`
 * (a separate, interactive-only readline script with no exported functions, generating
 * `.env.example` rather than the wizard's real `.env`) or `provider-wizard.mjs`'s policy-mutation
 * helpers (which operate on an EXISTING policy.yaml, not a from-scratch scaffold).
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync, openSync, fstatSync, closeSync, statSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from './yaml-lite.mjs';
import { autoDetectProviders } from './provider-wizard.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTALLATION_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/;
const AGENT_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/;
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;
const MAX_AGENTS = 20;

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
export const SETUP_TARGETS = ['.ai/policy.yaml', '.ai/tenant.yaml', '.env'];

export function detectExistingConfig(repoRoot) {
  const policyPath = join(repoRoot, '.ai', 'policy.yaml');
  const existingTargets = SETUP_TARGETS.filter((target) => existsSync(join(repoRoot, target)));
  return { exists: existingTargets.length > 0, policyPath, existingTargets };
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

function normalizeString(value, label, pattern, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  const normalized = value.trim();
  if (!pattern.test(normalized)) throw new Error(`${label} contains unsupported characters`);
  return normalized;
}

/** Reject line/control characters so a provider credential cannot create extra `.env` entries. */
export function assertSafeSetupSecret(secret) {
  if (typeof secret !== 'string' || secret.length === 0 || /[\0\r\n]/.test(secret)) {
    throw new Error('provider credential is invalid');
  }
  return secret;
}

/** Normalize data shared by the review and commit paths so reviewable input always commits. */
export function normalizeSetupInput({ tenantName, agents, monthlyBudgetUsd } = {}) {
  const installationName = normalizeString(tenantName, 'installation name', INSTALLATION_NAME, 'My Tenant');
  if (!Array.isArray(agents) || agents.length === 0 || agents.length > MAX_AGENTS) {
    throw new Error(`between 1 and ${MAX_AGENTS} agents are required to build a setup plan`);
  }
  const normalizedAgents = agents.map((agent) => normalizeString(agent, 'agent identifier', AGENT_ID));
  if (new Set(normalizedAgents).size !== normalizedAgents.length) {
    throw new Error('agent identifiers must be unique');
  }
  const normalizedBudget = Number(monthlyBudgetUsd);
  if (!Number.isFinite(normalizedBudget) || normalizedBudget <= 0) {
    throw new Error('monthly budget must be a positive number');
  }
  return { installationName, agents: normalizedAgents, monthlyBudgetUsd: normalizedBudget };
}

function normalizeChoice(choice) {
  if (!choice || typeof choice !== 'object') return null;
  return {
    providerId: normalizeString(choice.providerId, 'provider identifier', PROVIDER_ID),
    modelId: normalizeString(choice.modelId, 'model identifier', MODEL_ID),
    keyEnv: normalizeString(choice.keyEnv, 'provider environment variable', ENV_NAME),
    displayName: typeof choice.displayName === 'string' && choice.displayName.trim()
      ? choice.displayName.trim().slice(0, 120)
      : normalizeString(choice.providerId, 'provider identifier', PROVIDER_ID),
  };
}

function normalizeLegacyProviders(providers) {
  if (!Array.isArray(providers)) throw new Error('providers must be an array');
  return providers.map((provider) => {
    if (!provider || typeof provider !== 'object') throw new Error('provider is invalid');
    const apiKey = provider.apiKey === undefined ? undefined : assertSafeSetupSecret(provider.apiKey);
    return {
      name: normalizeString(provider.name, 'provider identifier', PROVIDER_ID),
      keyEnv: normalizeString(provider.keyEnv, 'provider environment variable', ENV_NAME),
      apiKey,
    };
  });
}

function safeComment(value) {
  return String(value).replace(/[\r\n\0]/g, ' ').trim().slice(0, 120);
}

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
export function buildSetupPlan({ tenantName, agents, providers = [], choice, providerSecret, monthlyBudgetUsd }) {
  const input = normalizeSetupInput({ tenantName, agents, monthlyBudgetUsd });
  const { installationName: name, agents: normalizedAgents, monthlyBudgetUsd: normalizedBudget } = input;
  const budget = computeBudgetFromDollars(normalizedBudget, normalizedAgents.length);
  const selectedChoice = choice ? normalizeChoice(choice) : null;
  const plannedProviders = selectedChoice
    ? [{ name: selectedChoice.providerId, keyEnv: selectedChoice.keyEnv, apiKey: assertSafeSetupSecret(providerSecret) }]
    : normalizeLegacyProviders(providers);
  const route = selectedChoice
    ? { provider: selectedChoice.providerId, model: selectedChoice.modelId }
    : null;

  const tenantYaml = `# ${name} — MeridianOS tenant config (generated by the setup wizard)
# This is a DECLARATIVE DomainPlugin — no JS code required.

agents: [${normalizedAgents.join(', ')}]
boardTitle: "${name} AI Board"

prompts:
  implRules: |
    Write clean, well-tested code. Follow the project conventions. Write tests for all new code.
  reviewCriteria: |
    Verify against acceptance criteria. Check for security issues, performance regressions, and code style.

budgetMeter:
${normalizedAgents.map((a) => `  ${a}: transcript`).join('\n')}

defaultModels:
${normalizedAgents.map((a) => `  ${a}:
    simple: ${route?.model ?? 'deepseek-chat'}
    standard: ${route?.model ?? 'claude-sonnet-5'}
    complex: ${route?.model ?? 'claude-sonnet-5'}`).join('\n')}

agentHarness:
${normalizedAgents.map((a) => `  ${a}: claude-code`).join('\n')}

knownRiskTags: [data-model, deploy, security, ui, api, docs]
riskToAction:
  data-model: APPROVE
  deploy: APPROVE
  security: APPROVE

cliPath: tools/aios/cli.mjs
`;

  const policyYaml = `# ${name} — MeridianOS policy (generated by the setup wizard)
# Budget computed from a $${normalizedBudget}/month figure — see setup-wizard-core.mjs's
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
    provider: ${route?.provider ?? 'deepseek'}
    model: ${route?.model ?? 'deepseek-chat'}
  standard:
    provider: ${route?.provider ?? 'anthropic'}
    model: ${route?.model ?? 'claude-sonnet-5'}
  complex:
    provider: ${route?.provider ?? 'anthropic'}
    model: ${route?.model ?? 'claude-sonnet-5'}

kill_switch: false
`;

  const envLines = [
    `# ${name} — Provider API Keys (generated by the setup wizard)`,
    '# .env is gitignored — never commit it.',
    '',
  ];
  const allDefaults = loadProvidersDefaults();
  const selectedNames = new Set(plannedProviders.map((p) => p.name));
  for (const p of plannedProviders) {
    envLines.push(`${p.keyEnv}=${p.apiKey ?? 'your-key-here'}`);
  }
  for (const [name2, def] of Object.entries(allDefaults)) {
    if (selectedNames.has(name2) || !def.keyEnv) continue;
    if (!ENV_NAME.test(def.keyEnv)) continue;
    envLines.push(`# ${def.keyEnv}=your-key-here  # ${safeComment(def.displayName ?? name2)}, optional`);
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

/** Build the browser-visible, redacted review. This function is pure and never assembles .env content. */
export function buildSetupReview({ tenantName, agents, choice, monthlyBudgetUsd }) {
  const input = normalizeSetupInput({ tenantName, agents, monthlyBudgetUsd });
  const selectedChoice = normalizeChoice(choice);
  if (!selectedChoice) throw new Error('a validated provider and model are required');
  const budget = computeBudgetFromDollars(input.monthlyBudgetUsd, input.agents.length);
  return {
    installationName: input.installationName,
    agents: input.agents,
    budget,
    route: {
      providerId: selectedChoice.providerId,
      modelId: selectedChoice.modelId,
      keyEnv: selectedChoice.keyEnv,
      displayName: selectedChoice.displayName,
    },
    files: [
      { name: '.ai/policy.yaml', description: 'Budget and selected provider routing.' },
      { name: '.ai/tenant.yaml', description: 'Installation name and agent roster.' },
      { name: '.env', description: 'Approved provider credential location.' },
    ],
  };
}

// ─── Writing (the only function that touches disk) ──────────────────────────

/**
 * Write a plan built by buildSetupPlan() to `repoRoot`. Refuses every existing setup target
 * (`.ai/policy.yaml`, `.ai/tenant.yaml`, or `.env`) even if a legacy caller passes force:true.
 * The pre-existing installation is left completely untouched on rejection.
 */
export function writeSetupPlan(plan, repoRoot, {
  force = false,
  fsOps = { mkdirSync, openSync, fstatSync, writeFileSync, closeSync, statSync, unlinkSync },
} = {}) {
  const { exists, existingTargets } = detectExistingConfig(repoRoot);
  if (exists) {
    void force; // Retained only for legacy call compatibility; setup never overwrites an installation.
    throw new Error(`Existing setup target prevents onboarding: ${existingTargets.join(', ')}`);
  }
  const created = [];
  try {
    for (const [relPath, content] of Object.entries(plan.files)) {
      const fullPath = join(repoRoot, relPath);
      fsOps.mkdirSync(dirname(fullPath), { recursive: true });
      // `wx` is the final no-overwrite check: a target created after preflight is never
      // truncated. Record the acquired target before its fallible write so cleanup also covers
      // a disk/close failure that leaves a partially-written file behind.
      let fd = fsOps.openSync(fullPath, 'wx', 0o600);
      try {
        let stat;
        try {
          stat = fsOps.fstatSync(fd);
        } catch (error) {
          // The file is already exclusively ours. Close it, obtain a pathname identity, and
          // register it for the outer cleanup before propagating the acquisition failure.
          fsOps.closeSync(fd);
          fd = null;
          stat = fsOps.statSync(fullPath);
          created.push({ fullPath, dev: stat.dev, ino: stat.ino });
          throw error;
        }
        created.push({ fullPath, dev: stat.dev, ino: stat.ino });
        fsOps.writeFileSync(fd, content, 'utf8');
      } finally {
        if (fd !== null) fsOps.closeSync(fd);
      }
    }
  } catch (error) {
    for (const createdFile of created.reverse()) {
      try {
        const current = fsOps.statSync(createdFile.fullPath);
        if (current.dev === createdFile.dev && current.ino === createdFile.ino) {
          fsOps.unlinkSync(createdFile.fullPath);
        }
      } catch {
        // Another actor owns or already removed the path; never remove an unknown replacement.
      }
    }
    throw error;
  }
}
