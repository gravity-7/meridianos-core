const DAY_MS = 24 * 60 * 60 * 1000;

export class OperationalScopeError extends Error {
  constructor(code, message, httpStatus = 400) {
    super(message);
    this.name = 'OperationalScopeError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function paramsFrom(input) {
  if (input instanceof URLSearchParams) return input;
  if (input instanceof URL) return input.searchParams;
  return new URL(String(input || '/'), 'http://localhost').searchParams;
}

function exactInstant(value, label) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new OperationalScopeError('INVALID_SCOPE', `${label} must be an ISO-8601 instant`);
  return new Date(time).toISOString();
}

export function parseOperationalScope(input, authContext = {}, policy = {}, { now = Date.now() } = {}) {
  const params = paramsFrom(input);
  if (params.has('tenant')) throw new OperationalScopeError('INVALID_SCOPE', 'tenant is derived from authorization context');
  const tenantId = authContext.tenantId;
  if (!tenantId) throw new OperationalScopeError('FORBIDDEN_SCOPE', 'authorized tenant context is required', 403);

  const to = params.has('to') ? exactInstant(params.get('to'), 'to') : new Date(now).toISOString();
  const from = params.has('from') ? exactInstant(params.get('from'), 'from') : new Date(Date.parse(to) - DAY_MS).toISOString();
  if (Date.parse(from) >= Date.parse(to)) throw new OperationalScopeError('INVALID_SCOPE', 'from must be before to');
  const maxWindowDays = Number(policy.maxWindowDays ?? policy.max_window_days ?? 366);
  if ((Date.parse(to) - Date.parse(from)) > maxWindowDays * DAY_MS) {
    throw new OperationalScopeError('INVALID_SCOPE', `time scope exceeds the ${maxWindowDays}-day maximum`);
  }

  const projectId = params.get('project') || null;
  const provider = params.get('provider') || null;
  const allowedProjects = new Set(authContext.allowedProjects ?? []);
  const allowedProviders = new Set(authContext.allowedProviders ?? []);
  if (!authContext.local && projectId && !allowedProjects.has(projectId)) {
    throw new OperationalScopeError('FORBIDDEN_SCOPE', 'project is outside the authorized scope', 403);
  }
  if (!authContext.local && provider && !allowedProviders.has(provider)) {
    throw new OperationalScopeError('FORBIDDEN_SCOPE', 'provider is outside the authorized scope', 403);
  }
  return { tenantId: String(tenantId), projectId, provider, from, to, timezone: 'UTC' };
}

export function scopeQuery(scope) {
  const out = new URLSearchParams({ from: scope.from, to: scope.to });
  if (scope.projectId) out.set('project', scope.projectId);
  if (scope.provider) out.set('provider', scope.provider);
  return out;
}

export function publicOperationalScope(scope) {
  return { from: scope.from, to: scope.to, project: scope.projectId, provider: scope.provider, timezone: 'UTC' };
}
