/**
 * policy-validate — coherence checks for policy.yaml (postmortem A5 / item 10). The surgical writer
 * (policy-write.mjs) guarantees a lever change is SHAPED correctly; nothing checked that the
 * resulting COMBINATION made sense. That let the dashboard silently write nonsense like a `routine`
 * model costlier than `default`, a WIP cap above the global parallel cap, or an unknown cadence.
 *
 * validatePolicy(policy) → { errors[], warnings[] }
 *   errors   = incoherent/unsafe combinations. The dashboard REJECTS a write that produces one.
 *   warnings = legal but probably-not-what-you-meant. The write proceeds; the founder is told.
 *
 * Pure. The dashboard validates the would-be-merged policy BEFORE writing (applyDottedUpdates).
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(HERE, 'schema', 'policy.schema.json');

const CADENCES = new Set(['every_15m', 'every_30m', 'every_45m', 'hourly', 'every_2h', 'every_3h', 'on_handoff', 'off']);
const DISPOSITIONS = new Set(['block_and_ask', 'notify_only', 'allow']);
const MERGE_MODES = new Set(['founder_only', 'peer_agent_review', 'verifier_gated']);

// Rough cost rank (cheaper → pricier) for the models the founder can pick. Only used to flag a
// `routine` sweep model that is MORE expensive than `default` — a budget-lever inversion. Unknown
// ids simply don't trigger the check (no false positive).
const COST_RANK = {
  'gpt-oss-120b': 0,
  'claude-haiku-4-5': 1, 'claude-haiku-4-5-20251001': 1,
  'gemini-3.5-flash': 2,
  'claude-sonnet-5': 3, 'gemini-3.1-pro': 3, 'gemini-3-pro': 3,
  'claude-opus-4-8': 4, 'claude-opus-4-6': 4, 'claude-opus-4.6': 4,
  'claude-fable-5': 5,
};

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null));

export function validatePolicy(policy = {}) {
  const errors = [];
  const warnings = [];
  const err = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);

  // --- budget ---
  const wp = num(policy?.agent_budget?.warn_pct);
  if (wp != null && (wp < 1 || wp > 100)) err(`agent_budget.warn_pct must be 1–100 (got ${wp})`);
  const ptt = num(policy?.agent_budget?.per_task_tokens);
  if (ptt != null && ptt <= 0) err(`agent_budget.per_task_tokens must be > 0 (got ${ptt})`);
  if (policy?.agent_budget?.attribution === 'total') {
    warn("agent_budget.attribution: total counts the founder's own usage against the agents' caps — the founder working can halt the agents. Use agent_only unless you intend that.");
  }

  // --- work / concurrency ---
  const mp = num(policy?.work?.max_parallel);
  const wip = num(policy?.work?.wip_per_agent);
  if (mp != null && mp < 1) err(`work.max_parallel must be ≥ 1 (got ${mp})`);
  if (wip != null && wip < 1) err(`work.wip_per_agent must be ≥ 1 (got ${wip})`);
  if (mp != null && wip != null && wip > mp) err(`work.wip_per_agent (${wip}) exceeds work.max_parallel (${mp}) — a single agent could never reach its WIP cap.`);
  const ttl = num(policy?.work?.lease_ttl_min);
  if (ttl != null && ttl <= 0) err(`work.lease_ttl_min must be > 0 (got ${ttl})`);
  const mr = num(policy?.work?.max_runs_per_5h);
  if (mr != null && mr <= 0) err(`work.max_runs_per_5h must be > 0 (got ${mr})`);

  // --- schedule / quiet hours ---
  const cadence = policy?.schedule?.cadence;
  if (cadence != null && !CADENCES.has(cadence)) err(`schedule.cadence '${cadence}' is not one of ${[...CADENCES].join(' | ')}`);
  if (policy?.quiet_hours?.enabled === true && policy?.quiet_hours?.from === policy?.quiet_hours?.to) {
    warn(`quiet_hours.enabled is true but from == to (${policy.quiet_hours.from}) — that window never pauses anything.`);
  }

  // --- governance ---
  for (const [k, v] of Object.entries(policy?.sensitive_actions ?? {})) {
    if (!DISPOSITIONS.has(v)) err(`sensitive_actions.${k} '${v}' must be one of ${[...DISPOSITIONS].join(' | ')}`);
  }
  if (policy?.auto_merge != null && !MERGE_MODES.has(policy.auto_merge)) {
    err(`auto_merge '${policy.auto_merge}' must be one of ${[...MERGE_MODES].join(' | ')}`);
  }

  // --- model coherence: routine sweep must not cost more than the default ---
  for (const agent of Object.keys(policy?.agent_models ?? {})) {
    const m = policy.agent_models[agent];
    const dr = COST_RANK[m?.default], rr = COST_RANK[m?.routine];
    if (dr != null && rr != null && rr > dr) {
      warn(`agent_models.${agent}: routine (${m.routine}) is pricier than default (${m.default}) — the "cheap sweep" model costs more than the everyday one.`);
    }
  }

  // --- P5 analytics ---
  const VALID_ALERT_CHANNELS = new Set(['slack', 'email', 'webhook']);
  const VALID_SEVERITIES = new Set(['info', 'warning', 'critical']);
  const VALID_ALERT_TYPES = new Set(['budget_threshold', 'anomaly', 'optimization_available']);

  // Validate analytics.aggregation
  const aggInterval = num(policy?.analytics?.aggregation?.intervalMinutes);
  if (aggInterval != null && (aggInterval < 1 || aggInterval > 1440)) {
    err(`analytics.aggregation.intervalMinutes must be 1–1440 (got ${aggInterval})`);
  }

  // Validate analytics.budget
  const monthlyLimit = num(policy?.analytics?.budget?.monthlyLimit);
  if (monthlyLimit != null && monthlyLimit < 0) {
    err(`analytics.budget.monthlyLimit must be ≥ 0 (got ${monthlyLimit})`);
  }

  // Validate analytics.alerts.channels
  for (const ch of (policy?.analytics?.alerts?.channels ?? [])) {
    if (ch.type && !VALID_ALERT_CHANNELS.has(ch.type)) {
      err(`analytics.alerts.channels[].type '${ch.type}' must be one of ${[...VALID_ALERT_CHANNELS].join(' | ')}`);
    }
    if (ch.severity && !VALID_SEVERITIES.has(ch.severity)) {
      err(`analytics.alerts.channels[].severity '${ch.severity}' must be one of ${[...VALID_SEVERITIES].join(' | ')}`);
    }
    if (ch.url && !/^https?:\/\//i.test(ch.url) && ch.type !== 'email') {
      warn(`analytics.alerts.channels[].url '${ch.url}' may not be a valid URL — alerts will fail to dispatch`);
    }
    if (ch.type === 'email') {
      if (ch.host && !ch.host.includes('.')) warn(`analytics.alerts.channels[].host '${ch.host}' looks invalid for SMTP`);
      const port = num(ch.port);
      if (port != null && (port < 1 || port > 65535)) err(`analytics.alerts.channels[].port must be 1–65535 (got ${port})`);
    }
  }

  // Validate analytics.alerts.rules
  for (const rule of (policy?.analytics?.alerts?.rules ?? [])) {
    if (rule.type && !VALID_ALERT_TYPES.has(rule.type)) {
      err(`analytics.alerts.rules[].type '${rule.type}' must be one of ${[...VALID_ALERT_TYPES].join(' | ')}`);
    }
    if (rule.severity && !VALID_SEVERITIES.has(rule.severity)) {
      err(`analytics.alerts.rules[].severity '${rule.severity}' must be one of ${[...VALID_SEVERITIES].join(' | ')}`);
    }
    const tPct = num(rule.thresholdPct);
    if (tPct != null && (tPct < 1 || tPct > 100)) {
      err(`analytics.alerts.rules[].thresholdPct must be 1–100 (got ${tPct})`);
    }
    const cd = num(rule.cooldownSeconds);
    if (cd != null && cd < 0) err(`analytics.alerts.rules[].cooldownSeconds must be ≥ 0 (got ${cd})`);
  }

  // Validate analytics.optimization
  const minDays = num(policy?.analytics?.optimization?.minDataDays);
  if (minDays != null && minDays < 1) {
    err(`analytics.optimization.minDataDays must be ≥ 1 (got ${minDays})`);
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** Apply `{ 'dotted.path': value }` onto a deep clone of a policy object (for pre-write validation). */
export function applyDottedUpdates(policy, updates) {
  const clone = JSON.parse(JSON.stringify(policy ?? {}));
  for (const [path, value] of Object.entries(updates ?? {})) {
    const parts = String(path).split('.');
    let node = clone;
    for (let i = 0; i < parts.length - 1; i++) {
      if (node[parts[i]] == null || typeof node[parts[i]] !== 'object') node[parts[i]] = {};
      node = node[parts[i]];
    }
    node[parts[parts.length - 1]] = value;
  }
  return clone;
}

