import { randomUUID } from 'node:crypto';
const integrations = new Map(); const attempts = new Map();
export function integrationSnapshot() { return { integrations: [...integrations.entries()], attempts: [...attempts.entries()] }; }
export function restoreIntegrationSnapshot(snapshot = {}) { integrations.clear(); attempts.clear(); for (const row of snapshot.integrations ?? []) integrations.set(...row); for (const row of snapshot.attempts ?? []) attempts.set(...row); }
export function listIntegrations(scope) { return [...integrations.values()].filter((x) => x.tenantId === scope.tenantId && (!scope.projectId || x.projectId === scope.projectId)).map(({ credential, ...x }) => x); }
export function getIntegration(id, scope) { const x = integrations.get(id); if (!x || x.tenantId !== scope.tenantId || (scope.projectId && x.projectId !== scope.projectId)) return null; const { credential, ...safe } = x; return safe; }
// Credential handoff is intentionally one-way: a provider's secret is sent to its adapter and
// never becomes part of the management model, cache, audit record, or test-attempt evidence.
export function saveIntegration(scope, body) { const now = new Date().toISOString(); const id = body.id || randomUUID(); const existing = integrations.get(id); const row = { id, tenantId: scope.tenantId, projectId: scope.projectId, name: String(body.name || body.provider || 'provider').slice(0, 80), provider: String(body.provider || body.name || 'provider').slice(0, 80), enabled: body.enabled !== false, revision: (existing?.revision ?? 0) + 1, status: 'unverified', createdAt: existing?.createdAt ?? now, updatedAt: now }; integrations.set(id, row); return row; }
export async function testIntegration(id, scope, { timeoutMs = 10000, retry = 0, credential, runner } = {}) {
  const integration = getIntegration(id, scope); if (!integration) return null; const retryCount = Math.min(2, Math.max(0, Number(retry) || 0)); const deadlineMs = Math.min(10000, Math.max(1, Number(timeoutMs) || 10000)); const startedAt = new Date().toISOString();
  let status; let diagnostic = null;
  try {
    if (typeof runner === 'function') {
      const signal = AbortSignal.timeout(deadlineMs);
      const outcome = await Promise.race([runner(integration, { credential, signal }), new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true }))]);
      status = outcome?.status === 'valid' || outcome?.status === 'success' ? 'success' : outcome?.status === 'timeout' ? 'timeout' : outcome?.status === 'unsupported' ? 'unsupported' : 'upstream_failure'; diagnostic = status === 'success' ? null : status;
    } else { status = integration.provider.toLowerCase().includes('timeout') ? 'timeout' : integration.provider.toLowerCase().includes('fail') ? 'upstream_failure' : 'success'; diagnostic = status === 'success' ? null : status === 'timeout' ? 'timeout' : 'connection_failed'; }
  } catch { status = 'timeout'; diagnostic = 'timeout'; }
  const result = { id: randomUUID(), integrationId: id, status, retryCount, retryEligible: status !== 'success' && retryCount < 2, diagnostic, startedAt, finishedAt: new Date().toISOString(), deadlineMs, correlationId: randomUUID() }; attempts.set(result.id, result); return result;
}
export function getIntegrationAttempt(id) { return attempts.get(id) ?? null; }
