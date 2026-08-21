import { page, table, notice, badge, instant, make } from '../../shared/view-helpers.mjs'; import { managementRequest } from '../../shared/management-actions.mjs';
export async function renderRoute(context) {
  const data = await managementRequest('/api/management/audit'); if (!context.isCurrent()) return;
  const view = page('Management audit evidence', 'Append-only management evidence excludes secrets and unauthorized targets.');
  const rows = data.events.map((event) => [
    instant(event.timestamp),
    make('span', event.actor.id, 'entity-tag'),
    event.intent,
    badge(event.outcome, event.outcome === 'allowed' ? 'ok' : event.outcome === 'denied' ? 'denied' : 'info'),
    make('code', event.correlationId),
    badge(event.disclosureClassification, 'default')
  ]);
  view.node.append(rows.length ? table(['Timestamp', 'Actor', 'Intent', 'Outcome', 'Correlation', 'Disclosure'], rows, 'Scoped management audit evidence') : notice('No management audit evidence is available.'));
  context.root.replaceChildren(view.node);
}
