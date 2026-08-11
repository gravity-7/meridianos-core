import { page, table, notice } from '../../shared/view-helpers.mjs';
import { managementRequest } from '../../shared/management-actions.mjs';

export async function renderRoute(context) {
  const audit = await managementRequest('/api/management/audit'); if (!context.isCurrent()) return;
  const view = page('Security posture', 'Server-authorized management controls, session-bound reauthentication, scoped capabilities, and immutable correlated evidence.');
  const posture = [['Authentication', 'Server-verified dashboard session or bearer identity'], ['Reauthentication', 'Five-minute session-bound grant for destructive actions'], ['API keys', 'One-time disclosure, bounded rotation, immediate revoke'], ['Scope', 'Tenant/project scope derived on the server']];
  const evidence = audit.events.filter((event) => /key|reauth|policy|security/i.test(event.intent)).map((event) => [event.timestamp, event.intent, event.outcome, event.correlationId]);
  view.node.append(table(['Control', 'Status'], posture, 'Authorized security posture'), evidence.length ? table(['Timestamp', 'Intent', 'Outcome', 'Correlation'], evidence, 'Correlated security evidence') : notice('No security evidence is available in this authorized scope.'));
  context.root.replaceChildren(view.node);
}
