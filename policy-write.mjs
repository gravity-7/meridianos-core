/**
 * policy-write — surgical writer for .ai/policy.yaml. The dashboard's Save calls this so the
 * founder can drive the levers from the UI; it is still the FOUNDER writing (the agent never
 * writes policy on its own). It UPDATES an existing scalar in place — preserving indentation,
 * trailing comments, and every other line byte-for-byte — and refuses to touch a path that
 * doesn't already exist (so it can never silently reshape the file). Zero-dependency; reuses
 * the same comment/colon scanners as the reader so writer and reader agree on the subset.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { stripComment, colonIndex } from './yaml-lite.mjs';

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
 * Only existing scalar leaves are updated; throws if the path is not found.
 */
export function setPolicyValue(text, path, value) {
  const parts = Array.isArray(path) ? path : String(path).split('.');
  const lines = text.split(/\r?\n/);
  const stack = []; // { indent, key } for each open mapping
  let targetIdx = -1;

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

    if (rest === '') {
      stack.push({ indent, key }); // an open mapping — descend
    } else if (curPath.length === parts.length && curPath.every((p, idx) => p === parts[idx])) {
      targetIdx = i;
      break;
    }
  }

  if (targetIdx < 0) throw new Error(`policy path not found: ${parts.join('.')}`);
  const raw = lines[targetIdx];
  const lead = raw.slice(0, raw.length - raw.trimStart().length);
  const comment = trailingComment(raw);
  lines[targetIdx] = `${lead}${parts[parts.length - 1]}: ${serializeScalar(value)}${comment ? `  ${comment.trim()}` : ''}`;
  return lines.join('\n');
}

/** Apply `{ 'dotted.path': value, ... }` to policy.yaml on disk. Returns the written text.
 *  `config` is the injected AiosConfig (REQUIRED); it only matters when `path` itself is
 *  omitted. */
export function writePolicy(updates, { path = undefined, config } = {}) {
  path = path ?? config.policyPath;
  let text = readFileSync(path, 'utf8');
  for (const [p, v] of Object.entries(updates)) text = setPolicyValue(text, p, v);
  writeFileSync(path, text);
  return text;
}
