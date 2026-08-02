/**
 * dashboard/server — the founder's live control panel. Zero-dependency node:http server that
 *   GET  /             → serves index.html (the live dashboard)
 *   GET  /api/status   → buildStatus() JSON (budget, active leases, queue, runs, policy)
 *   POST /api/policy   → writes lever changes back to .ai/policy.yaml (whitelisted paths only)
 *
 * It only writes the founder-controlled lever set (LEVER_PATHS) via the surgical policy writer,
 * so a Save can never reshape the file or touch anything outside the control panel. Bind to
 * localhost — this is a single-operator local tool, not a public service.
 */
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFileSync, existsSync } from 'node:fs';
import { randomUUID, randomBytes } from 'node:crypto';
import { join, dirname } from 'node:path';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import url from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { buildStatus } from '../status.mjs';
import { openDb } from '../db.mjs';
import { createProjectStore } from '../project-store.mjs';
import { createAios } from '../config.mjs';
import { writePolicy, LEVER_PATHS } from '../policy-write.mjs';
import { loadPolicy, providerBreakdownFromLedger } from '../budget.mjs';
import { validatePolicy, applyDottedUpdates } from '../policy-validate.mjs';
import { handleAction } from './actions.mjs';
import { readSpec, writeSpec } from './spec-file.mjs';
import { openLedger, queryWindow, listEvents } from '../gateway/ledger.mjs';
import { queryOverview, queryTimeseries, queryBreakdown, queryTaskCost, queryProjectCosts, computeBudgetForecast, detectAnomalies } from '../analytics.mjs';
import { getLastAggregatedHour, getLastAggregatedDay } from '../aggregation.mjs';
import { readRuns } from '../runlog.mjs';
import { getProviderHealth } from '../provider-health.mjs';
import { detectInstalledIdes, generateProxyConfig, testIdeConnectivity, KNOWN_IDES } from '../ide-proxy.mjs';
import { generateToken, verifyToken, refreshToken as jwtRefreshToken } from '../auth/jwt.mjs';
import { getUserStore, verifyPassword, hashPassword } from '../auth/user-store.mjs';
import { getAPITokenManager } from '../auth/api-tokens.mjs';
import { ProjectManager, getProjectManager as getGlobalProjectManager, getTemplateLoader } from '../control-plane.mjs';
import { getOAuthProvider } from '../auth/oauth-provider.mjs';
import { SOC2Report } from '../compliance/reports/soc2.mjs';
import { GDPRReport } from '../compliance/reports/gdpr.mjs';
import { CostAllocationReport } from '../compliance/reports/cost-allocation.mjs';
import { ModelUsageReport } from '../compliance/reports/model-usage.mjs';

// Import ProjectManager for multi-tenant project management
let _projectManager = null;
function getProjectManager() {
  if (!_projectManager) {
    _projectManager = getGlobalProjectManager();
  }
  return _projectManager;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX = join(HERE, 'index.html');
const ALLOWED = new Set(LEVER_PATHS);
const ACTION_PATHS = new Set(['/api/run', '/api/task', '/api/verify', '/api/escalation']);
const STATUS_TTL_MS = 2000; // dedupe bursty polls; buildStatus rescans transcripts, so don't do it per-request

// Rate limiting state
const rateLimits = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 100;

function checkRateLimit(ip) {
  const now = Date.now();
  if (!rateLimits.has(ip)) {
    rateLimits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return true;
  }
  const state = rateLimits.get(ip);
  if (now > state.resetAt) {
    state.count = 1;
    state.resetAt = now + RATE_LIMIT_WINDOW;
    return true;
  }
  if (state.count >= MAX_REQUESTS_PER_WINDOW) {
    return false;
  }
  state.count++;
  return true;
}

// Per-boot auth token (postmortem security P1). The dashboard binds to 127.0.0.1, but that alone
// lets ANY local process — or a malicious web page doing a cross-origin POST — flip levers or trigger
// a restart. Every mutating request must carry this token (injected into the served page) AND a
// same-origin Host/Origin. GET /api/status stays open (read-only). Env override for embedding tools.
const AUTH_TOKEN = process.env.AIOS_DASH_TOKEN || randomUUID();
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** True if a mutating request is same-origin (Host + any Origin are loopback) AND carries the token. */
function authorized(req) {
  const host = String(req.headers.host || '').split(':')[0];
  if (!LOOPBACK_HOSTS.has(host)) return false;
  const origin = req.headers.origin;
  if (origin) {
    let oh; try { oh = new URL(origin).hostname; } catch { return false; }
    if (!LOOPBACK_HOSTS.has(oh)) return false; // cross-origin POST → reject (CSRF)
  }
  return req.headers['x-aios-token'] === AUTH_TOKEN;
}

/** Build the exec-command map for a given tenant CLI path. `cliPath` defaults to
 *  'tools/aios/cli.mjs' (PV's runner) via config.mjs's resolveDomain, so the default map here is
 *  byte-identical to the old module-level constant. */
function buildExecCommands(cliPath) {
  return {
    validate:     ['node', [cliPath, 'validate']],
    list:         ['node', [cliPath, 'list']],
    'run --dry':  ['node', [cliPath, 'run', '--dry']],
    tick:         ['node', [cliPath, 'tick']],
    plan:         ['node', [cliPath, 'plan']],
    render:       ['node', [cliPath, 'render']],
    'verify --dry': ['node', [cliPath, 'verify', '--dry']],
    reap:         ['node', [cliPath, 'reap']],
    seed:         ['node', [cliPath, 'seed']],
  };
}

/** `config` is the injected AiosConfig (REQUIRED) — its `repoRoot` is the cwd the CLI subcommand
 *  runs in, and its `domain.cliPath` (default 'tools/aios/cli.mjs') is the tenant runner CLI. */
function execCommand(name, config) {
  const cliPath = config.domain?.cliPath ?? 'tools/aios/cli.mjs';
  const entry = buildExecCommands(cliPath)[name];
  if (!entry) return Promise.resolve({ ok: false, error: `unknown command: ${name}` });
  const [cmd, args] = entry;
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: config.repoRoot, timeout: 30_000, maxBuffer: 1024 * 512 }, (err, stdout, stderr) => {
      resolve({
        ok: !err || err.code === 0,
        command: `node ${cliPath} ${args.slice(1).join(' ')}`,
        stdout: stdout || '',
        stderr: stderr || '',
        exitCode: err ? (err.code ?? 1) : 0,
      });
    });
  });
}

/**
 * "Restart & update": launch tools/aios/restart.ps1 FULLY DETACHED so it outlives the daemon it is
 * about to stop. We spawn a throwaway powershell that immediately `Start-Process`es the real script
 * as an independent top-level process (not in this daemon's process tree), then returns. The script
 * sleeps briefly, stops the AIOS-Daemon task, pulls main, and starts it again. Windows-only (matches
 * the scheduled-task deployment); on other platforms it reports that it's unsupported.
 */
/** `config` is the injected AiosConfig (REQUIRED) — its `repoRoot` locates restart.ps1 and is
 *  the cwd the detached restart process runs in. */
