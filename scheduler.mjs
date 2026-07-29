#!/usr/bin/env node
/**
 * scheduler — the AIOS daemon. A single long-running Node process that:
 *   1. Starts the dashboard HTTP server (localhost:4317)
 *   2. Runs the watchdog tick every 60s (reap stale leases, collect health)
 *   3. Fires agent runs on the policy-defined cadence (hourly by default)
 *
 * This is the ONLY process the founder needs to keep running for full autonomy.
 * Register it as a Windows startup task:
 *   schtasks /create /tn "AIOS-Daemon" /tr "node C:\projects\propertyverdict\tools\aios\scheduler.mjs" /sc onlogon /rl highest
 *
 * Or run it manually:
 *   node tools/aios/scheduler.mjs
 *
 * Environment:
 *   AIOS_DASHBOARD_PORT  — dashboard port (default 4317)
 *   AIOS_DRY_RUN         — set to "1" to skip the real launcher (dry-run mode)
 *
 * SAFETY: if AIOS_DRY_RUN=1 or policy.kill_switch=true, no agents are spawned.
 * The scheduler itself never modifies policy.yaml — it only reads it.
 *
 * Crash resilience:
 *   • Each subsystem tick is wrapped so a throw/reject in one tick logs the error
 *     and the daemon keeps running and keeps serving :4317.
 *   • process.on('unhandledRejection') → log + continue.
 *   • process.on('uncaughtException')  → log + exit(1) so the scheduled task
 *     relaunches a clean process rather than continuing in a corrupt state.
 *   • All output is mirrored to a size-capped rotating file under .ai/logs/
 *     so the daemon is diagnosable even when launched without a console.
 */
import { openDb } from './db.mjs';
import { loadPolicy } from './budget.mjs';
import { executeRun, cadenceMs, runnerStatus } from './runner.mjs';
import { tick } from './watchdog.mjs';
import { launchAgent } from './launcher.mjs';
import { createProjectStore } from './project-store.mjs';
import { createDashboardServer } from './dashboard/server.mjs';
import { verifyCycle } from './verify-loop.mjs';
import { pushEscalations } from './escalation-push.mjs';
import { selectModel } from './router.mjs';
import { plannerCycle } from './planner.mjs';
import { pruneAllWorktrees } from './worktree.mjs';
import { restorePrimaryTreeToMain } from './boot-guard.mjs';
import { createRotatingLogger } from './daemon-logger.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAios } from './config.mjs';
import { assembleGateway } from './gateway/index.mjs';
import { syncFromAdo } from './azure-devops-source.mjs';
import { validatePolicySchema } from './policy-validate.mjs';

// Composition root: as of ★③.2 Part B, a DomainPlugin is a REQUIRED, explicitly-injected
// dependency (there is no baked-in default tenant) — so the AIOS config can no longer be
// constructed at MODULE LOAD (that would throw for every importer, including the test runner,
// which imports this module without ever calling start()). `config` is therefore assigned ONCE,
// inside `start({domain})`, and every module-scope function below reads it via closure — a plain
// reassignment of this `let`, never a redeclaration, so start()'s value is visible everywhere.
let config;
const WATCHDOG_INTERVAL_MS = 60_000; // 1 min
const MIN_CADENCE_MS = 60_000;       // safety floor: never run faster than 1 min

// ---------------------------------------------------------------------------
// Daemon-level rotating file logger (mirrors to console + .ai/logs/daemon.log)
// ---------------------------------------------------------------------------
// Like `config`, the REAL config-backed rotating logger can only be constructed once a domain is
// injected in start(). The process guards immediately below register at module load time and must
// stay functional even if start() never runs (e.g. this module merely being imported by tests) —
// so `logger` starts as a minimal console-only fallback and start() upgrades it in place.
let logger = {
  log(tag, msg) { console.log(`[aios:${tag}] ${msg}`); },
  error(tag, msg, err) { console.error(`[aios:${tag}] ${msg}${err != null ? ` — ${err?.stack ?? err}` : ''}`); },
  close() {},
};

