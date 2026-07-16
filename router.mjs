/**
 * router — the policy brain. Given the DB, the parsed policy, and the live budget, it makes ONE
 * decision for an agent that wants work:
 *   - MAY it claim now?   kill_switch / budget halt / max_parallel / wip_per_agent
 *   - WHICH task?         the next eligible task within the priority floor + capability_matrix
 *   - WITH which model?   agent_models.default, or the cheaper `routine` when the budget is at
 *                         warn and auto_downgrade_at_warn is on
 *   - for how long?       lease TTL from work.lease_ttl_min
 *
 * Pure: it reads state + policy and returns a decision object. It NEVER writes — the runner takes
 * the decision and calls bus.claim. (quiet_hours + schedule cadence are the runner's concern.)
 */
import { budgetStatus, loadPolicy } from './budget.mjs';
import { parseJsonArray } from './state.mjs';
import { createStateStore } from './state-store.mjs';
import { CLAIMABLE_STATUSES } from './machine.mjs';
import { routeModel } from './model-router.mjs';
import { resolveProvider, providerKeyPresent, modelForTier } from './providers.mjs';
import { sensitiveBlock, isFounderApproved } from './sensitive.mjs';

const leaseLive = (t, nowIso) => t.lease_expires && t.lease_expires > nowIso;
const brief = (t) => ({ id: t.id, title: t.title, status: t.status, owner: t.owner, priority: t.priority, complexity: t.complexity, risk_tags: t.risk_tags });

/**
 * Which model an agent should use. When model_routing is enabled and a task is provided,
 * uses the model-router for intelligent per-task selection. Otherwise falls back to the
 * agent_models.default / routine pattern.
 * `domain` (optional — the injected DomainPlugin, i.e. `config.domain`) is forwarded to
 * routeModel() for its tenant-specific defaultModels/taxonomy.
 */
export function selectModel(policy, agent, agentState, task = null, domain) {
  // Task-aware routing (when model_routing is configured and a task is available)
  if (task && policy?.model_routing) {
    const result = routeModel(agent, task, policy, agentState, domain);
    if (result.model) return result.model;
  }

  // Fallback: agent_models.default / routine
  const models = policy?.agent_models?.[agent] ?? {};
  const def = models.default ?? null;
  const routine = models.routine ?? def;
  if (policy?.agent_budget?.auto_downgrade_at_warn && agentState === 'warn' && routine) return routine;
  return def;
}

/**
 * Build a filter function from the policy's capability_matrix + work_stealing. Returns null if
 * no matrix is defined (no filtering — backward compatible). When a matrix exists:
 *   - A task whose risk_tags include a category exclusively assigned to another agent is skipped.
 *   - A task owned by another agent is skipped unless work_stealing is on.
 *   - A task with owner 'both' or matching the agent always passes the owner check.
 */
export function buildCapabilityFilter(agent, policy) {
  const matrix = policy?.capability_matrix;
  if (!matrix || typeof matrix !== 'object') return null;
  const workStealing = policy?.work_stealing === true;

  return (task) => {
    // Owner gate: respect task.owner unless work_stealing is enabled
    const owner = task.owner ?? 'both';
    if (owner !== 'both' && owner !== agent && !workStealing) return false;

    // Capability gate: if the task has risk_tags that appear in the matrix, the agent must be listed
    const tags = parseJsonArray(task.risk_tags);
    for (const tag of tags) {
      const allowed = matrix[tag];
      // If a tag is in the matrix and the agent is NOT listed → blocked
      if (Array.isArray(allowed) && !allowed.includes(agent)) return false;
    }
    return true;
  };
}

// buildSprintFilter moved to state.mjs (D2 bite #2, stage 2a — promoted read-queries; see
// state-store.mjs's DB_BOUND_FNS). Re-exported here by name so existing importers
// (`import { buildSprintFilter } from './router.mjs'`) keep working unchanged.
export { buildSprintFilter } from './state.mjs';

/** Compose two task filters (either may be null). Returns null only when both are null. */
export function composeFilters(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return (t) => a(t) && b(t);
}

/**
 * @returns {{mayClaim:boolean, reason:string, agent:string, task:object|null, model:string|null,
 *   provider:string|null, harness:string|null, ttlMs:number|null}}
 *   mayClaim:false carries the blocking `reason` (kill_switch | budget_halt | max_parallel |
 *   wip_per_agent | no_eligible_task | below_priority_floor | sensitive_action:<action> |
 *   missing_key:<provider> — the last is a skip, not a hard block: the task is still named in
 *   `task` so the runner can log/warn which task and provider triggered it);
 *   mayClaim:true carries task+model+provider+harness+ttl.
 *   `config` is the injected AiosConfig (REQUIRED), threaded to sensitiveBlock's governance
 *   hard-stop check.
 */