function restartDaemon(config) {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'restart button is Windows-only (uses the AIOS-Daemon scheduled task)' };
  }
  const script = join(config.repoRoot, 'tools', 'aios', 'restart.ps1');
  try {
    const child = spawn('powershell', [
      '-NoProfile', '-Command',
      `Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${script}'`,
    ], { cwd: config.repoRoot, detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    return { ok: true, message: 'restart requested — the daemon will stop, pull the latest main, and restart in ~10s. Reconnect shortly.' };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// Lazy gateway ledger opener — only opens when a /api/ledger endpoint is hit.
// Uses the gateway's tenant from config.gateway.registry.tenant or config.gateway.tenant.
let _ledger = null;
function getLedger(config) {
  if (_ledger) return _ledger;
  try { _ledger = openLedger(undefined, { config }); } catch { return null; }
  return _ledger;
}
function getTenant(config) {
  return config?.gateway?.registry?.tenant ?? config?.gateway?.tenant ?? 'default';
}

let _store = null;

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) reject(new Error('body too large')); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/** Validate + apply a lever-update object. Exported so tests can exercise it without a socket.
 *  `config` is the injected AiosConfig (REQUIRED), threaded to loadPolicy/writePolicy. */
export function applyPolicyUpdates(updates, { path, config } = {}) {
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) throw new Error('expected an object of path:value');
  for (const p of Object.keys(updates)) if (!ALLOWED.has(p)) throw new Error(`path not allowed: ${p}`);
  // Coherence gate (postmortem A5): validate the WOULD-BE-MERGED policy before writing, so the
  // dashboard can't persist an incoherent combination (WIP > parallel, unknown cadence, bad enum…).
  const merged = applyDottedUpdates(loadPolicy(undefined, config), updates);
  const v = validatePolicy(merged);
  if (!v.ok) throw new Error(`invalid policy: ${v.errors.join('; ')}`);
  writePolicy(updates, { ...(path ? { path } : {}), config });
  return { ok: true, wrote: Object.keys(updates), warnings: v.warnings };
}

/** `config` is the injected AiosConfig (REQUIRED). Threaded to every call this server makes that
 *  accepts one: readSpec/writeSpec, execCommand, restartDaemon, buildStatus, openDb, actions. */
export function createDashboardServer(config) {
  // lazy: don't open the DB just by importing this module
  const getStore = () => (_store ||= createProjectStore({ db: openDb(undefined, config), config }));
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const clientIp = req.socket.remoteAddress || 'unknown';

      // Apply rate limiting to all API requests
      if (url.pathname.startsWith('/api/') && !checkRateLimit(clientIp)) {
        return send(res, 429, JSON.stringify({ ok: false, error: 'Too many requests. Please try again later.' }));
      }

      // Cheap liveness probe: touches NO DB, filesystem, git, or transcript scan, so it answers
      // instantly whenever the event loop is free — and, crucially, times out when the loop is
      // BLOCKED (e.g. a synchronous git/gh spawnSync in a tick). That makes it a true wedge signal
      // an external watchdog can poll to restart a daemon that is "listening but unresponsive"
      // (the failure mode that only a process-EXIT restart, not this, would otherwise miss).
      if (req.method === 'GET' && url.pathname === '/healthz') {
        return send(res, 200, JSON.stringify({ ok: true, ts: Date.now() }));
      }
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        const html = readFileSync(INDEX, 'utf8').replaceAll('__AIOS_TOKEN__', AUTH_TOKEN);
        return send(res, 200, html, 'text/html; charset=utf-8');
      }
      // Every mutating request must be same-origin + carry the per-boot token (security P1).
      if (req.method === 'POST' && !authorized(req)) {
        return send(res, 403, JSON.stringify({ ok: false, error: 'forbidden: missing/invalid token or cross-origin request' }));
      }
      if (req.method === 'GET' && url.pathname === '/api/status') {
        const t = Date.now();
        if (t - statusCache.t >= STATUS_TTL_MS) statusCache = { t, body: JSON.stringify(buildStatus({ config })) };
        return send(res, 200, statusCache.body);
      }
      if (req.method === 'GET' && url.pathname === '/api/spec') {
        const path = url.searchParams.get('path');
        return send(res, 200, JSON.stringify({ ok: true, path, content: readSpec(path, config) }));
      }
      if (req.method === 'POST' && url.pathname === '/api/spec') {
        const { path, content } = JSON.parse((await readBody(req)) || '{}');
        return send(res, 200, JSON.stringify(writeSpec(path, content, config)));
      }
      if (req.method === 'POST' && url.pathname === '/api/policy') {
        const updates = JSON.parse((await readBody(req)) || '{}');
        const result = applyPolicyUpdates(updates, { config });
        statusCache.t = 0; // a lever changed — next poll rebuilds instead of serving stale
        return send(res, 200, JSON.stringify(result));
      }
      if (req.method === 'POST' && url.pathname === '/api/run-now') {
        const fn = globalThis.__aiosRunNow;
        if (typeof fn !== 'function') return send(res, 200, JSON.stringify({ ok: false, error: 'scheduler not running — start via scheduler.mjs' }));
        const result = fn();
        statusCache.t = 0;
        return send(res, 200, JSON.stringify(result));
      }
      if (req.method === 'POST' && url.pathname === '/api/stop') {
        send(res, 200, JSON.stringify({ ok: true, message: 'scheduler stopping…' }));
        setTimeout(() => process.exit(0), 500);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/restart') {
        // Fire the detached restart FIRST, then respond — the detached process is independent of us.
        return send(res, 200, JSON.stringify(restartDaemon(config)));
      }
      if (req.method === 'GET' && url.pathname === '/api/commands') {
        const cliPath = config.domain?.cliPath ?? 'tools/aios/cli.mjs';
        return send(res, 200, JSON.stringify({ ok: true, commands: Object.keys(buildExecCommands(cliPath)) }));
      }
      if (req.method === 'POST' && url.pathname === '/api/exec') {
        const { command } = JSON.parse((await readBody(req)) || '{}');
        const result = await execCommand(command, config);
        return send(res, 200, JSON.stringify(result));
      }
      if (req.method === 'POST' && ACTION_PATHS.has(url.pathname)) {
        const body = JSON.parse((await readBody(req)) || '{}');
        const result = handleAction(getStore(), url.pathname, body, { config });
        if (url.pathname !== '/api/run') statusCache.t = 0; // a mutating action → rebuild next poll
        return send(res, 200, JSON.stringify(result));
      }
      // ── Gateway ledger API (F004 spend dashboard data) ──────────────────
      if (req.method === 'GET' && url.pathname === '/api/providers') {
        // Phase 0: Return provider health status from the live health loop
        const providers = [];
        const routes = config.gateway?.registry?.routes ?? {};
        const healthMap = getProviderHealth();
        for (const [name, route] of Object.entries(routes)) {
          const h = healthMap[name];
          const health = h ? { status: h.status, latencyMs: h.latencyMs, lastCheck: h.lastCheck, error: h.error } : { status: 'unknown', latencyMs: null, lastCheck: null, error: null };
          providers.push({
            name,
            wire: route.wire,
            baseUrl: route.upstreamUrl,
            health,
          });
        }
        return send(res, 200, JSON.stringify({ ok: true, providers }));
      }
      if (req.method === 'GET' && url.pathname === '/api/ledger/summary') {
        const ledger = getLedger(config);
        if (!ledger) return send(res, 200, JSON.stringify({ ok: true, available: false }));
        const tenant = getTenant(config);
        const week = queryWindow(ledger, { tenant, since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString() });
        const denyCount = ledger.prepare(
          `SELECT COUNT(*) AS c FROM token_events WHERE tenant = ? AND enforcement_decision = 'deny'`
        ).get(tenant)?.c ?? 0;
        return send(res, 200, JSON.stringify({ ok: true, available: true, ...week, denyCount }));
      }
      if (req.method === 'GET' && url.pathname === '/api/ledger/by-model') {
        const ledger = getLedger(config);
        if (!ledger) return send(res, 200, JSON.stringify({ ok: true, available: false }));
        const tenant = getTenant(config);
        const rows = ledger.prepare(
          `SELECT provider, model, COUNT(*) AS calls, SUM(total_tokens) AS tokens, SUM(cost_usd) AS cost
             FROM token_events WHERE tenant = ? GROUP BY provider, model ORDER BY cost DESC`
        ).all(tenant);
        return send(res, 200, JSON.stringify({ ok: true, available: true, models: rows }));
      }
      if (req.method === 'GET' && url.pathname === '/api/ledger/by-agent') {
        const ledger = getLedger(config);
        if (!ledger) return send(res, 200, JSON.stringify({ ok: true, available: false }));
        const tenant = getTenant(config);
        const rows = ledger.prepare(
          `SELECT agent, COUNT(*) AS calls, SUM(total_tokens) AS tokens, SUM(cost_usd) AS cost,
                  MAX(ts) AS lastActivity
             FROM token_events WHERE tenant = ? GROUP BY agent ORDER BY cost DESC`
        ).all(tenant);
        return send(res, 200, JSON.stringify({ ok: true, available: true, agents: rows }));
      }
      if (req.method === 'GET' && url.pathname === '/api/ledger/deny-events') {
        const ledger = getLedger(config);
        if (!ledger) return send(res, 200, JSON.stringify({ ok: true, available: false }));
        const tenant = getTenant(config);
        const rows = ledger.prepare(
          `SELECT ts, agent, cap_window, request_id
             FROM token_events WHERE tenant = ? AND enforcement_decision = 'deny'
             ORDER BY ts DESC LIMIT 50`
        ).all(tenant);
        return send(res, 200, JSON.stringify({ ok: true, available: true, denies: rows }));
      }
      if (req.method === 'GET' && url.pathname === '/api/ledger/spend-by-provider') {
        const breakdown = providerBreakdownFromLedger(config);
        return send(res, 200, JSON.stringify({ ok: true, available: breakdown !== null, providers: breakdown || {} }));
      }
      // ── P5: Analytics endpoints (AI Spend Observability) ─────────────────

      // Helper to open the gateway ledger and get tenant
      const getAnalyticsLedger = () => getLedger(config);

      // GET /api/analytics/overview — KPI aggregates (T019)
      if (req.method === 'GET' && url.pathname === '/api/analytics/overview') {
        const ledger = getAnalyticsLedger();
        if (!ledger) return send(res, 503, JSON.stringify({ error: 'Analytics unavailable', reason: 'Ledger database not accessible' }));
        const from = url.searchParams.get('from') || undefined;
        const to = url.searchParams.get('to') || undefined;
        const overview = queryOverview(ledger, from, to);
        return send(res, 200, JSON.stringify(overview));
      }

      // GET /api/analytics/timeseries — spend time-series (T020)
      if (req.method === 'GET' && url.pathname === '/api/analytics/timeseries') {
        const ledger = getAnalyticsLedger();
        if (!ledger) return send(res, 503, JSON.stringify({ error: 'Analytics unavailable' }));
        const from = url.searchParams.get('from') || undefined;
        const to = url.searchParams.get('to') || undefined;
        const groupBy = url.searchParams.get('groupBy') || 'provider';
        const timeseries = queryTimeseries(ledger, from, to, groupBy);
        return send(res, 200, JSON.stringify(timeseries));
      }

      // GET /api/analytics/breakdown — ranked breakdown (T021)
      if (req.method === 'GET' && url.pathname === '/api/analytics/breakdown') {
        const ledger = getAnalyticsLedger();
        if (!ledger) return send(res, 503, JSON.stringify({ error: 'Analytics unavailable' }));
        const dimension = url.searchParams.get('dimension') || 'provider';
        const from = url.searchParams.get('from') || undefined;
        const to = url.searchParams.get('to') || undefined;
        const limit = parseInt(url.searchParams.get('limit') || '10', 10);
        const breakdown = queryBreakdown(ledger, dimension, from, to, limit);
        return send(res, 200, JSON.stringify(breakdown));
      }

      // GET /api/analytics/export — CSV export (T022)
      if (req.method === 'GET' && url.pathname === '/api/analytics/export') {
        const ledger = getAnalyticsLedger();
        if (!ledger) return send(res, 503, JSON.stringify({ error: 'Analytics unavailable' }));
        const from = url.searchParams.get('from') || undefined;
        const to = url.searchParams.get('to') || undefined;

        // Query breakdown data as base for CSV
        const breakdown = queryBreakdown(ledger, 'model', from, to, 1000);
        const overview = queryOverview(ledger, from, to);

        const csvLines = ['Date Range,Total Spend,Total Tokens,Total API Calls'];
        csvLines.push(`${overview.period.from},${overview.totalSpend},${overview.totalTokens},${overview.totalApiCalls}`);
        csvLines.push('');
        csvLines.push('Model,Cost (USD),Tokens,API Calls,Share %');
        for (const item of breakdown.items) {
          const escapedKey = item.key.includes(',') ? `"${item.key}"` : item.key;
          csvLines.push(`${escapedKey},${item.cost},${item.tokens},${item.apiCalls},${item.pct}`);
        }

        const csv = csvLines.join('\n');
        return send(res, 200, csv, 'text/csv; charset=utf-8');
      }

      // GET /api/analytics/aggregation/status — aggregation debug info (T023)
      if (req.method === 'GET' && url.pathname === '/api/analytics/aggregation/status') {
        const ledger = getAnalyticsLedger();
        if (!ledger) return send(res, 503, JSON.stringify({ error: 'Analytics unavailable' }));
        const lastHourly = getLastAggregatedHour(ledger);
        const lastDaily = getLastAggregatedDay(ledger);
        // Count pending windows: events newer than last aggregation
        let pendingHours = 0;
        if (lastHourly) {
          const r = ledger.prepare(
            'SELECT COUNT(DISTINCT substr(ts, 1, 13)) AS c FROM token_events WHERE ts > ? AND cost_usd IS NOT NULL',
          ).get(lastHourly);
          pendingHours = r?.c ?? 0;
        }
        return send(res, 200, JSON.stringify({
          lastHourlyRun: lastHourly,
          lastDailyRun: lastDaily,
          hourlyWindowsPending: pendingHours,
        }));
      }

      // POST /api/analytics/spend-pause — toggle spend pause (T041)
      if (req.method === 'POST' && url.pathname === '/api/analytics/spend-pause') {
        const body = JSON.parse((await readBody(req)) || '{}');
        const ledger = getAnalyticsLedger();
        if (!ledger) return send(res, 503, JSON.stringify({ error: 'Analytics unavailable' }));

        const action = body.action || 'status';
        const reason = body.reason || '';

        if (action === 'pause') {
          ledger.prepare(
            "UPDATE spend_pause_state SET is_paused = 1, paused_at = ?, paused_by = 'dashboard', reason = ?, resumed_at = NULL",
          ).run(new Date().toISOString(), reason);
          return send(res, 200, JSON.stringify({ isPaused: true, message: 'All AI spend paused' }));
        } else if (action === 'resume') {
          ledger.prepare(
            "UPDATE spend_pause_state SET is_paused = 0, resumed_at = ?, reason = NULL",
          ).run(new Date().toISOString());
          return send(res, 200, JSON.stringify({ isPaused: false, message: 'AI spend resumed' }));
        } else {
          return send(res, 400, JSON.stringify({ error: 'Invalid action. Use "pause" or "resume".' }));
        }
      }

      // GET /api/analytics/spend-pause — read pause state (T041)
      if (req.method === 'GET' && url.pathname === '/api/analytics/spend-pause') {
        const ledger = getAnalyticsLedger();
        if (!ledger) return send(res, 503, JSON.stringify({ error: 'Analytics unavailable' }));
        const row = ledger.prepare('SELECT * FROM spend_pause_state').get();
        return send(res, 200, JSON.stringify({
          isPaused: row?.is_paused === 1,
          pausedAt: row?.paused_at || null,
          pausedBy: row?.paused_by || null,
          reason: row?.reason || null,
          resumedAt: row?.resumed_at || null,
        }));
      }

      // GET /api/analytics/budget — budget forecast (T039)
      if (req.method === 'GET' && url.pathname === '/api/analytics/budget') {
        const ledger = getAnalyticsLedger();
        if (!ledger) return send(res, 503, JSON.stringify({ error: 'Analytics unavailable' }));
        try {
          const policy = loadPolicy(undefined, config);
          const aConfig = policy?.analytics ?? {};
          const budgetConfig = {
            monthlyLimit: aConfig?.budget?.monthlyLimit ?? 500,
          };
          const forecast = computeBudgetForecast(ledger, budgetConfig);
          const anomalies = detectAnomalies(ledger);
          return send(res, 200, JSON.stringify({ ...forecast, anomalies }));
        } catch (e) {
          return send(res, 200, JSON.stringify({ error: e.message }));
        }
      }

      // GET /api/analytics/task-cost — per-task cost (T030)
      if (req.method === 'GET' && url.pathname === '/api/analytics/task-cost') {
        const ledger = getAnalyticsLedger();
        if (!ledger) return send(res, 503, JSON.stringify({ error: 'Analytics unavailable' }));
        const taskId = url.searchParams.get('taskId');
        const includeRuns = url.searchParams.get('includeRuns') === 'true';
        if (!taskId) return send(res, 400, JSON.stringify({ error: 'taskId query parameter required' }));
        const result = queryTaskCost(ledger, taskId, includeRuns);
        return send(res, 200, JSON.stringify(result));
      }

      // GET /api/analytics/project-costs — per-project cost ranking (T031)
      if (req.method === 'GET' && url.pathname === '/api/analytics/project-costs') {
        const ledger = getAnalyticsLedger();
        if (!ledger) return send(res, 503, JSON.stringify({ error: 'Analytics unavailable' }));
        const project = url.searchParams.get('project');
        const orderBy = url.searchParams.get('orderBy') || 'cost';
        const limit = parseInt(url.searchParams.get('limit') || '20', 10);
        if (!project) return send(res, 400, JSON.stringify({ error: 'project query parameter required' }));
        const result = queryProjectCosts(ledger, project, orderBy, limit);
        return send(res, 200, JSON.stringify(result));
      }

      // ── P5: Optimization endpoints (US6) ───────────────────────────────

      // GET /api/analytics/optimization/recommendations (T056)
      if (req.method === 'GET' && url.pathname === '/api/analytics/optimization/recommendations') {
        const ledger = getAnalyticsLedger();
        if (!ledger) return send(res, 503, JSON.stringify({ error: 'Analytics unavailable' }));
        try {
          const status = url.searchParams.get('status') || 'active';
          const rows = ledger.prepare(
            "SELECT * FROM optimization_rules WHERE status = ? ORDER BY estimated_weekly_savings DESC",
          ).all(status);
          return send(res, 200, JSON.stringify({ ok: true, recommendations: rows }));
        } catch (e) {
          return send(res, 200, JSON.stringify({ ok: true, recommendations: [] }));
        }
      }

      // POST /api/analytics/optimization/apply (T057)
      if (req.method === 'POST' && url.pathname === '/api/analytics/optimization/apply') {
        const body = JSON.parse((await readBody(req)) || '{}');
        if (!body.id) return send(res, 400, JSON.stringify({ error: 'id required' }));
        try {
          const { applyRecommendation } = await import('../optimization.mjs');
          const ledger = getAnalyticsLedger();
          if (!ledger) return send(res, 503, JSON.stringify({ error: 'Analytics unavailable' }));
          const result = applyRecommendation(ledger, body.id);
          return send(res, 200, JSON.stringify(result));
        } catch (e) {
          return send(res, 500, JSON.stringify({ error: e.message }));
        }
      }

      // POST /api/analytics/optimization/dismiss (T058)
      if (req.method === 'POST' && url.pathname === '/api/analytics/optimization/dismiss') {
        const body = JSON.parse((await readBody(req)) || '{}');
        if (!body.id) return send(res, 400, JSON.stringify({ error: 'id required' }));
        try {
          const { dismissRecommendation } = await import('../optimization.mjs');
          const ledger = getAnalyticsLedger();
          if (!ledger) return send(res, 503, JSON.stringify({ error: 'Analytics unavailable' }));
          const result = dismissRecommendation(ledger, body.id, body.reason || '');
          return send(res, 200, JSON.stringify(result));
        } catch (e) {
          return send(res, 500, JSON.stringify({ error: e.message }));
        }
      }

      // POST /api/analytics/alerts/test — test alert delivery (T050)
      if (req.method === 'POST' && url.pathname === '/api/analytics/alerts/test') {
        try {
          const { dispatchAlert } = await import('../alerts.mjs');
          const policy = loadPolicy(undefined, config);
          const { resolveAnalyticsConfig: rac } = await import('../config.mjs');
          const analyticsConfig = rac(policy);
          const channels = analyticsConfig.alerts.channels.filter(c => c.enabled);

          const alert = {
            type: 'test',
            severity: 'info',
            title: 'MeridianOS Test Alert',
            message: 'This is a test alert from the dashboard to verify your alert channel configuration.',
            spendToDate: 0,
            budgetLimit: analyticsConfig.budget.monthlyLimit || 500,
            pctUsed: 0,
          };

          const results = await dispatchAlert(alert, channels);
          return send(res, 200, JSON.stringify({ ok: true, message: `Test alert dispatched to ${results.length} channel(s)`, results }));
        } catch (e) {
          return send(res, 500, JSON.stringify({ error: e.message }));
        }
      }

      // GET /api/analytics/alerts/config — alert configuration (T049)
      if (req.method === 'GET' && url.pathname === '/api/analytics/alerts/config') {
        const policy = loadPolicy(undefined, config);
        const aConfig = policy?.analytics?.alerts ?? {};
        return send(res, 200, JSON.stringify({ ok: true, channels: aConfig.channels || [], rules: aConfig.rules || [] }));
      }

      // ── Provider test endpoint (US2) ──────────────────────────────────
      if (req.method === 'POST' && url.pathname === '/api/providers/test') {
        const { provider: providerName } = JSON.parse((await readBody(req)) || '{}');
        if (!providerName) return send(res, 400, JSON.stringify({ ok: false, error: 'provider name required' }));
        try {
          const { resolveProvider } = await import('../providers.mjs');
          const { testProviderConnection } = await import('../provider-conformance.mjs');
          const policy = loadPolicy(undefined, config);
          const providerConfig = resolveProvider(providerName, policy);
          if (!providerConfig) return send(res, 404, JSON.stringify({ ok: false, error: `unknown provider: ${providerName}` }));
          const resolvedKey = providerConfig.keyEnv ? process.env[providerConfig.keyEnv] ?? null : null;
          const result = await testProviderConnection(providerConfig, resolvedKey);
          return send(res, 200, JSON.stringify({ ok: true, ...result }));
        } catch (err) {
          return send(res, 500, JSON.stringify({ ok: false, error: err.message }));
        }
      }

      // ── Provider add endpoint (US3) ────────────────────────────────────
      if (req.method === 'POST' && url.pathname === '/api/providers') {
        const { name, keyEnv, apiKey, source } = JSON.parse((await readBody(req)) || '{}');
        if (!name) return send(res, 400, JSON.stringify({ ok: false, error: 'name required' }));
        try {
          const { runProviderWizardDashboard } = await import('../provider-wizard.mjs');
          const result = await runProviderWizardDashboard(name, keyEnv, apiKey, config.repoRoot);
          if (result.conflict) return send(res, 409, JSON.stringify({ ok: false, error: result.error }));
          if (!result.ok) return send(res, 400, JSON.stringify({ ok: false, error: result.error }));
          statusCache.t = 0;
          return send(res, 201, JSON.stringify({ ok: true, provider: result.provider }));
        } catch (err) {
          return send(res, 500, JSON.stringify({ ok: false, error: err.message }));
        }
      }

      // ── Pricing endpoints (US6) ────────────────────────────────────────
      if (req.method === 'POST' && url.pathname === '/api/pricing/refresh') {
        try {
          const { openDb } = await import('../db.mjs');
          const { refreshAllModelPricing } = await import('../pricing-refresh.mjs');
          const db = openDb(undefined, config);
          const policy = loadPolicy(undefined, config);
          const result = await refreshAllModelPricing(db, policy, config);
          db.close();
          return send(res, 200, JSON.stringify({ ok: true, ...result }));
        } catch (err) {
          return send(res, 500, JSON.stringify({ ok: false, error: err.message }));
        }
      }

      if (req.method === 'GET' && url.pathname === '/api/pricing') {
        try {
          const { openDb } = await import('../db.mjs');
          const { getModels } = await import('../model-registry.mjs');
          const db = openDb(undefined, config);
          const provider = url.searchParams.get('provider');
          const models = getModels(db, { provider, deprecated: false });
          db.close();
          return send(res, 200, JSON.stringify({ ok: true, models, count: models.length }));
        } catch (err) {
          return send(res, 500, JSON.stringify({ ok: false, error: err.message }));
        }
      }

      // ── Models endpoints (US8) ─────────────────────────────────────────
      if (req.method === 'GET' && url.pathname === '/api/models') {
        try {
          const { openDb } = await import('../db.mjs');
          const { getModels } = await import('../model-registry.mjs');
          const db = openDb(undefined, config);
          const provider = url.searchParams.get('provider');
          const tier = url.searchParams.get('tier');
          const deprecated = url.searchParams.get('deprecated') === 'true' ? true : (url.searchParams.get('deprecated') === 'false' ? false : null);
          const search = url.searchParams.get('search');
          const models = getModels(db, { provider, tier, deprecated, search });
          db.close();
          return send(res, 200, JSON.stringify({ ok: true, models, count: models.length }));
        } catch (err) {
          return send(res, 500, JSON.stringify({ ok: false, error: err.message }));
        }
      }

      if (req.method === 'POST' && url.pathname === '/api/models/refresh') {
        try {
          const { openDb } = await import('../db.mjs');
          const { discoverAllModels } = await import('../model-discovery.mjs');
          const db = openDb(undefined, config);
          const policy = loadPolicy(undefined, config);
          // Fire and forget for 202
          discoverAllModels(db, policy, config).then(() => db.close()).catch(() => db.close());
          return send(res, 202, JSON.stringify({ ok: true, message: 'Model refresh started', estimatedDurationSec: 60 }));
        } catch (err) {
          return send(res, 500, JSON.stringify({ ok: false, error: err.message }));
        }
      }

      if (req.method === 'GET' && url.pathname === '/api/models/refresh/status') {
        // Best-effort: check if refresh is in progress via a simple flag
        const refreshing = globalThis.__modelsRefreshing ?? false;
        return send(res, 200, JSON.stringify({ ok: true, running: refreshing }));
      }

      // ── IDE Detection ─────────────────────────────────────────────────
      if (req.method === 'GET' && url.pathname === '/api/ide/detect') {
        const customPaths = config?.policy?.ide_detection?.paths ?? [];
        const ides = detectInstalledIdes({ customPaths });
        return send(res, 200, JSON.stringify({
          ides,
          detectedCount: ides.filter((i) => i.installed).length,
          totalChecked: ides.length,
        }));
      }

      // ── IDE Proxy Config Snippet ──────────────────────────────────────
      if (req.method === 'GET' && url.pathname.startsWith('/api/ide/config/')) {
        const ideName = url.pathname.slice('/api/ide/config/'.length);
        const validNames = [...KNOWN_IDES.map((i) => i.ideName), 'generic'];
        if (!validNames.includes(ideName)) {
          return send(res, 400, JSON.stringify({
            ok: false,
            error: `Unknown IDE '${ideName}'. Valid values: ${validNames.join(', ')}`,
          }));
        }
        const configSnippet = generateProxyConfig(
          ideName,
          `http://127.0.0.1:${config?.gateway?.port || 8787}`,
        );
        return send(res, 200, JSON.stringify(configSnippet));
      }

      // ── IDE Connectivity Test ─────────────────────────────────────────
      if (req.method === 'POST' && url.pathname.startsWith('/api/ide/test/')) {
        const ideName = url.pathname.slice('/api/ide/test/'.length);
        const gatewayUrl = `http://127.0.0.1:${config?.gateway?.port || 8787}`;
        const result = await testIdeConnectivity(gatewayUrl);
        result.ideName = ideName;
        return send(res, 200, JSON.stringify(result));
      }

      // ── IDE Traffic Status ────────────────────────────────────────────
      if (req.method === 'GET' && url.pathname === '/api/ide/status') {
        const period = url.searchParams.get('period') || 'week';
        const now = new Date();
        let since;
        if (period === 'session') since = new Date(now - 3600000).toISOString();
        else if (period === 'day') since = new Date(now - 86400000).toISOString();
        else if (period === 'week') since = new Date(now - 604800000).toISOString();
        else since = new Date(now - 2592000000).toISOString(); // month

        let ideBreakdown = [];
        let copilotStatus = 'unknown';

        try {
          const ledger = getLedger(config);
          if (ledger) {
            const tenant = getTenant(config);

            // Group by ide_name for source='ide'
            const rows = ledger.prepare(
              `SELECT ide_name, SUM(cost_usd) AS cost, SUM(total_tokens) AS tokens, COUNT(*) AS calls, MAX(ts) AS last_seen
                 FROM token_events WHERE tenant = ? AND source = 'ide' AND ts >= ? GROUP BY ide_name`,
            ).all(tenant, since);

            ideBreakdown = rows.map((r) => ({
              ideName: r.ide_name || 'unknown-ide',
              displayName: r.ide_name === 'vscode-copilot' ? 'GitHub Copilot'
                : r.ide_name === 'claude-code' ? 'Claude Code'
                : r.ide_name || 'Unknown IDE',
              costUsd: r.cost ?? 0,
              tokens: r.tokens ?? 0,
              requestCount: r.calls,
              lastSeen: r.last_seen,
            }));

            // Determine Copilot status
            const copilotRow = rows.find((r) => r.ide_name === 'vscode-copilot');
            if (copilotRow && copilotRow.calls > 0) {
              copilotStatus = 'working';
            } else {
              // Check if proxy is configured but no traffic detected
              const anyIdeTraffic = rows.some((r) => r.calls > 0);
              copilotStatus = anyIdeTraffic ? 'partial' : 'unavailable';
            }
          }
        } catch { /* best-effort */ }

        const totalCost = ideBreakdown.reduce((s, i) => s + i.costUsd, 0);
        const totalTokens = ideBreakdown.reduce((s, i) => s + i.tokens, 0);

        return send(res, 200, JSON.stringify({
          period,
          totalCostUsd: totalCost,
          totalTokens,
          byIde: ideBreakdown,
          copilotStatus,
          copilotStatusNote: copilotStatus === 'unavailable'
            ? 'No IDE traffic detected. Configure proxy settings from the IDE Connect page.'
            : copilotStatus === 'partial'
            ? 'Some IDE traffic detected but Copilot proxy coverage may be incomplete.'
            : null,
        }));
      }

      // ── MCP Server Config ─────────────────────────────────────────────
      if (req.method === 'GET' && url.pathname === '/api/mcp/config') {
        const mcpConfig = {
          mcpServers: {
            meridianos: {
              command: 'node',
              args: ['mcp-server.mjs'],
              cwd: config?.repoRoot || process.cwd(),
              env: {
                MCP_DASHBOARD_URL: `http://localhost:${config?.gateway?.dashboardPort || 4317}`,
              },
            },
          },
        };
        return send(res, 200, JSON.stringify({
          config: mcpConfig,
          instructions: "Add the above 'meridianos' entry to your .mcp.json file's 'mcpServers' object. If you already have other MCP servers configured, merge the 'meridianos' entry alongside them. Restart Claude Code after saving.",
          prerequisites: [
            'Node.js 22+ installed',
            'MeridianOS daemon running (dashboard accessible at localhost:4317)',
            'Claude Code or Claude Cowork installed',
          ],
          toolsAvailable: [
            'meridian_list_tasks',
            'meridian_create_task',
            'meridian_get_spend',
            'meridian_get_budget',
            'meridian_get_board_summary',
          ],
        }));
      }

      // ── Subscription Plans ────────────────────────────────────────────
      if (req.method === 'GET' && url.pathname === '/api/subscriptions') {
        const providers = config?.policy?.providers ?? {};
        const subscriptions = [];
        const apiKeys = [];

        for (const [name, p] of Object.entries(providers)) {
          const auth = p.auth ?? {};
          if (auth.mode === 'subscription') {
            subscriptions.push({
              providerName: name,
              planName: p.displayName || auth.planName || name,
              mode: 'subscription',
              monthlyCostUsd: auth.monthlyCostUsd ?? 0,
              active: true, // best-effort; actual token validity checked on next request
              lastVerified: auth.lastVerified ?? null,
              tokenEnv: auth.keyEnv ?? null,
              usageThisMonth: { tokens: 0, costIncluded: auth.monthlyCostUsd ?? 0, costOverage: 0 },
            });
          } else {
            apiKeys.push({
              providerName: name,
              planName: null,
              mode: 'api_key',
              active: true,
              usageThisMonth: { tokens: 0, costUsd: 0 },
            });
          }
        }

        const combinedTotal = subscriptions.reduce((s, p) => s + (p.monthlyCostUsd ?? 0), 0);

        return send(res, 200, JSON.stringify({
          subscriptions,
          apiKeys,
          combinedMonthlyTotal: combinedTotal,
        }));
      }

      if (req.method === 'POST' && url.pathname === '/api/subscriptions') {
        const body = JSON.parse((await readBody(req)) || '{}');
        if (!body.legalAccepted) {
          return send(res, 400, JSON.stringify({
            ok: false,
            error: 'You must accept the legal disclaimer before saving subscription configuration.',
          }));
        }
        if (!body.providerName || !body.keyEnv) {
          return send(res, 400, JSON.stringify({
            ok: false,
            error: 'providerName and keyEnv are required.',
          }));
        }

        // Build the provider config entry
        const providerEntry = {
          name: body.providerName,
          displayName: body.planName || body.providerName,
          wire: body.wire || 'anthropic',
          baseUrl: body.baseUrl || 'https://api.anthropic.com',
          auth: {
            mode: 'subscription',
            keyEnv: body.keyEnv,
            planName: body.planName || body.providerName,
            monthlyCostUsd: body.monthlyCostUsd ?? 0,
            lastVerified: new Date().toISOString().slice(0, 10),
          },
          features: { supportsStreaming: true, supportsToolUse: true },
        };

        // Apply provider config via policy update
        const update = {};
        update[`providers.${body.providerName}`] = providerEntry;
        applyDottedUpdates(update, config);

        return send(res, 201, JSON.stringify({
          ok: true,
          message: `Subscription configured. Set the ${body.keyEnv} environment variable and restart the daemon.`,
          providerName: body.providerName,
        }));
      }

      // ── Run detail (links a run to its ledger costs) ────────────────────
      if (req.method === 'GET' && url.pathname === '/api/run') {
        const runId = url.searchParams.get('id');
        if (!runId) return send(res, 400, JSON.stringify({ ok: false, error: '?id required' }));
        const runs = readRuns({ limit: 0, config }); // 0 = all
        const run = runs.find((r) => r.run_id === runId);
        if (!run) return send(res, 404, JSON.stringify({ ok: false, error: 'run not found' }));
        let ledgerCost = null;
        try {
          const ledger = getLedger(config);
          if (ledger) {
            const tenant = getTenant(config);
            const rows = ledger.prepare(
              `SELECT SUM(cost_usd) AS cost, SUM(total_tokens) AS tokens, COUNT(*) AS calls
                 FROM token_events WHERE tenant = ? AND run_id = ?`
            ).all(tenant, runId);
            if (rows?.[0]?.calls > 0) ledgerCost = rows[0];
          }
        } catch { /* best-effort */ }
        return send(res, 200, JSON.stringify({ ok: true, run, ledgerCost }));
      }

      // ── Authentication API (Multi-Tenant Platform) ─────────────────
      if (req.method === 'POST' && url.pathname === '/api/auth/login') {
        return handleLogin(req, res);
      }
      if (req.method === 'GET' && url.pathname === '/api/auth/me') {
        return handleGetCurrentUser(req, res);
      }
      if (req.method === 'PUT' && url.pathname === '/api/auth/me') {
        return handleUpdateCurrentUser(req, res);
      }
      if (req.method === 'POST' && url.pathname === '/api/auth/me/password') {
        return handleChangePassword(req, res);
      }
      if (req.method === 'POST' && url.pathname === '/api/auth/tokens') {
        return handleCreateApiToken(req, res);
      }
      if (req.method === 'GET' && url.pathname === '/api/auth/tokens') {
        return handleListApiTokens(req, res);
      }
      if (req.method === 'DELETE' && url.pathname.match(/^\/api\/auth\/tokens\/[^/]+$/)) {
        const tokenId = url.pathname.split('/').pop();
        return handleRevokeApiToken(req, res, tokenId);
      }
      if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
        return handleLogout(req, res);
      }
      if (req.method === 'POST' && url.pathname === '/api/auth/refresh') {
        return handleRefreshJWT(req, res);
      }
      if (req.method === 'GET' && url.pathname.match(/^\/api\/auth\/oauth\/[^/]+\/authorize$/)) {
        const provider = url.pathname.split('/')[4];
        return handleOAuthAuthorize(req, res, provider);
      }
      if (req.method === 'GET' && url.pathname.match(/^\/api\/auth\/oauth\/[^/]+\/callback$/)) {
        const provider = url.pathname.split('/')[4];
        return handleOAuthCallback(req, res, provider);
      }
      if (req.method === 'POST' && url.pathname === '/api/auth/users') {
        return handleCreateUser(req, res);
      }

      // ── Project Management API (Multi-Tenant Platform) ────────────────
      if (req.method === 'GET' && url.pathname === '/api/projects/templates') {
        if (!requireAuth(req, res)) return;
        return handleListTemplates(req, res);
      }
      if (req.method === 'GET' && url.pathname.match(/^\/api\/projects\/templates\/[^/]+$/)) {
        if (!requireAuth(req, res)) return;
        const templateId = url.pathname.split('/').pop();
        return handleGetTemplate(req, res, templateId);
      }

      // ── Compliance Reporting API (US7) ─────────────────────────────
      if (req.method === 'POST' && url.pathname === '/api/compliance/reports/soc2') {
        if (!requireAuth(req, res)) return;
        return handleGenerateSOC2Report(req, res);
      }
      if (req.method === 'POST' && url.pathname === '/api/compliance/reports/gdpr') {
        if (!requireAuth(req, res)) return;
        return handleGenerateGDPRReport(req, res);
      }
      if (req.method === 'POST' && url.pathname === '/api/compliance/reports/cost-allocation') {
        if (!requireAuth(req, res)) return;
        return handleGenerateCostAllocationReport(req, res);
      }
      if (req.method === 'POST' && url.pathname === '/api/compliance/reports/model-usage') {
        if (!requireAuth(req, res)) return;
        return handleGenerateModelUsageReport(req, res);
      }
      if (req.method === 'GET' && url.pathname === '/api/compliance/reports') {
        if (!requireAuth(req, res)) return;
        return handleListComplianceReports(req, res);
      }

      if (req.method === 'GET' && url.pathname === '/api/projects') {
        if (!requireAuth(req, res)) return;
        return handleListProjects(req, res);
      }
      if (req.method === 'POST' && url.pathname === '/api/projects') {
        if (!requireAuth(req, res)) return;
        return handleCreateProject(req, res);
      }
      if (req.method === 'GET' && url.pathname.match(/^\/api\/projects\/[^/]+$/)) {
        if (!requireAuth(req, res)) return;
        const projectId = url.pathname.split('/').pop();
        return handleGetProject(req, res, projectId);
      }
      if (req.method === 'POST' && url.pathname.match(/^\/api\/projects\/[^/]+\/start$/)) {
        if (!requireAuth(req, res)) return;
        const projectId = url.pathname.split('/')[3];
        return handleStartProject(req, res, projectId);
      }
      if (req.method === 'POST' && url.pathname.match(/^\/api\/projects\/[^/]+\/stop$/)) {
        if (!requireAuth(req, res)) return;
        const projectId = url.pathname.split('/')[3];
        return handleStopProject(req, res, projectId);
      }
      if (req.method === 'POST' && url.pathname.match(/^\/api\/projects\/[^/]+\/restart$/)) {
        if (!requireAuth(req, res)) return;
        const projectId = url.pathname.split('/')[3];
        return handleRestartProject(req, res, projectId);
      }
      if (req.method === 'DELETE' && url.pathname.match(/^\/api\/projects\/[^/]+$/)) {
        if (!requireAuth(req, res)) return;
        const projectId = url.pathname.split('/').pop();
        return handleDeleteProject(req, res, projectId);
      }
      if (req.method === 'GET' && url.pathname.match(/^\/api\/projects\/[^/]+\/health$/)) {
        if (!requireAuth(req, res)) return;
        const projectId = url.pathname.split('/')[3];
        return handleGetProjectHealth(req, res, projectId);
      }

      // ── Billing API (Multi-Tenant Platform - US5) ─────────────────────
      if (req.method === 'GET' && url.pathname === '/api/billing/license') {
        if (!requireAuth(req, res)) return;
        return handleGetLicense(req, res);
      }
      if (req.method === 'POST' && url.pathname === '/api/billing/license/validate') {
        if (!requireAuth(req, res)) return;
        return handleValidateLicense(req, res);
      }
      if (req.method === 'POST' && url.pathname === '/api/billing/license/refresh') {
        if (!requireAuth(req, res)) return;
        return handleRefreshLicense(req, res);
      }
      if (req.method === 'POST' && url.pathname === '/api/billing/checkout') {
        if (!requireAuth(req, res)) return;
        return handleCreateCheckout(req, res);
      }
      if (req.method === 'GET' && url.pathname === '/api/billing/portal') {
        if (!requireAuth(req, res)) return;
        return handleGetPortal(req, res);
      }
      if (req.method === 'GET' && url.pathname === '/api/billing/subscription') {
        if (!requireAuth(req, res)) return;
        return handleGetSubscription(req, res);
      }
      if (req.method === 'POST' && url.pathname === '/api/billing/webhook/stripe') {
        return handleStripeWebhook(req, res);
      }
      if (req.method === 'POST' && url.pathname === '/api/billing/check-feature') {
        if (!requireAuth(req, res)) return;
        return handleCheckFeature(req, res);
      }
      if (req.method === 'GET' && url.pathname === '/api/billing/limits') {
        if (!requireAuth(req, res)) return;
        return handleGetLimits(req, res);
      }
      if (req.method === 'GET' && url.pathname === '/api/billing/pricing') {
        if (!requireAuth(req, res)) return;
        return handleGetPricing(req, res);
      }

      // Team Collaboration API (US3). These handlers self-check requireAuth internally, so no
      // wrapping gate here (matches the reviews handlers just below, same pattern).
      if (req.method === 'POST' && url.pathname === '/api/auth/invitations') {
        return handleCreateInvitation(req, res);
      }
      if (req.method === 'GET' && url.pathname === '/api/auth/invitations') {
        return handleListInvitations(req, res);
      }
      if (req.method === 'POST' && url.pathname.match(/^\/api\/auth\/invitations\/[^/]+\/accept$/)) {
        return handleAcceptInvitation(req, res);
      }
      if (req.method === 'POST' && url.pathname.match(/^\/api\/auth\/invitations\/[^/]+\/reject$/)) {
        return handleRejectInvitation(req, res);
      }
      if (req.method === 'GET' && url.pathname === '/api/activity/feed') {
        return handleGetActivityFeed(req, res);
      }
      if (req.method === 'GET' && url.pathname === '/api/activity/stats') {
        return handleGetActivityStats(req, res);
      }
      if (req.method === 'POST' && url.pathname.match(/^\/api\/tasks\/[^/]+\/comments$/)) {
        return handleAddTaskComment(req, res);
      }
      if (req.method === 'GET' && url.pathname.match(/^\/api\/tasks\/[^/]+\/comments$/)) {
        return handleGetTaskComments(req, res);
      }
      if (req.method === 'PUT' && url.pathname.match(/^\/api\/tasks\/[^/]+\/comments\/[^/]+$/)) {
        return handleUpdateTaskComment(req, res);
      }
      if (req.method === 'DELETE' && url.pathname.match(/^\/api\/tasks\/[^/]+\/comments\/[^/]+$/)) {
        return handleDeleteTaskComment(req, res);
      }
      if (req.method === 'POST' && url.pathname === '/api/reviews/assign') {
        return handleAssignReviewers(req, res);
      }
      if (req.method === 'GET' && url.pathname === '/api/reviews/assignments') {
        return handleGetReviewAssignments(req, res);
      }
      if (req.method === 'GET' && url.pathname === '/api/reviews/stats') {
        return handleGetReviewStats(req, res);
      }

      return send(res, 404, JSON.stringify({ ok: false, error: 'not found' }));
    } catch (e) {
      return send(res, 400, JSON.stringify({ ok: false, error: String((e && e.message) || e) }));
    }
  });
}

