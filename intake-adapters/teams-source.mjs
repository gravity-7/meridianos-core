/**
 * teams-source — Microsoft Teams IntakeSource connector (contracts/intake-source-plugin.md).
 * Teams itself has no generic "issue tracker" API; task tracking inside Teams is Microsoft
 * Planner (Graph API), which is what this adapter talks to — `config.plan_id` is the Planner
 * plan attached to a Teams channel.
 */
const PERCENT_TO_STATUS = (pct) => (pct === 0 ? 'todo' : pct === 100 ? 'done' : 'in-progress');
const STATUS_TO_PERCENT = { todo: 0, 'in-progress': 50, done: 100 };
const BUCKET_PRIORITY = { 1: 'critical', 3: 'high', 5: 'medium', 9: 'low' }; // Planner's priority scale (0-10, lower = more urgent)
const PRIORITY_TO_GRAPH = { critical: 1, high: 3, medium: 5, low: 9 };

function headers(config) {
  return { Authorization: `Bearer ${config.access_token}`, 'Content-Type': 'application/json' };
}
function taskToRest(task) {
  return {
    externalId: task.id,
    title: task.title,
    body: task.description ?? '',
    status: PERCENT_TO_STATUS(task.percentComplete ?? 0),
    priority: BUCKET_PRIORITY[task.priority] ?? 'medium',
    tags: [],
    url: `https://tasks.office.com/task/${task.id}`,
    createdAt: task.createdDateTime ? new Date(task.createdDateTime).getTime() : Date.now(),
    updatedAt: Date.now(),
  };
}

export async function fetchTasks(config) {
  const res = await fetch(`https://graph.microsoft.com/v1.0/planner/plans/${config.plan_id}/tasks`, { headers: headers(config) });
  if (!res.ok) throw new Error(`Microsoft Graph API error: ${res.status}`);
  const data = await res.json();
  return (data.value ?? []).map(taskToRest);
}

export async function createTask(task, config) {
  const res = await fetch('https://graph.microsoft.com/v1.0/planner/tasks', {
    method: 'POST', headers: headers(config),
    body: JSON.stringify({ planId: config.plan_id, title: task.title, priority: PRIORITY_TO_GRAPH[task.priority] ?? 5 }),
  });
  if (!res.ok) throw new Error(`Microsoft Graph API error: ${res.status}`);
  const data = await res.json();
  return { externalId: data.id, url: `https://tasks.office.com/task/${data.id}` };
}

export async function updateTask(externalId, updates, config) {
  const body = {};
  if (updates.title) body.title = updates.title;
  if (updates.status) body.percentComplete = STATUS_TO_PERCENT[updates.status] ?? 0;
  if (updates.priority) body.priority = PRIORITY_TO_GRAPH[updates.priority] ?? 5;

  // Planner tasks require an If-Match ETag on update — fetch the current one first.
  const current = await fetch(`https://graph.microsoft.com/v1.0/planner/tasks/${externalId}`, { headers: headers(config) });
  if (!current.ok) throw new Error(`Microsoft Graph API error: ${current.status}`);
  const etag = current.headers.get('etag');

  const res = await fetch(`https://graph.microsoft.com/v1.0/planner/tasks/${externalId}`, {
    method: 'PATCH', headers: { ...headers(config), 'If-Match': etag ?? '*' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Microsoft Graph API error: ${res.status}`);
  return { success: true };
}

export async function handleWebhook(payload) {
  // Graph change notifications only carry a resource reference, not the full entity —
  // callers are expected to have already re-fetched `resourceData` before invoking this.
  const task = payload.resourceData;
  if (!task) throw new Error('Unknown webhook payload: missing resourceData');
  if (payload.changeType === 'deleted') return { action: 'deleted', externalId: task.id, task: null };
  const shaped = taskToRest(task);
  if (payload.changeType === 'created') return { action: 'created', externalId: task.id, task: shaped };
  return { action: 'updated', externalId: task.id, task: shaped };
}

export async function testConnection(config) {
  const start = Date.now();
  try {
    const res = await fetch(`https://graph.microsoft.com/v1.0/planner/plans/${config.plan_id}`, { headers: headers(config) });
    const latency_ms = Date.now() - start;
    return res.ok ? { success: true, message: 'Connection successful', latency_ms } : { success: false, message: `Authentication failed: ${res.status}`, latency_ms };
  } catch (err) {
    return { success: false, message: err.message };
  }
}
