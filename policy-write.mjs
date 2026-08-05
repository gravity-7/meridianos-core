/**
 * policy-write — surgical writer for .ai/policy.yaml. The dashboard's Save calls this so the
 * founder can drive the levers from the UI; it is still the FOUNDER writing (the agent never
 * writes policy on its own). It UPDATES an existing scalar in place — preserving indentation,
 * trailing comments, and every other line byte-for-byte — and refuses to touch a path that
 * doesn't already exist (so it can never silently reshape the file). Zero-dependency; reuses
 * the same comment/colon scanners as the reader so writer and reader agree on the subset.
 *
 * Concurrency (T195/Phase 10 edge case: "concurrent config changes"): `writePolicy` does a
 * read-modify-write over a plain file, which is a classic lost-update race if two OS processes
 * (e.g. two concurrent dashboard requests, or a project's own daemon writing alongside the
 * dashboard) call it on the same policy.yaml at the same time — both read the same original
 * text, and whichever writes last silently discards the other's update. `writePolicy` now
 * guards the read-modify-write with a short-lived exclusive lock file (`<path>.lock`, created
 * with `wx` so a concurrent acquirer sees EEXIST and retries) so concurrent writers serialize
 * instead of clobbering each other.
 *
 * Backups (008 — End-User Configurability, US1/FR-003): every write snapshots the PRE-write
 * content to a sibling `<basename>.backup.<timestamp>.yaml` file before touching the live file —
 * the same naming convention `provider-wizard.mjs`'s own `writePolicyWithBackup` already uses for
 * its separate write path, so both are listable/restorable by the same `policy-backups.mjs`
 * helper. Timestamp collisions (two writes inside the same millisecond) are resolved by probing
 * for an unused suffix rather than silently overwriting an earlier backup.
 *
 * Insertion (008 — T010): `setPolicyValue` used to throw when `path` didn't already exist on
 * disk — every LEVER_PATHS entry required a pre-seeded line, which broke on any policy.yaml that
 * predates a newly-added lever (e.g. `active_profile`, `gateway.port`). It now inserts a missing
 * path instead of throwing: if the deepest existing ancestor mapping is found, the remaining
 * levels are added as its children (2-space indent per level, matching this file's own
 * convention); if no ancestor exists at all, a brand-new top-level block is appended at EOF.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { stripComment, colonIndex } from './yaml-lite.mjs';

/** Synchronously acquire an exclusive lock file, retrying until `timeoutMs` elapses. Uses
 *  `Atomics.wait` for the retry backoff so the wait is a real (if short) sleep rather than a
 *  hot spin loop — safe here because `writePolicy` is already a synchronous, fast operation. */
function acquireLock(lockPath, { timeoutMs = 2000, retryMs = 10 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const sleepBuf = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    try {
      closeSync(openSync(lockPath, 'wx'));
      return;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      if (Date.now() >= deadline) {
        throw new Error(`writePolicy: timed out waiting for lock ${lockPath} (another writer may have crashed while holding it)`);
      }
      Atomics.wait(sleepBuf, 0, 0, retryMs);
    }
  }
}

function releaseLock(lockPath) {
  try { unlinkSync(lockPath); } catch { /* best-effort — lock is advisory */ }
}

/** Snapshot `path`'s current content to `<basename>.backup.<timestamp>.yaml` before it's
 *  overwritten. Probes for an unused suffix so two writes in the same millisecond never collide
 *  into one backup silently replacing the other. Returns the backup path, or null if `path`
 *  doesn't exist yet (nothing to back up on a first-ever write). */
function backupBeforeWrite(path) {
  if (!existsSync(path)) return null;
  const dot = path.lastIndexOf('.');
  const base = dot > 0 ? path.slice(0, dot) : path;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  let backupPath = `${base}.backup.${timestamp}.yaml`;
  let suffix = 1;
  while (existsSync(backupPath)) {
    backupPath = `${base}.backup.${timestamp}-${suffix}.yaml`;
    suffix++;
  }
  copyFileSync(path, backupPath);
  return backupPath;
}

