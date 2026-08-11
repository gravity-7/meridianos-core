import { make, link, badge, instant, page, table, definitionList, notice, scopeText } from '../../shared/view-helpers.mjs';

function lifecycle(context, data) {
  const occurrence = data.occurrence; const section = make('section', null, 'card'); section.append(make('h2', 'Alert lifecycle'));
  if (context.demo) return section.append(notice('Demo data is read-only. Lifecycle actions are disabled.')), section;
  if (occurrence.status === 'resolved') return section.append(notice('This occurrence is resolved. A later recurrence creates a new linked occurrence.')), section;
  const candidates = occurrence.status === 'open' ? [['acknowledge','Acknowledge'],['resolve','Resolve']] : [['reopen','Reopen'],['resolve','Resolve']];
  const actions = data.actions ? candidates.filter(([value]) => data.actions[value]?.allowed) : candidates;
  if (!actions.length) { const explanations = candidates.map(([value]) => data.actions?.[value]?.explanation).filter(Boolean); section.append(notice(explanations.join(' ') || 'No lifecycle action is authorized in the current state.')); return section; }
  const form = make('form'); const field = make('fieldset'); field.append(make('legend', 'Choose a lifecycle action'));
  for (const [value,label] of actions) { const choice = make('label'); const radio = make('input'); radio.type = 'radio'; radio.name = 'action'; radio.value = value; radio.required = true; choice.append(radio, document.createTextNode(` ${label}`)); field.append(choice); }
  const reasonLabel = make('label', 'Reason'); const reason = make('textarea'); reason.required = true; reason.maxLength = 1000; reasonLabel.append(reason);
  const button = make('button', 'Record lifecycle action'); button.type = 'submit'; const output = make('div'); output.setAttribute('aria-live', 'polite'); form.append(field, reasonLabel, button, output);
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); const action = new FormData(form).get('action'); if (!action || !reason.value.trim()) return;
    context.setPending(true); button.disabled = true;
    try { const result = await context.api.mutate(`/alerts/${encodeURIComponent(occurrence.id)}/${action}`, { expectedVersion: occurrence.version, reason: reason.value.trim() }); output.replaceChildren(notice(`Alert ${result.occurrence.status}.`), link(result.audit.href, 'Open immutable audit evidence')); }
    catch (error) { output.replaceChildren(notice(error.message, { error: true })); if (error.code === 'ALERT_VERSION_CONFLICT') output.append(make('p', 'Another actor changed this alert. Refresh before trying again.'), context.refreshButton('Refresh current alert')); }
    finally { context.setPending(false); button.disabled = false; button.focus({ preventScroll: true }); }
  });
  section.append(form); return section;
}

export async function renderRoute(context) {
  const data = await context.api.read(`/alerts/${encodeURIComponent(context.route.params.alertId)}`); if (!context.isCurrent()) return;
  const item = data.occurrence; const view = page(item.title, item.summary); view.node.append(make('p', scopeText(context.scope), 'scope-summary'));
  view.node.append(definitionList([['Severity', badge(item.severity, item.severity)], ['Status', badge(item.status, item.status)], ['Affected task', data.related.task ? link(data.related.task.href, `Open task ${data.related.task.entityId}`) : 'Not linked'], ['Affected run', data.related.run ? link(data.related.run.href, `Open run ${data.related.run.entityId}`) : 'Not linked'], ['First seen', instant(item.first_seen_at)], ['Last seen', instant(item.last_seen_at)], ['Occurrences', item.occurrence_count], ['Acknowledged by', item.acknowledged_by], ['Acknowledgement reason', item.acknowledgement_reason], ['Notification suppression', item.notification_suppression_reason ?? 'Not suppressed'], ['Resolution reason', item.resolution_reason]]));
  const availability = data.evidenceAvailability; if (availability) view.node.append(make('h2', 'Retained source evidence'), definitionList([['Alert events', availability.alert.earliestAvailableAt ? `Available since ${instant(availability.alert.earliestAvailableAt)}` : availability.alert.unavailableReason], ['Run evidence', availability.run.earliestAvailableAt ? `Available since ${instant(availability.run.earliestAvailableAt)}` : availability.run.unavailableReason], ['Gateway ledger', availability.ledger.earliestAvailableAt ? `Available since ${instant(availability.ledger.earliestAvailableAt)}` : availability.ledger.unavailableReason]]));
  view.node.append(lifecycle(context, data), make('h2', 'Immutable lifecycle and notification timeline'), table(['Time', 'Event', 'Actor', 'Before', 'After', 'Reason', 'Result', 'Audit'], data.timeline.map((event) => [instant(event.created_at), event.event_type, event.actor_id, `${event.from_status ?? 'none'} / ${event.from_severity ?? 'none'}`, `${event.to_status ?? 'none'} / ${event.to_severity ?? 'none'}`, event.reason, event.result, link(event.drilldown.href, 'Open evidence')]), 'Append-only alert evidence'));
  context.root.replaceChildren(view.node);
}