// ---------------------------------------------------------------------------
// Global process guards
// ---------------------------------------------------------------------------

/**
 * Unhandled promise rejections: log and continue.  One bad async chain must
 * not kill the daemon and take down the dashboard.
 */
process.on('unhandledRejection', (reason) => {
  logger.error('scheduler', 'unhandledRejection', reason);
  // intentionally NOT exiting — let the daemon keep serving :4317
});

/**
 * Synchronous uncaught exceptions: these leave the process in an undefined
 * state, so we log and exit(1).  The Windows scheduled task (configured with
 * restart-on-failure) relaunches a clean process.
 */
process.on('uncaughtException', (err) => {
  logger.error('scheduler', 'uncaughtException', err);
  process.exit(1);
});

// ---------------------------------------------------------------------------

function loadMeta() {
  if (!existsSync(config.boardJson)) return {};
  try { const b = JSON.parse(readFileSync(config.boardJson, 'utf8')); return { milestones: b.milestones, founder_actions: b.founder_actions }; } catch { return {}; }
}

let db;    // raw handle — owned ONLY by the composition root (needed to close it on shutdown)
let store; // ProjectStore built over `db`, threaded into every flipped entry point below
let events; // = store.events (set alongside it in start())
let tickCount = 0;
const startedAt = Date.now();

// ---------------------------------------------------------------------------
// Extracted, testable tick bodies
// ---------------------------------------------------------------------------

/**
 * Core watchdog tick body.  All external dependencies are injected so the
 * function can be unit-tested without real sockets or a real DB.
 *
 * @param {object} deps
 * @param {object}   deps.store       the composition root's ProjectStore
 * @param {object}   deps.logger      { log, error } — rotating logger or test double
 * @param {number}   deps.tickCount   current tick counter
 * @param {number}   deps.startedAt   daemon start timestamp (ms)
 * @param {boolean}  deps.dryRun
 * @param {Function} deps._tick           watchdog.tick
 * @param {Function} deps._plannerCycle   planner.plannerCycle
 * @param {Function} deps._pushEscalations escalation-push.pushEscalations
 * @param {Function} deps._verifyCycle    verify-loop.verifyCycle
 * @param {Function} deps._selectModel    router.selectModel
 * @param {Function} deps._render         (meta) => store.render(meta)
 * @param {Function} deps._loadMeta
 * @param {Function} deps._loadPolicy
 * @param {Function} deps._pruneEvents    store.events.pruneEvents
 * @param {Function} deps._pruneHistory   store.state.pruneHistory
 * @param {object}   [deps.config]     the injected AiosConfig (defaults to the composition root's)
 */