/** The exact scalar paths the founder's dashboard is allowed to write. The server whitelists
 *  against this (defence in depth over setPolicyValue's own path check), and the round-trip
 *  test asserts .ai/policy.yaml actually exposes every one. */
export const LEVER_PATHS = [
  'kill_switch',
  'agent_budget.warn_pct', 'agent_budget.per_task_tokens', 'agent_budget.auto_downgrade_at_warn', 'agent_budget.attribution',
  'agent_budget.five_hour_sessions',
  'agent_budget.claude.week_anchor', 'agent_budget.claude.per_5h_tokens', 'agent_budget.claude.per_week_tokens',
  'agent_budget.antigravity.per_5h_tokens', 'agent_budget.antigravity.per_week_tokens',
  'agent_models.claude.default', 'agent_models.claude.routine', 'agent_models.antigravity.default',
  'work.max_parallel', 'work.wip_per_agent', 'work.priority_floor', 'work.lease_ttl_min', 'work.max_runs_per_5h',
  'schedule.cadence', 'quiet_hours.enabled', 'quiet_hours.from', 'quiet_hours.to',
  'sensitive_actions.deploy', 'sensitive_actions.external_send', 'sensitive_actions.spend_money', 'sensitive_actions.schema_change',
  // escalation.webhook_url is intentionally NOT writable from the dashboard — it is a secret,
  // resolved at runtime from env / .ai/secrets (see escalation-push.resolveWebhookUrl). Keeping it
  // out of LEVER_PATHS stops a Save from ever serializing the secret back into the tracked file.
  'auto_merge', 'escalation.channel',
  'work_stealing',
  'model_routing.claude.simple', 'model_routing.claude.medium', 'model_routing.claude.medium_high',
  'model_routing.claude.complex', 'model_routing.claude.critical',
  'model_routing.antigravity.simple', 'model_routing.antigravity.medium', 'model_routing.antigravity.medium_high',
  'model_routing.antigravity.complex', 'model_routing.antigravity.critical',
  // active_profile (008 — End-User Configurability, US2): which named `profiles.<name>` entry is
  // currently active (see profiles.mjs's resolveActivePolicy). `setPolicyValue` now inserts this
  // if missing from an older policy.yaml (see T010 note above) rather than throwing.
  'active_profile',
  // gateway.port (008 — T010): the only genuinely real, currently-unwritable Gateway field found
  // by auditing actual runtime reads against the original "General/Gateway/Integrations/Prompts"
  // task wording — policy-validate.mjs validates it and scheduler.mjs/dashboard/server.mjs read it
  // (with an AIOS_GATEWAY_PORT env override and an 8787 fallback), so it's a live, meaningful lever.
  // "Logging toggle" and "enforcement mode" (also named in the original task text) were NOT added:
  // neither corresponds to any field actually read anywhere in this codebase — adding a lever for
  // them would be a dead UI control with no backing behavior. "Prompts" fields live in tenant.yaml
  // (multi-line `|` block scalars: prompts.implRules/reviewCriteria), not policy.yaml, and need a
  // block-scalar-aware writer this module doesn't implement — tracked as a genuine follow-up gap,
  // not silently faked here.
  'gateway.port',
];

/** Render a JS value as a policy scalar: bare when safe, double-quoted otherwise. */
export function serializeScalar(v) {
  if (v === true) return 'true';
  if (v === false) return 'false';
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return String(v);
  const s = String(v);
  return /^[A-Za-z0-9_.\-]+$/.test(s) ? s : JSON.stringify(s);
}

/** Return the trailing `# comment` of a line (with leading whitespace), or '' if none. */
function trailingComment(line) {
  const kept = stripComment(line);
  return line.slice(kept.length);
}

/**
 * Set the scalar at `path` (array or dotted string) to `value`, returning the new text.
 * Updates an existing scalar leaf in place. If the path doesn't exist yet, inserts it instead of
 * throwing: the deepest existing ancestor mapping (a prefix of `path`) gets the remaining levels
 * added as its children; if no ancestor exists at all, a new top-level block is appended at EOF.
 * Every inserted level uses a 2-space indent, matching this repo's policy.yaml convention.
 */
