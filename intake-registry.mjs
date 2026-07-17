/**
 * intake-registry — the pluggable registry D4 formalizes for the IntakeSource contract
 * `inbox-source.mjs` (ADR 0001 D2 bite #3) established: `name` + `list()` + `read(id)` (+
 * optional `submit(...)`). This module owns registration/lookup only — it does not construct
 * any source itself (see `inbox-source.mjs`'s `createInboxSource`, `github-source.mjs`'s
 * `createGithubSource`, and future adapters).
 *
 * Zero shared module state — same discipline as config.mjs's `createAios`: there is NO ambient
 * singleton. A root constructs a registry via `createIntakeRegistry(...)` and passes it down;
 * nothing here is reachable except through the instance returned.
 */

/** Build an empty (or pre-seeded) IntakeSource registry. `sources` is registered in order via
 *  `register` below, so a duplicate `name` among the initial list throws exactly like a later
 *  `register(...)` call would. */
export function createIntakeRegistry(sources = []) {
  const byName = new Map();

  /** Add a source. Throws if a source with the same `name` is already registered — callers must
   *  pick stable, unique names (e.g. 'filesystem-inbox', 'github-issues'). */
  function register(source) {
    const name = source?.name;
    if (!name || typeof name !== 'string') {
      throw new Error('intake-registry: source.name must be a non-empty string');
    }
    if (byName.has(name)) {
      throw new Error(`intake-registry: a source named '${name}' is already registered`);
    }
    byName.set(name, source);
    return source;
  }

  /** The source registered under `name`, or undefined if none. */
  function get(name) {
    return byName.get(name);
  }

  /** All registered sources, in registration order. */
  function list() {
    return [...byName.values()];
  }

  for (const source of sources) register(source);

  return { register, get, list };
}
