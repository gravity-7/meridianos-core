/**
 * planner — keeps the queue from starving. It turns epics / proposed cards into concrete child
 * tasks so agents always have eligible work, and reports backlog health to the dashboard.
 *
 * The intelligence (deciding HOW to break an epic down) is an agent's job — the planner takes a
 * decomposition (a list of child briefs) and materializes it atomically-ish into DB tasks with
 * inherited owner/priority, resources, and deps. proposeTasks() creates them as `proposed`;
 * acceptProposals() promotes them into the state machine (proposed → spec). plannerStatus()
 * emits the dashboard `planner` payload. Pure over an injected `db`.
 */
import { parseJsonArray } from './state.mjs';
import { loadPolicy } from './budget.mjs';
import { meetsSpecEntry, meetsDefinitionOfReady } from './definition-of-ready.mjs';
import { sensitiveBlock, describeBlocks, isFounderApproved } from './sensitive.mjs';

const sep = (childId, parentId) => childId !== parentId && (childId.startsWith(`${parentId}.`) || childId.startsWith(`${parentId}-`));

/** The nearest ancestor task id by id-prefix, or null. */
export function parentOf(id, tasks) {
  const ancestors = tasks.filter((t) => sep(id, t.id)).map((t) => t.id);
  return ancestors.sort((a, b) => b.length - a.length)[0] ?? null; // longest prefix = nearest parent
}

/** Epics = tasks that have descendants (by id-prefix), with a done/total progress count. */
export function epicsOf(tasks) {
  return tasks
    .map((p) => ({ p, kids: tasks.filter((c) => sep(c.id, p.id)) }))
    .filter(({ kids }) => kids.length > 0)
    .map(({ p, kids }) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      childrenReady: kids.filter((c) => c.status === 'done').length,
      childrenTotal: kids.length,
    }));
}

/** Materialize a decomposition into child tasks (status `proposed` by default). */
export function proposeTasks(store, { parentId = null, children = [], now = Date.now() } = {}) {
  const parent = parentId ? store.state.getTask(parentId) : null;
  const nowIso = new Date(now).toISOString();
  const created = [];
  children.forEach((c, i) => {
    const id = c.id ?? `${parentId ?? 'TASK'}.${i + 1}`;
    const t = store.state.upsertTask({
      id,
      title: c.title ?? id,
      status: c.status ?? 'proposed',
      owner: c.owner ?? parent?.owner ?? 'both',
      priority: c.priority ?? parent?.priority ?? 100,
      complexity: c.complexity,
      resources: c.resources ?? [],
      depends_on: c.depends_on ?? [],
      contracts: c.contracts ?? [],
      note: c.note ?? (parentId ? `planned from ${parentId}` : 'planned'),
    }, { now: nowIso });
    created.push(t.id);
  });
  return { ok: true, created };
}

/** Promote proposed tasks into the state machine (proposed → spec). Skips illegal moves. */
export function acceptProposals(store, { ids = [], actor = 'planner', now = Date.now() } = {}) {
  const accepted = [];
  const nowIso = new Date(now).toISOString();
  for (const id of ids) {
    try {
      const r = store.state.transition({ taskId: id, to: 'spec', actor, note: 'accepted by planner', now: nowIso });
      if (r && r.ok) accepted.push(id);
    } catch { /* not proposed / illegal — skip */ }
  }
  return { ok: true, accepted };
}

/**
 * Auto-promote tasks through the upstream pipeline so the runner always has work.
 * Runs on each watchdog tick. Promotes:
 *   1. proposed → spec (auto-accept — the task entered the board, it should be worked on)
 *   2. spec → designing (fast-track when a spec file already exists)
 * The runner handles claiming spec/designing/ready-for-impl tasks via CLAIMABLE.
 * `config` is the injected AiosConfig (REQUIRED), threaded to the sensitive.mjs governance calls
 * (sensitiveBlock / describeBlocks).
 */
