import { make, notice, page, formPanel } from '../../shared/view-helpers.mjs'; import { managementRequest } from '../../shared/management-actions.mjs';
export async function renderRoute(context) {
  const webhookId = encodeURIComponent(context.route.params.webhookId);
  const attemptId = encodeURIComponent(context.route.params.attemptId);
  const view = page('Webhook delivery recovery', 'A replay requires a reason. Ineligible or duplicate requests make no outbound delivery.');
  const reason = make('textarea'); reason.id = 'webhook-recovery-reason'; reason.required = true; reason.placeholder = 'Provide justification for replaying this webhook delivery attempt...';
  const submit = make('button', 'Replay retained delivery', 'btn-primary'); submit.type = 'submit';
  const form = make('form', null, 'management-form');
  const feedback = make('div', null, 'management-feedback'); feedback.setAttribute('role', 'status');
  const reasonLabel = make('label', 'Recovery reason'); reasonLabel.htmlFor = reason.id; reasonLabel.append(reason);
  form.append(reasonLabel, submit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); submit.disabled = true;
    try {
      const result = await managementRequest(`/api/management/webhooks/${webhookId}/attempts/${attemptId}/replay`, { method: 'POST', body: { reason: reason.value } });
      feedback.textContent = `${result.replay.outcome} · ${result.correlationId}`;
    } catch (error) {
      feedback.replaceChildren(notice(error.message, { error: true }));
    } finally {
      submit.disabled = false;
    }
  });
  const formCard = formPanel(document, { title: 'Replay webhook delivery', icon: 'plug', subtitle: 'Initiate a safe idempotent redelivery for this retained attempt.' }, form);
  view.node.append(formCard, feedback);
  context.root.replaceChildren(view.node);
}
