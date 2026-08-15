const MAX_QUERY_LENGTH = 80;
const MAX_RESULTS = 50;
const ROLE_RANK = Object.freeze({ viewer: 1, operator: 2, admin: 3 });

export class SearchQueryError extends Error {
  constructor(code, message) { super(message); this.name = 'SearchQueryError'; this.code = code; this.httpStatus = 400; }
}

export const SEARCH_ROUTES = Object.freeze([
  { id: 'overview', label: 'Overview', description: 'Current attention, health, work, and cost.', href: '/app', requiredRole: 'viewer' },
  { id: 'operations', label: 'Operations', description: 'Tasks and retained runs.', href: '/app/operations/tasks', requiredRole: 'viewer' },
  { id: 'observability', label: 'Observability', description: 'Gateway, usage, cost, alerts, and audit.', href: '/app/observability/gateway', requiredRole: 'viewer' },
  { id: 'integrations', label: 'Integrations', description: 'Providers, keys, and webhooks.', href: '/app/integrations/providers', requiredRole: 'operator' },
  { id: 'governance', label: 'Governance', description: 'Billing, security, and audit.', href: '/app/governance/billing', requiredRole: 'operator' },
  { id: 'administration', label: 'Administration settings', description: 'Members, tenant settings, and permissions.', href: '/app/administration/members', requiredRole: 'admin' },
  { id: 'setup', label: 'Setup and onboarding', description: 'Configure the first provider and workspace.', href: '/app/setup', requiredRole: 'admin' },
]);

function roleRank(role) { return ROLE_RANK[role] ?? 0; }
function canAccess(actor, requiredRole) { return roleRank(actor?.role) >= roleRank(requiredRole); }
function projectForTask(id) { const value = String(id || ''); return value.includes('/') ? value.split('/')[0] : null; }
function scopeHref(href, scope) {
  const url = new URL(href, 'http://localhost');
  if (scope?.projectId) url.searchParams.set('project', scope.projectId);
  return `${url.pathname}${url.search}`;
}
function safeText(value, fallback = '') { return typeof value === 'string' ? value.slice(0, 240) : fallback; }
function matches(query, ...values) { return values.some((value) => safeText(value).toLocaleLowerCase().includes(query.toLocaleLowerCase())); }

export function parseSearchQuery(raw) {
  if (typeof raw !== 'string') throw new SearchQueryError('SEARCH_QUERY_INVALID', 'Search text is required.');
  const query = raw.trim();
  if (!query || query.length > MAX_QUERY_LENGTH || /[\u0000-\u001f\u007f]/u.test(query)) throw new SearchQueryError('SEARCH_QUERY_INVALID', 'Search text must be between 1 and 80 safe characters.');
  return query;
}

function rankResult(result, query) {
  const label = result.label.toLocaleLowerCase(); const q = query.toLocaleLowerCase();
  return label === q ? 0 : label.startsWith(q) ? 1 : result.kind === 'route' ? 3 : 2;
}

export function buildSearchResults({ query: rawQuery, scope = {}, actor = { role: 'viewer' }, tasks = [], runs = [], providers = [], limit = 20 } = {}) {
  const query = parseSearchQuery(rawQuery);
  const results = [];
  const push = (result) => { if (results.some((item) => item.kind === result.kind && item.id === result.id)) return; results.push(result); };

  for (const route of SEARCH_ROUTES) {
    if (!canAccess(actor, route.requiredRole) || !matches(query, route.label, route.description)) continue;
    push({ kind: 'route', id: route.id, label: route.label, description: route.description, href: scopeHref(route.href, scope), scope: { projectId: scope.projectId ?? null }, command: null });
  }
  for (const task of Array.isArray(tasks) ? tasks : []) {
    const projectId = projectForTask(task?.id);
    if (scope.projectId && projectId !== scope.projectId) continue;
    if (!matches(query, task?.id, task?.title, task?.status)) continue;
    const id = safeText(task?.id); if (!id) continue;
    push({ kind: 'task', id, label: id, description: safeText(task?.title || task?.status, 'Task'), href: scopeHref(`/app/operations/tasks/${encodeURIComponent(id)}`, scope), scope: { projectId }, command: null });
  }
  for (const run of Array.isArray(runs) ? runs : []) {
    const taskProject = projectForTask(run?.task);
    if (scope.projectId && taskProject !== scope.projectId) continue;
    if (!matches(query, run?.run_id, run?.task, run?.outcome, run?.reason)) continue;
    const id = safeText(run?.run_id); if (!id) continue;
    push({ kind: 'run', id, label: id, description: safeText(run?.outcome || run?.reason, 'Run'), href: scopeHref(`/app/operations/runs/${encodeURIComponent(id)}`, scope), scope: { projectId: taskProject }, command: null });
  }
  if (canAccess(actor, 'operator')) for (const provider of Array.isArray(providers) ? providers : []) {
    const id = safeText(provider?.id || provider?.name); const label = safeText(provider?.label || provider?.displayName || id);
    if (!id || !matches(query, id, label)) continue;
    push({ kind: 'provider', id, label, description: 'Provider integration', href: scopeHref(`/app/integrations/providers/${encodeURIComponent(id)}`, scope), scope: { projectId: scope.projectId ?? null }, command: null });
  }
  const boundedLimit = Math.max(1, Math.min(MAX_RESULTS, Number(limit) || 20));
  results.sort((a, b) => rankResult(a, query) - rankResult(b, query) || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  return { queryLength: query.length, results: results.slice(0, boundedLimit) };
}
