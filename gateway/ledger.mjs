/**
 * ledger — the gateway sidecar's OWN append-only token-event store. SEPARATE from the daemon's
 * board DB (db.mjs / schema.sql `events` table, event-log.mjs) — that store is per-task lifecycle
 * logging for the AIOS scheduler; this one is the per-request usage record the gateway emits on
 * every provider call (token-event.mjs), scoped for enforcement/verdict math (3.3b) and retiring
 * the harness-transcript usage-readers (3.3c). Locked decision: its own SQLite file, never mixed
 * into schema.sql.
 *
 * Mirrors db.mjs's open pattern (DatabaseSync, busy_timeout, WAL, foreign_keys, migrate-from-.sql)
 * and event-log.mjs's never-throw-into-the-caller contract for every op EXCEPT appendEvent's
 * validation, which must throw on a malformed event — that is the caller's bug, not a ledger
 * failure, and must not be swallowed into a silently-missing row.
 *
 * queryWindow mirrors budget.mjs's providerBreakdown never-fabricate rule: token/cost sums only
 * ever accumulate over rows where that column is non-null; a null column is counted via
 * unknownRuns/costUnknownRuns instead of being coerced into the sum as 0.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateTokenEvent } from './token-event.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const LEDGER_SCHEMA_PATH = join(HERE, 'ledger-schema.sql');

function defaultLedgerPath(config) {
  const root = config?.repoRoot ?? process.cwd();
  return join(root, '.ai', 'gateway', 'ledger.db');
}

/**
 * Open (creating + migrating if needed) the token-event ledger.
 * @param {string} [path]  ':memory:' for tests, else a file path. Falls back to a path derived
 *                          from `config.repoRoot` (`.ai/gateway/ledger.db`) — deliberately off the
 *                          board DB's `.ai/state/aios.db` path.
 * @param {object} [config] the injected AiosConfig; only consulted when `path` is omitted.
 */
export function openLedger(path, { config } = {}) {
  const ledgerPath = path || defaultLedgerPath(config);
  if (ledgerPath !== ':memory:') mkdirSync(dirname(ledgerPath), { recursive: true });

  const db = new DatabaseSync(ledgerPath);
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(readFileSync(LEDGER_SCHEMA_PATH, 'utf8')); // all statements are CREATE ... IF NOT EXISTS
}

/**
 * Append one token-event. Validates first (throws on the first malformed field — a caller bug,
 * never swallowed); the INSERT itself is best-effort, so a ledger write failure (e.g. disk full)
 * never throws into a caller mid-request. Returns the event's own id either way.
 */
export function appendEvent(ledger, event) {
  validateTokenEvent(event);
  try {
    ledger.prepare(
      `INSERT INTO token_events (
         id, ts, tenant, agent, session, task, run_id, request_id,
         provider, model, wire, upstream_status, latency_ms,
         input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens,
         cost_usd, enforcement_decision, cap_window, raw
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      event.id, event.ts, event.tenant, event.agent, event.session, event.task, event.runId, event.requestId,
      event.provider, event.model, event.wire, event.upstreamStatus, event.latencyMs,
      event.inputTokens, event.outputTokens, event.cacheReadTokens, event.cacheWriteTokens, event.totalTokens,
      event.costUsd, event.enforcementDecision, event.capWindow, JSON.stringify(event),
    );
  } catch { /* a ledger write failure must never crash the caller mid-request */ }
  return event.id;
}

/**
 * Aggregate usage over the half-open window [since, until) for `tenant` (optionally scoped to one
 * `agent`). Token/cost sums only accumulate over rows where that column is non-null — a null
 * column contributes to `unknownRuns`/`costUnknownRuns` instead of being fabricated as 0.
 * `since`/`until` are ISO-8601 strings, each optional (an omitted bound is unbounded on that side).
 */
export function queryWindow(ledger, { tenant, agent, since, until } = {}) {
  try {
    const clauses = ['tenant = ?'];
    const params = [tenant];
    if (agent) { clauses.push('agent = ?'); params.push(agent); }
    if (since != null) { clauses.push('ts >= ?'); params.push(since); }
    if (until != null) { clauses.push('ts < ?'); params.push(until); }

    const rows = ledger.prepare(
      `SELECT input_tokens, output_tokens, total_tokens, cost_usd
         FROM token_events WHERE ${clauses.join(' AND ')}`,
    ).all(...params);

    let inputTokens = 0, outputTokens = 0, totalTokens = 0, costUsd = 0;
    let runs = 0, unknownRuns = 0, costUnknownRuns = 0;
    for (const r of rows) {
      runs++;
      if (r.input_tokens != null) inputTokens += r.input_tokens;
      if (r.output_tokens != null) outputTokens += r.output_tokens;
      if (r.total_tokens != null) totalTokens += r.total_tokens; else unknownRuns++;
      if (r.cost_usd != null) costUsd += r.cost_usd; else costUnknownRuns++;
    }
    return { inputTokens, outputTokens, totalTokens, costUsd, runs, unknownRuns, costUnknownRuns };
  } catch {
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, runs: 0, unknownRuns: 0, costUnknownRuns: 0 };
  }
}

/** The most recent events (newest first), each parsed back from its stored `raw` JSON. `tenant`/
 *  `agent` are optional filters. */
export function listEvents(ledger, { limit = 50, tenant, agent } = {}) {
  try {
    const clauses = [];
    const params = [];
    if (tenant) { clauses.push('tenant = ?'); params.push(tenant); }
    if (agent) { clauses.push('agent = ?'); params.push(agent); }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    params.push(limit);
    const rows = ledger.prepare(
      `SELECT raw FROM token_events${where} ORDER BY ts DESC, rowid DESC LIMIT ?`,
    ).all(...params);
    return rows.map((r) => JSON.parse(r.raw));
  } catch { return []; }
}

/** Delete the oldest rows beyond the newest `keep`, by rowid (mirrors event-log.mjs's
 *  pruneEvents). Best-effort: a prune failure never throws. */
export function pruneEvents(ledger, { keep = 50000 } = {}) {
  try {
    const max = ledger.prepare('SELECT MAX(rowid) AS m FROM token_events').get()?.m;
    if (max == null) return 0;
    const cutoff = max - keep;
    if (cutoff <= 0) return 0;
    return ledger.prepare('DELETE FROM token_events WHERE rowid <= ?').run(cutoff).changes;
  } catch { return 0; }
}
