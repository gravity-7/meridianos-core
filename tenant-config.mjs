/**
 * tenant-config — declarative tenant configuration via `.ai/tenant.yaml`.
 *
 * Most tenants don't need a custom JS DomainPlugin; they just need to declare their roster,
 * prompts, budget meter, model defaults, etc. This module reads `.ai/tenant.yaml` and produces
 * a DomainPlugin-compatible object, so a tenant can go from zero to running with a single YAML
 * file — no JS entrypoint required.
 *
 * Resolution chain (config.mjs resolveDomain):
 *   1. Explicit `{ domain }` passed to createAios/resolvePaths (JS DomainPlugin — full power)
 *   2. `$AIOS_TENANT_CONFIG` env var pointing at a YAML file
 *   3. `.ai/tenant.yaml` in the repo root (zero-config default)
 *   4. Throw — a DomainPlugin is required
 *
 * The YAML schema mirrors DomainPlugin fields exactly. Every field is optional except `agents`.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseYaml } from './yaml-lite.mjs';

/**
 * Load a tenant config from a YAML file path. Returns a DomainPlugin-compatible object,
 * or null if the file doesn't exist.
 */
export function loadTenantConfig(filePath) {
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, 'utf8');
  const yaml = parseYaml(raw);

  // agents is the only REQUIRED field for a valid tenant
  if (!yaml.agents || (Array.isArray(yaml.agents) && yaml.agents.length === 0)) {
    return null; // invalid — caller will fall through to the error
  }

  return {
    agents: Array.isArray(yaml.agents) ? yaml.agents : [yaml.agents],
    prompts: yaml.prompts || undefined,
    guardrailCheck: yaml.guardrailCheck || undefined,
    boardTitle: yaml.boardTitle || undefined,
    riskToAction: yaml.riskToAction || undefined,
    knownRiskTags: yaml.knownRiskTags || undefined,
    budgetMeter: yaml.budgetMeter || undefined,
    defaultModels: yaml.defaultModels || undefined,
    agentHarness: yaml.agentHarness || undefined,
    taskCategories: yaml.taskCategories || undefined,
    tagToCategory: yaml.tagToCategory || undefined,
    mcpServers: yaml.mcpServers || undefined,
    cliPath: yaml.cliPath || undefined,
    // paths — OPTIONAL { features, policy, inbox, feedback, runs } overrides.
    // Each is a repo-relative path. Unset ⇒ core defaults (e.g. .ai/features/).
    paths: yaml.paths || undefined,
  };
}

/**
 * Resolve a tenant config using the full resolution chain.
 * `repoRoot` — the repo root (for deriving the default `.ai/tenant.yaml` path).
 * Returns a DomainPlugin-compatible object or null.
 */
export function resolveTenantConfig(repoRoot) {
  // 1. Explicit env var override
  if (process.env.AIOS_TENANT_CONFIG) {
    const cfg = loadTenantConfig(process.env.AIOS_TENANT_CONFIG);
    if (cfg) return cfg;
  }
  // 2. Default location: .ai/tenant.yaml
  return loadTenantConfig(join(repoRoot, '.ai', 'tenant.yaml'));
}
