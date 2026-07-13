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