export function decide(db, { config, agent, now = Date.now(), policy = loadPolicy(undefined, config), budget, claimable = CLAIMABLE_STATUSES, excludeTasks = null } = {}) {
  const store = createStateStore(db);
  const nowIso = new Date(now).toISOString();
  const deny = (reason) => ({ mayClaim: false, reason, agent, task: null, model: null, ttlMs: null });

  const b = budget ?? budgetStatus({ policy, now, config });
  if (b.kill_switch) return deny('kill_switch');
  const agentState = b[agent]?.state ?? 'ok';
  const mayClaim = b.mayClaim?.[agent] ?? (agentState !== 'halt');
  if (!mayClaim) return deny('budget_halt');

  const work = policy?.work ?? {};
  const active = store.listTasks().filter((t) => leaseLive(t, nowIso));
  if (work.max_parallel != null && active.length >= work.max_parallel) return deny('max_parallel');
  if (work.wip_per_agent != null && active.filter((t) => t.lease_owner === agent).length >= work.wip_per_agent) return deny('wip_per_agent');

  // Dispatch dedupe (RCA-2): when deciding for a second agent in the same tick, skip any task a
  // prior agent has already been assigned this tick, so two agents never contend for one task and
  // the second agent gets DIFFERENT work if any exists (restores real parallelism).
  const excludeFilter = excludeTasks && excludeTasks.size
    ? (t) => !excludeTasks.has(t.id)
    : null;
  const filter = composeFilters(composeFilters(buildCapabilityFilter(agent, policy), store.buildSprintFilter()), excludeFilter);
  const t = store.nextEligibleTask({ agent, now: nowIso, claimable, filter });
  if (!t) return deny('no_eligible_task');
  const floor = work.priority_floor ?? 999;
  if (t.priority > floor) return deny('below_priority_floor');

  // Governance hard-stop: never autonomously claim a task that (or whose ancestor epic) carries a
  // risk_tag mapped to a block_and_ask sensitive action (spend_money / external_send / deploy /
  // schema_change). The planner also parks these as `blocked` + escalates; this is defense-in-depth
  // so a sensitive task is never handed to an agent even if the planner hasn't run yet.
  const blockedAction = !isFounderApproved(t) && sensitiveBlock(policy, store.effectiveRiskTags(t), undefined, config);
  if (blockedAction) return deny(`sensitive_action:${blockedAction}`);

  const routed = routeModel(agent, t, policy, agentState, config.domain);
  const model = routed.model ?? selectModel(policy, agent, agentState, null, config.domain);
  const providerName = routed.provider ?? 'anthropic';
  const harness = routed.harness ?? config.domain.agentHarness?.[agent] ?? 'claude-code';
  const ttlMs = (work.lease_ttl_min ?? 30) * 60 * 1000;

  // Cost-safety guard (the wedge): a task routed to a third-party provider whose BYO key isn't
  // set must never silently fall back to paid Anthropic — that's the exact surprise-spend this
  // system exists to prevent. Default is to skip claiming the task this cycle; a founder can
  // opt into `on_missing_key: 'fallback_anthropic'` to explicitly allow the fallback instead.
  // Native anthropic (keyEnv: null) is always "present", so this never fires for legacy policy.
  const provider = resolveProvider(providerName, policy);
  if (!providerKeyPresent(provider)) {
    const onMissingKey = policy?.model_routing?.on_missing_key ?? 'skip';
    if (onMissingKey === 'fallback_anthropic') {
      return {
        mayClaim: true,
        reason: 'ok',
        agent,
        task: brief(t),
        model: modelForTier('anthropic', routed.tier, policy) ?? model,
        provider: 'anthropic',
        harness: config.domain.agentHarness?.[agent] ?? 'claude-code',
        modelTier: routed.tier,
        modelReason: `${routed.reason} → fallback_anthropic (missing key for '${providerName}')`,
        ttlMs,
      };
    }
    return {
      mayClaim: false,
      reason: `missing_key:${providerName}`,
      agent,
      task: brief(t),
      model,
      provider: providerName,
      harness,
      modelTier: routed.tier,
      ttlMs: null,
    };
  }

  return {
    mayClaim: true,
    reason: 'ok',
    agent,
    task: brief(t),
    model,
    provider: providerName,
    harness,
    modelTier: routed.tier,
    modelReason: routed.reason,
    ttlMs,
  };
}
