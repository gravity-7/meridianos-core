/**
 * inject — the pure spawn-plan rewrite that points a harness at the LOCAL GATEWAY instead of the
 * real upstream provider (bite 3.2d, expanded to openai wire in Phase 0). launcher.mjs's
 * launchAgent calls this when the gateway is available and the run's provider resolves to a
 * routable wire (anthropic OR openai) — see launcher.mjs for the gating logic.
 *
 * Wire scope (Phase 0): BOTH anthropic wire (env-var rewrite: ANTHROPIC_BASE_URL + ANTHROPIC_API_KEY)
 * AND openai wire (file-based rewrite: opencode.json's baseURL + apiKey). The gateway token is
 * registered in the run registry for server-side resolution.
 */

import { randomUUID } from 'node:crypto';

/**
 * Rewrite `plan` to talk to the gateway instead of the real upstream, for anthropic AND openai wires.
 *
 * - `plan` — a harness adapter's spawn plan (`{ cmd, args, env, files }`, see harness-adapters.mjs).
 *   NEVER mutated; a new plan object is returned when a rewrite happens.
 * - `route` — this run's resolved route (`{ upstreamUrl, wire, keyEnv }`, see
 *   provider-registry.mjs's `resolveRoute`). Only `route.wire` is read here — the real upstream
 *   resolution happens server-side in the gateway, keyed off the run's provider.
 * - `ctx` — the attribution context to register against the minted token:
 *   `{ tenant, agent, session, task, runId, provider, model, tier }` (see run-registry.mjs).
 * - `gatewayUrl` — the local gateway's base URL (env-var or file-config gets pointed here).
 * - `runs` — a run-registry instance (`createRunRegistry()` from run-registry.mjs, or a test stub
 *   exposing the same `registerRun` shape).
 * - `mintToken` — test seam for token generation; defaults to `randomUUID`.
 *
 * Returns `{ plan, token }`. For a non-anthropic/non-openai wire, `plan` is the SAME object passed
 * in (nothing to rewrite) and `token` is `null` — no token is minted, nothing is registered.
 */
export function applyGatewayInjection({ plan, route, ctx, gatewayUrl, runs, mintToken = randomUUID }) {
  // Anthropic wire: rewrite env vars (ANTHROPIC_BASE_URL + ANTHROPIC_API_KEY)
  if (route?.wire === 'anthropic') {
    const token = mintToken();
    runs.registerRun(token, ctx);

    const newPlan = {
      ...plan,
      env: {
        ...plan.env,
        ANTHROPIC_BASE_URL: gatewayUrl,
        ANTHROPIC_API_KEY: token,
      },
    };

    return { plan: newPlan, token };
  }

  // OpenAI wire: rewrite file-based config (opencode.json's baseURL + apiKey)
  if (route?.wire === 'openai') {
    const opencodeFile = (plan.files ?? []).find(f => f.path === 'opencode.json');
    if (!opencodeFile) return { plan, token: null }; // defensive: no config to rewrite

    const token = mintToken();
    runs.registerRun(token, ctx);

    let config;
    try { config = JSON.parse(opencodeFile.content); } catch { return { plan, token: null }; }

    // Rewrite the provider's baseURL and apiKey to point at the gateway
    // opencode.json nests under provider.<name>.options.baseURL and .options.apiKey
    const providerName = ctx.provider;
    if (config?.provider?.[providerName]?.options) {
      config.provider[providerName].options.baseURL = gatewayUrl;
      config.provider[providerName].options.apiKey = token;
    }

    const newFiles = plan.files.map(f =>
      f.path === 'opencode.json' ? { ...f, content: JSON.stringify(config, null, 2) } : f,
    );

    const newPlan = { ...plan, files: newFiles };

    return { plan: newPlan, token };
  }

  // Unknown/unsupported wire — pass through unchanged
  return { plan, token: null };
}
