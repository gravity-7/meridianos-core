/**
 * claude-usage — exact Claude Code token consumption from local session transcripts.
 * The mirror of antigravity-usage.mjs, so BOTH agents are metered in the same token unit.
 *
 * Source: ~/.claude/projects/<project>/*.jsonl — every assistant turn is a JSON line with
 * `message.usage` {input_tokens, output_tokens, cache_creation_input_tokens,
 * cache_read_input_tokens} and a top-level `timestamp`.
 *
 * billable = input + output + cache_creation (fresh work). cache_read is heavily discounted and
 * tracked separately — this is the exact parallel to Antigravity's fresh-input + output.
 *
 * ATTRIBUTION: by default this sums EVERY session in the project (founder-interactive + agent
 * runs). Pass `agentSessions` — a Set of session ids — to count ONLY agent-initiated sessions.
 * Claude Code names each transcript `<sessionId>.jsonl`, so the filename is the join key against
 * the run log (`.ai/runs/log.jsonl`, one record per launch). This is how the founder's policy
 * lever `agent_budget.attribution: agent_only` keeps the founder's own usage off the agent gauges.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

/** Claude Code encodes a project's transcript dir by replacing : \ / in the cwd with '-'. */
export const projectDirFor = (cwd = process.cwd()) => cwd.replace(/[:\\/]/g, '-');
export const defaultClaudeDir = (home = homedir(), cwd = process.cwd()) =>
  join(home, '.claude', 'projects', projectDirFor(cwd));

/**
 * Locate ONE run's transcript by its session id, searching every project dir under
 * ~/.claude/projects/ — an agent run happens in its own git worktree, so its transcript lands
 * under a project dir keyed on the WORKTREE cwd, not the repo root, so we can't guess the dir.
 * Returns the file path, or null if no project dir has a `<sessionId>.jsonl` (older run, a
 * non-Claude-Code harness, or a transcript that's since been pruned).
 */
