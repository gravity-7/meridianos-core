/**
 * definition-of-ready — the DoR gate (see .ai/scrum.md). A user story may only enter the sprint
 * pipeline (proposed → spec) once it is well-formed: a real user-story statement plus enough
 * testable acceptance criteria for an agent to implement it unambiguously. This is what stops the
 * thin one-liner stories ("- Visual quota tracker in UI") from being auto-promoted and worked half-
 * understood. Pure — inspects a task row and returns a verdict.
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
 * Evaluate a story against the Definition of Ready. Returns { ready, reasons[] }.
 * Non-story tasks (epics/features) are containers — they are always "ready" (not gated here).
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
