/**
 * profiles — named configuration profiles with inheritance (008 — End-User Configurability, US2).
 *
 * A profile is a named overlay under `policy.yaml`'s top-level `profiles:` key. A profile may declare
 * `extends: <name>` to inherit another profile's fields, recursively deep-merged (child overrides win at
 * every depth, not just the top level) — the same merge shape `providers.mjs` already uses for its
 * three-source provider merge, generalized to arbitrary-depth policy objects since profile overrides can
 * target any nested policy path (e.g. `agents.builder.defaultTier`).
 *
 * Deliberately NOT built on YAML anchors/aliases (`<<: *base`) — an explicit `extends:` string keeps profile
 * inheritance readable in plain YAML and needs no new runtime dependency (see plan.md's Constitution Check).
 */

/** Deep-merge `override` onto `base`. Plain objects merge key-by-key recursively; anything else (primitive,
 *  array, or a type mismatch between base/override) is replaced wholesale by `override`. */
function deepMerge(base, override) {
  if (override === null || override === undefined) return base;
  const bothPlainObjects =
    typeof override === 'object' && !Array.isArray(override) &&
    typeof base === 'object' && base !== null && !Array.isArray(base);
  if (!bothPlainObjects) return override;

  const merged = { ...base };
  for (const [key, val] of Object.entries(override)) {
    merged[key] = deepMerge(base[key], val);
  }
  return merged;
}

/**
 * Resolve a named profile's `extends` chain into a single flat configuration overlay.
 * Throws on: unknown profile name, an `extends` target that doesn't exist, or a circular chain.
 *
 * @param {object} policy - The loaded policy object (must contain `profiles` to resolve anything)
 * @param {string} name - The profile to resolve
 * @returns {object} The merged profile fields (root-first, leaf-last precedence), `extends` key stripped
 */
export function resolveProfile(policy, name) {
  const profiles = policy?.profiles ?? {};
  if (!(name in profiles)) {
    throw new Error(`unknown profile '${name}'`);
  }

  // Walk the extends chain leaf-to-root, detecting cycles as we go.
  const chainNamesLeafToRoot = [];
  const visited = new Set();
  let current = name;
  while (current !== undefined) {
    if (visited.has(current)) {
      throw new Error(`circular profile inheritance detected: ${[...chainNamesLeafToRoot, current].join(' -> ')}`);
    }
    visited.add(current);
    chainNamesLeafToRoot.push(current);

    const entry = profiles[current];
    const parent = entry.extends;
    if (parent !== undefined && !(parent in profiles)) {
      throw new Error(`profile '${current}' extends unknown profile '${parent}'`);
    }
    current = parent;
  }

  let merged = {};
  for (const profileName of [...chainNamesLeafToRoot].reverse()) {
    const { extends: _extends, ...rest } = profiles[profileName];
    merged = deepMerge(merged, rest);
  }
  return merged;
}

/**
 * List every profile defined in policy, with its direct `extends` parent (or null for a root profile).
 * Never throws — used for UI/CLI listing where an unresolvable chain shouldn't block the listing itself.
 *
 * @param {object} policy
 * @returns {Array<{name: string, extends: string|null}>}
 */
export function listProfiles(policy) {
  const profiles = policy?.profiles ?? {};
  return Object.entries(profiles).map(([name, entry]) => ({ name, extends: entry?.extends ?? null }));
}

/**
 * Overlay the currently-active profile (`policy.active_profile`, a plain scalar so it's a normal
 * dashboard-writable lever) onto the base policy, if one is set. Returns `policy` unchanged when
 * `active_profile` is absent — every existing caller of `loadPolicy` that never sets this field sees
 * zero behavior change, so this is called explicitly at the specific points that need "active profile
 * takes effect" semantics (daemon boot, scheduler tick) rather than being folded into `loadPolicy`
 * itself, which ~100 call sites across this codebase depend on returning the raw parsed file.
 *
 * @param {object} policy
 * @returns {object} `policy` with the active profile's fields merged on top, `profiles`/`active_profile`
 *   keys stripped from the result (they're metadata, not runtime config)
 */
export function resolveActivePolicy(policy) {
  const activeProfile = policy?.active_profile;
  if (!activeProfile) return policy;

  const overlay = resolveProfile(policy, activeProfile);
  const { profiles: _profiles, active_profile: _active, ...base } = policy;
  return deepMerge(base, overlay);
}
