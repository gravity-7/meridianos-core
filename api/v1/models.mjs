/**
 * api/v1/models — model discovery and tiering endpoints (contracts/rest-api-v1.md §Models),
 * backed by model-registry.mjs's SQLite-stored discovered models (same table + DB the
 * dashboard's existing GET /api/models handler reads).
 */
import { getModels } from '../../model-registry.mjs';
import { openDb } from '../../db.mjs';

function toRestShape(row) {
  return {
    id: row.model_id,
    provider: row.provider,
    name: row.display_name ?? row.model_id,
    tier: row.tier_assigned ?? null,
    enabled: !row.deprecated,
    context_window: row.context_window ?? null,
    pricing: {
      input: row.pricing_input_per_m ?? null,
      output: row.pricing_output_per_m ?? null,
    },
  };
}

export async function handle(ctx) {
  const { req, url, config, apiKey, json, hasScope } = ctx;

  if (req.method === 'GET' && url.pathname === '/api/v1/models') {
    if (!hasScope(apiKey, 'providers:read')) return json(403, { error: 'Forbidden', message: 'API key lacks required scope: providers:read' });
    const db = openDb(undefined, config);
    try {
      const provider = url.searchParams.get('provider');
      const rows = getModels(db, { provider });
      return json(200, { models: rows.map(toRestShape) });
    } finally {
      db.close?.();
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/v1/models/refresh') {
    if (!hasScope(apiKey, 'providers:write')) return json(403, { error: 'Forbidden', message: 'API key lacks required scope: providers:write' });
    const db = openDb(undefined, config);
    let count;
    try {
      const { discoverAllModels } = await import('../../model-discovery.mjs');
      const { loadPolicy } = await import('../../budget.mjs');
      const result = await discoverAllModels(db, loadPolicy(undefined, config), config);
      count = Array.isArray(result) ? result.length : (result?.count ?? 0);
    } finally {
      db.close?.();
    }
    return json(200, { message: 'Models refreshed successfully', refreshed_at: Math.floor(Date.now() / 1000), count });
  }

  const tierMatch = req.method === 'PUT' && url.pathname.match(/^\/api\/v1\/models\/([^/]+)\/tier$/);
  if (tierMatch) {
    if (!hasScope(apiKey, 'providers:write')) return json(403, { error: 'Forbidden', message: 'API key lacks required scope: providers:write' });
    const modelId = decodeURIComponent(tierMatch[1]);
    const body = JSON.parse((await ctx.readBody(req)) || '{}');
    if (!body.tier) return json(400, { error: 'Bad Request', message: "Invalid request body: missing required field 'tier'" });
    const db = openDb(undefined, config);
    try {
      const row = db.prepare('SELECT * FROM model_registry WHERE model_id = ?').get(modelId);
      if (!row) return json(404, { error: 'Not Found', message: `Model not found: ${modelId}` });
      db.prepare('UPDATE model_registry SET tier_assigned = ?, updated_at = datetime(\'now\') WHERE model_id = ?').run(body.tier, modelId);
      return json(200, { id: modelId, tier: body.tier, updated_at: Math.floor(Date.now() / 1000) });
    } finally {
      db.close?.();
    }
  }

  return false;
}
