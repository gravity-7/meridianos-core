/**
 * The feature state machine — the single definition of legal task transitions.
 *
 *   proposed → spec → designing → ready-for-impl → in-progress → in-review → done
 *                                                                    │
 *   any active state ─────────────────────────────────────────────→ blocked → (unblock)
 *
 * `done` is terminal. `blocked` is reachable from any active state and unblocks back into
 * an active state. Any other move is illegal and fails CI (validate) / throws at runtime.
 */
export const STATES = [
  'proposed', 'spec', 'designing', 'ready-for-impl',
  'in-progress', 'in-review', 'done', 'blocked',
];

export const ACTIVE = ['proposed', 'spec', 'designing', 'ready-for-impl', 'in-progress', 'in-review'];
export const TERMINAL = ['done'];

const TRANSITIONS = {
  proposed: ['spec', 'blocked'],
  spec: ['designing', 'blocked'],
  designing: ['ready-for-impl', 'blocked'],
  'ready-for-impl': ['in-progress', 'blocked'],
  'in-progress': ['in-review', 'blocked'],
  'in-review': ['done', 'in-progress', 'blocked'], // done, or bounce back on changes requested
  done: [],
  blocked: ['ready-for-impl', 'in-progress', 'designing', 'spec'], // unblock into an active state
};

export function legalTransitions(from) {
  return TRANSITIONS[from] || [];
}

export function isLegalTransition(from, to) {
  if (!STATES.includes(from) || !STATES.includes(to)) return false;
  if (from === to) return true; // idempotent no-op is allowed
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from, to) {
  if (!STATES.includes(from)) throw new Error(`unknown source state: ${from}`);
  if (!STATES.includes(to)) throw new Error(`unknown target state: ${to}`);
  if (!isLegalTransition(from, to)) {
    throw new Error(`illegal transition: ${from} -> ${to} (allowed: ${legalTransitions(from).join(', ') || 'none'})`);
  }
}

/**
 * Which statuses ANY roster agent is allowed to CLAIM. Agents claim spec/designing/ready-for-impl
 * to push work forward. `in-progress` is ALSO claimable so a task the verifier BOUNCED back for
 * rework (or one whose agent died and was reaped) gets picked up again — a live lease still
 * protects a task that is actively being worked, so only unleased in-progress tasks (needing
 * rework) are eligible.
 * The router's capability_matrix (policy.yaml) further filters which categories each agent may work
 * (e.g. money-math stays claude-only), and the sprint filter limits work to the active sprint.
 * This list is agent-independent (§1.4 roster genericization) — every agent in the injected
 * `config.domain.agents` roster gets the same claimable-status set; per-agent differences are
 * expressed via the capability_matrix, not here.
 */
export const CLAIMABLE_STATUSES = ['spec', 'designing', 'ready-for-impl', 'in-progress'];
