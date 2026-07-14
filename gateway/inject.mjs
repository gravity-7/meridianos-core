/**
 * inject — the pure spawn-plan rewrite that points a harness at the LOCAL GATEWAY instead of the
 * real upstream provider (bite 3.2d). `launcher.mjs`'s `launchAgent` calls this ONLY when the
 * gateway is opted in (`config.gateway.enabled === true`) and the run's provider resolves to a
 * routable, anthropic-wire route — see launcher.mjs for the gating logic.
 *
 * Wire scope (locked for this bite): ONLY the anthropic wire (claude-code, the primary/daemon
 * harness) is rewritten here. `claude-code`'s spawn plan carries the real upstream endpoint in
 * `ANTHROPIC_BASE_URL` and the real BYO key in `ANTHROPIC_API_KEY` (see
 * harness-adapters.mjs's `claudeCodeEnv`) — this module swaps both for the gateway's own URL and a
 * short-lived per-run token, which `gateway/server.mjs` accepts on the `x-api-key` header (the
 * header claude-code's anthropic-wire client actually sends the key on) and resolves back to the
 * real key server-side (see run-registry.mjs + provider-registry.mjs).
 *
 * openai wire (opencode's BYO-key path, which writes a file-based `opencode.json` with a literal
 * `baseURL` rather than an env var) is a DOCUMENTED FOLLOW-UP (3.2d-ii) — this bite only touches
 * the env-var-based anthropic wire. Callers must not assume openai-wire runs get gateway coverage
 * yet; `applyGatewayInjection` returns the plan UNCHANGED (and mints no token) for any non-anthropic
 * wire so callers can gate on `route.wire === 'anthropic'` before ever calling in, but this function
 * is defensive about that itself too.
 */

import { randomUUID } from 'node:crypto';

/**
 * Rewrite `plan` to talk to the gateway instead of the real upstream, for the anthropic wire only.
 *
 * - `plan` — a harness adapter's spawn plan (`{ cmd, args, env, files }`, see harness-adapters.mjs).
 *   NEVER mutated; a new plan object is returned when a rewrite happens.
 * - `route` — this run's resolved route (`{ upstreamUrl, wire, keyEnv }`, see
 *   provider-registry.mjs's `resolveRoute`). Only `route.wire` is read here — the real upstream
 *   resolution happens server-side in the gateway, keyed off the run's provider.
 * - `ctx` — the attribution context to register against the minted token:
 *   `{ tenant, agent, session, task, runId, provider, model, tier }` (see run-registry.mjs).
 * - `gatewayUrl` — the local gateway's base URL (`ANTHROPIC_BASE_URL` gets pointed here).
 * - `runs` — a run-registry instance (`createRunRegistry()` from run-registry.mjs, or a test stub
 *   exposing the same `registerRun` shape).
 * - `mintToken` — test seam for token generation; defaults to `randomUUID`.
 *
 * Returns `{ plan, token }`. For a non-anthropic wire, `plan` is the SAME object passed in
 * (nothing to rewrite) and `token` is `null` — no token is minted, nothing is registered.
 */
export function applyGatewayInjection({ plan, route, ctx, gatewayUrl, runs, mintToken = randomUUID }) {
  if (route?.wire !== 'anthropic') {
    return { plan, token: null };
  }

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