export function setPolicyValue(text, path, value) {
  const parts = Array.isArray(path) ? path : String(path).split('.');
  const lines = text.split(/\r?\n/);
  const stack = []; // { indent, key } for each open mapping
  let targetIdx = -1;

  // For each prefix length of `parts`, track where that ancestor mapping's header line is (-1 if
  // never seen) and the line index right after the last line seen anywhere in its body — the
  // insertion point for a new child once we know the deepest ancestor that actually exists.
  const ancestorHeaderIdx = new Array(parts.length).fill(-1);
  const ancestorBodyEnd = new Array(parts.length).fill(-1);

  for (let i = 0; i < lines.length; i++) {
    const noComment = stripComment(lines[i]);
    if (noComment.trim() === '') continue;
    const indent = noComment.length - noComment.trimStart().length;
    const trimmed = noComment.trim();
    const colon = colonIndex(trimmed);
    if (colon < 0) continue;

    while (stack.length && indent <= stack[stack.length - 1].indent) stack.pop();
    const key = trimmed.slice(0, colon).trim();
    const rest = trimmed.slice(colon + 1).trim();
    const curPath = [...stack.map((s) => s.key), key];

    for (let depth = 1; depth < parts.length; depth++) {
      if (curPath.length >= depth && curPath.slice(0, depth).every((p, idx) => p === parts[idx])) {
        ancestorBodyEnd[depth - 1] = i + 1;
        if (curPath.length === depth) ancestorHeaderIdx[depth - 1] = i;
      }
    }

    if (rest === '') {
      stack.push({ indent, key }); // an open mapping — descend
    } else if (curPath.length === parts.length && curPath.every((p, idx) => p === parts[idx])) {
      targetIdx = i;
      break;
    }
  }

  if (targetIdx >= 0) {
    const raw = lines[targetIdx];
    const lead = raw.slice(0, raw.length - raw.trimStart().length);
    const comment = trailingComment(raw);
    lines[targetIdx] = `${lead}${parts[parts.length - 1]}: ${serializeScalar(value)}${comment ? `  ${comment.trim()}` : ''}`;
    return lines.join('\n');
  }

  // Path not found — insert. Find the deepest existing ancestor mapping among parts[0..N-2].
  let insertAt = -1;
  let fromDepth = 0;
  for (let depth = parts.length - 1; depth >= 1; depth--) {
    if (ancestorHeaderIdx[depth - 1] >= 0) {
      insertAt = ancestorBodyEnd[depth - 1];
      fromDepth = depth;
      break;
    }
  }

  const newLines = [];
  if (insertAt === -1) {
    // No ancestor exists at all — append a brand-new top-level block at EOF.
    insertAt = lines.length;
    if (insertAt > 0 && lines[insertAt - 1] === '') insertAt--; // insert before a trailing blank line
  }
  for (let depth = fromDepth; depth < parts.length - 1; depth++) {
    newLines.push(`${'  '.repeat(depth)}${parts[depth]}:`);
  }
  newLines.push(`${'  '.repeat(parts.length - 1)}${parts[parts.length - 1]}: ${serializeScalar(value)}`);

  lines.splice(insertAt, 0, ...newLines);
  return lines.join('\n');
}

/** Apply `{ 'dotted.path': value, ... }` to policy.yaml on disk. Returns the written text.
 *  `config` is the injected AiosConfig (REQUIRED); it only matters when `path` itself is
 *  omitted. */
export function writePolicy(updates, { path = undefined, config } = {}) {
  path = path ?? config.policyPath;
  const lockPath = `${path}.lock`;
  acquireLock(lockPath);
  try {
    backupBeforeWrite(path);
    let text = readFileSync(path, 'utf8');
    for (const [p, v] of Object.entries(updates)) text = setPolicyValue(text, p, v);
    writeFileSync(path, text);
    return text;
  } finally {
    releaseLock(lockPath);
  }
}
