/**
 * api/v1/webhooks — webhook registration endpoints (contracts/rest-api-v1.md §Webhooks). A thin
 * REST-shape wrapper over api/webhooks.mjs's registerWebhook/listWebhooks/deleteWebhook, which
 * already owns the schema, validation, and delivery/retry logic (Foundational T008).
 */
import { registerWebhook, listWebhooks, deleteWebhook } from '../webhooks.mjs';

function toRestShape(row) {
  return {
    id: row.id,
    url: row.url,
    events: row.events.split(',').map((e) => e.trim()),
    is_active: !!row.is_active,
    created_at: row.created_at,
    last_delivery_at: row.last_delivery_at ?? null,
    failure_count: row.failure_count,
  };
}

export async function handle(ctx) {
  const { req, url, db, apiKey, json, readBody, hasScope } = ctx;
  const m = url.pathname.match(/^\/api\/v1\/webhooks(?:\/([^/]+))?$/);
  if (!m) return false;
  const id = m[1];

  if (req.method === 'GET' && !id) {
    if (!hasScope(apiKey, 'config:read')) return json(403, { error: 'Forbidden', message: 'API key lacks required scope: config:read' });
    return json(200, { webhooks: listWebhooks(db).map(toRestShape) });
  }

  if (req.method === 'POST' && !id) {
    if (!hasScope(apiKey, 'config:write')) return json(403, { error: 'Forbidden', message: 'API key lacks required scope: config:write' });
    const body = JSON.parse((await readBody(req)) || '{}');
    try {
      const created = registerWebhook(db, body);
      return json(201, { ...created, events: Array.isArray(created.events) ? created.events : created.events.split(',') });
    } catch (err) {
      return json(400, { error: 'Bad Request', message: err.message });
    }
  }

  if (req.method === 'DELETE' && id) {
    if (!hasScope(apiKey, 'config:write')) return json(403, { error: 'Forbidden', message: 'API key lacks required scope: config:write' });
    const deleted = deleteWebhook(db, id);
    if (!deleted) return json(404, { error: 'Not Found', message: `Webhook not found: ${id}` });
    ctx.res.writeHead(204).end();
    return true;
  }

  return false;
}