export async function runWatchdogTick(deps) {
  const {
    store,
    logger,
    tickCount,
    startedAt,
    dryRun,
    config: cfg = config,
    _tick           = tick,
    _plannerCycle   = plannerCycle,
    _pushEscalations = pushEscalations,
    _verifyCycle    = verifyCycle,
    _selectModel    = selectModel,
    _render         = (meta) => store.render(meta),
    _loadMeta       = loadMeta,
    _loadPolicy     = loadPolicy,
    _pruneEvents    = store.events.pruneEvents,
    _pruneHistory   = store.state.pruneHistory,
    _syncFromAdo    = syncFromAdo,
  } = deps;
  const events = store.events;

  try {
    const policy = _loadPolicy(undefined, cfg);

    // Watchdog: reap stale leases, collect health, heartbeat/prune. Isolated
    // so a throw here does not starve the planner/verify subsystems below for
    // the rest of this cycle.
    let h;
    try {
      h = _tick(store, { policy, config: cfg });
      if (h.reaped?.length) logger.log('watchdog', `reaped: ${h.reaped.join(', ')}`);

      // Heartbeat every 10th tick (~10 min)
      if (tickCount % 10 === 0) {
        events.info('scheduler', 'heartbeat', { tick: tickCount, uptimeMin: Math.round((Date.now() - startedAt) / 60_000) });
        _pruneEvents();
        try { _pruneHistory(); } catch { /* best-effort */ }
      }
    } catch (tickErr) {
      logger.error('watchdog', `tick-error: ${tickErr?.message ?? String(tickErr)}`, tickErr);
      events.error('watchdog', 'tick-error', { error: tickErr?.message ?? String(tickErr) });
    }

    // Azure DevOps sync (if enabled): pull ADO features into board tasks before planner cycle
    try {
      if (policy?.integrations?.azure_devops?.enabled) {
        const syncRes = await _syncFromAdo({ store, config: cfg, policy });
        if (syncRes.created > 0 || syncRes.updated > 0) {
          logger.log('scheduler', `ADO sync: created=${syncRes.created}, updated=${syncRes.updated}, skipped=${syncRes.skipped}`);
        }
      }
    } catch (syncErr) {
      logger.error('scheduler', `ADO sync error: ${syncErr?.message ?? String(syncErr)}`, syncErr);
    }

    // Planner: auto-promote proposed → spec → designing. Isolated so a throw
    // here does not skip the escalation push or verify loop below.
    try {
      const pc = _plannerCycle(store, { now: Date.now(), config: cfg });
      if (pc.promoted.length) {
        logger.log('planner', `promoted: ${pc.promoted.map(p => `${p.id} (${p.from}→${p.to})`).join(', ')}`);
        events.info('planner', 'promote', { promoted: pc.promoted });

        // G2: non-blocking spec/design-complete pings — piggybacked on the existing escalation
        // webhook (Discord/Slack). The system keeps flowing regardless; founder can optionally
        // open the dashboard and bounce a task back one stage if unhappy with the output.
        const port = cfg.dashboardPort ?? 4317;
        const dashUrl = `http://localhost:${port}/`;
        const stageNotifications = [
          ...pc.promoted
            .filter(p => p.from === 'spec' && p.to === 'designing')
            .map(p => ({
              id: `spec-done-${p.id}-${Date.now()}`,
              level: 'info',
              message: `📋 Spec ready: **${p.id}** — pipeline continues to design. Open the dashboard to review or bounce it back.`,
              detail: dashUrl,
            })),
          ...pc.promoted
            .filter(p => p.from === 'designing' && p.to === 'ready-for-impl')
            .map(p => ({
              id: `design-done-${p.id}-${Date.now()}`,
              level: 'info',
              message: `🎨 Design ready: **${p.id}** — moving to implementation. Open the dashboard to review or bounce it back.`,
              detail: dashUrl,
            })),
        ];
        if (stageNotifications.length > 0) {
          // Fire-and-forget — .catch swallows failures so pipeline is never blocked by webhook errors
          _pushEscalations(stageNotifications, { policy, config: cfg }).catch((e) => {
            logger.log('escalation', `stage-notify push error: ${e?.message ?? String(e)}`);
          });
        }
      }
    } catch (plannerErr) {
      logger.error('planner', `cycle-error: ${plannerErr?.message ?? String(plannerErr)}`, plannerErr);
      events.error('planner', 'cycle-error', { error: plannerErr?.message ?? String(plannerErr) });
    }


    // Push escalations via webhook. `h` is undefined if the watchdog tick
    // above threw, so guard rather than skipping the rest of the cycle.
    if (h?.escalations?.length > 0) {
      try {
        const pushResult = await _pushEscalations(h.escalations, { policy, config: cfg });
        if (pushResult.sent > 0) {
          logger.log('escalation', `pushed ${pushResult.sent} escalation(s)`);
          events.info('escalation', 'push', { sent: pushResult.sent });
        }
        if (pushResult.error) {
          logger.log('escalation', `push error: ${pushResult.error}`);
          events.error('escalation', 'push-fail', { error: pushResult.error });
        }
      } catch (pushErr) {
        logger.log('escalation', `push error: ${pushErr.message}`);
        events.error('escalation', 'push-fail', { error: pushErr.message });
      }
    }

    // Run the verify loop (check in-review tasks, merge on pass). Isolated so
    // a throw here still lets the render below run.
    try {
      const modelSelector = (agent) => _selectModel(policy, agent, 'ok', null, cfg.domain);
      const vr = await _verifyCycle(store, { policy, selectModel: modelSelector, dryRun, config: cfg });
      if (vr.merged.length) {
        logger.log('verifier', `merged: ${vr.merged.map(m => m.task).join(', ')}`);
        events.info('verifier', 'merge', { tasks: vr.merged.map(m => m.task) });
      }
      if (vr.failed.length) {
        logger.log('verifier', `failed: ${vr.failed.map(f => f.task).join(', ')}`);
        events.warn('verifier', 'check-fail', { tasks: vr.failed.map(f => f.task) });
      }
      if (vr.pending.length) logger.log('verifier', `pending: ${vr.pending.join(', ')}`);
    } catch (verifyErr) {
      logger.error('verifier', `cycle-error: ${verifyErr?.message ?? String(verifyErr)}`, verifyErr);
      events.error('verifier', 'cycle-error', { error: verifyErr?.message ?? String(verifyErr) });
    }

    // Re-render after state changes
    try { _render(_loadMeta()); } catch (renderErr) {
      events.warn('scheduler', 'render-fail', { error: renderErr.message });
    }
  } catch (e) {
    // Belt-and-suspenders outer catch: any subsystem that slips past its own
    // guard lands here.  Log and return — never re-throw.
    logger.error('watchdog', `tick-error: ${e?.message ?? String(e)}`, e);
    events.error('watchdog', 'tick-error', { error: e?.message ?? String(e) });
  }
}

