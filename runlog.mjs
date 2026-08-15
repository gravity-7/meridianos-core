/**
 * runlog — the append-only ledger of every agent run, at `.ai/runs/log.jsonl` (one JSON record
 * per line). This is what gives the founder the visibility the old scheduled routine had, but
 * structured: "when it ran / when it skipped / what it did", each with a reason. The dashboard
 * reads it; the runner appends to it. Local runtime state (gitignored), never hand-edited.
 *
 * Record: { run_id, ts, agent, model, provider, harness, task, tokens, usage, outcome, reason,
 *   reset_at, note }
 *   outcome ∈ ok | noop | skipped | failed | blocked
 *   provider/harness (1.4) are additive — older log lines simply lack them; readers must treat
 *   their absence as "unknown", never as "native anthropic/claude-code".
 *   usage (1.6) is additive — { inputTokens, outputTokens, totalTokens, provider, model } from
 *   usage-readers.mjs, or null when genuinely unknown. `tokens` (legacy, = usage.totalTokens when
 *   present) is kept so every older reader (dashboard, budget.mjs) keeps working unchanged.
 *   reason  ∈ ok | quota | timeout | signal | spawn_error | nonzero | no_transition | lost_claim
 *             — the TYPED exit class (exit-classify.mjs). Scheduling keys on this, never the note.
 *   reset_at — wall-clock a quota window reopens (when reason='quota' and the provider printed it).
 */
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

/** Unique-ish id: base36 time + 4 random chars. Callers may pass their own for determinism. */
export function newRunId(now = Date.now()) {
  return `${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Append one run record (filling run_id + ts if absent). Creates the dir. Returns the record.
 *  `config` is the injected AiosConfig (REQUIRED); it only matters when `path` itself is
 *  omitted. */
export function appendRun(rec, { path = undefined, now = Date.now(), config } = {}) {
  path = path ?? config.runsPath;
  const full = {
    run_id: rec.run_id ?? newRunId(now),
    ts: rec.ts ?? new Date(now).toISOString(),
    agent: rec.agent ?? null,
    model: rec.model ?? null,
    provider: rec.provider ?? null,
    harness: rec.harness ?? null,
    session: rec.session ?? null,
    task: rec.task ?? null,
    tokens: rec.tokens ?? null,
    usage: rec.usage ?? null,
    outcome: rec.outcome ?? 'noop',
    reason: rec.reason ?? null,
    reset_at: rec.reset_at ?? null,
    note: rec.note ?? '',
  };
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(full)}\n`);
  return full;
}

/** Read the log newest-first, at most `limit` records. Missing file → []; bad lines skipped.
 *  `config` is the injected AiosConfig (REQUIRED); it only matters when `path` itself is
 *  omitted. */
export function readRuns({ path = undefined, limit = 50, config } = {}) {
  path = path ?? config.runsPath;
  if (!existsSync(path)) return [];
  const recs = [];
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { recs.push(JSON.parse(line)); } catch { /* tolerate a torn/partial line */ }
  }
  recs.reverse();
  return limit ? recs.slice(0, limit) : recs;
}

export class RunCursorError extends Error {
  constructor(code, message) { super(message); this.name = 'RunCursorError'; this.code = code; this.httpStatus = 400; }
}

const fingerprint = (value) => createHash('sha256').update(JSON.stringify(value)).digest('base64url').slice(0, 20);
const encodeCursor = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
function decodeCursor(value) {
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    if (parsed?.v !== 1 || !Number.isInteger(parsed.n) || !Number.isInteger(parsed.o) || typeof parsed.f !== 'string') throw new Error('shape');
    return parsed;
  } catch { throw new RunCursorError('INVALID_CURSOR', 'cursor is malformed or unsupported'); }
}

function safeRun(run) {
  const allowed = ['run_id','ts','agent','model','provider','harness','session','task','tokens','usage','outcome','reason','reset_at','note'];
  return Object.fromEntries(allowed.filter((key) => Object.hasOwn(run, key)).map((key) => [key, run[key]]));
}

function filterRuns(records, scope = {}, filters = {}) {
  return records.filter((run) => {
    if (scope.from && (!run.ts || run.ts < scope.from)) return false;
    if (scope.to && (!run.ts || run.ts >= scope.to)) return false;
    if (scope.projectId && !(String(run.task || '').startsWith(`${scope.projectId}/`) || run.project_id === scope.projectId)) return false;
    if (scope.provider && run.provider !== scope.provider) return false;
    if (filters.state && run.outcome !== filters.state) return false;
    if (filters.task && run.task !== filters.task) return false;
    if (filters.runId && run.run_id !== filters.runId) return false;
    return true;
  });
}

export function queryRuns({ path = undefined, config, scope = {}, filters = {}, cursor = null, limit = 50 } = {}) {
  path = path ?? config?.runsPath;
  const all = readRuns({ path, limit: 0, config });
  const key = fingerprint({ tenantId: scope.tenantId ?? null, projectId: scope.projectId ?? null, provider: scope.provider ?? null, filters });
  const decoded = cursor ? decodeCursor(cursor) : { v: 1, n: all.length, o: 0, f: key };
  if (decoded.f !== key) throw new RunCursorError('INVALID_CURSOR', 'cursor does not match the authorized filters');
  if (decoded.n > all.length) throw new RunCursorError('EXPIRED_CURSOR', 'run snapshot is no longer retained; restart pagination');
  const snapshotRuns = all.slice(all.length - decoded.n);
  const visible = filterRuns(snapshotRuns, scope, filters);
  const pageLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const items = visible.slice(decoded.o, decoded.o + pageLimit).map(safeRun);
  const nextOffset = decoded.o + items.length;
  const nextCursor = nextOffset < visible.length ? encodeCursor({ v: 1, n: decoded.n, o: nextOffset, f: key }) : null;
  return { items, nextCursor, snapshot: encodeCursor({ v: 1, n: decoded.n, o: 0, f: key }), limit: pageLimit };
}

export function queryRunEvidence({ path = undefined, config, runId, scope = {}, cursor = null, limit = 50 } = {}) {
  if (!runId) throw new RunCursorError('INVALID_CURSOR', 'runId is required');
  const page = queryRuns({ path, config, scope, filters: { runId }, cursor, limit });
  return { ...page, items: [...page.items].reverse() };
}