export function findSessionTranscriptPath(sessionId, { home = homedir() } = {}) {
  if (!sessionId) return null;
  const projectsRoot = join(home, '.claude', 'projects');
  let dirs = [];
  try { dirs = readdirSync(projectsRoot); } catch { return null; }
  const fname = sessionId + '.jsonl';
  for (const d of dirs) {
    const p = join(projectsRoot, d, fname);
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Exact billable tokens for ONE session (see findSessionTranscriptPath for how it's located).
 * Returns null if the transcript isn't found anywhere — "unknown", never zero, so a missing
 * transcript can't be mistaken for a free run. Model-agnostic: sums every usage-bearing record
 * regardless of `message.model`, so a claude-code run pointed at a third-party provider (e.g.
 * DeepSeek via --model deepseek-chat) is counted exactly like a native-Anthropic one — the CLI
 * writes the same transcript shape no matter which model answered.
 */
export function sessionTokens(sessionId, opts) {
  const path = findSessionTranscriptPath(sessionId, opts);
  if (!path) return null;
  let billable = 0;
  for (const r of readTranscript(path)) billable += r.billable;
  return billable;
}

const H5 = 5 * 60 * 60 * 1000;
const D7 = 7 * 24 * 60 * 60 * 1000;
const emptyWindow = () => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0, billable: 0, messages: 0 });

/** Parse one transcript file → array of per-turn usage records. Never throws. */
export function readTranscript(path) {
  let text;
  try { text = readFileSync(path, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let rec; try { rec = JSON.parse(line); } catch { continue; }
    const u = rec?.message?.usage;
    if (!u) continue;
    const input = u.input_tokens || 0, output = u.output_tokens || 0;
    const cacheWrite = u.cache_creation_input_tokens || 0, cacheRead = u.cache_read_input_tokens || 0;
    out.push({
      ts: rec.timestamp ? Date.parse(rec.timestamp) : null,
      model: rec?.message?.model || 'unknown',
      input, output, cacheWrite, cacheRead,
      billable: input + output + cacheWrite,
    });
  }
  return out;
}

/**
 * @param {object}        [o]
 * @param {string}        [o.dir]           project transcript dir
 * @param {number}        [o.now]           epoch ms (injectable)
 * @param {Set<string>}   [o.agentSessions] when given, count ONLY transcripts whose session id
 *                                          (the `<sessionId>.jsonl` filename) is in this set —
 *                                          i.e. attribution: agent_only. Omit ⇒ count every session.
 * @param {boolean}       [o.splitFounder]  with `agentSessions`, don't SKIP the founder's own
 *                                          sessions — accumulate them into a separate `founder`
 *                                          window set (same shape) in the same pass. Without
 *                                          `agentSessions` there is nothing to split; founder=null.
 * @param {number|null}   [o.weekStartMs]   epoch ms of the current PLAN week boundary. When set,
 *                                          `last7d` counts usage since that instant (mirrors the
 *                                          plan's fixed weekly window) instead of the trailing 7d.
 * @param {boolean}       [o.session5h]     mirror the plan's 5h sessions: the first stamped record
 *                                          starts a window that expires 5h later; the next record
 *                                          after expiry starts the next one. `last5h` then counts
 *                                          only the CURRENT session (zero if it has expired) and
 *                                          `fiveHourSession` reports { start, resetAt }. Session
 *                                          boundaries come from every record this call READ — pass
 *                                          splitFounder so founder activity anchors them too, as it
 *                                          does on the real account. false ⇒ rolling trailing 5h.
 */
export function claudeUsage({ dir = defaultClaudeDir(), now = Date.now(), agentSessions = null, splitFounder = false, weekStartMs = null, session5h = false } = {}) {
  const last5h = emptyWindow(), last7d = emptyWindow(), total = emptyWindow();
  const founder = splitFounder && agentSessions ? { last5h: emptyWindow(), last7d: emptyWindow(), total: emptyWindow() } : null;
  let noTimestamp = 0, fiveHourSession = null;
  const add = (w, r) => { w.input += r.input; w.output += r.output; w.cacheWrite += r.cacheWrite; w.cacheRead += r.cacheRead; w.billable += r.billable; w.messages++; };
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { return { last5h, last7d, total, noTimestamp, founder, fiveHourSession }; }

  const all = [];
  for (const f of files) {
    const isAgent = !agentSessions || agentSessions.has(f.replace(/\.jsonl$/, ''));
    if (!isAgent && !founder) continue; // agent_only without split: skip the founder's own interactive sessions
    for (const r of readTranscript(join(dir, f))) all.push({ r, isAgent });
  }

  // Window starts. 5h: rolling trailing-5h, or the current activity-anchored session; a record
  // counts when ts >= start (ts <= now is always required). start=Infinity ⇒ window is empty.
  let start5h = now - H5;
  if (session5h) {
    const stamped = all.filter((x) => x.r.ts != null && x.r.ts <= now).sort((a, b) => a.r.ts - b.r.ts);
    let ws = null;
    for (const x of stamped) if (ws == null || x.r.ts >= ws + H5) ws = x.r.ts;
    const active = ws != null && now < ws + H5;
    start5h = active ? ws : Infinity;
    fiveHourSession = { start: active ? ws : null, resetAt: active ? ws + H5 : null };
  }
  const startWeek = weekStartMs ?? (now - D7);

  for (const { r, isAgent } of all) {
    const w = isAgent ? { last5h, last7d, total } : founder;
    add(w.total, r);
    if (r.ts == null) { noTimestamp++; continue; }
    if (r.ts > now) continue;
    if (r.ts >= start5h) add(w.last5h, r);
    if (r.ts >= startWeek) add(w.last7d, r);
  }
  return { last5h, last7d, total, noTimestamp, founder, fiveHourSession };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const u = claudeUsage();
  const f = (n) => n.toLocaleString('en-US');
  console.log('Claude token consumption (from ~/.claude transcripts):');
  console.log(`  last 5h:  ${f(u.last5h.billable)} billable  (in ${f(u.last5h.input)} + out ${f(u.last5h.output)} + cacheW ${f(u.last5h.cacheWrite)}; cacheR ${f(u.last5h.cacheRead)}; ${u.last5h.messages} msgs)`);
  console.log(`  last 7d:  ${f(u.last7d.billable)} billable  (${u.last7d.messages} msgs)`);
}
