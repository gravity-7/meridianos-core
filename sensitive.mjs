/**
 * sensitive — the governance hard-stop layer. The constitution (§6) and policy.yaml's
 * `sensitive_actions` block say the autonomous system must STOP and ask the founder before
 * spending money, sending anything external, deploying, or changing the schema. This module is
 * the runtime enforcement of that: it maps a task's risk_tags to those sensitive actions and
 * answers "may this be worked autonomously, or must a human decide first?".
 *
 * Risk tags live on the task AND are inherited from ancestor epics/features (a child story of a
 * `payments` epic is itself money-spending even if its own risk_tags are empty) — so we always
 * evaluate the EFFECTIVE tags (own + every ancestor via parent_id / id-prefix).
 *
 * Pure over an injected db (only reads). The router denies claims for blocked tasks; the planner
 * parks them as `blocked` (which auto-escalates to the founder via the watchdog feed).
 */

// taskWithAncestors / effectiveRiskTags moved to state.mjs (D2 bite #2, stage 2a — promoted
// read-queries; see state-store.mjs's DB_BOUND_FNS). Re-exported here by name so existing
// importers (`import { effectiveRiskTags } from './sensitive.mjs'`) keep working unchanged.
export { taskWithAncestors, effectiveRiskTags } from './state.mjs';

/** The default disposition when a sensitive action isn't named in policy — fail safe (stop). */
const DEFAULT_DISPOSITION = 'block_and_ask';

/**
 * The founder's §6 disposition (approval, snooze, skip) lives in DEDICATED task columns
 * (approved_at / snoozed_until / skipped_at / skip_reason), NOT as substrings in the free-text
 * `note`. That is the whole point of this design: a later transition that rewrites `note` — e.g.
 * a verify bounce writing "verification failed…" — must never clobber a founder approval or a
 * park (the live minio re-block bug). These readers therefore consult the columns only; the note
 * is left entirely for its own block/verify free-text. Writes go through state.setGovernanceFlags.
 */

/** Has the founder explicitly approved this task past a §6 hold? */
export function isFounderApproved(task) {
  return task?.approved_at != null;
}

/** ISO date string this task is snoozed until, or null if not snoozed. */
export function snoozedUntil(task) {
  return task?.snoozed_until ?? null;
}

/** Has the founder skipped (parked) this task past a §6 hold? */
export function isSkipped(task) {
  return task?.skipped_at != null;
}

/**
 * LEGACY note-marker parser — used ONLY by the one-time db.migrate() backfill that lifts a
 * pre-columns DB's `[founder-snoozed:…]` / `[founder-skipped(:reason)]` / 'founder-approved'
 * note markers into the new columns. Not part of the live read/write path. Returns
 * { approved, snoozedUntil, skipped, skipReason } derived from an old note string.
 */
const SNOOZE_RE = /\[founder-snoozed:([^\]]+)\]/i;
const SKIP_RE = /\[founder-skipped(?::([^\]]*))?\]/i;
const APPROVAL_RE = /founder-approved/i;

export function parseNoteMarkers(note) {
  const s = typeof note === 'string' ? note : '';
  const snooze = s.match(SNOOZE_RE);
  const skip = s.match(SKIP_RE);
  const until = snooze && !Number.isNaN(Date.parse(snooze[1])) ? snooze[1] : null;
  return {
    approved: APPROVAL_RE.test(s),
    snoozedUntil: until,
    skipped: !!skip,
    skipReason: skip && skip[1] ? skip[1] : null,
  };
}

/**
 * Given the policy and a set of (effective) risk tags, return the first sensitive action that is
 * set to `block_and_ask` (i.e. a governance hard-stop), or null if none apply. `notify_only` and
 * `allow` dispositions do NOT block — they let the work proceed (the notification is separate).
 * `riskToAction` defaults to the resolved DomainPlugin's map (PV unless a tenant overrode it) but
 * may be injected — used by tests to prove a non-default plugin's map actually drives blocking.
 * `config` is the injected AiosConfig (REQUIRED); it only matters when `riskToAction` itself is
 * omitted.
 */
export function sensitiveBlock(policy, tags, riskToAction = undefined, config) {
  const map = riskToAction ?? config.domain.riskToAction;
  const actions = policy?.sensitive_actions ?? {};
  for (const tag of tags) {
    const action = map[tag];
    if (!action) continue;
    const disposition = actions[action] ?? DEFAULT_DISPOSITION;
    if (disposition === 'block_and_ask') return action;
  }
  return null;
}

/**
 * ALL sensitive actions that currently block these tags (deduped), in a stable order. Used to write
 * an ACCURATE governance-hold note: a task under epic F2 inherits both `external` and `payments`, so
 * relaxing `external_send` alone leaves it parked on `spend_money`. The note must name what is
 * ACTUALLY blocking it right now (postmortem #7), not just the first action found at block time.
 * `config` is the injected AiosConfig (REQUIRED); it only matters when `riskToAction` itself is
 * omitted.
 */
export function sensitiveBlocks(policy, tags, riskToAction = undefined, config) {
  const map = riskToAction ?? config.domain.riskToAction;
  const actions = policy?.sensitive_actions ?? {};
  const out = [];
  for (const tag of tags) {
    const action = map[tag];
    if (!action || out.includes(action)) continue;
    const disposition = actions[action] ?? DEFAULT_DISPOSITION;
    if (disposition === 'block_and_ask') out.push(action);
  }
  return out;
}

/** Human phrasing for a governance-hold note: "spend money", "external send + spend money".
 *  `config` threads through to sensitiveBlocks' injected default. */
export function describeBlocks(policy, tags, config) {
  return sensitiveBlocks(policy, tags, undefined, config).map((a) => a.replace(/_/g, ' ')).join(' + ');
}
