/**
 * definition-of-ready — two-tier DoR gate (see .ai/scrum.md).
 *
 * Tier 1 — `meetsSpecEntry` (gates proposed → spec):
 *   Minimal bar — just a real title and an assigned owner. The spec agent is responsible
 *   for writing the full acceptance criteria, complexity, and user-story statement into the
 *   task row (via `cli.mjs update-task`) as part of its spec work.
 *
 * Tier 2 — `meetsDefinitionOfReady` (gates spec → designing):
 *   Full bar — by this point the spec agent has run, so the task must carry a real user-story
 *   statement, ≥2 testable ACs, a complexity estimate, and an owner. If it still doesn't,
 *   the planner leaves the task in `spec` with a note so the runner retries the spec agent.
 *
 * Pure — inspects a task row and returns a verdict.
 */
import { parseJsonArray } from './state.mjs';

/** Placeholder titles that are not real stories. */
const PLACEHOLDER = /^(task|tbd|todo|untitled|story|new story)\b/i;

/**
 * Does the acceptance_criteria text carry at least `min` distinct, non-trivial criteria?
 * Accepts either bullet lines ("- ...") or Given/When/Then clauses.
 */
export function countAcceptanceCriteria(ac) {
  if (!ac || typeof ac !== 'string') return 0;
  const lines = ac.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const bullets = lines.filter((l) => /^[-*]\s+\S/.test(l) && l.replace(/^[-*]\s+/, '').length >= 6);
  const gwt = lines.filter((l) => /\bgiven\b.*\bthen\b/i.test(l) || /^(given|when|then)\b/i.test(l));
  return Math.max(bullets.length, gwt.length);
}

/** Is there a proper "As a … I want … so that …" story statement (in title, note, or AC)? */
export function hasUserStoryStatement(task) {
  const hay = `${task.title || ''}\n${task.note || ''}\n${task.acceptance_criteria || ''}`;
  return /\bas an?\b[\s\S]{3,}\bi want\b/i.test(hay);
}

/**
 * Tier 1 gate: is this story ready to ENTER the spec stage?
 * Intentionally minimal — the spec agent will fill in the rest.
 * Non-story tasks (epics/features) are containers — always ready.
 */
export function meetsSpecEntry(task) {
  if (task.type && task.type !== 'story') return { ready: true, reasons: [] };
  const reasons = [];
  if (!task.title || PLACEHOLDER.test(task.title.trim()))
    reasons.push('title is a placeholder — give it a real name before the spec agent can work it');
  if (!task.owner)
    reasons.push('no owner assigned (claude | antigravity | both)');
  return { ready: reasons.length === 0, reasons };
}

/**
 * Tier 2 gate: does this story meet the full Definition of Ready?
 * Gates spec → designing. By this point the spec agent should have written
 * proper ACs and complexity back to the task via `cli.mjs update-task`.
 * Non-story tasks (epics/features) are containers — always ready.
 */
export function meetsDefinitionOfReady(task, { minCriteria = 2 } = {}) {
  if (task.type && task.type !== 'story') return { ready: true, reasons: [] };
  const reasons = [];

  if (!task.title || PLACEHOLDER.test(task.title.trim())) reasons.push('title is a placeholder, not a real story');
  if (!hasUserStoryStatement(task)) reasons.push('missing "As a <role>, I want <capability>, so that <benefit>" statement');
  const n = countAcceptanceCriteria(task.acceptance_criteria);
  if (n < minCriteria) reasons.push(`has ${n} acceptance criteria; needs at least ${minCriteria} testable ones`);
  if (task.complexity == null) reasons.push('no story points (complexity 1–5)');
  if (!task.owner) reasons.push('no owner assigned');

  return { ready: reasons.length === 0, reasons };
}

/** Convenience: only the not-ready stories from a list, with their reasons. */
export function notReadyStories(tasks) {
  return tasks
    .filter((t) => (t.type ?? 'story') === 'story')
    .map((t) => ({ id: t.id, ...meetsDefinitionOfReady(t) }))
    .filter((r) => !r.ready);
}
