/** Server-side authorization for the additive management API. */
import { randomUUID } from 'node:crypto';

export const MANAGEMENT_CAPABILITIES = Object.freeze({
  providersRead: ['admin', 'operator'], providersWrite: ['admin'],
  keysRead: ['admin'], keysWrite: ['admin'], webhooksRead: ['admin', 'operator'], webhooksWrite: ['admin', 'operator'],
  accessRead: ['admin', 'operator'], accessWrite: ['admin'], billingRead: ['admin', 'operator'],
  settingsWrite: ['admin'], auditRead: ['admin', 'operator'],
});

export function managementScope(config, user, requested = {}) {
  const tenantId = config?.gateway?.registry?.tenant ?? config?.gateway?.tenant ?? 'default';
  // A client can narrow to a project but cannot select a tenant. A mismatched requested tenant
  // is deliberately represented only as a denial reason, never echoed back to the caller.
  return { tenantId, projectId: typeof requested.projectId === 'string' ? requested.projectId : null, requestedTenant: requested.tenantId };
}

export function decideManagementAuthorization({ config, user, capability, requestedScope = {}, target = null }) {
  const correlationId = randomUUID();
  const scope = managementScope(config, user, requestedScope);
  const role = user?.role ?? 'viewer';
  let reasonCode = 'allowed';
  let allowed = Boolean(user?.sub) && (MANAGEMENT_CAPABILITIES[capability] ?? []).includes(role);
  if (!user?.sub) reasonCode = 'authentication_required';
  else if (requestedScope.tenantId && requestedScope.tenantId !== scope.tenantId) { allowed = false; reasonCode = 'scope_denied'; }
  // JWTs currently carry a tenant role, not a project-membership assertion. Until a project
  // membership is server-loaded, only tenant administrators may narrow to a project; accepting
  // an arbitrary project id from an operator/viewer would turn client route state into authority.
  else if (scope.projectId && role !== 'admin') { allowed = false; reasonCode = 'scope_denied'; }
  else if (!allowed) reasonCode = 'capability_denied';
  if (target?.tenantId && target.tenantId !== scope.tenantId) { allowed = false; reasonCode = 'scope_denied'; }
  if (scope.projectId && target?.projectId && target.projectId !== scope.projectId) { allowed = false; reasonCode = 'scope_denied'; }
  return { actor: { id: user?.sub ?? null, role }, capability, scope: { tenantId: scope.tenantId, projectId: scope.projectId }, target: target ? { type: target.type, id: target.id } : null, allowed, reasonCode, policyVersion: 'management-v1', correlationId };
}

export function nonDisclosingDenial(decision) {
  return { ok: false, error: { code: 'MANAGEMENT_ACCESS_DENIED', message: 'This management action is not available for the current access scope.', correlationId: decision.correlationId } };
}
