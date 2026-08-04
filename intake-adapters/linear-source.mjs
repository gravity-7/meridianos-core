/**
 * linear-source — Linear IntakeSource connector (contracts/intake-source-plugin.md). Linear's
 * API is GraphQL-only, so every method here POSTs a query/mutation to https://api.linear.app/graphql.
 */
const STATE_TO_STATUS = { backlog: 'todo', unstarted: 'todo', started: 'in-progress', completed: 'done', canceled: 'done' };
const STATUS_TO_PRIORITY = { 0: 'low', 1: 'low', 2: 'medium', 3: 'high', 4: 'critical' };
const PRIORITY_TO_LINEAR = { low: 1, medium: 2, high: 3, critical: 4 };

async function graphql(config, query, variables) {
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { Authorization: config.api_key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Linear API error: ${res.status}`);
  const data = await res.json();
  if (data.errors) throw new Error(`Linear API error: ${data.errors.map((e) => e.message).join('; ')}`);
  return data.data;
}

export async function fetchTasks(config) {
  const data = await graphql(config, `
    query($teamId: String!) {
      team(id: $teamId) {
        issues { nodes { id title description priority labels { nodes { name } } url createdAt updatedAt state { type } } }
      }
    }`, { teamId: config.team_id });
  return (data.team?.issues?.nodes ?? []).map((issue) => ({
    externalId: issue.id,
    title: issue.title,
    body: issue.description ?? '',
    status: STATE_TO_STATUS[issue.state?.type] ?? 'todo',
    priority: STATUS_TO_PRIORITY[issue.priority] ?? 'medium',
    tags: (issue.labels?.nodes ?? []).map((l) => l.name),
    url: issue.url,
    createdAt: new Date(issue.createdAt).getTime(),
    updatedAt: new Date(issue.updatedAt).getTime(),
  }));
}

export async function createTask(task, config) {
  const data = await graphql(config, `
    mutation($input: IssueCreateInput!) {
      issueCreate(input: $input) { issue { id url } }
    }`, { input: { teamId: config.team_id, title: task.title, description: task.body ?? '', priority: PRIORITY_TO_LINEAR[task.priority] ?? 2 } });
  const issue = data.issueCreate.issue;
  return { externalId: issue.id, url: issue.url };
}

export async function updateTask(externalId, updates, config) {
  const input = {};
  if (updates.title) input.title = updates.title;
  if (updates.body) input.description = updates.body;
  if (updates.priority) input.priority = PRIORITY_TO_LINEAR[updates.priority] ?? 2;
  await graphql(config, `
    mutation($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) { success }
    }`, { id: externalId, input });
  return { success: true };
}

export async function handleWebhook(payload) {
  const issue = payload.data;
  if (payload.action === 'remove') return { action: 'deleted', externalId: issue.id, task: null };
  const task = {
    externalId: issue.id,
    title: issue.title,
    body: issue.description ?? '',
    status: STATE_TO_STATUS[issue.state?.type] ?? 'todo',
    priority: STATUS_TO_PRIORITY[issue.priority] ?? 'medium',
    tags: (issue.labels ?? []).map((l) => l.name ?? l),
    url: issue.url,
    createdAt: new Date(issue.createdAt).getTime(),
    updatedAt: new Date(issue.updatedAt).getTime(),
  };
  if (payload.action === 'create') return { action: 'created', externalId: issue.id, task };
  if (payload.action === 'update') return { action: 'updated', externalId: issue.id, task };
  throw new Error(`Unknown webhook action: ${payload.action}`);
}

export async function testConnection(config) {
  const start = Date.now();
  try {
    await graphql(config, `query { viewer { id } }`);
    return { success: true, message: 'Connection successful', latency_ms: Date.now() - start };
  } catch (err) {
    return { success: false, message: err.message, latency_ms: Date.now() - start };
  }
}
