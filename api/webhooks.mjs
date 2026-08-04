/**
 * webhooks — registration + delivery for the public REST API's event notifications
 * (task.created, task.completed, task.failed, budget.warning, budget.critical, provider.error,
 * model.deprecated, cost.spike — FR-011).
 *
 * Delivery retries with exponential backoff (1s initial, 2x multiplier, 60s max, 3 attempts —
 * FR-012), recording every attempt in `webhook_delivery_logs` for auditability. `fetchImpl` and
 * `sleepImpl` are injectable so tests can run the full retry ladder without a network call or a
 * real 1s+2s+4s wait.
 */
import { randomUUID, createHmac } from 'node:crypto';

const VALID_EVENTS = new Set([
  'task.created', 'task.completed', 'task.failed',
  'budget.warning', 'budget.critical',
  'provider.error', 'model.deprecated', 'cost.spike',
]);

const MAX_ATTEMPTS = 3;
const INITIAL_DELAY_MS = 1000;
const BACKOFF_MULTIPLIER = 2;
const MAX_DELAY_MS = 60_000;

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Register a new webhook. Throws on invalid URL or event types. */
export function registerWebhook(db, { url, events, secret }) {
  if (typeof url !== 'string' || !/^https:\/\//i.test(url)) {
    throw new Error('Webhook url must be an HTTPS URL');
  }
  const eventList = Array.isArray(events) ? events : String(events || '').split(',').map((s) => s.trim()).filter(Boolean);
  const invalid = eventList.filter((e) => !VALID_EVENTS.has(e));
  if (eventList.length === 0 || invalid.length > 0) {
    throw new Error(`Invalid webhook events: ${invalid.length ? invalid.join(', ') : '(none provided)'}`);
  }
  const id = `webhook-${randomUUID()}`;
  const createdAt = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO webhooks (id, url, events, secret, is_active, created_at, failure_count)
     VALUES (?, ?, ?, ?, 1, ?, 0)`,
  ).run(id, url, eventList.join(','), secret ?? null, createdAt);
  return { id, url, events: eventList, is_active: 1, created_at: createdAt };
}

export function listWebhooks(db) {
  return db.prepare('SELECT * FROM webhooks ORDER BY created_at DESC').all();
}

export function deleteWebhook(db, id) {
  return db.prepare('DELETE FROM webhooks WHERE id = ?').run(id).changes > 0;
}

/** Active webhooks subscribed to `eventType`. */
function subscribedWebhooks(db, eventType) {
  return db.prepare('SELECT * FROM webhooks WHERE is_active = 1').all()
    .filter((w) => w.events.split(',').map((e) => e.trim()).includes(eventType));
}

function signPayload(secret, body) {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

function logDelivery(db, { webhookId, eventType, payload, status, httpStatus, errorMessage, attemptNumber }) {
  db.prepare(
    `INSERT INTO webhook_delivery_logs
       (id, webhook_id, event_type, payload, status, http_status, error_message, attempt_number, delivered_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `delivery-${randomUUID()}`, webhookId, eventType, payload, status,
    httpStatus ?? null, errorMessage ?? null, attemptNumber, Math.floor(Date.now() / 1000),
  );
}

/** One HTTP delivery attempt. Never throws — returns a result object. */
async function attemptDelivery(webhook, body, fetchImpl) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (webhook.secret) headers['X-Meridian-Signature'] = signPayload(webhook.secret, body);
    const res = await fetchImpl(webhook.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10_000) });
    if (res.ok) return { success: true, httpStatus: res.status };
    return { success: false, httpStatus: res.status, error: `HTTP ${res.status}` };
  } catch (err) {
    return { success: false, httpStatus: null, error: String(err?.message || err) };
  }
}

/**
 * Deliver `eventType`/`data` to every active webhook subscribed to it, retrying failures up to
 * `MAX_ATTEMPTS` times with exponential backoff. Resolves once all webhooks have settled
 * (success, or exhausted retries) — callers that don't want to block on the backoff ladder
 * should call this without awaiting.
 */
export async function triggerEvent(db, eventType, data, { fetchImpl = fetch, sleepImpl = defaultSleep, logger } = {}) {
  const webhooks = subscribedWebhooks(db, eventType);
  const payload = JSON.stringify({ event: eventType, timestamp: Math.floor(Date.now() / 1000), data });

  await Promise.all(webhooks.map(async (webhook) => {
    let delay = INITIAL_DELAY_MS;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const result = await attemptDelivery(webhook, payload, fetchImpl);

      if (result.success) {
        logDelivery(db, { webhookId: webhook.id, eventType, payload, status: 'success', httpStatus: result.httpStatus, attemptNumber: attempt });
        db.prepare('UPDATE webhooks SET last_delivery_at = ?, failure_count = 0 WHERE id = ?')
          .run(Math.floor(Date.now() / 1000), webhook.id);
        return;
      }

      const isFinalAttempt = attempt >= MAX_ATTEMPTS;
      logDelivery(db, {
        webhookId: webhook.id, eventType, payload,
        status: isFinalAttempt ? 'failed' : 'retrying',
        httpStatus: result.httpStatus, errorMessage: result.error, attemptNumber: attempt,
      });
      db.prepare('UPDATE webhooks SET failure_count = failure_count + 1 WHERE id = ?').run(webhook.id);

      if (isFinalAttempt) {
        db.prepare('UPDATE webhooks SET is_active = 0 WHERE id = ? AND failure_count >= ?')
          .run(webhook.id, MAX_ATTEMPTS);
        logger?.error('webhooks', `delivery to ${webhook.id} (${webhook.url}) failed after ${MAX_ATTEMPTS} attempts — webhook disabled`, result.error);
        return;
      }

      await sleepImpl(Math.min(delay, MAX_DELAY_MS));
      delay *= BACKOFF_MULTIPLIER;
    }
  }));
}
