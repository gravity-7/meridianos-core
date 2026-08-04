/**
 * webhook-source — Generic Webhook IntakeSource connector (contracts/intake-source-plugin.md,
 * spec Acceptance Scenario 7). Unlike the other 5 connectors, there is no external API to poll —
 * everything arrives via `handleWebhook`, transformed through `config.field_mappings` (a map from
 * our canonical Task field name to a dot-path into the incoming JSON payload), so this one
 * connector can front "any JSON payload" a user's own tool sends.
 *
 * Example config:
 *   { field_mappings: { externalId: 'id', title: 'summary', body: 'description.text',
 *                        status: 'state', priority: 'fields.urgency', tags: 'labels' } }
 */
const STATUS_ALIASES = { open: 'todo', new: 'todo', 'in progress': 'in-progress', 'in-progress': 'in-progress', closed: 'done', done: 'done', resolved: 'done' };
const PRIORITY_ALIASES = { p0: 'critical', p1: 'high', p2: 'medium', p3: 'low', critical: 'critical', high: 'high', medium: 'medium', low: 'low' };

/** Read a dot-path (`'a.b.c'`) out of a nested object; returns undefined if any segment is missing. */
function getPath(obj, path) {
  if (!path) return undefined;
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function normalizeStatus(raw) {
  if (raw == null) return 'todo';
  return STATUS_ALIASES[String(raw).toLowerCase()] ?? 'todo';
}
function normalizePriority(raw) {
  if (raw == null) return 'medium';
  return PRIORITY_ALIASES[String(raw).toLowerCase()] ?? 'medium';
}

/** Apply `field_mappings` to transform an arbitrary payload into the canonical Task shape. */
export function mapPayloadToTask(payload, fieldMappings = {}) {
  const externalId = getPath(payload, fieldMappings.externalId) ?? getPath(payload, 'id');
  const title = getPath(payload, fieldMappings.title) ?? getPath(payload, 'title');
  if (!externalId || !title) throw new Error('Generic webhook payload is missing a mappable id/title — check field_mappings');

  const tagsRaw = getPath(payload, fieldMappings.tags);
  return {
    externalId: String(externalId),
    title: String(title),
    body: String(getPath(payload, fieldMappings.body) ?? ''),
    status: normalizeStatus(getPath(payload, fieldMappings.status)),
    priority: normalizePriority(getPath(payload, fieldMappings.priority)),
    tags: Array.isArray(tagsRaw) ? tagsRaw.map(String) : [],
    url: getPath(payload, fieldMappings.url) ?? null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/** Nothing to poll — this connector is push-only. */
export async function fetchTasks() {
  return [];
}

/** No external system to create INTO by default; if `config.outgoing_url` is set, relay there. */
export async function createTask(task, config) {
  if (!config.outgoing_url) return { externalId: task.externalId ?? `local-${Date.now()}`, url: null };
  const res = await fetch(config.outgoing_url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(task) });
  if (!res.ok) throw new Error(`Generic webhook outgoing relay failed: HTTP ${res.status}`);
  return { externalId: task.externalId ?? `local-${Date.now()}`, url: config.outgoing_url };
}

export async function updateTask(externalId, updates, config) {
  if (!config.outgoing_url) return { success: true };
  const res = await fetch(config.outgoing_url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ externalId, ...updates }) });
  if (!res.ok) throw new Error(`Generic webhook outgoing relay failed: HTTP ${res.status}`);
  return { success: true };
}

/** The core of this connector: every inbound POST is a `payload` to remap, `action` defaults to
 *  'updated' unless the payload explicitly marks itself as a delete (`config.delete_field`). */
export async function handleWebhook(payload, config) {
  const deleteFlag = config.delete_field ? getPath(payload, config.delete_field) : false;
  const externalId = getPath(payload, config.field_mappings?.externalId) ?? getPath(payload, 'id');
  if (deleteFlag) return { action: 'deleted', externalId: String(externalId), task: null };

  const task = mapPayloadToTask(payload, config.field_mappings ?? {});
  const isNew = config.created_field ? Boolean(getPath(payload, config.created_field)) : true;
  return { action: isNew ? 'created' : 'updated', externalId: task.externalId, task };
}

/** There's no endpoint to probe (we RECEIVE, we don't call out) — success means config is sane. */
export async function testConnection(config) {
  if (!config.field_mappings?.title || !(config.field_mappings?.externalId || config.field_mappings === undefined)) {
    return { success: false, message: 'field_mappings.title is required' };
  }
  return { success: true, message: 'Configuration looks valid — this connector receives pushes, so there is no endpoint to dial' };
}
