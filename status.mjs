/**
 * status — assembles the single payload the dashboard renders: budget gauges, who's active
 * right now (live leases), the eligible queue, recent runs, and the current policy (the levers).
 * Pure read: it opens the state DB, the usage meters, and the run log, and never mutates state.
 */
import { openDb } from './db.mjs';
import { createProjectStore } from './project-store.mjs';
import { budgetStatus, loadPolicy } from './budget.mjs';
import { readRuns } from './runlog.mjs';
import { CLAIMABLE_STATUSES } from './machine.mjs';
import { healthStatus, collectEscalations } from './watchdog.mjs';
import { runnerStatus } from './runner.mjs';
import { verifierStatus } from './verifier.mjs';
import { plannerStatus } from './planner.mjs';
import { routeModel, categoryIndex, TIERS } from './model-router.mjs';

// ─── Task-type definitions (constitution §11) ────────────────────────────────
const TASK_TYPE_META = {
  design:  { label: 'Design',  desc: 'UI components in packages/ui + apps/*/src/components', icon: '🎨' },
  copy:    { label: 'Copy',    desc: 'EN copy strings — labels, errors, placeholders, templates', icon: '✏️' },
  docs:    { label: 'Docs',    desc: 'Markdown docs for UI components in packages/ui/docs/', icon: '📄' },
  a11y:    { label: 'A11y',    desc: 'ARIA roles, keyboard nav, focus management in UI files', icon: '♿' },
  tokens:  { label: 'Tokens',  desc: 'Design token proposals in index.css or design-tokens.json', icon: '🎛️' },
};

/** For each defined task_type, count tasks by status and owner. Tasks without a task_type
 *  are grouped under '_uncategorized'. Pure, read-only — mirrors buildStatus's shape. */
function buildTaskCategories(tasks) {
  const categories = {};
  for (const [type, meta] of Object.entries(TASK_TYPE_META)) {
    categories[type] = { ...meta, total: 0, byStatus: {}, byOwner: {} };
  }
  categories._uncategorized = { label: 'Uncategorized', desc: 'Tasks without an explicit task_type', icon: '📦', total: 0, byStatus: {}, byOwner: {} };

  for (const t of tasks) {
    const type = t.task_type && categories[t.task_type] ? t.task_type : '_uncategorized';
    const cat = categories[type];
    cat.total++;
    cat.byStatus[t.status] = (cat.byStatus[t.status] || 0) + 1;
    cat.byOwner[t.owner] = (cat.byOwner[t.owner] || 0) + 1;
  }
  return categories;
}

const leaseLive = (t, nowIso) => t.lease_expires && t.lease_expires > nowIso;

/**
 * @param {object}  [o]
 * @param {object}  o.config        the injected AiosConfig (REQUIRED)
 * @param {object}  [o.store]       an already-built ProjectStore (tests); otherwise one is built
 *                                  from a freshly-opened db at o.dbPath (closed again on return)
 * @param {string}  [o.dbPath]      state DB path (defaults to the repo DB) — only used when
 *                                  `o.store` is omitted
 * @param {number}  [o.now]         epoch ms (injectable for tests)
 * @param {object}  [o.policy]      parsed policy (defaults to .ai/policy.yaml)
 * @param {object}  [o.agentDirs]   { [agent]: dirOverride } — per-agent usage-store dir override
 *                                  (tests); threaded straight into budgetStatus.
 * @param {number}  [o.runsLimit]
 */
export function buildStatus({ config, store, dbPath, now = Date.now(), policy = loadPolicy(undefined, config), agentDirs, runsLimit = 20 } = {}) {
  const nowIso = new Date(now).toISOString();
  const ownedDb = store ? null : openDb(dbPath, config);
  store = store ?? createProjectStore({ db: ownedDb, config });
  try {
    const tasks = store.state.listTasks();
    const models = policy?.agent_models ?? {};

    const activeFor = (agent) => {
      const t = tasks.find((x) => leaseLive(x, nowIso) && x.lease_owner === agent);
      if (!t) return null;
      return {
        task: t.id,
        title: t.title,
        status: t.status,
        session: t.lease_session,
        heartbeatAgeSec: Math.max(0, Math.round((now - Date.parse(t.updated_at)) / 1000)),
      };
    };

    const roster = config.domain.agents;
    const claimable = new Set(CLAIMABLE_STATUSES);
    const queue = tasks
      .filter((t) => claimable.has(t.status) && !leaseLive(t, nowIso))
      .map((t) => {
        // routeModel throws on a malformed object-form model_routing entry (unknown provider,
        // empty model) — a real config bug that should halt the actual claim/spawn path, but the
        // read-only dashboard must stay up regardless, so degrade to null routing here instead.
        const routeSafe = (agent) => {
          try { return routeModel(agent, t, policy, 'ok', config.domain); }
          catch { return { model: null, tier: null }; }
        };
        const routing = {};
        for (const agent of roster) {
          const r = routeSafe(agent);
          routing[agent] = { model: r.model, tier: r.tier };
        }
        return {
          id: t.id, title: t.title, status: t.status, owner: t.owner, priority: t.priority,
          complexity: t.complexity, spec: t.spec ?? null,
          routing,
        };
      });

    const budget = budgetStatus({ policy, now, agentDirs, config });
    const runs = readRuns({ limit: runsLimit, config });

    return {
      ts: nowIso,
      kill_switch: budget.kill_switch,
      // 008 — End-User Configurability: the Settings workspace's Gateway panel needs to read the
      // CURRENT gateway.port to pre-fill its field, not just write a new one — buildStatus already
      // surfaces other policy-derived state (kill_switch above) the same way.
      gateway: { port: policy?.gateway?.port ?? null },
      budget,
      // Read-only "spend split by provider" (1.6) — computed inside budgetStatus from the run
      // log; surfaced at the top level alongside the other subsystems for discoverability.
      providerUsage: budget.providerUsage,
      agents: Object.fromEntries(roster.map((agent) => [agent, { model: models[agent]?.default ?? null, active: activeFor(agent) }])),
      queue,
      runs,
      // --- orchestrator subsystems (dashboard-v2 contract) ---
      health: healthStatus(store, { policy, budget, now, config }),
      runner: runnerStatus({ policy, budget, now, runs, config }),
      verifier: verifierStatus(store, { policy, now, config }),
      planner: plannerStatus(store, { now }),
      escalations: collectEscalations(store, { policy, budget, now, config }),
      // Snoozed/skipped blocked tasks — kept out of `escalations` so they stop nagging, but
      // still listed so the dashboard can offer Un-snooze/Un-skip/Approve (reversible parking).
      parked: store.state.parkedTasks({ now }),
      capability_matrix: policy?.capability_matrix ?? null,
      work_stealing: policy?.work_stealing ?? false,
      taskCategories: buildTaskCategories(tasks),
      systemLog: store.events.readEvents({ limit: 30 }),
      policy,
    };
  } finally {
    if (ownedDb) ownedDb.close?.();
  }
}
