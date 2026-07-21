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
import { loadPolicy, budgetStatus } from './budget.mjs';
import { executeRun, cadenceMs, runnerStatus } from './runner.mjs';
import { tick } from './watchdog.mjs';
import { launchAgent } from './launcher.mjs';
import { createProjectStore } from './project-store.mjs';
import { createDashboardServer } from './dashboard/server.mjs';
import { verifyCycle } from './verify-loop.mjs';
import { pushEscalations, pushToSlack, formatVerifierFailure, formatBudgetAlert, routeToSlack } from './escalation-push.mjs';
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
import { runBootChecks, formatBootCheckResults } from './boot-check.mjs';
import { resolveAdoConfig, syncToBoard, syncFromBoard } from './azure-devops-source.mjs';

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

        // F007: Slack push for verifier failures
        try {
          const slackRoute = routeToSlack(cfg, 'verifier_failure', policy);
          if (slackRoute.route) {
            const domain = cfg.domain?.boardTitle || cfg.domain?.agents?.[0] || 'meridianos';
            const msg = formatVerifierFailure(domain, vr.failed);
            const slackRes = await pushToSlack(slackRoute.webhookUrl, msg);
            if (!slackRes.ok) {
              logger.log('slack', `verifier push error: ${slackRes.error}`);
            }
          }
        } catch (slackErr) {
          // Slack failures never crash the daemon
          logger.log('slack', `verifier push error: ${slackErr?.message ?? String(slackErr)}`);
        }
      }
      if (vr.pending.length) logger.log('verifier', `pending: ${vr.pending.join(', ')}`);
    } catch (verifyErr) {
      logger.error('verifier', `cycle-error: ${verifyErr?.message ?? String(verifyErr)}`, verifyErr);
      events.error('verifier', 'cycle-error', { error: verifyErr?.message ?? String(verifyErr) });
    }

    // ADO bi-directional sync (F006): pull ADO → board, then push board → ADO.
    // Isolated so a network/auth failure in the ADO connector never takes down
    // the daemon or skips the render below.
    try {
      const adoCfg = resolveAdoConfig(policy);
      if (adoCfg) {
        // Pull: ADO work items → MeridianOS board
        const toResult = await syncToBoard(adoCfg, store);
        if (toResult.created > 0 || toResult.updated > 0) {
          logger.log('ado', `sync→board: +${toResult.created} ~${toResult.updated} (${toResult.skipped} skipped)`);
          events.info('ado', 'sync-to-board', { created: toResult.created, updated: toResult.updated, skipped: toResult.skipped });
        }
        if (toResult.errors.length > 0) {
          for (const err of toResult.errors) logger.log('ado', `sync→board error: ${err}`);
        }

        // Push: MeridianOS board status changes → ADO
        const fromResult = await syncFromBoard(adoCfg, store);
        if (fromResult.pushed > 0) {
          logger.log('ado', `sync←board: pushed ${fromResult.pushed} status update(s) (${fromResult.skipped} skipped)`);
          events.info('ado', 'sync-from-board', { pushed: fromResult.pushed, skipped: fromResult.skipped });
        }
        if (fromResult.errors.length > 0) {
          for (const err of fromResult.errors) logger.log('ado', `sync←board error: ${err}`);
        }
      }
    } catch (adoErr) {
      logger.error('ado', `sync error: ${adoErr?.message ?? String(adoErr)}`, adoErr);
      events.error('ado', 'sync-error', { error: adoErr?.message ?? String(adoErr) });
    }

    // F007: Budget threshold check — push Slack alerts when any agent exceeds warn/halt threshold.
    // Isolated so a budget query or Slack failure never skips the render below.
    try {
      const budget = budgetStatus({ config: cfg, policy });
      if (budget) {
        for (const agent of (cfg.domain.agents ?? [])) {
          const agentBudget = budget[agent];
          if (agentBudget && agentBudget.state !== 'ok') {
            // Only alert on warn/halt — not 'no-cap' or 'ok'
            const slackRoute = routeToSlack(cfg, 'budget_breach', policy);
            if (slackRoute.route) {
              const domain = cfg.domain?.boardTitle || 'meridianos';
              const msg = formatBudgetAlert(domain, agent, agentBudget);
              if (msg) {
                const slackRes = await pushToSlack(slackRoute.webhookUrl, msg);
                if (!slackRes.ok) {
                  logger.log('slack', `budget push error: ${slackRes.error}`);
                } else {
                  logger.log('slack', `budget alert sent for ${agent} (${agentBudget.state})`);
                }
              }
            }
          }
        }
      }
    } catch (budgetSlackErr) {
      // Slack/budget failures never crash the daemon
      logger.log('slack', `budget check error: ${budgetSlackErr?.message ?? String(budgetSlackErr)}`);
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
 * Opt-in gateway wiring: when policy.gateway.enabled === true, assemble a gateway sidecar and
 * return the `config.gateway` shape launcher.mjs consumes ({ enabled, url, runs, registry }) plus a
 * close(). When not enabled, returns { gatewayConfig: undefined, close: a no-op } and does NOT call
 * assembleGateway at all (byte-identical to pre-gateway behavior). `_assembleGateway` is injected
 * for tests.
 */
export async function maybeStartGateway({ config, policy, port = 0, tenant = 'pv', _assembleGateway = assembleGateway }) {
  if (policy?.gateway?.enabled !== true) return { gatewayConfig: undefined, close: () => {} };
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

  // ── Pre-flight checks ──
  // Run BEFORE binding ports or touching git. Fatal issues → clean exit with actionable fixes.
  const port = Number(process.env.AIOS_DASHBOARD_PORT) || 4317;
  const bootPolicy = loadPolicy(undefined, config);
  const checks = await runBootChecks({ config, policy: bootPolicy, dashboardPort: port });
  console.log(formatBootCheckResults(checks));
  if (!checks.allClear) {
    console.error('Pre-flight checks failed. Fix the issues above and restart.');
    process.exit(1);
  }

  db = openDb(undefined, config);
  store = createProjectStore({ db, config });
  events = store.events;

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

  // Opt-in metering/enforcement gateway (config.gateway drives launcher.mjs's injection). Off by
  // default — a tenant with no policy.gateway block is byte-identical to before.
  const gwPolicy = loadPolicy(undefined, config);
  const gwPort = Number(process.env.AIOS_GATEWAY_PORT) || (gwPolicy?.gateway?.port ?? 0);
  const gwTenant = gwPolicy?.gateway?.tenant ?? 'pv';
  let closeGateway = () => {};
  const gw = await maybeStartGateway({ config, policy: gwPolicy, port: gwPort, tenant: gwTenant });
  if (gw.gatewayConfig) {
    config.gateway = gw.gatewayConfig;
    closeGateway = gw.close;
    logger.log('gateway', `sidecar ${config.gateway.url} (tenant ${gwTenant})`);
    events.info('gateway', 'start', { url: config.gateway.url, tenant: gwTenant });
  }

  // 2. Watchdog
  setInterval(watchdogTick, WATCHDOG_INTERVAL_MS);
  watchdogTick(); // first tick immediately

  // 3. Runner on cadence
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
