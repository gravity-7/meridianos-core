/**
 * config-hot-reload — live reload of NON-CRITICAL policy.yaml settings without a process
 * restart (T198, Phase 10 polish). "Critical" settings (auth secrets, ports, gateway.tenant,
 * the schema shape itself) intentionally stay OUT of the hot-reloadable set — those still
 * require an explicit restart, so an operator can never accidentally hot-swap something
 * security-sensitive mid-flight just by editing a file on disk.
 *
 * Every module in this repo that reads policy.yaml already does so live (budget.mjs's
 * `loadPolicy` re-parses the file on every call — see config.mjs's doc comment on why there is
 * no cached singleton). What was actually missing is a WATCHER: something that notices a
 * policy.yaml edit as it happens and (a) validates it before trusting it, (b) hands the
 * multi-tenant control plane a live, always-current snapshot of the safe-to-hot-swap subset,
 * without the caller having to poll the filesystem itself.
 *
 * `watchPolicy(policyPath, onChange)` starts a debounced `fs.watch`. Each change re-reads and
 * validates the file (policy-validate.mjs's `validatePolicy` — the coherence checker that flags
 * things like an unknown cadence or a WIP cap above the global parallel cap) — an invalid edit
 * (a YAML typo, a broken value) is reported via `onChange({ok:false, errors})` and otherwise
 * IGNORED: the last-known-good in-memory snapshot is kept, so a bad edit mid-session can never
 * crash or misconfigure a running project.
 */
import fs from 'node:fs';
import { loadPolicy } from './budget.mjs';
import { validatePolicy } from './policy-validate.mjs';

/** Dotted policy.yaml paths this module treats as safe to apply live. Anything not listed here
 *  still requires a restart to take effect — see the module doc comment above. */
export const HOT_RELOADABLE_PATHS = [
  'work.max_parallel',
  'work.wip_per_agent',
  'work.priority_floor',
  'work.lease_ttl_min',
  'work.max_runs_per_5h',
  'agent_budget.warn_pct',
  'agent_budget.per_task_tokens',
  'agent_budget.auto_downgrade_at_warn',
  'quiet_hours.enabled',
  'quiet_hours.from',
  'quiet_hours.to',
  'schedule.cadence',
  'auto_merge',
];

function getPath(obj, parts) {
  let v = obj;
  for (const p of parts) {
    if (v == null) return undefined;
    v = v[p];
  }
  return v;
}

function setPath(obj, parts, value) {
  let cursor = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    cursor = (cursor[parts[i]] ??= {});
  }
  cursor[parts[parts.length - 1]] = value;
}

/** Project the hot-reloadable subset out of a full parsed policy object. */
export function pickHotReloadable(fullPolicy, paths = HOT_RELOADABLE_PATHS) {
  const out = {};
  for (const dotted of paths) {
    const parts = dotted.split('.');
    const v = getPath(fullPolicy, parts);
    if (v !== undefined) setPath(out, parts, v);
  }
  return out;
}

// path -> { fsWatcher, timer, current, onChange }
const watchers = new Map();

function readAndValidate(policyPath) {
  const full = loadPolicy(policyPath);
  const { errors } = validatePolicy(full);
  return { full, errors };
}

/**
 * Start watching `policyPath` for changes. Returns the current hot-reloadable snapshot
 * immediately (synchronous initial read). Calling this again for a path already being watched
 * is a no-op that returns the existing snapshot (idempotent — safe to call from startProject
 * on every start without tracking watch state externally).
 *
 * @param {string} policyPath - absolute path to a project's policy.yaml
 * @param {(event: {ok: boolean, current: object, errors?: string[]}) => void} [onChange]
 * @param {{debounceMs?: number}} [options]
 * @returns {object} the current hot-reloadable settings snapshot
 */
export function watchPolicy(policyPath, onChange, { debounceMs = 150 } = {}) {
  const existing = watchers.get(policyPath);
  if (existing) return existing.current;

  const state = { fsWatcher: null, timer: null, current: {}, onChange };
  watchers.set(policyPath, state);

  const { full, errors } = readAndValidate(policyPath);
  state.current = errors.length ? {} : pickHotReloadable(full);

  if (!fs.existsSync(policyPath)) return state.current; // nothing on disk yet to watch

  try {
    state.fsWatcher = fs.watch(policyPath, () => {
      clearTimeout(state.timer);
      state.timer = setTimeout(() => {
        let result;
        try {
          result = readAndValidate(policyPath);
        } catch {
          return; // transient read (e.g. mid-write) — wait for the next change event
        }
        if (result.errors.length) {
          state.onChange?.({ ok: false, current: state.current, errors: result.errors });
          return; // keep last-known-good — never apply an invalid edit
        }
        state.current = pickHotReloadable(result.full);
        state.onChange?.({ ok: true, current: state.current });
      }, debounceMs);
    });
  } catch {
    // fs.watch is unsupported on some filesystems/platforms — hot-reload degrades to
    // "read once at watch time", which is still strictly better than throwing.
  }

  return state.current;
}

/** The latest known-good hot-reloadable snapshot for a watched path (`{}` if never watched). */
export function getHotReloadedConfig(policyPath) {
  return watchers.get(policyPath)?.current ?? {};
}

/** Stop watching a path and release its fs.watch handle. Idempotent. */
export function unwatchPolicy(policyPath) {
  const state = watchers.get(policyPath);
  if (!state) return;
  clearTimeout(state.timer);
  try { state.fsWatcher?.close(); } catch { /* best-effort */ }
  watchers.delete(policyPath);
}

/** Test/shutdown helper: stop every active watcher. */
export function unwatchAll() {
  for (const p of [...watchers.keys()]) unwatchPolicy(p);
}
