/**
 * opencode-usage — extract EXACT token counts for OpenCode runs from its own local session
 * store, so they can be counted against the compute budget the same way Claude/Antigravity usage
 * already is (see claude-usage.mjs / antigravity-usage.mjs — this is their third sibling).
 *
 * Source: verified empirically against the installed opencode 1.17.15 CLI — it keeps a SQLite DB
 * at `<data dir>/opencode/opencode.db` (XDG_DATA_HOME, falling back to `~/.local/share` — opencode
 * uses XDG-style paths on every OS, Windows included). Table `session` has ONE row per opencode
 * session with token totals already aggregated by opencode itself:
 *   tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write
 * plus `directory` (the cwd opencode was spawned in) and `model` (a JSON blob
 * `{"id":...,"providerID":...,"variant":...}`).
 *
 * JOIN KEY: harness-adapters.mjs's opencode adapter passes no --session flag (a fresh run per
 * task is fine per constitution §9), so there's no session id to match on. Instead we match on
 * `directory` — the run's isolated git worktree path, unique per run (worktree.mjs mints a
 * fresh dir per branch), so this scopes the read to THIS run's session, never "latest globally".
 * opencode records `directory` with forward slashes even on Windows, so the match normalizes
 * both sides before comparing.
 *
 * billable = fresh input (tokens_input + tokens_cache_write) + output (tokens_output +
 * tokens_reasoning) — cache_read is excluded, the same "fresh work" convention claude-usage.mjs
 * and antigravity-usage.mjs both use.
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

export function defaultOpencodeDbPath(home = homedir()) {
  const dataHome = process.env.XDG_DATA_HOME || join(home, '.local', 'share');
  return join(dataHome, 'opencode', 'opencode.db');
}

const normalizeDir = (d) => String(d ?? '').replace(/\\/g, '/').replace(/\/+$/, '');

/** Parse opencode's `model` column (`{"id":...,"providerID":...,"variant":...}`) — fails soft. */
function parseModelField(raw) {
  if (!raw) return { id: null, providerID: null };
  try {
    const m = JSON.parse(raw);
    return { id: m?.id ?? null, providerID: m?.providerID ?? null };
  } catch {
    return { id: null, providerID: null };
  }
}

/**
 * Usage for one run, matched by its worktree directory. Sums every session row that matches
 * (normally exactly one — a fresh worktree per run — but summed defensively in case opencode
 * ever splits a run into more than one session row for the same directory).
 *
 * Returns null when the DB doesn't exist yet or no session matches this directory — "unknown",
 * never zero, so a run opencode hasn't reported on yet isn't mistaken for a free one.
 */
export function opencodeUsageForDirectory(directory, { dbPath = defaultOpencodeDbPath() } = {}) {
  if (!directory || !existsSync(dbPath)) return null;
  let db;
  try { db = new DatabaseSync(dbPath, { readOnly: true }); } catch { return null; }
  let rows;
  try {
    rows = db.prepare(
      'SELECT tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, model FROM session WHERE replace(directory, \'\\\', \'/\') = ?'
    ).all(normalizeDir(directory));
  } catch { rows = null; }
  try { db.close(); } catch { /* best-effort */ }
  if (!rows || !rows.length) return null;

  let input = 0, output = 0, cacheRead = 0, model = null, providerID = null;
  for (const r of rows) {
    input += (r.tokens_input || 0) + (r.tokens_cache_write || 0);
    output += (r.tokens_output || 0) + (r.tokens_reasoning || 0);
    cacheRead += r.tokens_cache_read || 0;
    const m = parseModelField(r.model);
    if (m.id) { model = m.id; providerID = m.providerID; }
  }
  return { input, output, cacheRead, billable: input + output, model, providerID };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2];
  if (!dir) { console.log('usage: node opencode-usage.mjs <worktree-directory>'); process.exit(1); }
  console.log(JSON.stringify(opencodeUsageForDirectory(dir), null, 2));
}
