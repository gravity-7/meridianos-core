const definitions = [
  ['overview', '/app', '/static/app/routes/overview/index.mjs'],
  ['overview-alias', '/app/overview', '/static/app/routes/overview/index.mjs'],
  ['foundation', '/app/foundation', null],
  ['setup', '/app/setup', null],
  ['setup-complete', '/app/setup/complete', null],
  ['task-list', '/app/operations/tasks', '/static/app/routes/operations/index.mjs'],
  ['task-detail', '/app/operations/tasks/:taskId', '/static/app/routes/operations/task-detail.mjs'],
  ['task-categories', '/app/operations/task-categories', '/static/app/routes/operations/task-categories.mjs'],
  ['scheduling', '/app/operations/scheduling', '/static/app/routes/operations/scheduling.mjs'],
  ['commands', '/app/operations/commands', '/static/app/routes/operations/commands.mjs'],
  ['run-list', '/app/operations/runs', '/static/app/routes/operations/index.mjs'],
  ['run-detail', '/app/operations/runs/:runId', '/static/app/routes/operations/run-detail.mjs'],
  ['gateway', '/app/observability/gateway', '/static/app/routes/observability/gateway.mjs'],
  ['cost', '/app/observability/cost', '/static/app/routes/observability/cost.mjs'],
  ['usage', '/app/observability/usage', '/static/app/routes/observability/usage.mjs'],
  ['alert-list', '/app/observability/alerts', '/static/app/routes/observability/alerts.mjs'],
  ['alert-detail', '/app/observability/alerts/:alertId', '/static/app/routes/observability/alert-detail.mjs'],
  ['audit-detail', '/app/observability/audit/:auditId', '/static/app/routes/observability/audit-detail.mjs'],
  ['provider-list', '/app/integrations/providers', '/static/app/routes/integrations/providers.mjs'],
  ['provider-detail', '/app/integrations/providers/:providerId', '/static/app/routes/integrations/provider-detail.mjs'],
  ['ide-connect', '/app/integrations/ide', '/static/app/routes/integrations/ide.mjs'],
  ['mcp-config', '/app/integrations/mcp', '/static/app/routes/integrations/mcp.mjs'],
  ['subscriptions', '/app/integrations/subscriptions', '/static/app/routes/integrations/subscriptions.mjs'],
  ['api-keys', '/app/integrations/api-keys', '/static/app/routes/integrations/api-keys.mjs'],
  ['webhooks', '/app/integrations/webhooks/:webhookId', '/static/app/routes/integrations/webhooks.mjs'],
  ['webhook-detail', '/app/integrations/webhooks/:webhookId/attempts/:attemptId', '/static/app/routes/integrations/webhook-detail.mjs'],
  ['members', '/app/administration/members', '/static/app/routes/administration/members.mjs'],
  ['member-detail', '/app/administration/members/:memberId', '/static/app/routes/administration/member-detail.mjs'],
  ['tenant-settings', '/app/administration/tenant-settings', '/static/app/routes/administration/tenant-settings.mjs'],
  ['billing', '/app/governance/billing', '/static/app/routes/governance/billing.mjs'],
  ['security', '/app/governance/security', '/static/app/routes/governance/security.mjs'],
  ['audit', '/app/governance/audit', '/static/app/routes/governance/audit.mjs'],
].map(([id, pattern, module]) => Object.freeze({ id, pattern, module }));

export const APP_ROUTES = Object.freeze(definitions);

const cleanPath = (pathname) => {
  if (typeof pathname !== 'string' || !pathname.startsWith('/app')) return null;
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
};

function decodePart(value, { allowSlash = false } = {}) {
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded || decoded === '.' || decoded === '..' || decoded.includes('\\') || decoded.includes('\0')) return null;
    if (decoded.includes('/') && (!allowSlash || decoded.split('/').some((part) => !part || part === '.' || part === '..'))) return null;
    return decoded;
  } catch { return null; }
}

export function resolveAppRoute(pathname) {
  const clean = cleanPath(pathname);
  if (!clean) return null;
  const parts = clean.split('/');
  for (const route of definitions) {
    const expected = route.pattern.split('/');
    if (expected.length !== parts.length) continue;
    const params = {};
    let matches = true;
    for (let i = 0; i < expected.length; i++) {
      if (expected[i].startsWith(':')) {
        const parameter = expected[i].slice(1);
        const decoded = decodePart(parts[i], { allowSlash: parameter === 'taskId' });
        if (decoded == null) { matches = false; break; }
        params[parameter] = decoded;
      } else if (expected[i] !== parts[i]) { matches = false; break; }
    }
    if (matches) return { id: route.id, params, pathname: clean };
  }
  return null;
}

export function buildAppPath(id, params = {}) {
  const route = definitions.find((item) => item.id === id);
  if (!route) throw new Error(`unknown app route: ${id}`);
  return route.pattern.replace(/:([A-Za-z][A-Za-z0-9]*)/g, (_all, key) => {
    if (params[key] == null || params[key] === '') throw new Error(`missing route parameter: ${key}`);
    return encodeURIComponent(String(params[key]));
  });
}

export function routeModule(id) {
  return definitions.find((route) => route.id === id)?.module ?? null;
}