/**
 * Core runner cycle body.  All external dependencies are injected so the
 * function can be unit-tested without real spawns or a real DB.
 *
 * @param {object} deps
 * @param {object}   deps.store    the composition root's ProjectStore
 * @param {object}   deps.logger
 * @param {boolean}  deps.dryRun
 * @param {Function} deps._executeRun   runner.executeRun
 * @param {Function} deps._render       (meta) => store.render(meta)
 * @param {Function} deps._loadMeta
 * @param {Function} deps._loadPolicy
 * @param {Function} deps._launchAgent  launcher.launchAgent
 * @param {object}   [deps.config]   the injected AiosConfig (defaults to the composition root's)
 */
export async function runRunnerCycle(deps) {
  const {
    store,
    logger,
    dryRun,
    config: cfg   = config,
    _executeRun   = executeRun,
    _render       = (meta) => store.render(meta),
    _loadMeta     = loadMeta,
    _loadPolicy   = loadPolicy,
    _launchAgent  = launchAgent,
  } = deps;
  const events = store.events;

  try {
    const policy  = _loadPolicy(undefined, cfg);
    const launcher = dryRun ? undefined : _launchAgent;

    const result = await _executeRun({ store, policy, launch: launcher, config: cfg });

    // Re-render the board after any state changes
    try { _render(_loadMeta()); } catch (renderErr) {
      events.warn('scheduler', 'render-fail', { error: renderErr.message });
    }

    if (result.fired) {
      logger.log('runner', `fired ${result.runs.length} run(s)`);
      for (const r of result.runs) logger.log('runner', `  → ${r.agent} ${r.task} ${r.outcome}: ${r.note}`);
    } else {
      logger.log('runner', `skipped: ${result.reason}`);
    }
  } catch (e) {
    // Belt-and-suspenders outer catch: log and return — never re-throw.
    logger.error('runner', `cycle-error: ${e?.message ?? String(e)}`, e);
    events.error('runner', 'cycle-error', { error: e?.message ?? String(e) });
  }
}

// ---------------------------------------------------------------------------
// Scheduler internals (thin wrappers that isolate tick errors)
// ---------------------------------------------------------------------------

