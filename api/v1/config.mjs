/**
 * api/v1/config — configuration read/write (contracts/rest-api-v1.md §Configuration).
 *
 * Deliberately a MUCH smaller writable surface than the dashboard's own lever set
 * (policy-write.mjs's LEVER_PATHS, gated by the dashboard's own per-boot token) — an external
 * API client only gets `budget.monthly_limit`, since that's the one field the contract documents
 * and the one a third-party integration plausibly needs to change unattended.
 */
import { loadPolicy } from '../../budget.mjs';
import { resolveAnalyticsConfig } from '../../config.mjs';
import { resolveAllProviders } from '../../providers.mjs';
import { writeMonthlyBudget } from '../../scripts/setup-wizard-minimal.mjs';

export async function handle(ctx) {
  const { req, url, config, apiKey, json, readBody, hasScope } = ctx;
  if (url.pathname !== '/api/v1/config') return false;

  if (req.method === 'GET') {
    if (!hasScope(apiKey, 'config:read')) return json(403, { error: 'Forbidden', message: 'API key lacks required scope: config:read' });
    const policy = loadPolicy(undefined, config);
    const analytics = resolveAnalyticsConfig(policy);
    const providers = resolveAllProviders(policy, config);
    return json(200, {
      gateway: { port: Number(process.env.AIOS_DASHBOARD_PORT) || 4317, disabled: policy?.gateway?.disabled === true },
      budget: {
        monthly_limit: analytics.budget.monthlyLimit,
        current_spend: null, // populated from the ledger by /api/v1/costs/summary — kept out here to avoid a second expensive query
        warning_threshold: 0.8,
        critical_threshold: 1.0,
      },
      providers: Object.fromEntries(Object.entries(providers).map(([name, d]) => [name, { enabled: d.enabled !== false }])),
    });
  }

  if (req.method === 'PUT') {
    if (!hasScope(apiKey, 'config:write')) return json(403, { error: 'Forbidden', message: 'API key lacks required scope: config:write' });
    const body = JSON.parse((await readBody(req)) || '{}');
    if (body.budget?.monthly_limit === undefined) {
      return json(400, { error: 'Bad Request', message: 'Only budget.monthly_limit is writable via this endpoint' });
    }
    writeMonthlyBudget(config.repoRoot, body.budget.monthly_limit);
    return json(200, { message: 'Configuration updated successfully', updated_at: Math.floor(Date.now() / 1000) });
  }

  return false;
}
