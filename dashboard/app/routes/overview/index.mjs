import { make, link, badge, card, definitionList, money, number, instant, page, notice, scopeText } from '../../shared/view-helpers.mjs';

export async function renderRoute(context) {
  const data = await context.api.read('/overview'); if (!context.isCurrent()) return;
  const view = page('Operational overview', 'Urgent attention, service health, current work, failures, and cost context in one authorized scope.');
  view.node.append(make('p', scopeText(context.scope), 'scope-summary'));
  const attention = make('section', null, 'attention-region'); attention.append(make('h2', 'Attention now'));
  if (!data.attention.length) attention.append(notice(data.attentionSummary));
  else {
    const list = make('ol', null, 'attention-list');
    for (const item of data.attention) {
      const row = make('li', null, `attention-item severity-${item.severity}`);
      row.append(badge(item.severity, item.severity), make('strong', item.title), make('p', item.summary), make('p', `Affected: ${item.affectedEntity} · Last seen ${instant(item.lastSeenAt)} · ${number(item.occurrenceCount)} occurrence(s)`, 'muted'), link(item.drilldown.href, item.drilldown.label));
      list.append(row);
    }
    attention.append(list);
  }
  const grid = make('div', null, 'overview-grid');
  grid.append(
    card('Gateway health', badge(data.health.state, data.health.state), make('p', data.health.label), definitionList([['Requests', number(data.health.requests)], ['Errors', number(data.health.errors)], ['Error rate', `${data.health.errorRate}%`]]), link(data.health.drilldown.href, data.health.drilldown.label)),
    card('Active and queued work', definitionList([['Active agents', number(data.work.activeAgents)], ['Queued tasks', number(data.work.queuedTasks)]]), link(data.work.drilldowns.tasks.href, data.work.drilldowns.tasks.label)),
    card('Failed and blocked work', definitionList([['Failed runs', number(data.work.failedRuns)], ['Blocked tasks', number(data.work.blockedTasks)]]), make('p', data.work.definition, 'muted'), link(data.work.drilldowns.runs.href, data.work.drilldowns.runs.label)),
    card('Cost and budget', definitionList([['Selected-scope spend', money(data.cost.spend)], ['Unknown-cost events', number(data.cost.unknownCostEvents)], ['Current-month spend', money(data.cost.budget.spend)], ['Monthly limit', money(data.cost.budget.monthlyLimit)], ['Forecast', money(data.cost.budget.forecast)]]), make('p', data.cost.budget.periodLabel, 'muted'), link(data.cost.drilldown.href, data.cost.drilldown.label)),
  );
  view.node.append(attention, grid, make('p', `Fresh as of ${instant(data.freshAsOf)}`, 'freshness'));
  context.root.replaceChildren(view.node);
}