/** Watchdog tick: reap stale leases, collect health, push escalations, run verify loop. */
async function watchdogTick() {
  tickCount++;
  try {
    await runWatchdogTick({
      store,
      logger,
      tickCount,
      startedAt,
      dryRun: process.env.AIOS_DRY_RUN === '1',
      config,
    });
  } catch (e) {
    // Belt-and-suspenders: runWatchdogTick should not throw (it has its own
    // internal guards), but if something slips through we catch it here so the
    // setInterval loop — and therefore :4317 — stay alive.
    logger.error('watchdog', 'tick-escaped', e);
    events.error('watchdog', 'tick-escaped', { error: e?.message ?? String(e) });
  }
}

/** Runner cycle: decide, claim, launch. */
async function runCycle() {
  try {
    await runRunnerCycle({
      store,
      logger,
      dryRun: process.env.AIOS_DRY_RUN === '1',
      config,
    });
  } catch (e) {
    // Same belt-and-suspenders pattern as watchdogTick.
    logger.error('runner', 'cycle-escaped', e);
    events.error('runner', 'cycle-escaped', { error: e?.message ?? String(e) });
  }
}

/** Re-read cadence from policy and reschedule the runner interval. */
let runnerTimer = null;
let currentCadence = null;
function scheduleRunner({ force = false } = {}) {
  const policy = loadPolicy(undefined, config);
  const cadence = policy?.schedule?.cadence ?? 'off';

  if (!force && cadence === currentCadence) return;
  currentCadence = cadence;

  if (runnerTimer) clearInterval(runnerTimer);
  const ms = cadenceMs(cadence);

  if (!ms) {
    runnerTimer = null;
    logger.log('scheduler', `cadence=${cadence} — runner disabled (manual/event only)`);
    return;
  }

  const safems = Math.max(ms, MIN_CADENCE_MS);
  logger.log('scheduler', `cadence=${cadence} (${safems / 1000}s)`);
  runnerTimer = setInterval(runCycle, safems);
}

/** Policy watcher: re-read cadence every 5 minutes in case the founder changed it. */
function startPolicyWatcher() {
  setInterval(() => {
    try { scheduleRunner(); } catch (e) {
      events.warn('scheduler', 'policy-reload-fail', { error: e.message });
    }
  }, 5 * 60_000);
}

/**
 * Gateway wiring: always starts the gateway sidecar (default-ON since Phase 0).
 * When `policy.gateway.disabled === true`, skips startup (opt-out).
 * Returns the `config.gateway` shape launcher.mjs consumes ({ enabled, url, runs, registry }) plus a
 * close(). `_assembleGateway` is injected for tests.
 */
export async function maybeStartGateway({ config, policy, port = 0, tenant = 'pv', _assembleGateway = assembleGateway }) {
  if (policy?.gateway?.disabled === true) return { gatewayConfig: undefined, close: () => {} };
  const asm = await _assembleGateway({ config, policy, port, tenant });
  return {
    gatewayConfig: { enabled: true, url: asm.url, runs: asm.runs, registry: asm.store.get() },
    close: asm.close,
  };
}

/**
 * Start the AIOS daemon.
 * @param {object} [opts]
 * @param {object} [opts.domain]  the tenant's DomainPlugin (REQUIRED — see config.mjs). The PV
 *                                launcher (`tools/aios/scheduler.mjs`) passes `PV_DOMAIN`; there is
 *                                no default here, so calling `start()` with no domain throws.
 */
