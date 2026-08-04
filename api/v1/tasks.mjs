/**
 * api/v1/tasks — task CRUD for the public REST API (contracts/rest-api-v1.md §Tasks).
 *
 * Backs onto the SAME `tasks` table the orchestrator itself uses (state.mjs) — there is only one
 * task concept in this system. Internal fields not in the REST contract are projected:
 *   REST body     ← task.acceptance_criteria (closest existing free-text field)
 *   REST tags     ← task.risk_tags (JSON array; reused as generic string tags for API tasks)
 *   REST priority ← task.priority (INTEGER, lower = sooner) via a small bucket mapping
 *   REST status   ← task.status, aliasing the REST contract's 'todo' to the internal 'proposed'
 *                   ('in-progress' and 'done' are spelled identically in both vocabularies)
 * Status changes go through state.mjs's `transition()` — the single legal writer of task state
 * (machine.mjs) — so an external client can't skip steps a real agent couldn't either; an illegal
 * transition request comes back as 400, not a silently-clamped write.
 */
import { randomUUID } from 'node:crypto';
import { getTask, listTasks, upsertTask, transition } from '../../state.mjs';
import { triggerEvent } from '../webhooks.mjs';

const PRIORITY_BUCKETS = { critical: 10, high: 30, medium: 60, low: 100 };
const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low'];

function priorityToLabel(n) {
  for (const label of PRIORITY_ORDER) if (n <= PRIORITY_BUCKETS[label]) return label;
  return 'low';
}
function priorityFromLabel(label) {
  return PRIORITY_BUCKETS[label] ?? PRIORITY_BUCKETS.medium;
}

function restStatusToInternal(status) {
  return status === 'todo' ? 'proposed' : status;
}
function internalStatusToRest(status) {
  return status === 'proposed' ? 'todo' : status;
}

function toRestShape(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.acceptance_criteria ?? '',
    status: internalStatusToRest(row.status),
    priority: priorityToLabel(row.priority),
    source: row.source ?? 'agent',
    created_at: row.created_at ? Math.floor(Date.parse(row.created_at) / 1000) : null,
    updated_at: row.updated_at ? Math.floor(Date.parse(row.updated_at) / 1000) : null,
    tags: (() => { try { return JSON.parse(row.risk_tags || '[]'); } catch { return []; } })(),
  };
}

/**
 * Handle one request under /api/v1/tasks. Returns true if handled (a response was sent),
 * false if the path/method didn't match anything this module owns.
 */