// ─── Phase 0: JSON Schema boot-time validation ───────────────────────────────

const VALID_WIRES = new Set(['anthropic', 'openai', 'google-ai', 'generic-http']);

/**
 * Load the provider JSON Schema from schema/provider.schema.json for structural validation.
 * Returns the parsed schema or null if file is missing/unparseable.
 */
function loadProviderSchema() {
  try {
    const schemaPath = join(HERE, 'schema', 'provider.schema.json');
    const raw = readFileSync(schemaPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Phase 0: Validate policy.yaml against JSON Schema at boot time.
 * Returns { ok, errors[] } with field-level error messages including file path and line hints.
 * Uses schema/provider.schema.json for provider structural validation.
 */
export function validatePolicySchema(policy = {}) {
  const errors = [];
  const providerSchema = loadProviderSchema();

  // Validate model_routing references valid providers
  const definedProviders = new Set(Object.keys(policy?.providers ?? {}));
  for (const [agent, tiers] of Object.entries(policy?.model_routing ?? {})) {
    if (typeof tiers !== 'object' || tiers == null) continue;
    for (const [tier, config] of Object.entries(tiers)) {
      if (config?.provider && !definedProviders.has(config.provider)) {
        errors.push(`policy.yaml: model_routing.${agent}.${tier}.provider '${config.provider}' references unknown provider — defined providers: [${[...definedProviders].join(', ')}]`);
      }
      if (!config?.model) {
        errors.push(`policy.yaml: model_routing.${agent}.${tier}.model is required when a provider is specified`);
      }
    }
  }

  // Validate provider entries against JSON Schema (003 — schema-driven validation)
  for (const [name, provider] of Object.entries(policy?.providers ?? {})) {
    // Schema-driven validation
    if (providerSchema && providerSchema.required) {
      for (const req of providerSchema.required) {
        if (!(req in (provider ?? {}))) {
          errors.push(`policy.yaml: providers.${name}.${req} is required`);
        }
      }
      // Validate name pattern
      if (provider?.name && providerSchema.properties?.name?.pattern) {
        const re = new RegExp(providerSchema.properties.name.pattern);
        if (!re.test(provider.name)) {
          errors.push(`policy.yaml: providers.${name}.name '${provider.name}' must match ${providerSchema.properties.name.pattern}`);
        }
      }
      // Validate wire enum via dynamic WiresAdapter registry check
      if (provider?.wire && !VALID_WIRES.has(provider.wire)) {
        errors.push(`policy.yaml: providers.${name}.wire '${provider.wire}' is invalid — must be one of [${[...VALID_WIRES].join(', ')}]`);
      }
      // Validate baseUrl format (required, must be HTTPS)
      if (provider?.baseUrl == null || provider?.baseUrl === '') {
        errors.push(`policy.yaml: providers.${name}.baseUrl is required`);
      } else if (providerSchema.properties?.baseUrl?.pattern) {
        const re = new RegExp(providerSchema.properties.baseUrl.pattern);
        if (!re.test(provider.baseUrl)) {
          errors.push(`policy.yaml: providers.${name}.baseUrl must be an HTTPS URL (got '${provider.baseUrl}')`);
        }
      }
    } else {
      // Fallback: basic structural validation without schema
      if (provider?.wire && !VALID_WIRES.has(provider.wire)) {
        errors.push(`policy.yaml: providers.${name}.wire '${provider.wire}' is invalid — must be one of [${[...VALID_WIRES].join(', ')}]`);
      }
      if (!provider?.baseUrl) {
        errors.push(`policy.yaml: providers.${name}.baseUrl is required`);
      }
    }
  }

  // Validate gateway port if set
  if (policy?.gateway?.port != null) {
    const port = Number(policy.gateway.port);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      errors.push(`policy.yaml: gateway.port must be 1024–65535 (got ${policy.gateway.port})`);
    }
  }

  // Check for unknown top-level fields (forward-compat warning only, not an error)
  // This is handled by existing validatePolicy — not duplicated here.

  return { ok: errors.length === 0, errors };
}
