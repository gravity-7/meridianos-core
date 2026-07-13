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
