/**
 * validate — the CI gate for the state core. Two jobs:
 *   1. Invariants: every task has a legal status, integer priority, complexity in 1..5, and
 *      depends_on that reference real tasks.
 *   2. Drift: re-seed a throwaway DB from the committed board.json, re-render, and require a
 *      byte-for-byte match with the committed board.json + board.md. A hand-edited or stale
 *      board therefore FAILS CI — enforcing "state is data, prose is a view".
 *
 * Exit 0 = clean, 1 = violations.
 */
import { readFileSync } from 'node:fs';
import { openDb } from './db.mjs';
import { seedTasks } from './state.mjs';
import { STATES } from './machine.mjs';
import { buildBoardJson, buildBoardMd } from './render.mjs';

/** Pure invariant checks over a parsed board.json object. Returns an array of problem strings.
 *  `knownRiskTags` defaults to the resolved DomainPlugin's taxonomy (PV unless a tenant overrode
 *  it) but may be injected — used by tests to prove a non-default plugin's taxonomy actually
 *  drives the check. `config` is the injected AiosConfig (REQUIRED); it only matters when
 *  `knownRiskTags` itself is omitted. Read live (not a module-level const) so it stays in sync
 *  with the plugin. */
export function checkInvariants(boardJson, knownRiskTags = undefined, config) {
  const tags = knownRiskTags ?? config.domain.knownRiskTags;
  const KNOWN_RISK = new Set(tags);
  const problems = [];
  const tasks = boardJson?.tasks ?? [];
  const ids = new Set();
  for (const t of tasks) {
    if (!t.id) { problems.push('a task has no id'); continue; }
    if (ids.has(t.id)) problems.push(`duplicate task id: ${t.id}`);
    ids.add(t.id);
    if (!STATES.includes(t.status)) problems.push(`${t.id}: invalid status '${t.status}'`);
    if (!Number.isInteger(t.priority)) problems.push(`${t.id}: priority must be an integer (got ${t.priority})`);
    if (t.complexity != null && (t.complexity < 1 || t.complexity > 5)) problems.push(`${t.id}: complexity ${t.complexity} out of 1..5`);
    for (const r of t.risk_tags ?? []) if (!KNOWN_RISK.has(r)) problems.push(`${t.id}: unknown risk_tag '${r}'`);
  }
  for (const t of tasks) {
    for (const d of t.depends_on ?? []) if (!ids.has(d)) problems.push(`${t.id}: depends_on references unknown task '${d}'`);
  }
  return problems;
}

export function validate({ drift = true, config } = {}) {
  let boardJson;
  try {
    boardJson = JSON.parse(readFileSync(config.boardJson, 'utf8'));
  } catch (e) {
    return { ok: false, problems: [`cannot read/parse ${config.boardJson}: ${e.message}`] };
  }

  const problems = checkInvariants(boardJson, undefined, config);

  if (drift && problems.length === 0) {
    const db = openDb(':memory:', config);
    seedTasks(db, boardJson);
    const meta = { milestones: boardJson.milestones, founder_actions: boardJson.founder_actions };
    const expectJson = JSON.stringify(buildBoardJson(db, meta), null, 2) + '\n';
    const expectMd = buildBoardMd(buildBoardJson(db, meta), undefined, config) + '\n';
    db.close();

    if (readFileSync(config.boardJson, 'utf8') !== expectJson) {
      problems.push('board.json drift — committed file ≠ render(state). Fix: node tools/aios/cli.mjs render');
    }
    if (readFileSync(config.boardMd, 'utf8') !== expectMd) {
      problems.push('board.md drift — committed file ≠ render(state). Fix: node tools/aios/cli.mjs render');
    }
  }

  return { ok: problems.length === 0, problems };
}
