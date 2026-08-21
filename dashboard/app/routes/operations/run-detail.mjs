import { make, link, badge, money, number, instant, page, table, notice, scopeText, iconLabel, listPanel } from '../../shared/view-helpers.mjs';

function recoveryForm(context, data) {
  const section = make('section', null, 'management-form-panel recovery-card'); section.append(make('h2', 'Safe recovery'));
  if (context.demo) { section.append(notice('Demo data is read-only. Recovery actions are disabled.')); return section; }
  section.append(make('p', data.recovery.retry.explanation));
  if (data.recovery.retry.allowed) {
    const form = make('form', null, 'management-form'); const label = make('label', 'Reason for retry'); const input = make('textarea'); input.name = 'reason'; input.required = true; input.maxLength = 500; label.append(input);
    const button = make('button', 'Retry by requeueing task', 'btn-primary'); button.type = 'submit'; const result = make('div'); result.setAttribute('aria-live', 'polite');
    form.append(label, button, result); form.addEventListener('submit', async (event) => {
      event.preventDefault(); if (!input.value.trim()) return; context.setPending(true); button.disabled = true;
      try { const outcome = await context.api.mutate(`/runs/${encodeURIComponent(data.run.run_id)}/retry`, { reason: input.value.trim() }, { idempotencyKey: crypto.randomUUID() }); result.replaceChildren(notice(outcome.duplicate ? 'This retry request was already recorded.' : 'The task was safely requeued.'), link(outcome.audit.href, 'Open retry audit evidence')); }
      catch (error) { result.replaceChildren(notice(error.message, { error: true })); }
      finally { context.setPending(false); button.disabled = false; button.focus({ preventScroll: true }); }
    }); section.append(form);
  }
  const restart = make('details'); restart.append(make('summary', 'Administrator restart (sensitive action)'));
  restart.append(make('p', data.recovery.restart.explanation), make('p', 'Impact preview: the daemon stops, pulls the latest main, and may be unavailable for about ten seconds. Restart is never automatic.'));
  if (data.recovery.restart.allowed) {
    const form = make('form', null, 'management-form'); const reasonLabel = make('label', 'Restart reason'); const reason = make('textarea'); reason.required = true; reasonLabel.append(reason);
    const confirmLabel = make('label'); const confirmation = make('input'); confirmation.type = 'checkbox'; confirmation.required = true; confirmLabel.append(confirmation, document.createTextNode(' I understand the daemon will briefly disconnect.'));
    const button = make('button', 'Confirm daemon restart', 'btn-primary'); button.type = 'submit'; const output = make('div'); output.setAttribute('aria-live', 'polite');
    form.append(reasonLabel, confirmLabel, button, output); form.addEventListener('submit', async (event) => {
      event.preventDefault(); if (!confirmation.checked || !reason.value.trim()) return; context.setPending(true); button.disabled = true;
      try { const result = await context.postLegacy('/api/restart', { reason: reason.value.trim(), sourceRunId: data.run.run_id, projectId: data.task?.projectId ?? null, scope: context.scope }); output.replaceChildren(notice(result.message ?? 'Restart requested.')); if (result.audit?.href) output.append(link(result.audit.href, 'Open restart audit evidence')); }
      catch (error) { output.replaceChildren(notice(error.message, { error: true })); }
      finally { context.setPending(false); button.disabled = false; button.focus({ preventScroll: true }); }
    }); restart.append(form);
  }
  section.append(restart); return section;
}

export async function renderRoute(context) {
  const data = await context.api.read(`/runs/${encodeURIComponent(context.route.params.runId)}`, { cursor: context.url.searchParams.get('cursor') }); if (!context.isCurrent()) return;
  const view = page(`Run ${data.run.run_id}`, 'Typed outcome, retained evidence, cost attribution, related records, and authorized recovery.'); view.node.append(make('p', scopeText(context.scope), 'scope-summary'));
  view.node.append(listPanel(document, {
    title: iconLabel('play-circle', 'Run attribution and metadata', { size: '1.25rem', strokeWidth: 2.2, color: 'inherit' }),
    rows: [
      { icon: 'play-circle', label: 'Outcome', value: badge(data.run.outcome, data.run.outcome) },
      { icon: 'alert-circle', label: 'Reason', value: data.run.reason ?? 'Unknown' },
      { icon: 'clock', label: 'Started', value: instant(data.run.ts) },
      { icon: 'check-square', label: 'Task', value: data.task ? link(data.task.drilldown.href, data.task.id) : 'Unattributed' },
      { icon: 'users', label: 'Agent', value: data.run.agent ?? 'Unattributed' },
      { icon: 'plug', label: 'Provider / model', value: `${data.run.provider ?? 'Unknown'} / ${data.run.model ?? 'Unknown'}` },
      { icon: 'chart-bars', label: 'Tokens', value: number(data.attribution.totalTokens) },
      { icon: 'database', label: 'Cost', value: money(data.attribution.costUsd) },
      { icon: 'alert-circle', label: 'Unknown-cost events', value: number(data.attribution.unknownCostEvents) }
    ]
  }));
  view.node.append(recoveryForm(context, data));
  const checks = data.checks ?? []; view.node.append(make('h2', 'Checks'), checks.length ? table(['Check', 'Status', 'Upstream status', 'Latency'], checks.map((item) => [item.id, badge(item.status, item.status), item.upstreamStatus ?? 'Unknown', item.latencyMs == null ? 'Unknown' : `${item.latencyMs} ms`]), 'Policy and gateway checks for this run') : make('p', 'No retained checks are available for this run.'));
  const retries = data.retryHistory ?? []; view.node.append(make('h2', 'Retry history'), retries.length ? table(['Requested', 'Actor', 'Role', 'Reason', 'Result', 'Correlation', 'Audit'], retries.map((item) => [instant(item.created_at), item.actor_id, item.actor_role, item.reason, badge(item.result, item.result), item.correlation_id, item.audit ? link(item.audit.href, 'Open retry audit') : 'Audit unavailable']), 'Recorded retry requests and immutable outcomes') : make('p', 'No retry attempts are recorded for this run.'));
  const alerts = data.alerts ?? []; view.node.append(make('h2', 'Related alerts'), alerts.length ? table(['Alert', 'Severity', 'Status'], alerts.map((item) => [link(item.drilldown.href, item.title), badge(item.severity, item.severity), badge(item.status, item.status)]), 'Alerts related to this run') : make('p', 'No related alerts are retained in this scope.'));
  view.node.append(make('h2', 'Status timeline'), table(['Time', 'Type', 'Summary', 'Audit ID'], data.timeline.map((item) => [instant(item.at), item.type, item.summary, item.auditId]), 'Chronological task and gateway timeline'));
  view.node.append(make('h2', 'Log evidence'), table(['Time', 'Outcome', 'Reason', 'Note'], data.evidence.items.map((item) => [instant(item.ts), item.outcome, item.reason, item.note]), 'Chronological retained run evidence'));
  if (data.evidence.nextCursor) view.node.append(link(`${context.url.pathname}?${new URLSearchParams({ ...Object.fromEntries(context.url.searchParams), cursor: data.evidence.nextCursor })}`, 'Next evidence page'));
  view.node.append(make('p', data.retention.disclosure, 'muted'));
  context.root.replaceChildren(view.node);
}