export async function handle(ctx) {
  const { req, url, db, apiKey, json, readBody, hasScope } = ctx;
  const m = url.pathname.match(/^\/api\/v1\/tasks(?:\/([^/]+))?$/);
  if (!m) return false;
  const id = m[1];

  // GET /tasks — list, with status/source filter + pagination
  if (req.method === 'GET' && !id) {
    if (!hasScope(apiKey, 'tasks:read')) return json(403, { error: 'Forbidden', message: 'API key lacks required scope: tasks:read' });
    const statusFilter = url.searchParams.get('status');
    const sourceFilter = url.searchParams.get('source');
    const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 100);
    const offset = Number(url.searchParams.get('offset')) || 0;

    let all = listTasks(db).map(toRestShape);
    if (statusFilter) all = all.filter((t) => t.status === statusFilter);
    if (sourceFilter) all = all.filter((t) => t.source === sourceFilter);
    const page = all.slice(offset, offset + limit);
    return json(200, { tasks: page, total: all.length, limit, offset });
  }

  // POST /tasks — create
  if (req.method === 'POST' && !id) {
    if (!hasScope(apiKey, 'tasks:write')) return json(403, { error: 'Forbidden', message: 'API key lacks required scope: tasks:write' });
    const body = JSON.parse((await readBody(req)) || '{}');
    if (!body.title || typeof body.title !== 'string') {
      return json(400, { error: 'Bad Request', message: "Invalid request body: missing required field 'title'" });
    }
    const taskId = `task-${randomUUID().slice(0, 8)}`;
    const row = upsertTask(db, {
      id: taskId,
      title: body.title,
      acceptance_criteria: body.body ?? '',
      priority: priorityFromLabel(body.priority),
      risk_tags: Array.isArray(body.tags) ? body.tags : [],
      status: 'proposed',
      source: 'api',
    });
    const shaped = toRestShape(row);
    triggerEvent(db, 'task.created', { id: shaped.id, title: shaped.title, status: shaped.status, priority: shaped.priority, source: shaped.source })
      .catch(() => { /* best-effort — a webhook failure must never fail the API response */ });
    return json(201, shaped);
  }

  if (!id) return false;

  // GET /tasks/{id}
  if (req.method === 'GET') {
    if (!hasScope(apiKey, 'tasks:read')) return json(403, { error: 'Forbidden', message: 'API key lacks required scope: tasks:read' });
    const row = getTask(db, id);
    if (!row) return json(404, { error: 'Not Found', message: `Task not found: ${id}` });
    return json(200, toRestShape(row));
  }

  // PATCH /tasks/{id}
  if (req.method === 'PATCH') {
    if (!hasScope(apiKey, 'tasks:write')) return json(403, { error: 'Forbidden', message: 'API key lacks required scope: tasks:write' });
    const row = getTask(db, id);
    if (!row) return json(404, { error: 'Not Found', message: `Task not found: ${id}` });
    const body = JSON.parse((await readBody(req)) || '{}');

    let newStatus = null;
    if (body.status && restStatusToInternal(body.status) !== row.status) {
      newStatus = restStatusToInternal(body.status);
      try {
        transition(db, { taskId: id, to: newStatus, actor: `api:${apiKey.name}`, note: 'Updated via REST API' });
      } catch (err) {
        return json(400, { error: 'Bad Request', message: err.message });
      }
    }
    const updated = upsertTask(db, {
      id,
      title: body.title ?? row.title,
      acceptance_criteria: body.body ?? row.acceptance_criteria,
      priority: body.priority ? priorityFromLabel(body.priority) : row.priority,
      // upsertTask's risk_tags column has no existing-fallback of its own (unlike its other
      // fields) — pass the CURRENT tags explicitly when the caller didn't send any, so a PATCH
      // that only changes e.g. status doesn't silently wipe them to [].
      risk_tags: Array.isArray(body.tags) ? body.tags : JSON.parse(row.risk_tags || '[]'),
    });
    const shaped = toRestShape(updated);

    // FR-011 task.completed / task.failed webhooks — 'blocked' is this state machine's closest
    // analogue to REST's "failed" (there's no explicit failure state; a blocked task is one that
    // can't currently make progress, which is what an external integration cares about).
    if (newStatus === 'done') {
      const durationSeconds = row.created_at ? Math.max(0, Math.floor((Date.now() - Date.parse(row.created_at)) / 1000)) : null;
      triggerEvent(db, 'task.completed', { id: shaped.id, title: shaped.title, status: shaped.status, duration_seconds: durationSeconds })
        .catch(() => { /* best-effort */ });
    } else if (newStatus === 'blocked') {
      triggerEvent(db, 'task.failed', { id: shaped.id, title: shaped.title, error: body.error ?? 'Task blocked', retry_count: 0 })
        .catch(() => { /* best-effort */ });
    }
    return json(200, shaped);
  }

  // DELETE /tasks/{id} — only for API-created tasks; orchestrator work items are never hard-deleted
  if (req.method === 'DELETE') {
    if (!hasScope(apiKey, 'tasks:write')) return json(403, { error: 'Forbidden', message: 'API key lacks required scope: tasks:write' });
    const row = getTask(db, id);
    if (!row) return json(404, { error: 'Not Found', message: `Task not found: ${id}` });
    if (row.source !== 'api') {
      return json(403, { error: 'Forbidden', message: 'Only tasks created via the REST API can be deleted' });
    }
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    ctx.res.writeHead(204).end();
    return true;
  }

  return false;
}