/**
 * Authentication middleware for protected endpoints
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @returns {boolean} True if authenticated, false otherwise
 */
function requireAuth(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    send(res, 401, JSON.stringify({
      ok: false,
      error: 'Missing authorization header',
      remediation: 'Include an Authorization header with your JWT token or API key. Format: "Bearer <token>" or "ApiKey <key>"'
    }));
    return false;
  }

  const [scheme, token] = authHeader.split(' ');
  if (!scheme || !token) {
    send(res, 401, JSON.stringify({
      ok: false,
      error: 'Invalid authorization header format',
      remediation: 'Authorization header must be in format "Bearer <token>" or "ApiKey <key>". Ensure no extra spaces or characters.'
    }));
    return false;
  }

  if (scheme.toLowerCase() === 'bearer') {
    const payload = verifyToken(token);
    if (!payload) {
      send(res, 401, JSON.stringify({
        ok: false,
        error: 'Invalid or expired token',
        remediation: 'Your JWT token may be expired or invalid. Please refresh your token using POST /api/auth/refresh or log in again.'
      }));
      return false;
    }
    req.user = payload;
    return true;
  } else if (scheme.toLowerCase() === 'apikey') {
    const tokenManager = getAPITokenManager();
    const tokenData = tokenManager.validateToken(token);
    if (!tokenData) {
      send(res, 401, JSON.stringify({
        ok: false,
        error: 'Invalid API key',
        remediation: 'Your API key may be expired or revoked. Generate a new API key using POST /api/auth/tokens or contact support.'
      }));
      return false;
    }
    req.user = { sub: tokenData.user_id, email: tokenData.email };
    req.apiToken = tokenData;
    return true;
  } else {
    send(res, 401, JSON.stringify({
      ok: false,
      error: 'Invalid authorization scheme',
      remediation: 'Supported schemes are "Bearer" for JWT tokens and "ApiKey" for API keys. Ensure you use the correct scheme.'
    }));
    return false;
  }
}

