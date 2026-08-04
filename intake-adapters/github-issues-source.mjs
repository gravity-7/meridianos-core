/**
 * github-issues-source — GitHub Issues IntakeSource connector (contracts/intake-source-plugin.md).
 * Distinct from the root github-source.mjs (the internal `name`/`list`/`read` IntakeSource
 * contract used by intake-registry.mjs) — this implements the MARKETPLACE contract
 * (fetchTasks/createTask/updateTask/handleWebhook) over the same REST API.
 */
const STATE_TO_STATUS = { open: 'todo', closed: 'done' };
const LABEL_PRIORITIES = new Set(['low', 'medium', 'high', 'critical']);

function headers(config) {
  return { Authorization: `Bearer ${config.api_token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
}
function apiBase(config) {
  return `https://api.github.com/repos/${config.owner}/${config.repo}`;
}
function priorityFromLabels(labels) {
  const found = labels.map((l) => (typeof l === 'string' ? l : l.name)).find((n) => LABEL_PRIORITIES.has(n));
  return found ?? 'medium';
}
function issueToTask(issue) {
  const labelNames = (issue.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));
  return {
    externalId: String(issue.number),
    title: issue.title,
    body: issue.body ?? '',
    status: issue.pull_request ? undefined : (STATE_TO_STATUS[issue.state] ?? 'todo'),
    priority: priorityFromLabels(labelNames),
    tags: labelNames.filter((n) => !LABEL_PRIORITIES.has(n)),
    url: issue.html_url,
    createdAt: new Date(issue.created_at).getTime(),
    updatedAt: new Date(issue.updated_at).getTime(),
  };
}

export async function fetchTasks(config) {
  const res = await fetch(`${apiBase(config)}/issues?state=all&per_page=100`, { headers: headers(config) });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const data = await res.json();
  return data.filter((issue) => !issue.pull_request).map(issueToTask);
}

export async function createTask(task, config) {
  const labels = [...(task.tags ?? [])];
  if (task.priority) labels.push(task.priority);
  const res = await fetch(`${apiBase(config)}/issues`, {
    method: 'POST', headers: { ...headers(config), 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: task.title, body: task.body ?? '', labels }),
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const data = await res.json();
  return { externalId: String(data.number), url: data.html_url };
}

export async function updateTask(externalId, updates, config) {
  const body = {};
  if (updates.title) body.title = updates.title;
  if (updates.body) body.body = updates.body;
  if (updates.status) body.state = updates.status === 'done' ? 'closed' : 'open';
  if (updates.tags || updates.priority) body.labels = [...(updates.tags ?? []), ...(updates.priority ? [updates.priority] : [])];

  const res = await fetch(`${apiBase(config)}/issues/${externalId}`, {
    method: 'PATCH', headers: { ...headers(config), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  return { success: true };
}

export async function handleWebhook(payload) {
  const issue = payload.issue;
  if (!issue) throw new Error('Unknown webhook payload: missing issue');
  if (payload.action === 'deleted') return { action: 'deleted', externalId: String(issue.number), task: null };
  const task = issueToTask(issue);
  if (payload.action === 'opened') return { action: 'created', externalId: String(issue.number), task };
  if (['edited', 'closed', 'reopened', 'labeled', 'unlabeled'].includes(payload.action)) {
    return { action: 'updated', externalId: String(issue.number), task };
  }
  throw new Error(`Unknown webhook action: ${payload.action}`);
}

export async function testConnection(config) {
  const start = Date.now();
  try {
    const res = await fetch(apiBase(config), { headers: headers(config) });
    const latency_ms = Date.now() - start;
    return res.ok ? { success: true, message: 'Connection successful', latency_ms } : { success: false, message: `Authentication failed: ${res.status}`, latency_ms };
  } catch (err) {
    return { success: false, message: err.message };
  }
}
