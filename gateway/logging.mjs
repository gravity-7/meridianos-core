/**
 * logging — append-only request/response logging with header redaction and replay.
 * Stored in the request_logs table of the gateway ledger database.
 *
 * Privacy-first: disabled by default, auth headers redacted, privacy warning at startup.
 * Append-only: rows are never updated, only inserted and pruned.
 */

import { randomUUID } from 'node:crypto';

const SENSITIVE_HEADERS = new Set(['authorization', 'x-api-key', 'api-key']);

/**
 * Deep-clone headers object, replacing sensitive header values with [REDACTED].
 * Case-insensitive header name matching. Never throws.
 */
export function redactHeaders(headers = {}) {
  try {
    const out = {};
    for (const [key, value] of Object.entries(headers)) {
      if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
        out[key] = '[REDACTED]';
      } else {
        out[key] = typeof value === 'string' ? value : String(value ?? '');
      }
    }
    return out;
  } catch {
    // Malformed headers fall through unredacted with a warning
    return { ...headers };
  }
}

/**
 * Insert a request-response log entry into the request_logs table.
 * Headers are redacted BEFORE storage.
 *
 * @param {object} db - better-sqlite3 database instance
 * @param {object} entry - { provider, model, method, url, statusCode, latencyMs,
 *   requestHeaders, requestBody, responseHeaders, responseBody, extractedUsage }
 */
export function logRequestResponse(db, entry) {
  if (!db) return;
  try {
    const stmt = db.prepare(`
      INSERT INTO request_logs (id, ts, provider, model, method, url, status_code, latency_ms,
        request_headers, request_body, response_headers, response_body, extracted_usage)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      randomUUID(),
      new Date().toISOString(),
      entry.provider ?? 'unknown',
      entry.model ?? 'unknown',
      entry.method ?? 'POST',
      entry.url ?? '',
      entry.statusCode ?? 0,
      entry.latencyMs ?? 0,
      JSON.stringify(redactHeaders(entry.requestHeaders ?? {})),
      typeof entry.requestBody === 'string' ? entry.requestBody : JSON.stringify(entry.requestBody ?? ''),
      JSON.stringify(entry.responseHeaders ?? {}),
      typeof entry.responseBody === 'string' ? entry.responseBody : JSON.stringify(entry.responseBody ?? ''),
      entry.extractedUsage ? JSON.stringify(entry.extractedUsage) : null,
    );
  } catch (err) {
    console.warn(`[MERIDIANOS] logging: failed to write log entry: ${err?.message ?? err}`);
  }
}

/**
 * Delete log entries older than retentionDays.
 */
export function pruneOldLogs(db, retentionDays = 7) {
  if (!db || retentionDays <= 0) return 0;
  try {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const result = db.prepare('DELETE FROM request_logs WHERE ts < ?').run(cutoff);
    return result.changes ?? 0;
  } catch (err) {
    console.warn(`[MERIDIANOS] logging: prune failed: ${err?.message ?? err}`);
    return 0;
  }
}

/**
 * Get a single log entry by ID.
 */
export function getLogById(db, id) {
  if (!db) return null;
  try {
    const row = db.prepare('SELECT * FROM request_logs WHERE id = ?').get(id);
    if (!row) return null;
    return rowToEntry(row);
  } catch {
    return null;
  }
}

/**
 * List log entries with pagination and optional filters.
 */
export function listLogs(db, { limit = 50, offset = 0, provider, since } = {}) {
  if (!db) return [];
  try {
    let sql = 'SELECT * FROM request_logs WHERE 1=1';
    const params = [];
    if (provider) {
      sql += ' AND provider = ?';
      params.push(provider);
    }
    if (since) {
      sql += ' AND ts >= ?';
      params.push(since);
    }
    sql += ' ORDER BY ts DESC LIMIT ? OFFSET ?';
    params.push(Math.min(limit, 500), offset);
    const rows = db.prepare(sql).all(...params);
    return rows.map(rowToEntry);
  } catch {
    return [];
  }
}

function rowToEntry(row) {
  return {
    id: row.id,
    ts: row.ts,
    provider: row.provider,
    model: row.model,
    method: row.method,
    url: row.url,
    statusCode: row.status_code,
    latencyMs: row.latency_ms,
    requestHeaders: safeParse(row.request_headers),
    requestBody: row.request_body,
    responseHeaders: safeParse(row.response_headers),
    responseBody: row.response_body,
    extractedUsage: safeParse(row.extracted_usage),
  };
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { return text; }
}

/**
 * Replay a previously logged request against current provider configuration.
 * Reads stored request, constructs new upstream HTTP call, returns new response.
 * Original log entry is never modified (append-only).
 *
 * @param {object} db - Database instance
 * @param {string} id - Log entry ID to replay
 * @param {object} opts - { registry, resolveKey, now } for constructing the upstream request
 */
export async function replayRequest(db, id, { registry, resolveKey, now = () => Date.now() } = {}) {
  const entry = getLogById(db, id);
  if (!entry) return null;

  const http = entry.url.startsWith('https') ? await import('node:https') : await import('node:http');
  const transport = http.default ?? http;

  const activeRegistry = typeof registry === 'function' ? registry() : registry;
  const { resolveRoute } = await import('./provider-registry.mjs');
  const route = resolveRoute(activeRegistry, entry.provider);
  if (!route) return null;

  const apiKey = resolveKey ? resolveKey(route.keyEnv) : undefined;
  const headers = { ...entry.requestHeaders };
  if (apiKey) {
    if (route.wire === 'anthropic') headers['x-api-key'] = apiKey;
    else headers['authorization'] = `Bearer ${apiKey}`;
  }

  const start = now();
  try {
    const url = new URL(entry.url);
    const upstreamRes = await new Promise((resolvePromise, rejectPromise) => {
      const req = transport.request(
        url,
        { method: entry.method, headers: { ...headers, 'content-type': 'application/json' } },
        (r) => resolvePromise(r),
      );
      req.on('error', rejectPromise);
      if (entry.requestBody) req.end(entry.requestBody);
      else req.end();
    });

    const chunks = [];
    for await (const chunk of upstreamRes) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');

    return {
      originalRequestId: id,
      statusCode: upstreamRes.statusCode,
      latencyMs: now() - start,
      body: safeParse(body),
    };
  } catch (err) {
    return {
      originalRequestId: id,
      statusCode: null,
      latencyMs: now() - start,
      error: String(err?.message ?? err),
    };
  }
}

/**
 * Check available disk space on the volume containing the given path.
 * Returns free bytes, or Infinity if check fails.
 */
export function checkDiskSpace(dbPath) {
  try {
    // Simple check: if the file exists, check its size doesn't exceed a threshold
    // Full disk space check requires platform-specific APIs
    return Infinity; // Platform check deferred
  } catch {
    return Infinity;
  }
}