/**
 * Billing API Handlers (Multi-Tenant Platform - US5)
 */

// Lazy load licensing modules
let _licenseValidator = null;
let _licenseRefresh = null;
let _stripeWebhook = null;

function getLicenseValidator() {
  if (!_licenseValidator) {
    const { LicenseValidator } = import('../licensing/license-validate.mjs');
    const db = openDb(undefined, config);
    _licenseValidator = new LicenseValidator(db);
  }
  return _licenseValidator;
}

function getLicenseRefresh() {
  if (!_licenseRefresh) {
    const { LicenseRefresh } = import('../licensing/license-refresh.mjs');
    const db = openDb(undefined, config);
    _licenseRefresh = new LicenseRefresh(db);
  }
  return _licenseRefresh;
}

function getStripeWebhook() {
  if (!_stripeWebhook) {
    const { StripeWebhook } = import('../licensing/stripe-webhook.mjs');
    const db = openDb(undefined, config);
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    _stripeWebhook = new StripeWebhook(db, webhookSecret);
  }
  return _stripeWebhook;
}

/**
 * GET /api/billing/license - Get current license status
 */
async function handleGetLicense(req, res) {
  try {
    const validator = getLicenseValidator();
    const result = validator.getLicenseStatus();

    if (result.success) {
      send(res, 200, JSON.stringify(result));
    } else {
      send(res, 404, JSON.stringify(result));
    }
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/**
 * POST /api/billing/license/validate - Validate a license key
 */
async function handleValidateLicense(req, res) {
  try {
    const body = JSON.parse((await readBody(req)) || '{}');
    const { license_key } = body;

    if (!license_key) {
      return send(res, 400, JSON.stringify({ success: false, error: 'license_key is required' }));
    }

    const validator = getLicenseValidator();
    const result = validator.validate(license_key);

    if (result.success) {
      send(res, 200, JSON.stringify(result));
    } else {
      send(res, 400, JSON.stringify(result));
    }
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/**
 * POST /api/billing/license/refresh - Force refresh license
 */
async function handleRefreshLicense(req, res) {
  try {
    const refresh = getLicenseRefresh();
    const result = await refresh.trigger();

    if (result.success) {
      send(res, 200, JSON.stringify(result));
    } else {
      send(res, 500, JSON.stringify(result));
    }
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/**
 * POST /api/billing/checkout - Create Stripe checkout session
 */
async function handleCreateCheckout(req, res) {
  try {
    const body = JSON.parse((await readBody(req)) || '{}');
    const { tier, seats, success_url, cancel_url } = body;

    if (!tier) {
      return send(res, 400, JSON.stringify({ success: false, error: 'tier is required' }));
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      return send(res, 500, JSON.stringify({ success: false, error: 'Stripe not configured' }));
    }

    // Import Stripe SDK
    const stripe = (await import('stripe')).default(process.env.STRIPE_SECRET_KEY);

    // Get pricing for tier
    const pricing = getTierPricing(tier);
    const priceId = pricing.priceId;

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{
        price: priceId,
        quantity: seats || 1,
      }],
      metadata: {
        tier,
        seats: String(seats || 1),
      },
      success_url: success_url || `${req.headers.origin}/billing/success`,
      cancel_url: cancel_url || `${req.headers.origin}/billing/cancel`,
    });

    send(res, 200, JSON.stringify({
      success: true,
      checkout_url: session.url,
      session_id: session.id,
    }));
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/**
 * GET /api/billing/portal - Get customer portal URL
 */
async function handleGetPortal(req, res) {
  try {
    const reqUrl = new URL(req.url, 'http://localhost');
    const return_url = reqUrl.searchParams.get('return_url') || req.headers.origin || 'http://localhost:4317';

    if (!process.env.STRIPE_SECRET_KEY) {
      return send(res, 500, JSON.stringify({ success: false, error: 'Stripe not configured' }));
    }

    // Get current license to find customer ID
    const validator = getLicenseValidator();
    const licenseStatus = validator.getLicenseStatus();

    if (!licenseStatus.success || !licenseStatus.license.customer_id) {
      return send(res, 404, JSON.stringify({ success: false, error: 'No active subscription found' }));
    }

    // Import Stripe SDK
    const stripe = (await import('stripe')).default(process.env.STRIPE_SECRET_KEY);

    // Create portal session
    const session = await stripe.billingPortal.sessions.create({
      customer: licenseStatus.license.customer_id,
      return_url,
    });

    send(res, 200, JSON.stringify({
      success: true,
      portal_url: session.url,
    }));
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/**
 * GET /api/billing/subscription - Get subscription details
 */
async function handleGetSubscription(req, res) {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return send(res, 500, JSON.stringify({ success: false, error: 'Stripe not configured' }));
    }

    // Get current license
    const validator = getLicenseValidator();
    const licenseStatus = validator.getLicenseStatus();

    if (!licenseStatus.success || !licenseStatus.license.subscription_id) {
      return send(res, 404, JSON.stringify({ success: false, error: 'No active subscription found' }));
    }

    // Import Stripe SDK
    const stripe = (await import('stripe')).default(process.env.STRIPE_SECRET_KEY);

    // Get subscription from Stripe
    const subscription = await stripe.subscriptions.retrieve(licenseStatus.license.subscription_id);

    send(res, 200, JSON.stringify({
      success: true,
      subscription: {
        id: subscription.id,
        status: subscription.status,
        tier: licenseStatus.license.tier,
        seats: subscription.items.data[0]?.quantity || 1,
        current_period_start: subscription.current_period_start,
        current_period_end: subscription.current_period_end,
        cancel_at_period_end: subscription.cancel_at_period_end,
      },
    }));
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/**
 * POST /api/billing/webhook/stripe - Handle Stripe webhook
 */
async function handleStripeWebhook(req, res) {
  try {
    const signature = req.headers['stripe-signature'];
    const payload = await readBody(req);

    if (!signature) {
      return send(res, 400, JSON.stringify({ success: false, error: 'Missing stripe-signature header' }));
    }

    const webhook = getStripeWebhook();

    // Verify signature
    if (!webhook.verifySignature(payload, signature)) {
      return send(res, 400, JSON.stringify({ success: false, error: 'Invalid signature' }));
    }

    // Parse event
    const event = JSON.parse(payload);

    // Handle event
    const result = webhook.handle(event);

    if (result.success) {
      send(res, 200, JSON.stringify({ received: true }));
    } else {
      send(res, 500, JSON.stringify({ received: true, error: result.error }));
    }
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/**
 * POST /api/billing/check-feature - Check if feature is available
 */
async function handleCheckFeature(req, res) {
  try {
    const body = JSON.parse((await readBody(req)) || '{}');
    const { feature } = body;

    if (!feature) {
      return send(res, 400, JSON.stringify({ success: false, error: 'feature is required' }));
    }

    const validator = getLicenseValidator();
    const result = validator.checkFeature(feature);

    if (result.success) {
      send(res, 200, JSON.stringify(result));
    } else {
      send(res, 404, JSON.stringify(result));
    }
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/**
 * GET /api/billing/limits - Get tier limits
 */
async function handleGetLimits(req, res) {
  try {
    const validator = getLicenseValidator();
    const result = validator.getLimits();

    if (result.success) {
      send(res, 200, JSON.stringify(result));
    } else {
      send(res, 404, JSON.stringify(result));
    }
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/**
 * GET /api/billing/pricing - Get available pricing plans
 */
async function handleGetPricing(req, res) {
  try {
    const plans = [
      {
        id: 'free',
        name: 'Free',
        tier: 'free',
        price_monthly: 0,
        price_yearly: 0,
        features: [
          '1 project',
          '3 agents',
          '1 user seat',
          '$100 monthly spend limit',
          'Local dashboard only',
        ],
        limits: {
          max_projects: 1,
          max_agents: 3,
          max_seats: 1,
          max_monthly_spend: 100,
        },
      },
      {
        id: 'pro',
        name: 'Pro',
        tier: 'pro',
        price_monthly: 29,
        price_yearly: 290,
        features: [
          '10 projects',
          '50 agents',
          '10 user seats',
          '$1,000 monthly spend limit',
          'Remote dashboard',
          'Team collaboration',
          'Project templates',
          'API access',
        ],
        limits: {
          max_projects: 10,
          max_agents: 50,
          max_seats: 10,
          max_monthly_spend: 1000,
        },
      },
      {
        id: 'enterprise',
        name: 'Enterprise',
        tier: 'enterprise',
        price_monthly: 99,
        price_yearly: 990,
        features: [
          'Unlimited projects',
          'Unlimited agents',
          'Unlimited user seats',
          'Unlimited spend',
          'All Pro features',
          'Priority support',
          'Custom integrations',
          'SSO',
          'Audit logs',
          'Compliance reports',
          'SLA guarantee',
        ],
        limits: {
          max_projects: -1,
          max_agents: -1,
          max_seats: -1,
          max_monthly_spend: -1,
        },
      },
    ];

    send(res, 200, JSON.stringify({
      success: true,
      plans,
    }));
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/**
 * Get Stripe price ID for a tier
 * @param {string} tier - License tier
 * @returns {Object} Pricing information
 */
function getTierPricing(tier) {
  const pricing = {
    free: {
      priceId: null, // Free tier has no price
    },
    pro: {
      priceId: process.env.STRIPE_PRO_PRICE_ID || 'price_pro_monthly',
    },
    enterprise: {
      priceId: process.env.STRIPE_ENTERPRISE_PRICE_ID || 'price_enterprise_monthly',
    },
  };

  return pricing[tier] || pricing.free;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.AIOS_DASHBOARD_PORT) || 4317;
  const host = process.env.AIOS_DASHBOARD_HOST || '127.0.0.1';
  const useHttps = process.env.AIOS_DASHBOARD_HTTPS === 'true';
  // Diagnostic-only default plugin — see budget.mjs's identical comment.
  const DIAG_DOMAIN = { agents: ['a', 'b'], prompts: { implRules: [], reviewCriteria: [] }, guardrailCheck: null, boardTitle: 'AIOS', riskToAction: {}, knownRiskTags: [] };
  const { config } = createAios({ domain: DIAG_DOMAIN });
  
  const server = createDashboardServer(config);
  
  if (useHttps) {
    try {
      const certs = loadOrGenerateCerts();
      const httpsServer = createHttpsServer(certs, server);
      httpsServer.listen(port, host, () => {
        console.log(`MeridianOS Dashboard → https://localhost:${port} (HTTPS)`);
        console.log(`⚠️  Using self-signed certificate. Your browser will show a security warning.`);
      });
    } catch (error) {
      console.error(`Failed to start HTTPS server: ${error.message}`);
      console.log(`Falling back to HTTP on localhost only...`);
      server.listen(port, host, () => {
        console.log(`MeridianOS Dashboard → http://localhost:${port}`);
      });
    }
  } else {
    server.listen(port, host, () => {
      console.log(`MeridianOS Dashboard → http://localhost:${port}`);
    });
  }
}

/**
 * Generate self-signed TLS certificate for HTTPS support
 * @param {string} certPath - Path to save certificate
 * @param {string} keyPath - Path to save private key
 * @returns {Object} Certificate and key paths
 */
function generateSelfSignedCert(certPath, keyPath) {
  const { execSync } = require('node:child_process');
  
  try {
    // Generate private key
    execSync(`openssl genrsa -out "${keyPath}" 2048`, { stdio: 'ignore' });
    
    // Generate self-signed certificate
    execSync(
      `openssl req -new -x509 -key "${keyPath}" -out "${certPath}" -days 365 -subj "/CN=localhost"`,

      {
        stdio: 'ignore',
      }
    );

    return { certPath, keyPath };
  } catch (err) {
    return { certPath: null, keyPath: null };
  }
}

/**
 * Team Collaboration API (US3) - Invitation Management
 */

// Lazy load team collaboration modules
let _invitationManager = null;
let _activityLogger = null;
let _taskCommentManager = null;
let _reviewerAssigner = null;

function getInvitationManager() {
  if (!_invitationManager) {
    const { InvitationManager } = import('../auth/user-store.mjs');
    const db = openDb(undefined, config);
    _invitationManager = new InvitationManager(db);
  }
  return _invitationManager;
}

function getActivityLogger() {
  if (!_activityLogger) {
    const { ActivityLogger } = import('../compliance/audit-log.mjs');
    const db = openDb(undefined, config);
    _activityLogger = new ActivityLogger(db);
  }
  return _activityLogger;
}

function getTaskCommentManager() {
  if (!_taskCommentManager) {
    const { TaskComment } = import('../project/task-comments.mjs');
    const db = openDb(undefined, config);
    _taskCommentManager = new TaskComment(db);
  }
  return _taskCommentManager;
}

function getReviewerAssigner() {
  if (!_reviewerAssigner) {
    const { getReviewerAssigner } = import('../control-plane.mjs');
    _reviewerAssigner = getReviewerAssigner();
  }
  return _reviewerAssigner;
}

/**
 * POST /api/auth/invitations - Create team invitation
 */
async function handleCreateInvitation(req, res) {
  try {
    if (!requireAuth(req, res)) return;
    
    const body = JSON.parse((await readBody(req)) || '{}');
    const { email, role = 'member', message } = body;

    if (!email) {
      return send(res, 400, JSON.stringify({ success: false, error: 'email is required' }));
    }

    const invitationManager = getInvitationManager();
    const result = await invitationManager.create({
      email,
      role,
      message,
      project_id: req.user.sub, // Current user's project
      created_by: req.user.sub,
    });

    if (result.success) {
      // Log the invitation creation
      const activityLogger = getActivityLogger();
      await activityLogger.log({
        user_id: req.user.sub,
        action: 'invitation_created',
        resource_type: 'invitation',
        resource_id: result.invitation.id,
        details: {
          email: result.invitation.email,
          role: result.invitation.role,
          project_id: req.user.sub,
        },
        metadata: { message },
      });

      send(res, 201, JSON.stringify(result));
    } else {
      send(res, 400, JSON.stringify(result));
    }
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/**
 * GET /api/auth/invitations - List invitations for current project
 */
async function handleListInvitations(req, res) {
  try {
    if (!requireAuth(req, res)) return;

    const invitationManager = getInvitationManager();
    const invitations = invitationManager.list(req.user.sub);

    // Log the access
    const activityLogger = getActivityLogger();
    await activityLogger.log({
      user_id: req.user.sub,
      action: 'invitations_listed',
      resource_type: 'invitation',
      details: { project_id: req.user.sub, count: invitations.length },
    });

    send(res, 200, JSON.stringify({ success: true, invitations }));
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/**
 * POST /api/auth/invitations/:id/accept - Accept invitation
 */
async function handleAcceptInvitation(req, res) {
  try {
    if (!requireAuth(req, res)) return;

    const invitationId = req.pathname.split('/')[3];
    const invitationManager = getInvitationManager();
    
    const result = await invitationManager.accept(invitationId, req.user.sub);

    if (result.success) {
      // Log the acceptance
      const activityLogger = getActivityLogger();
      await activityLogger.log({
        user_id: req.user.sub,
        action: 'invitation_accepted',
        resource_type: 'invitation',
        resource_id: invitationId,
        details: {
          email: result.user.email,
          role: result.role,
          project_id: req.user.sub,
        },
      });

      send(res, 200, JSON.stringify(result));
    } else {
      send(res, 400, JSON.stringify(result));
    }
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/**
 * POST /api/auth/invitations/:id/reject - Reject invitation
 */
async function handleRejectInvitation(req, res) {
  try {
    if (!requireAuth(req, res)) return;

    const invitationId = req.pathname.split('/')[3];
    const invitationManager = getInvitationManager();
    
    const result = await invitationManager.reject(invitationId, req.user.sub);

    if (result.success) {
      // Log the rejection
      const activityLogger = getActivityLogger();
      await activityLogger.log({
        user_id: req.user.sub,
        action: 'invitation_rejected',
        resource_type: 'invitation',
        resource_id: invitationId,
        details: { project_id: req.user.sub },
      });

      send(res, 200, JSON.stringify(result));
    } else {
      send(res, 400, JSON.stringify(result));
    }
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/**
 * GET /api/activity/feed - Get activity feed for current project
 */
async function handleGetActivityFeed(req, res) {
  try {
    if (!requireAuth(req, res)) return;

    const activityLogger = getActivityLogger();
    const limit = parseInt(req.url.searchParams.get('limit') || '50', 10);
    const offset = parseInt(req.url.searchParams.get('offset') || '0', 10);
    
    const feed = await activityLogger.getProjectFeed(req.user.sub, limit, offset);

    send(res, 200, JSON.stringify({ success: true, feed }));
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/**
 * GET /api/activity/stats - Get activity statistics for current project
 */
async function handleGetActivityStats(req, res) {
  try {
    if (!requireAuth(req, res)) return;

    const activityLogger = getActivityLogger();
    const stats = await activityLogger.getProjectStats(req.user.sub);

    send(res, 200, JSON.stringify({ success: true, stats }));
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/**
 * POST /api/tasks/:id/comments - Add comment to task
 */
async function handleAddTaskComment(req, res) {
  try {
    if (!requireAuth(req, res)) return;

    const taskId = req.pathname.split('/')[2];
    const body = JSON.parse((await readBody(req)) || '{}');
    const { content } = body;

    if (!content) {
      return send(res, 400, JSON.stringify({ success: false, error: 'content is required' }));
    }

    const taskCommentManager = getTaskCommentManager();
    const result = await taskCommentManager.create({
      task_id: taskId,
      user_id: req.user.sub,
      content,
    });

    if (result.success) {
      // Log the comment creation
      const activityLogger = getActivityLogger();
      await activityLogger.log({
        user_id: req.user.sub,
        action: 'task_commented',
        resource_type: 'task',
        resource_id: taskId,
        details: {
          comment_id: result.comment.id,
          project_id: req.user.sub,
        },
        metadata: { content: content.substring(0, 100) + '...' },
      });

      send(res, 201, JSON.stringify(result));
    } else {
      send(res, 400, JSON.stringify(result));
    }
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/**
 * GET /api/tasks/:id/comments - Get comments for task
 */
async function handleGetTaskComments(req, res) {
  try {
    if (!requireAuth(req, res)) return;

    const taskId = req.pathname.split('/')[2];
    const taskCommentManager = getTaskCommentManager();
    const comments = taskCommentManager.list(taskId);

    send(res, 200, JSON.stringify({ success: true, comments }));
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/**
 * PUT /api/tasks/:id/comments/:commentId - Update task comment
 */
async function handleUpdateTaskComment(req, res) {
  try {
    if (!requireAuth(req, res)) return;

    const taskId = req.pathname.split('/')[2];
    const commentId = req.pathname.split('/')[4];
    const body = JSON.parse((await readBody(req)) || '{}');
    const { content } = body;

    if (!content) {
      return send(res, 400, JSON.stringify({ success: false, error: 'content is required' }));
    }

    const taskCommentManager = getTaskCommentManager();
    const result = await taskCommentManager.update(commentId, content);

    if (result.success) {
      // Log the comment update
      const activityLogger = getActivityLogger();
      await activityLogger.log({
        user_id: req.user.sub,
        action: 'task_comment_updated',
        resource_type: 'task_comment',
        resource_id: commentId,
        details: {
          task_id: taskId,
          project_id: req.user.sub,
        },
        metadata: { content: content.substring(0, 100) + '...' },
      });

      send(res, 200, JSON.stringify(result));
    } else {
      send(res, 400, JSON.stringify(result));
    }
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/**
 * DELETE /api/tasks/:id/comments/:commentId - Delete task comment
 */
async function handleDeleteTaskComment(req, res) {
  try {
    if (!requireAuth(req, res)) return;

    const taskId = req.pathname.split('/')[2];
    const commentId = req.pathname.split('/')[4];
    const taskCommentManager = getTaskCommentManager();
    
    const result = await taskCommentManager.delete(commentId);

    if (result.success) {
      // Log the comment deletion
      const activityLogger = getActivityLogger();
      await activityLogger.log({
        user_id: req.user.sub,
        action: 'task_comment_deleted',
        resource_type: 'task_comment',
        resource_id: commentId,
        details: {
          task_id: taskId,
          project_id: req.user.sub,
        },
      });

      send(res, 200, JSON.stringify(result));
    } else {
      send(res, 400, JSON.stringify(result));
    }
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/**
 * POST /api/reviews/assign - Assign reviewers to PR (round-robin)
 */
async function handleAssignReviewers(req, res) {
  try {
    if (!requireAuth(req, res)) return;

    const body = JSON.parse((await readBody(req)) || '{}');
    const { pr_url, reviewer_count = 2 } = body;

    if (!pr_url) {
      return send(res, 400, JSON.stringify({ success: false, error: 'pr_url is required' }));
    }

    const reviewerAssigner = getReviewerAssigner();
    const result = await reviewerAssigner.assign(req.user.sub, pr_url, reviewer_count);

    if (result.success) {
      // Log the assignment
      const activityLogger = getActivityLogger();
      await activityLogger.log({
        user_id: req.user.sub,
        action: 'reviewers_assigned',
        resource_type: 'pr_review_assignment',
        resource_id: result.assignment_id,
        details: {
          pr_url: result.pr_url,
          reviewers: result.reviewers.map(r => r.username),
          reviewer_count: result.reviewer_count,
          project_id: req.user.sub,
        },
      });

      send(res, 201, JSON.stringify(result));
    } else {
      send(res, 400, JSON.stringify(result));
    }
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/**
 * GET /api/reviews/assignments - Get recent review assignments
 */
async function handleGetReviewAssignments(req, res) {
  try {
    if (!requireAuth(req, res)) return;

    const reviewerAssigner = getReviewerAssigner();
    const limit = parseInt(req.url.searchParams.get('limit') || '10', 10);
    const assignments = reviewerAssigner.getRecentAssignments(req.user.sub, limit);

    send(res, 200, JSON.stringify({ success: true, assignments }));
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/**
 * GET /api/reviews/stats - Get review assignment statistics
 */
async function handleGetReviewStats(req, res) {
  try {
    if (!requireAuth(req, res)) return;

    const reviewerAssigner = getReviewerAssigner();
    const stats = reviewerAssigner.getAssignmentStats(req.user.sub);

    send(res, 200, JSON.stringify({ success: true, stats }));
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/**
 * OAuth Authentication API (T185-T186)
 */
async function handleOAuthAuthorize(req, res, provider) {
  try {
    const oauthProvider = getOAuthProvider(config);
    const state = oauthProvider.constructor.generateState();
    
    // Store state in session for callback verification
    req.session = req.session || {};
    req.session.oauthState = state;
    req.session.oauthProvider = provider;
    
    const authUrl = oauthProvider.getAuthorizeUrl(state);
    return send(res, 200, JSON.stringify({ 
      success: true, 
      authUrl,
      state,
      provider
    }));
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

async function handleOAuthCallback(req, res, provider) {
  try {
    const oauthProvider = getOAuthProvider(config);
    
    // Verify state
    const state = req.query.state;
    if (!state || state !== req.session?.oauthState) {
      return send(res, 400, JSON.stringify({ 
        success: false, 
        error: 'Invalid or missing state parameter' 
      }));
    }
    
    // Exchange code for tokens
    const { code } = req.query;
    if (!code) {
      return send(res, 400, JSON.stringify({ 
        success: false, 
        error: 'Missing authorization code' 
      }));
    }
    
    const tokens = await oauthProvider.exchangeCodeForTokens(code);
    const idToken = tokens.id_token;
    
    // Verify ID token
    const decoded = await oauthProvider.verifyIdToken(idToken);
    
    // Fetch user info
    const userInfo = await oauthProvider.getUserInfo(tokens.access_token);
    
    // Create or update user in database
    const userStore = getUserStore();
    let user = await userStore.getUserByEmail(userInfo.email);
    
    if (!user) {
      // Create new user
      user = await userStore.createUser({
        email: userInfo.email,
        name: userInfo.name,
        password: null, // OAuth user has no password
        role: 'viewer', // Default role for OAuth users
        provider: provider, // Track OAuth provider
        providerId: userInfo.id
      });
    } else {
      // Update existing user with OAuth info
      await userStore.updateUser(user.id, {
        name: userInfo.name,
        provider: provider,
        providerId: userInfo.id
      });
    }
    
    // Generate JWT token
    const jwtToken = generateToken({
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      provider: provider
    });
    
    // Clear session
    delete req.session.oauthState;
    delete req.session.oauthProvider;
    
    return send(res, 200, JSON.stringify({ 
      success: true, 
      token: jwtToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    }));
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/**
 * Authentication API (Multi-Tenant Platform)
 */
