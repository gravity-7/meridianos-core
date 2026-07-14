/**
 * run-registry — ephemeral, in-memory mapping from a per-run gateway token to the attribution
 * context (tenant/agent/session/task/runId/provider/model/tier) the gateway needs to meter and
 * route a request. Tokens live only for the lifetime of a run; nothing here is persisted — a
 * process restart forgets every run, by design (the launcher re-registers on respawn, 3.2d).
 */

/** A fresh in-memory run registry: `registerRun`/`resolveRun`/`unregisterRun` share one Map. */
export function createRunRegistry() {
  const runs = new Map();

  return {
    registerRun(token, ctx) {
      if (typeof token !== 'string' || token.length === 0) {
        throw new Error('run-registry: token must be a non-empty string');
      }
      if (!ctx || typeof ctx !== 'object') {
        throw new Error('run-registry: ctx must be an object');
      }
      runs.set(token, ctx);
    },

    resolveRun(token) {
      return runs.get(token) ?? null;
    },

    unregisterRun(token) {
      runs.delete(token);
    },
  };
}
