/**
 * api/v1/providers — provider management endpoints (contracts/rest-api-v1.md §Providers).
 * Reads the same 3-layer-merged provider registry (providers.mjs's resolveAllProviders) the
 * dashboard uses; writes go through provider-wizard.mjs's non-interactive wizard (backup +
 * concurrent-modification detection already built in there — no need to re-implement it).
 */
import { resolveAllProviders } from '../../providers.mjs';
import { getProviderHealth } from '../../provider-health.mjs';
import { loadPolicy } from '../../budget.mjs';
import { runProviderWizard, readPolicyState, writePolicyWithBackup } from '../../provider-wizard.mjs';

function toRestShape(name, descriptor) {
  const health = getProviderHealth(name);
  return {
    id: name,
    name: descriptor.displayName ?? name,
    enabled: descriptor.enabled !== false,
    health: health?.status ?? 'unknown',
    last_checked: health?.lastCheck ? Math.floor(Date.parse(health.lastCheck) / 1000) : null,
  };
}

export async function handle(ctx) {
  const { req, url, config, apiKey, json, readBody, hasScope } = ctx;
  const m = url.pathname.match(/^\/api\/v1\/providers(?:\/([^/]+))?(?:\/(test))?$/);
  if (!m) return false;
  const id = m[1];
  const isTest = m[2] === 'test';

  if (req.method === 'GET' && !id) {
    if (!hasScope(apiKey, 'providers:read')) return json(403, { error: 'Forbidden', message: 'API key lacks required scope: providers:read' });
    const all = resolveAllProviders(loadPolicy(undefined, config), config);
    return json(200, { providers: Object.entries(all).map(([name, d]) => toRestShape(name, d)) });
  }

  if (req.method === 'POST' && !id) {
    if (!hasScope(apiKey, 'providers:write')) return json(403, { error: 'Forbidden', message: 'API key lacks required scope: providers:write' });
    const body = JSON.parse((await readBody(req)) || '{}');
    if (!body.id || !body.base_url) {
      return json(400, { error: 'Bad Request', message: "Invalid request body: missing required field 'id' or 'base_url'" });
    }
    const result = await runProviderWizard({
      name: body.id, wire: body.wire ?? 'openai', baseUrl: body.base_url, keyEnv: body.api_key_env,
      repoRoot: config.repoRoot,
    });
    if (!result.ok) return json(result.conflict ? 409 : 400, { error: 'Bad Request', message: result.error });
    return json(201, { id: body.id, name: body.name ?? body.id, enabled: true, health: 'unknown', last_checked: null });
  }

  if (!id) return false;

  if (isTest && req.method === 'POST') {
    if (!hasScope(apiKey, 'providers:write')) return json(403, { error: 'Forbidden', message: 'API key lacks required scope: providers:write' });
    const all = resolveAllProviders(loadPolicy(undefined, config), config);
    const descriptor = all[id];
    if (!descriptor) return json(404, { error: 'Not Found', message: `Provider not found: ${id}` });
    const start = Date.now();
    try {
      const res = await fetch(descriptor.baseUrl, { signal: AbortSignal.timeout(5000) });
      return json(200, { success: res.ok || res.status < 500, message: res.ok ? 'Connection successful' : `HTTP ${res.status}`, latency_ms: Date.now() - start });
    } catch (err) {
      return json(200, { success: false, message: String(err?.message || err), latency_ms: Date.now() - start });
    }
  }

  if (req.method === 'GET') {
    if (!hasScope(apiKey, 'providers:read')) return json(403, { error: 'Forbidden', message: 'API key lacks required scope: providers:read' });
    const all = resolveAllProviders(loadPolicy(undefined, config), config);
    const descriptor = all[id];
    if (!descriptor) return json(404, { error: 'Not Found', message: `Provider not found: ${id}` });
    const models = Object.entries(descriptor.models ?? {}).map(([tier, modelId]) => ({ id: modelId, name: modelId, tier, enabled: true }));
    return json(200, { ...toRestShape(id, descriptor), models });
  }

  if (req.method === 'DELETE') {
    if (!hasScope(apiKey, 'providers:write')) return json(403, { error: 'Forbidden', message: 'API key lacks required scope: providers:write' });
    const { policy, mtimeMs } = readPolicyState(config.repoRoot);
    policy.providers = { ...(policy.providers ?? {}), [id]: null }; // null = "hidden", same convention resolveAllProviders uses
    const result = writePolicyWithBackup(config.repoRoot, policy, mtimeMs);
    if (result.conflict) return json(409, { error: 'Conflict', message: 'Concurrent modification detected' });
    ctx.res.writeHead(204).end();
    return true;
  }

  return false;
}
