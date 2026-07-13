/**
 * Render the state DB into its two GENERATED git-committed views:
 *   .ai/state/board.json — canonical machine state (durable seed + audit; never hand-edited)
 *   .ai/board.md         — the founder's human dashboard (generated)
 *
 * Rendering is deterministic (no wall-clock in the output) so CI can detect a hand-edited or
 * stale board by re-rendering and diffing — that is `validate --drift`.
 */
import { writeFileSync } from 'node:fs';
import { listTasks, listSprints, listPIs } from './state.mjs';
import { ACTIVE } from './machine.mjs';

const arr = (s) => { try { return JSON.parse(s || '[]'); } catch { return []; } };

/** Escape a value for a Markdown TABLE CELL: pipes would otherwise open a new column, newlines
 *  would break the row (postmortem #6 — several task titles literally contain " | "). */
const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/** Durable projection of one task (declarative + status only — leases are NOT durable). */
function projectTask(t) {
  return {
    id: t.id,
    type: t.type,
    parent_id: t.parent_id,
    sprint_id: t.sprint_id,
    title: t.title,
    acceptance_criteria: t.acceptance_criteria,
    lane: t.lane,
    status: t.status,
    owner: t.owner,
    priority: t.priority,
    complexity: t.complexity,
    risk_tags: arr(t.risk_tags),
    task_type: t.task_type ?? null,
    // Durable §6 governance + park state — serialized so a founder approval / snooze / skip
    // survives a fresh-checkout DB rebuild (previously carried as note substrings). seed restores
    // them (upsertTask), keeping render↔seed a fixed point.
    approved_at: t.approved_at ?? null,
    snoozed_until: t.snoozed_until ?? null,
    skipped_at: t.skipped_at ?? null,
    skip_reason: t.skip_reason ?? null,
    resources: arr(t.resources),
    depends_on: arr(t.depends_on),
    spec: t.spec ?? null,
    contracts: arr(t.contracts),
    pr: t.pr ?? null,
    note: t.note ?? null,
    // NOTE: reap_count is deliberately NOT serialized — it is runtime liveness state (like the
    // lease columns), not durable board data. Serializing it broke the render↔seed fixed point
    // (seed doesn't restore it → 0), which failed `validate` in CI and wedged every merge.
    created_at: t.created_at,
    updated_at: t.updated_at,
  };
}

/** Build the canonical board.json object from the DB. Carries founder-facing meta verbatim. */
export function buildBoardJson(db, meta = {}) {
  return {
    $generated: 'GENERATED from the AIOS state DB. Do not hand-edit — run: node tools/aios/cli.mjs render',
    schema_version: 2,
    pis: listPIs(db),
    sprints: listSprints(db),
    tasks: listTasks(db).map(projectTask), // listTasks is ordered by priority, id → deterministic
    milestones: meta.milestones ?? [],
    founder_actions: meta.founder_actions ?? [],
  };
}

const STATUS_GROUPS = [...ACTIVE, 'blocked', 'done'];
const STATUS_LABEL = {
  proposed: 'Proposed', spec: 'Spec', designing: 'Designing', 'ready-for-impl': 'Ready for impl',
  'in-progress': 'In progress', 'in-review': 'In review', blocked: 'Blocked', done: 'Done',
};

/** `boardTitle` defaults to the injected `config`'s resolved DomainPlugin title, but may be
 *  overridden explicitly — used by tests to prove a non-default plugin's title actually renders.
 *  `config` is the injected AiosConfig (REQUIRED); it only matters when `boardTitle` itself is
 *  omitted. */
export function buildBoardMd(boardJson, boardTitle = undefined, config) {
  const title = boardTitle ?? config.domain.boardTitle;
  const tasks = boardJson.tasks || [];
  const sprints = boardJson.sprints || [];
  const pis = boardJson.pis || [];

  const activeSprint = sprints.find(s => s.status === 'active') || sprints[0];
  const activeSprintId = activeSprint?.id;

  const lines = [
    `# ${title}`,
    '',
    '> **GENERATED — do not hand-edit.** Canonical state: `.ai/state/board.json`.',
    '> Program Increments → Sprints → Epics → Features → User Stories.',
    '',
  ];

  if (activeSprint) {
    lines.push(`## 🏃 Active Sprint: ${activeSprint.name}`);
    if (activeSprint.goal) lines.push(`**Goal:** ${activeSprint.goal}`);
    lines.push('');
    
    const sprintStories = tasks.filter(t => t.sprint_id === activeSprint.id && t.type === 'story');
    if (sprintStories.length) {
      lines.push('| ID | Story | Status | Points | Owner | PR | Note |', '|----|-------|--------|--------|-------|----|------|');
      for (const t of sprintStories) {
        const pr = t.pr ? (String(t.pr).startsWith('http') ? `[PR](${t.pr})` : `#${t.pr}`) : '—';
        lines.push(`| ${cell(t.id)} | ${cell(t.title)} | ${cell(t.status)} | ${cell(t.complexity)} | ${cell(t.owner)} | ${pr} | ${cell(t.note)} |`);
      }
    } else {
      lines.push('*No User Stories assigned to active sprint.*');
    }
    lines.push('');
  }

  lines.push('## 📚 Backlog (Features & Epics)', '');
  const backlog = tasks.filter(t => t.type !== 'story');
  if (backlog.length) {
    lines.push('| ID | Type | Title | Status | Owner |', '|----|------|-------|--------|-------|');
    for (const t of backlog) {
      lines.push(`| ${cell(t.id)} | ${cell(t.type)} | ${cell(t.title)} | ${cell(t.status)} | ${cell(t.owner)} |`);
    }
  } else {
    lines.push('*Backlog empty.*');
  }
  lines.push('');

  if (boardJson.milestones?.length) {
    lines.push('## Milestones', '');
    for (const m of boardJson.milestones) lines.push(`- ${m}`);
    lines.push('');
  }
  if (boardJson.founder_actions?.length) {
    lines.push('## Founder actions', '');
    for (const a of boardJson.founder_actions) lines.push(`- ${a}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** Write both views to disk. Returns the paths written. `config` is the injected AiosConfig
 *  (REQUIRED) — threads through to buildBoardMd and also selects the write destinations
 *  (config.boardJson / config.boardMd). */
export function render(db, meta = {}, config) {
  const boardJson = buildBoardJson(db, meta);
  writeFileSync(config.boardJson, JSON.stringify(boardJson, null, 2) + '\n', 'utf8');
  writeFileSync(config.boardMd, buildBoardMd(boardJson, undefined, config) + '\n', 'utf8');
  return { boardJson: config.boardJson, boardMd: config.boardMd };
}