export async function start({ domain } = {}) {
  // Composition root: construct the AIOS config ONCE at daemon startup, from the caller's injected
  // domain, and upgrade the console-only fallback logger to the real config-backed rotating one.
  // This must be the very first thing start() does — everything below (and every module-scope
  // function this file exports) reads `config`/`logger` via closure.
  ({ config } = createAios({ domain }));
  logger = createRotatingLogger({ config });

  // Load repo-root .env (gitignored) so runtime secrets like AIOS_ESCALATION_WEBHOOK are available.
  try {
    const envPath = join(config.repoRoot, '.env');
    if (existsSync(envPath) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envPath);
  } catch { /* best-effort */ }

  db = openDb(undefined, config);
  store = createProjectStore({ db, config });
  events = store.events;
  const port = Number(process.env.AIOS_DASHBOARD_PORT) || 4317;

  // 1. Dashboard — bind the :4317 socket FIRST, before the (potentially slow, git-heavy) boot
  // recovery below, so the control panel is reachable as early as possible on startup rather than
  // after several git/gh subprocesses. Recovery + the first ticks still share this one event loop,
  // so /healthz becomes responsive the moment the loop is free.
  createDashboardServer(config).listen(port, '127.0.0.1', () => {
    logger.log('dashboard', `http://localhost:${port}`);
  });

  // Boot tree-hygiene recovery (early, right after the dashboard binds): the PRIMARY working tree must only ever carry
  // generated board drift — all agent work happens in isolated worktrees. It has repeatedly been
  // found stranded on an agent's feature branch after a crash/prune/merge race on Windows, which
  // breaks the founder's manual git pull/merge. Auto-heal: if HEAD != main, discard the generated
  // board drift and switch back. Non-generated uncommitted changes are left untouched (skipped).
  try {
    const r = restorePrimaryTreeToMain({ config });
    if (r.switched) {
      logger.log('boot', `WARN: primary tree was stranded on '${r.from}' — restored to main (discarded board drift)`);
      events.warn('boot', 'primary-tree-restored', { from: r.from });
    } else if (r.reason === 'dirty') {
      logger.log('boot', `WARN: primary tree on '${r.from}' has non-board uncommitted changes (${r.dirty.join(', ')}) — leaving it untouched; manual cleanup needed`);
      events.warn('boot', 'primary-tree-stranded-dirty', { from: r.from, dirty: r.dirty });
    } else if (r.reason === 'switch-failed' || r.reason === 'head-unknown') {
      logger.error('boot', `primary-tree restore failed (${r.reason}): ${r.error || ''}`);
      events.error('boot', 'primary-tree-restore-fail', { reason: r.reason, error: r.error });
    }
  } catch (e) { events.warn('boot', 'primary-tree-guard-fail', { error: e.message }); }

  // Clean any worktrees orphaned by a previous crash (agents from a dead daemon are gone anyway).
  try { const p = pruneAllWorktrees(config); if (p.removed) logger.log('worktree', `pruned ${p.removed} orphaned worktree(s)`); } catch { /* best-effort */ }

  // Boot lease recovery (RCA-4): any agent a previous daemon launched died with it, so its lease is
  // an orphan. Free every live lease now — the TTL reaper would otherwise sit on non-expired ones
  // for up to lease_ttl_min, wedging a max_parallel slot after every crash/restart.
  try { const r = store.state.releaseAllLeases(); if (r.freed.length) logger.log('boot', `freed ${r.freed.length} orphaned lease(s): ${r.freed.join(', ')}`); } catch (e) { events.warn('scheduler', 'boot-lease-recovery-fail', { error: e.message }); }

  // Metering/enforcement gateway (default-ON since Phase 0). Set gateway.disabled: true to opt out.
  const gwPolicy = loadPolicy(undefined, config);
  const gwPort = Number(process.env.AIOS_GATEWAY_PORT) || (gwPolicy?.gateway?.port ?? 0);
  const gwTenant = gwPolicy?.gateway?.tenant ?? 'pv';
  let closeGateway = () => {};

  // Phase 0: Validate unified policy configuration at boot
  const schemaResult = validatePolicySchema(gwPolicy);
  if (!schemaResult.ok) {
    for (const errMsg of schemaResult.errors) {
      logger.log('config', `ERROR: ${errMsg}`);
    }
  }

  const gw = await maybeStartGateway({ config, policy: gwPolicy, port: gwPort, tenant: gwTenant });
  if (gw.gatewayConfig) {
    config.gateway = gw.gatewayConfig;
    closeGateway = gw.close;
    logger.log('gateway', `sidecar auto-started at ${config.gateway.url} (tenant ${gwTenant}) — set gateway.disabled: true to opt out`);
    events.info('gateway', 'start', { url: config.gateway.url, tenant: gwTenant });
  }

  // 2. Watchdog
  setInterval(watchdogTick, WATCHDOG_INTERVAL_MS);
  watchdogTick(); // first tick immediately

  // 3. Model discovery tick (daily, 003 US4)
  const MODEL_DISCOVERY_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
  try {
    const { discoverAllModels: discoverModels } = await import('./model-discovery.mjs');
    const runModelDiscovery = async () => {
      try {
        const policy = loadPolicy(undefined, config);
        const gwDb = openDb(undefined, config);
        globalThis.__modelsRefreshing = true;
        const result = await discoverModels(gwDb, policy, config);
        globalThis.__modelsRefreshing = false;
        logger.log('discovery', `${result.modelsDiscovered} model(s) from ${result.providersScanned} provider(s)`);
        gwDb.close();
      } catch (e) {
        globalThis.__modelsRefreshing = false;
        logger.error('discovery', `model discovery failed: ${e.message}`, e);
      }
    };
    setInterval(runModelDiscovery, MODEL_DISCOVERY_INTERVAL_MS);
    // First discovery after 5min boot delay
    setTimeout(runModelDiscovery, 5 * 60 * 1000);
  } catch (e) {
    logger.log('discovery', `model discovery not available: ${e.message}`);
  }

  // 4. Pricing refresh tick (daily, sequenced after model discovery, 003 US6)
  const PRICING_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
  try {
    const { refreshAllModelPricing: refreshPricing } = await import('./pricing-refresh.mjs');
    const runPricingRefresh = async () => {
      try {
        const policy = loadPolicy(undefined, config);
        const gwDb = openDb(undefined, config);
        const result = await refreshPricing(gwDb, policy, config);
        logger.log('pricing', `${result.refreshed ?? 0} model(s) priced`);
        gwDb.close();
      } catch (e) {
        logger.error('pricing', `pricing refresh failed: ${e.message}`, e);
      }
    };
    // Offset pricing refresh by 30 minutes from model discovery to let discovery finish first
    setInterval(runPricingRefresh, PRICING_REFRESH_INTERVAL_MS);
    setTimeout(runPricingRefresh, 35 * 60 * 1000);
  } catch (e) {
    logger.log('pricing', `pricing refresh not available: ${e.message}`);
  }

  // 5. Runner on cadence
  scheduleRunner({ force: true });
  startPolicyWatcher();

  // 4. "Run now" hook — the dashboard POST /api/run-now triggers this
  globalThis.__aiosRunNow = () => { runCycle(); return { ok: true, note: 'run cycle triggered' }; };

  // 5. First run after a short boot delay (let the dashboard come up first)
  setTimeout(runCycle, 5_000);

  const cadence = loadPolicy(undefined, config)?.schedule?.cadence ?? 'off';
  events.info('scheduler', 'start', { port, cadence });
  logger.log('scheduler', 'AIOS daemon started — Ctrl+C to stop');

  // Graceful shutdown
  const shutdown = () => {
    events.info('scheduler', 'shutdown');
    logger.log('scheduler', 'shutting down...');
    if (runnerTimer) clearInterval(runnerTimer);
    try { closeGateway(); } catch { /* best-effort — never block shutdown */ }
    logger.close();
    db?.close?.();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Only run the daemon when this file is the direct entry point.  When it is
// imported by the test runner (or any other module), we export the tick
// functions for unit testing without starting the server or scheduling timers.
const _isMain = fileURLToPath(import.meta.url) === process.argv[1];
if (_isMain) start().catch((e) => { console.error('[aios:scheduler] start failed', e); process.exit(1); });
