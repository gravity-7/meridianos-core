import { createHash, randomUUID } from 'node:crypto';

function ensureWebhookState(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS webhooks (id TEXT PRIMARY KEY, url TEXT NOT NULL, events TEXT NOT NULL, secret TEXT, is_active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, last_delivery_at INTEGER, failure_count INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS webhook_delivery_logs (id TEXT PRIMARY KEY, webhook_id TEXT NOT NULL, event_type TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL, http_status INTEGER, error_message TEXT, attempt_number INTEGER NOT NULL, delivered_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS management_webhook_scopes (webhook_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, project_id TEXT);
    CREATE TABLE IF NOT EXISTS management_webhook_replays (id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL UNIQUE, webhook_id TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, reason TEXT, outcome TEXT NOT NULL, correlation_id TEXT NOT NULL, created_at INTEGER NOT NULL, completed_at INTEGER, http_status INTEGER);`);
}

function scopedWebhook(db, scope, webhookId) {
  ensureWebhookState(db); const explicit = db.prepare('SELECT * FROM management_webhook_scopes WHERE webhook_id = ?').get(webhookId);
  if (explicit) return explicit.tenant_id === scope.tenantId && (!scope.projectId || explicit.project_id === scope.projectId);
  // Public REST webhooks are local-machine resources; claim an unscoped legacy row only for this
  // server-derived scope, then enforce that scope thereafter.
  const webhook = db.prepare('SELECT id FROM webhooks WHERE id = ?').get(webhookId); if (!webhook) return false;
  db.prepare('INSERT INTO management_webhook_scopes (webhook_id, tenant_id, project_id) VALUES (?, ?, ?)').run(webhookId, scope.tenantId, scope.projectId); return true;
}

function pruneExpiredAttempts(db) { return db.prepare('DELETE FROM webhook_delivery_logs WHERE delivered_at < ?').run(Math.floor(Date.now() / 1000) - 30 * 86400).changes; }

export function recordWebhookAttempt(db, scope, input = {}) {
  ensureWebhookState(db); pruneExpiredAttempts(db); const webhookId = input.webhookId || 'default';
  if (!db.prepare('SELECT id FROM webhooks WHERE id = ?').get(webhookId)) db.prepare('INSERT INTO webhooks (id, url, events, is_active, created_at, failure_count) VALUES (?, ?, ?, 1, ?, 0)').run(webhookId, 'https://management.invalid/recorded', input.event || 'unknown', Math.floor(Date.now() / 1000));
  if (!scopedWebhook(db, scope, webhookId)) return null;
  const id = input.id || `delivery-${randomUUID()}`; const deliveredAt = input.createdAt ? Math.floor(Date.parse(input.createdAt) / 1000) : Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO webhook_delivery_logs (id, webhook_id, event_type, payload, status, http_status, error_message, attempt_number, delivered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, webhookId, input.event || 'unknown', JSON.stringify({ redacted: true }), input.status || 'failed', null, input.response ? '[REDACTED]' : null, 1, deliveredAt);
  return { id, webhookId, event: input.event || 'unknown', status: input.status || 'failed', createdAt: new Date(deliveredAt * 1000).toISOString(), retentionUntil: new Date((deliveredAt + 30 * 86400) * 1000).toISOString(), response: null };
}

export function listWebhookAttempts(db, scope, webhookId, { cursor, limit = 50 } = {}) {
  pruneExpiredAttempts(db); if (!scopedWebhook(db, scope, webhookId)) return { attempts: [], nextCursor: null, retentionDays: 30 };
  const start = cursor ? Number(Buffer.from(cursor, 'base64url').toString('utf8')) : 0; if (!Number.isInteger(start) || start < 0) throw new Error('invalid cursor'); const take = Math.max(1, Math.min(100, Number(limit) || 50)); const cutoff = Math.floor(Date.now() / 1000) - 30 * 86400;
  const rows = db.prepare('SELECT id, webhook_id, event_type, status, http_status, attempt_number, delivered_at FROM webhook_delivery_logs WHERE webhook_id = ? AND delivered_at >= ? ORDER BY delivered_at DESC LIMIT ? OFFSET ?').all(webhookId, cutoff, take + 1, start);
  return { attempts: rows.slice(0, take).map((row) => ({ id: row.id, webhookId: row.webhook_id, event: row.event_type, status: row.status, httpStatus: row.http_status, attemptNumber: row.attempt_number, createdAt: new Date(row.delivered_at * 1000).toISOString(), retentionUntil: new Date((row.delivered_at + 30 * 86400) * 1000).toISOString() })), nextCursor: rows.length > take ? Buffer.from(String(start + take)).toString('base64url') : null, retentionDays: 30 };
}

export async function replayWebhookAttempt(db, scope, webhookId, attemptId, reason, deliver = async () => ({ outcome: 'ineligible', outbound: false })) {
  pruneExpiredAttempts(db); if (!scopedWebhook(db, scope, webhookId)) return { outcome: 'denied', outbound: false }; const cutoff = Math.floor(Date.now() / 1000) - 30 * 86400; const attempt = db.prepare('SELECT * FROM webhook_delivery_logs WHERE id = ? AND webhook_id = ? AND delivered_at >= ?').get(attemptId, webhookId, cutoff);
  if (!attempt) return { outcome: 'denied', outbound: false }; if (attempt.status === 'success') return { outcome: 'ineligible', outbound: false };
  const existing = db.prepare('SELECT * FROM management_webhook_replays WHERE attempt_id = ?').get(attemptId); if (existing) return { id: existing.id, idempotencyKey: existing.idempotency_key, outcome: 'duplicate', outbound: false, correlationId: existing.correlation_id };
  const replay = { id: randomUUID(), idempotencyKey: createHash('sha256').update(`${attemptId}:replay`).digest('hex'), reason: String(reason || '').slice(0, 512), outcome: 'pending', outbound: false, correlationId: randomUUID() };
  try { db.prepare('INSERT INTO management_webhook_replays (id, attempt_id, webhook_id, idempotency_key, reason, outcome, correlation_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(replay.id, attemptId, webhookId, replay.idempotencyKey, replay.reason, replay.outcome, replay.correlationId, Math.floor(Date.now() / 1000)); }
  catch { const duplicate = db.prepare('SELECT * FROM management_webhook_replays WHERE attempt_id = ?').get(attemptId); if (duplicate) return { id: duplicate.id, idempotencyKey: duplicate.idempotency_key, outcome: 'duplicate', outbound: false, correlationId: duplicate.correlation_id }; throw new Error('unable to reserve webhook replay'); }
  const delivery = await deliver({ id: attempt.id, event: attempt.event_type }, replay); replay.outcome = delivery?.outcome ?? 'failed'; replay.outbound = delivery?.outbound === true; replay.httpStatus = delivery?.httpStatus ?? null; db.prepare('UPDATE management_webhook_replays SET outcome = ?, completed_at = ?, http_status = ? WHERE id = ?').run(replay.outcome, Math.floor(Date.now() / 1000), replay.httpStatus, replay.id); return replay;
}

// Compatibility no-ops: state is now in durable SQLite tables.
export function webhookSnapshot() { return {}; }
export function restoreWebhookSnapshot() {}