export function plannerCycle(store, { config, now = Date.now(), policy = loadPolicy(undefined, config) } = {}) {
  const tasks = store.state.listTasks();
  const nowIso = new Date(now).toISOString();
  const promoted = [];
  const skippedNotReady = [];

  // Governance hard-stop (constitution §6): any workable story whose effective risk_tags (own +
  // ancestor epic) map to a block_and_ask sensitive action (spend_money / external_send / deploy /
  // schema_change) must NOT flow autonomously. Park it as `blocked` — the watchdog surfaces blocked
  // tasks to the founder's escalation feed. Skips already-blocked/done tasks and idempotent otherwise.
  for (const t of tasks) {
    if (t.type !== 'story') continue;
    if (t.status === 'blocked' || t.status === 'done') continue;
    if (isFounderApproved(t)) continue; // founder cleared this §6 hold — let it flow
    const action = sensitiveBlock(policy, store.state.effectiveRiskTags(t), undefined, config);
    if (!action) continue;
    try {
      const what = describeBlocks(policy, store.state.effectiveRiskTags(t), config); // names ALL blocking actions
      store.state.transition({ taskId: t.id, to: 'blocked', actor: 'planner', note: `governance hold: needs founder approval to ${what}`, now: nowIso });
      promoted.push({ id: t.id, from: t.status, to: 'blocked', reason: `sensitive:${action}` });
    } catch { /* illegal move — skip */ }
  }

  // Governance RELEASE: when the policy no longer blocks a task (the founder relaxed the disposition,
  // e.g. external_send → notify_only), let a previously governance-held task flow again automatically.
  // We ONLY release holds THIS gate placed — identified by the "governance hold" note — never manual
  // dashboard blocks, reap auto-blocks, or PARKED tasks. The pre-block status is restored from the
  // audit log (defaulting to ready-for-impl). Idempotent: a released task is no longer `blocked`.
  const RELEASE_TARGETS = ['ready-for-impl', 'in-progress', 'designing', 'spec']; // legal moves from 'blocked'
  for (const t of tasks) {
    if (t.status !== 'blocked') continue;
    if (!(typeof t.note === 'string' && t.note.startsWith('governance hold'))) continue;
    if (sensitiveBlock(policy, store.state.effectiveRiskTags(t), undefined, config)) {
      // Still blocked, but the ACTIONS that block it may have changed (e.g. the founder relaxed
      // external_send, leaving only spend_money). Refresh the note so it names what is ACTUALLY
      // blocking it now — otherwise the founder relaxes the lever the stale note names and nothing
      // happens (postmortem #7).
      const want = `governance hold: needs founder approval to ${describeBlocks(policy, store.state.effectiveRiskTags(t), config)}`;
      if (t.note !== want) {
        try { store.state.setTaskNote({ taskId: t.id, note: want, now: nowIso }); } catch { /* skip */ }
      }
      continue; // policy still blocks it — stay parked
    }
    const prior = store.state.lastTransitionInto(t.id, 'blocked');
    const to = RELEASE_TARGETS.includes(prior?.from_state) ? prior.from_state : 'ready-for-impl';
    try {
      store.state.transition({ taskId: t.id, to, actor: 'planner', note: 'released — policy now permits this action', now: nowIso });
      promoted.push({ id: t.id, from: 'blocked', to, reason: 'governance-released' });
    } catch { /* illegal — skip */ }
  }

  // Sprint Rollover: If the active sprint has stories and all are done, complete it and start the next one.
  let activeSprint = store.state.getActiveSprint();

  if (activeSprint) {
    const sprintStories = tasks.filter(t => t.sprint_id === activeSprint.id && t.type === 'story');
    if (sprintStories.length > 0) {
      const allDone = sprintStories.every(t => t.status === 'done' || t.status === 'blocked');
      if (allDone) {
        // Complete current sprint
        store.state.completeSprint(activeSprint.id);
        promoted.push({ id: activeSprint.id, type: 'sprint', from: 'active', to: 'completed' });

        // Generate next sprint
        const match = activeSprint.name.match(/Sprint (\d+)/i);
        const nextNum = match ? parseInt(match[1], 10) + 1 : Date.now();
        const nextId = `S-${nextNum}`;
        const nextName = `Sprint ${nextNum}`;

        store.state.upsertSprint({ id: nextId, pi_id: activeSprint.pi_id, name: nextName, goal: 'Auto-generated Sprint', status: 'active' });
        promoted.push({ id: nextId, type: 'sprint', from: 'none', to: 'active' });

        // Point to the newly created sprint
        activeSprint = store.state.getActiveSprint();
      }
    }
  }

  // Sprint Planning: pull stories into the active sprint so the runner never starves.
  if (activeSprint) {
    // (a) Unassigned/backlog stories whose parent epic is in-progress — commit them to the sprint.
    const unassignedStories = tasks.filter(t => t.type === 'story' && !t.sprint_id && t.status !== 'done' && t.status !== 'blocked');
    for (const s of unassignedStories) {
      // Only pull into sprint if parent is in-progress
      const parent = s.parent_id ? tasks.find(p => p.id === s.parent_id) : null;
      if (parent && parent.status === 'in-progress') {
        store.state.setTaskSprint({ taskId: s.id, sprintId: activeSprint.id, now: nowIso });
        promoted.push({ id: s.id, from: 'backlog', to: 'sprint_assigned', sprint_id: activeSprint.id });
      }
    }

    // (b) Carry-over: a workable story stranded in a *non-active* (completed/absent) sprint is invisible
    // to the router's sprint filter (buildSprintFilter admits only active-sprint stories), so the runner
    // logs nothing_to_claim forever. This happens when a story is unblocked/reopened after its sprint
    // completed (e.g. via the dashboard Approve/unblock, or a manual reopen). Treat "assigned to a
    // non-active sprint" exactly like "unassigned" and carry it into the active sprint. Guarded by
    // `if (activeSprint)` — with no active sprint the filter already fails open, so we leave them be.
    const stranded = tasks.filter(t =>
      t.type === 'story' && t.status !== 'done' && t.status !== 'blocked' &&
      t.sprint_id && t.sprint_id !== activeSprint.id);
    for (const s of stranded) {
      store.state.setTaskSprint({ taskId: s.id, sprintId: activeSprint.id, now: nowIso });
      promoted.push({ id: s.id, from: s.sprint_id, to: 'sprint_assigned', sprint_id: activeSprint.id });
    }
  }

  for (const t of tasks.filter(t => t.status === 'proposed')) {
    const deps = parseJsonArray(t.depends_on);
    if (deps.length) {
      const doneCount = store.state.countDoneAmong(deps);
      if (doneCount < deps.length) continue;
    }
    // Tier-1 DoR gate: minimal check (title + owner). The spec agent is responsible for
    // writing full ACs, user-story statement, and complexity back to the task DB row.
    // A thin one-liner story now enters the pipeline so the spec agent can flesh it out.
    const entry = meetsSpecEntry(t);
    if (!entry.ready) {
      const note = `not ready: ${entry.reasons.join('; ')}`.slice(0, 240);
      if (t.note !== note) {
        try { store.state.setTaskNote({ taskId: t.id, note, now: nowIso }); } catch { /* skip */ }
      }
      skippedNotReady.push({ id: t.id, reasons: entry.reasons });
      continue;
    }
    try {
      store.state.transition({ taskId: t.id, to: 'spec', actor: 'planner', note: 'auto-promoted (spec-entry met)', now: nowIso });
      promoted.push({ id: t.id, from: 'proposed', to: 'spec' });
    } catch { /* blocked or illegal — skip */ }
  }

  for (const t of tasks.filter(t => t.status === 'spec' && t.spec)) {
    // Tier-2 DoR gate: full check before entering the design stage. By the time the spec file
    // exists, the spec agent should have called `update-task` to write ACs + complexity back.
    // If it hasn't, leave the task in `spec` (runner will retry the spec agent next cycle).
    const dor = meetsDefinitionOfReady(t);
    if (!dor.ready) {
      const note = `spec needs work: ${dor.reasons.join('; ')}`.slice(0, 240);
      if (t.note !== note) {
        try { store.state.setTaskNote({ taskId: t.id, note, now: nowIso }); } catch { /* skip */ }
      }
      skippedNotReady.push({ id: t.id, reasons: dor.reasons });
      continue;
    }
    try {
      store.state.transition({ taskId: t.id, to: 'designing', actor: 'planner', note: 'spec complete (DoR met) — fast-tracked', now: nowIso });
      promoted.push({ id: t.id, from: 'spec', to: 'designing' });
    } catch { /* skip */ }
  }

  return { promoted, skippedNotReady };
}

/** The dashboard `planner` payload: backlog depth, epic progress, and pending proposals. */
export function plannerStatus(store, { now = Date.now() } = {}) {
  const tasks = store.state.listTasks();
  const proposalsRaw = tasks.filter((t) => t.status === 'proposed');
  const proposals = proposalsRaw.map((t) => ({
    id: t.id,
    title: t.title,
    fromEpic: parentOf(t.id, tasks),
    priority: t.priority,
    resources: parseJsonArray(t.resources),
    status: 'proposed',
  }));
  const backlogDepth = tasks.filter((t) => ['proposed', 'spec'].includes(t.status)).length;
  const lastPlannedTs = proposalsRaw.reduce((m, t) => (t.updated_at > m ? t.updated_at : m), '') || null;
  return { backlogDepth, epics: epicsOf(tasks), proposals, lastPlannedTs };
}
