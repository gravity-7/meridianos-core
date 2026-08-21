import { make, link, badge, instant, page, table, scopeText } from '../../shared/view-helpers.mjs';
import { inheritScope } from '../../shared/operational-scope.mjs';
import { operationalRunOutcomeLabel, operationalTaskStateLabel } from '../../shared/legacy-adapters.mjs';

export async function renderRoute(context) {
  const tasks = context.route.id === 'task-list'; const data = await context.api.read(tasks ? '/tasks' : '/runs', { status: tasks ? context.url.searchParams.get('status') ?? context.url.searchParams.get('state') : null, state: tasks ? null : context.url.searchParams.get('state'), task: tasks ? null : context.url.searchParams.get('task'), cursor: context.url.searchParams.get('cursor') }); if (!context.isCurrent()) return;
  const view = page(tasks ? 'Task operations' : 'Run operations', tasks ? 'Current task state with durable task detail destinations.' : 'Newest-first retained runs with stable evidence destinations.');
  const summaryP = make('p', scopeText(context.scope), 'scope-summary');
  view.node.append(summaryP);
  if (tasks) {
    const categoryLink = make('div', null, 'category-quick-link');
    categoryLink.append(link('/app/operations/task-categories', 'View Constitution §11 Category Breakdown →', 'drilldown-link'));
    view.node.append(categoryLink);
  }
  const rows = data.items.map((item) => tasks
    ? [link(item.drilldown.href, item.id), item.title, badge(operationalTaskStateLabel(item.status), item.status), item.owner ?? 'Unknown', instant(item.updatedAt)]
    : [link(inheritScope(`/app/operations/runs/${encodeURIComponent(item.run_id)}`, context.scope), item.run_id), item.task ? link(inheritScope(`/app/operations/tasks/${encodeURIComponent(item.task)}`, context.scope), item.task) : 'Unattributed', badge(operationalRunOutcomeLabel(item.outcome), item.outcome), item.reason ?? 'Unknown', instant(item.ts)]);
  if (!rows.length) view.node.append(make('p', tasks ? 'No tasks match this scope.' : 'No retained runs match this scope.', 'empty-state'));
  else view.node.append(table(tasks ? ['Task', 'Title', 'State', 'Owner', 'Updated'] : ['Run', 'Task', 'Outcome', 'Reason', 'Started'], rows, tasks ? 'Scoped tasks' : 'Scoped runs'));
  if (data.nextCursor) view.node.append(link(`${context.url.pathname}?${new URLSearchParams({ ...Object.fromEntries(context.url.searchParams), cursor: data.nextCursor })}`, 'Next page'));
  context.root.replaceChildren(view.node);
}
