import { make, link, badge, money, number, instant, page, table, scopeText, iconLabel, listPanel } from '../../shared/view-helpers.mjs';

export async function renderRoute(context) {
  const data = await context.api.read(`/tasks/${encodeURIComponent(context.route.params.taskId)}`); if (!context.isCurrent()) return;
  const view = page(`Task ${data.task.id}`, data.task.title); view.node.append(make('p', scopeText(context.scope), 'scope-summary'));
  view.node.append(listPanel(document, {
    title: iconLabel('check-square', 'Task overview', { size: '1.25rem', strokeWidth: 2.2, color: 'inherit' }),
    rows: [
      { icon: 'check-square', label: 'State', value: badge(data.task.status, data.task.status) },
      { icon: 'layout-dashboard', label: 'Project', value: data.task.projectId },
      { icon: 'users', label: 'Owner', value: data.task.owner },
      { icon: 'clock', label: 'Updated', value: instant(data.task.updatedAt) },
      { icon: 'database', label: 'Selected-scope cost', value: money(data.cost.spend) },
      { icon: 'topology', label: 'Gateway requests', value: number(data.cost.requests) }
    ]
  }));
  if (data.recovery) view.node.append(make('h2', 'Recovery eligibility'), make('p', data.recovery.retry.explanation), make('p', data.recovery.restart.explanation, 'muted'));
  const runs = data.runs.map((run) => [link(run.drilldown.href, run.run_id), badge(run.outcome, run.outcome), run.reason ?? 'Unknown', run.provider ?? 'Unknown', run.model ?? 'Unknown', instant(run.ts)]);
  view.node.append(make('h2', 'Related runs'), runs.length ? table(['Run', 'Outcome', 'Reason', 'Provider', 'Model', 'Started'], runs, 'Runs related to this task') : make('p', 'No retained runs are available.'));
  const alerts = make('ul'); for (const alert of data.alerts) { const li = make('li'); li.append(badge(alert.severity, alert.severity), document.createTextNode(' '), link(alert.drilldown.href, alert.title)); alerts.append(li); }
  view.node.append(make('h2', 'Related alerts'), data.alerts.length ? alerts : make('p', 'No related alerts in this scope.'));
  view.node.append(make('h2', 'Action and audit history'), table(['Time', 'Operation', 'Before', 'After', 'Actor', 'Note'], data.history.map((item) => [instant(item.ts), item.op, item.from_state, item.to_state, item.actor, item.note]), 'Append-only task history'), make('p', data.retention.disclosure, 'muted'));
  context.root.replaceChildren(view.node);
}
