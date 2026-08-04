/**
 * notion-source — Notion database IntakeSource connector (contracts/intake-source-plugin.md).
 * Expects a Notion database with "Name" (title), "Status" (select: To Do/In Progress/Done),
 * "Priority" (select: Low/Medium/High/Critical), and "Tags" (multi-select) properties —
 * configurable property names could be added later; kept fixed here for simplicity.
 */
const NOTION_VERSION = '2022-06-28';
const STATUS_MAP = { 'To Do': 'todo', 'In Progress': 'in-progress', Done: 'done' };
const REVERSE_STATUS = { todo: 'To Do', 'in-progress': 'In Progress', done: 'Done' };
const PRIORITY_MAP = { Low: 'low', Medium: 'medium', High: 'high', Critical: 'critical' };
const REVERSE_PRIORITY = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };

function headers(config) {
  return { Authorization: `Bearer ${config.api_token}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' };
}

function pageToTask(page) {
  const props = page.properties;
  const title = props.Name?.title?.map((t) => t.plain_text).join('') ?? '';
  return {
    externalId: page.id,
    title,
    body: '',
    status: STATUS_MAP[props.Status?.select?.name] ?? 'todo',
    priority: PRIORITY_MAP[props.Priority?.select?.name] ?? 'medium',
    tags: (props.Tags?.multi_select ?? []).map((t) => t.name),
    url: page.url,
    createdAt: new Date(page.created_time).getTime(),
    updatedAt: new Date(page.last_edited_time).getTime(),
  };
}

export async function fetchTasks(config) {
  const res = await fetch(`https://api.notion.com/v1/databases/${config.database_id}/query`, {
    method: 'POST', headers: headers(config), body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`Notion API error: ${res.status}`);
  const data = await res.json();
  return (data.results ?? []).map(pageToTask);
}

export async function createTask(task, config) {
  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST', headers: headers(config),
    body: JSON.stringify({
      parent: { database_id: config.database_id },
      properties: {
        Name: { title: [{ text: { content: task.title } }] },
        Status: { select: { name: 'To Do' } },
        Priority: { select: { name: REVERSE_PRIORITY[task.priority] ?? 'Medium' } },
        Tags: { multi_select: (task.tags ?? []).map((name) => ({ name })) },
      },
    }),
  });
  if (!res.ok) throw new Error(`Notion API error: ${res.status}`);
  const data = await res.json();
  return { externalId: data.id, url: data.url };
}

export async function updateTask(externalId, updates, config) {
  const properties = {};
  if (updates.title) properties.Name = { title: [{ text: { content: updates.title } }] };
  if (updates.status) properties.Status = { select: { name: REVERSE_STATUS[updates.status] ?? 'To Do' } };
  if (updates.priority) properties.Priority = { select: { name: REVERSE_PRIORITY[updates.priority] ?? 'Medium' } };
  if (updates.tags) properties.Tags = { multi_select: updates.tags.map((name) => ({ name })) };

  const res = await fetch(`https://api.notion.com/v1/pages/${externalId}`, {
    method: 'PATCH', headers: headers(config), body: JSON.stringify({ properties }),
  });
  if (!res.ok) throw new Error(`Notion API error: ${res.status}`);
  return { success: true };
}

export async function handleWebhook(payload) {
  // Notion's public webhooks API sends { type, page: {...} } (or entity for older integrations).
  const page = payload.page ?? payload.entity;
  if (!page) throw new Error(`Unknown webhook payload shape`);
  if (payload.type === 'page.deleted' || page.archived) return { action: 'deleted', externalId: page.id, task: null };
  const task = pageToTask(page);
  if (payload.type === 'page.created') return { action: 'created', externalId: page.id, task };
  return { action: 'updated', externalId: page.id, task };
}

export async function testConnection(config) {
  const start = Date.now();
  try {
    const res = await fetch(`https://api.notion.com/v1/databases/${config.database_id}`, { headers: headers(config) });
    const latency_ms = Date.now() - start;
    return res.ok ? { success: true, message: 'Connection successful', latency_ms } : { success: false, message: `Authentication failed: ${res.status}`, latency_ms };
  } catch (err) {
    return { success: false, message: err.message };
  }
}
