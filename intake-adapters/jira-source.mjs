/**
 * jira-source — Jira Cloud/Server IntakeSource connector (contracts/intake-source-plugin.md).
 * One of the 6 pre-built marketplace connectors (FR-013), bundled with core rather than
 * auto-discovered — see plugin-registry.mjs's BUILTIN_PLUGINS for how it's cataloged.
 */
const STATUS_MAP = {
  'To Do': 'todo', 'Backlog': 'todo', 'Selected for Development': 'todo',
  'In Progress': 'in-progress', 'In Review': 'in-progress',
  'Done': 'done',
};
const PRIORITY_MAP = { Lowest: 'low', Low: 'low', Medium: 'medium', High: 'high', Highest: 'critical' };
const REVERSE_PRIORITY = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Highest' };

const mapStatus = (s) => STATUS_MAP[s] ?? 'todo';
const mapPriority = (p) => PRIORITY_MAP[p] ?? 'medium';
const authHeader = (config) => `Basic ${Buffer.from(`${config.email}:${config.api_token}`).toString('base64')}`;

export async function fetchTasks(config) {
  const res = await fetch(`${config.url}/rest/api/3/search?jql=project=${encodeURIComponent(config.project_key)}`, {
    headers: { Authorization: authHeader(config), Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Jira API error: ${res.status}`);
  const data = await res.json();
  return (data.issues ?? []).map((issue) => ({
    externalId: issue.id,
    title: issue.fields.summary,
    body: issue.fields.description ?? '',
    status: mapStatus(issue.fields.status?.name),
    priority: mapPriority(issue.fields.priority?.name),
    tags: issue.fields.labels ?? [],
    url: `${config.url}/browse/${issue.key}`,
    createdAt: new Date(issue.fields.created).getTime(),
    updatedAt: new Date(issue.fields.updated).getTime(),
  }));
}

export async function createTask(task, config) {
  const res = await fetch(`${config.url}/rest/api/3/issue`, {
    method: 'POST',
    headers: { Authorization: authHeader(config), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        project: { key: config.project_key },
        issuetype: { name: 'Task' },
        summary: task.title,
        description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: task.body ?? '' }] }] },
        priority: { name: REVERSE_PRIORITY[task.priority] ?? 'Medium' },
        labels: task.tags ?? [],
      },
    }),
  });
  if (!res.ok) throw new Error(`Jira API error: ${res.status}`);
  const data = await res.json();
  return { externalId: data.id, url: `${config.url}/browse/${data.key}` };
}

export async function updateTask(externalId, updates, config) {
  const fields = {};
  if (updates.title) fields.summary = updates.title;
  if (updates.body) fields.description = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: updates.body }] }] };
  if (updates.priority) fields.priority = { name: REVERSE_PRIORITY[updates.priority] ?? 'Medium' };
  if (updates.tags) fields.labels = updates.tags;

  const res = await fetch(`${config.url}/rest/api/3/issue/${externalId}`, {
    method: 'PUT',
    headers: { Authorization: authHeader(config), 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`Jira API error: ${res.status}`);
  return { success: true };
}

export async function handleWebhook(payload, config) {
  const issue = payload.issue;
  if (!issue) throw new Error(`Unknown webhook event: ${payload.webhookEvent}`);

  if (payload.webhookEvent === 'jira:issue_deleted') {
    return { action: 'deleted', externalId: issue.id, task: null };
  }
  const task = {
    externalId: issue.id,
    title: issue.fields.summary,
    body: issue.fields.description ?? '',
    status: mapStatus(issue.fields.status?.name),
    priority: mapPriority(issue.fields.priority?.name),
    tags: issue.fields.labels ?? [],
    url: `${config.url}/browse/${issue.key}`,
    createdAt: new Date(issue.fields.created).getTime(),
    updatedAt: new Date(issue.fields.updated).getTime(),
  };
  if (payload.webhookEvent === 'jira:issue_created') return { action: 'created', externalId: issue.id, task };
  if (payload.webhookEvent === 'jira:issue_updated') return { action: 'updated', externalId: issue.id, task };
  throw new Error(`Unknown webhook event: ${payload.webhookEvent}`);
}

export async function testConnection(config) {
  const start = Date.now();
  try {
    const res = await fetch(`${config.url}/rest/api/3/myself`, { headers: { Authorization: authHeader(config), Accept: 'application/json' } });
    const latency_ms = Date.now() - start;
    return res.ok ? { success: true, message: 'Connection successful', latency_ms } : { success: false, message: `Authentication failed: ${res.status}`, latency_ms };
  } catch (err) {
    return { success: false, message: err.message };
  }
}
