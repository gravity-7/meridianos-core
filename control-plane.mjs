/**
 * control-plane — the L1 (single-machine, single-process) supervisor over N declarative project
 * records (card C5, ADR 0001 D3.2). One operator, one process, many projects: `add()` turns a
 * DomainPlugin record (card C2's `domain-record.mjs` contract) into a fully-isolated AIOS instance
 * — its own `createAios({root, domain})` (own state store, own worktree root, own policy.yaml, own
 * tenant label) — and `tickAll()` runs ONE supervisor pass over every registered project.
 *
 * Isolation model:
 *   - PER-PROJECT (nothing shared): the AIOS config `createAios` returns — `resolvePaths` derives
 *     every path (dbPath, policyPath, worktreeRoot, ...) from THAT project's own `root`, so two
 *     projects registered here never read/write the same file. config.mjs already guarantees zero
 *     shared mutable module state for this (see its own doc comment) — this module leans on that
 *     rather than reimplementing isolation.
 *   - SHARED (by design, the one exception): the `gateway` — a single sidecar assembled once
 *     (gateway/index.mjs's `assembleGateway`) and passed into `createControlPlane` unchanged.
 *     Cross-project separation on the shared ledger comes from the per-project `tenant` label
 *     (gateway/ledger.mjs's events are tenant-scoped rows in one ledger, not one ledger per tenant).
 *
 * `tickAll()` isolates failures PER PROJECT: one project's tick throwing is caught and reported as
 * that project's own `{ok:false, error}` Result — it never aborts or contaminates any other
 * project's tick in the same pass (AC4).
 *
 * L1 ONLY: same machine, same process, no containers, no Postgres, no live registry push/pull.
 * Those are later cards.
 */
import { validateDomainRecord, loadDomainRecord } from './domain-record.mjs';
import { createAios } from './config.mjs';
import { loadPolicy } from './budget.mjs';
import { openDb } from './db.mjs';
import { createProjectStore } from './project-store.mjs';
import { tick as watchdogTick } from './watchdog.mjs';

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/** The tenant label for a project: an explicit `record.tenant` wins; otherwise fall back to the
 *  project's own `policy.yaml` (`policy.gateway.tenant`, the same field scheduler.mjs's
 *  `maybeStartGateway` reads at boot) — read via the project's OWN isolated `config`, never a
 *  shared one; a project with neither just uses its own name (still unique across the fleet, since
 *  `record.name` is the projectId). loadPolicy never throws — a missing/absent policy.yaml simply
 *  yields `{}`, so this works for a hermetic project with no policy file on disk. */
function deriveTenant(record, config) {
  if (isNonEmptyString(record.tenant)) return record.tenant;
  const policy = loadPolicy(undefined, config);
  return policy?.gateway?.tenant ?? record.name;
}

function toHandle(project) {
  return { id: project.id, name: project.name, root: project.root, tenant: project.tenant };
}

/**
 * The default `tick` implementation: one REAL watchdog cycle (reap + health + escalations, see
 * watchdog.mjs's `tick`) against the project's own on-disk state store, opened fresh and closed
 * again each pass (an MVP-simple choice — no long-lived per-project db handle to manage yet). The
 * shared `gateway` (when supplied) is forwarded alongside `config` for a future tick implementation
 * to use for metering; this default only reaps/reports and never launches an agent or touches the
 * network — L1 supervision, not L1 execution.
 */
function defaultTick({ config, gateway } = {}) {
  const db = openDb(undefined, config);
  try {
    const store = createProjectStore({ db, config });
    return watchdogTick(store, { config, ...(gateway ? { gateway } : {}) });
  } finally {
    try { db.close(); } catch { /* best-effort */ }
  }
}

/**
 * Build a control plane over an initially-empty (or pre-seeded, via `projects`) fleet.
 *   - `projects` — optional array of records to `add()` immediately (same validation as a later
 *     `add()` call; a bad seed record throws just like a bad `add()` call would).
 *   - `gateway`  — the SHARED gateway sidecar (e.g. `assembleGateway(...)`'s return value), or
 *     `null` if this control plane runs with no gateway wired up yet.
 *   - `tick`     — injectable per-project tick function, `({config, gateway, project}) => result`.
 *     Defaults to `defaultTick` (real watchdog reap+report). Tests inject a stub.
 */
export function createControlPlane({ projects = [], gateway = null, tick = defaultTick } = {}) {
  const registry = new Map(); // id -> { id, name, root, tenant, aios }

  function add(record) {
    const { ok, errors } = validateDomainRecord(record);
    if (!ok) {
      throw new Error(`createControlPlane.add: invalid project record:\n  - ${errors.join('\n  - ')}`);
    }
    if (!isNonEmptyString(record.root)) {
      throw new Error('createControlPlane.add: invalid project record:\n  - root: required (non-empty string project root path)');
    }
    const id = record.name;
    if (registry.has(id)) {
      throw new Error(`createControlPlane.add: a project named "${id}" is already registered`);
    }

    // Compile the record into a DomainPlugin, then build a FULLY ISOLATED AIOS instance from it —
    // own state store, own worktree root, own policy.yaml, own tenant label. No shared mutable
    // state with any other registered project (config.mjs's own guarantee).
    const domain = loadDomainRecord(record);
    const aios = createAios({ root: record.root, domain });
    const tenant = deriveTenant(record, aios.config);

    registry.set(id, { id, name: record.name, root: record.root, tenant, aios });
    return id;
  }

  async function tickAll() {
    const results = [];
    for (const project of registry.values()) {
      try {
        const result = await tick({ config: project.aios.config, gateway, project: toHandle(project) });
        results.push({ id: project.id, ok: true, result });
      } catch (error) {
        results.push({ id: project.id, ok: false, error });
      }
    }
    return results;
  }

  function list() {
    return [...registry.values()].map(toHandle);
  }

  function remove(id) {
    return registry.delete(id);
  }

  for (const record of projects) add(record);

  return { add, tickAll, list, remove };
}
