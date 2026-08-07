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
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs';
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
import { writePolicy, LEVER_PATHS, isAgentLeverPath } from '../policy-write.mjs';
import { listBackups, restoreBackup } from '../policy-backups.mjs';
import { listProfiles } from '../profiles.mjs';
import { TIERS } from '../model-router.mjs';
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
import { getUserStore, verifyPassword, hashPassword, InvitationManager } from '../auth/user-store.mjs';
import { getActivityLogger } from '../compliance/audit-log.mjs';
import { TaskComment } from '../project/task-comments.mjs';
import { getReviewerAssigner } from '../control-plane.mjs';
import { getAPITokenManager } from '../auth/api-tokens.mjs';
import { ProjectManager, getProjectManager as getGlobalProjectManager, getTemplateLoader } from '../control-plane.mjs';
import { getOAuthProvider } from '../auth/oauth-provider.mjs';
import { SOC2Report } from '../compliance/reports/soc2.mjs';
import { GDPRReport } from '../compliance/reports/gdpr.mjs';
import { CostAllocationReport } from '../compliance/reports/cost-allocation.mjs';
import { ModelUsageReport } from '../compliance/reports/model-usage.mjs';
import { metricsMiddleware, startMetricsCollection, createMetricsEndpoint, toPrometheusText, getPerformanceReport, resetMetrics } from './metrics.mjs';
import { createRotatingLogger } from '../daemon-logger.mjs';
import { handleApiV1 } from '../api/v1/router.mjs';
import { sendError, Errors } from './errors.mjs';

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
const SETUP_HTML = join(HERE, 'setup.html');
// GET /static/* (008 — End-User Configurability): the workspace's own .mjs modules plus the
// vendored uPlot/Muuri/Litegraph.js assets. Extension allowlist, not a MIME-sniffing library —
// zero-dependency principle — every extension actually used under dashboard/static/ is listed.
const STATIC_DIR = join(HERE, 'static');
const STATIC_CONTENT_TYPES = {
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};
const ALLOWED = new Set(LEVER_PATHS);
const ACTION_PATHS = new Set(['/api/run', '/api/task', '/api/verify', '/api/escalation']);
const STATUS_TTL_MS = 2000; // dedupe bursty polls; buildStatus rescans transcripts, so don't do it per-request

// GET /api/status's TTL cache. Was referenced (read AND reassigned) at every call site below without
// ever being declared — a latent bug that threw "statusCache is not defined" on the very first hit to
// /api/status (and on every mutating route that invalidates it), since ES modules are always strict
// mode and a bare assignment to an undeclared identifier throws rather than creating an implicit
// global. Discovered while adding /api/config/backups' cache-invalidation call (008 — End-User
// Configurability, US1) — no existing test exercised any of these routes over real HTTP, only via
// their underlying functions directly, which is why this went uncaught.
let statusCache = { t: 0, body: '' };

// ─── Rate Limiting (T192) ────────────────────────────────────────────────────
//
// Three tiers:
//   AUTH      tier: 20 requests / minute  — login, token refresh, OAuth callbacks
//   API-READ  tier: 240 requests / minute — GET/HEAD under /api/ (status, analytics, etc.)
//   API-WRITE tier: 100 requests / minute — POST/PUT/PATCH/DELETE under /api/
//
// Read and write traffic under /api/ used to share one 100 req/min bucket. The dashboard's own
// background poll loop (index.html's poll(), every 10s) alone issues ~13 GETs per cycle — status,
// providers, models, ide/detect, mcp/config, ide/status, subscriptions, and six analytics/budget/
// optimization endpoints — which is ~78 req/min of pure polling on a single-user localhost tool.
// That left almost no headroom in the shared bucket for actual user-initiated writes (e.g. inviting
// a team member), which could 429 within seconds of the dashboard being left open. Splitting reads
// and writes into separate buckets means heavy polling can no longer starve a write action; the
// api-read ceiling (240/min) still leaves comfortable headroom over steady-state polling (including
// multiple tabs or manual refreshes) while remaining well below anything a runaway loop bug would need
// bounding at.
//
// Each tier is tracked per-IP using a sliding fixed-window counter.
// Every API response carries X-RateLimit-* headers so clients can back off
// gracefully without needing to parse error bodies.

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

const RATE_TIERS = {
  auth:      { limit: 20,  window: RATE_LIMIT_WINDOW_MS },
  'api-read':  { limit: 240, window: RATE_LIMIT_WINDOW_MS },
  'api-write': { limit: 100, window: RATE_LIMIT_WINDOW_MS },
};

// Map<tier, Map<ip, { count, resetAt }>>
const rateLimitStores = {
  auth:        new Map(),
  'api-read':  new Map(),
  'api-write': new Map(),
};

/**
 * Determine the rate-limit tier for a given request. Auth-sensitive endpoints get the stricter
 * "auth" tier regardless of method; everything else under /api/ is split by method so read-only
 * background polling (GET/HEAD) can't starve user-initiated writes of their own budget.
 */
function rateTier(pathname, method) {
  if (
    pathname === '/api/auth/login' ||
    pathname === '/api/auth/refresh' ||
    pathname === '/api/auth/logout' ||
    pathname.startsWith('/api/auth/oauth/')
  ) return 'auth';
  return (method === 'GET' || method === 'HEAD') ? 'api-read' : 'api-write';
}

/**
 * Check and increment the rate counter for `ip` on `tier`.
 *
 * Returns an object:
 *   { allowed: boolean, limit, remaining, resetAt }
 *
 * `resetAt` is a Unix epoch second (for Retry-After / X-RateLimit-Reset).
 */
function checkRateLimit(ip, tier = 'api-write') {
  const { limit, window } = RATE_TIERS[tier];
  const store = rateLimitStores[tier];
  const now = Date.now();

  let state = store.get(ip);
  if (!state || now > state.resetAt) {
    state = { count: 0, resetAt: now + window };
    store.set(ip, state);
  }

  const remaining = Math.max(0, limit - state.count - 1);
  const resetSec  = Math.ceil(state.resetAt / 1000);

  if (state.count >= limit) {
    return { allowed: false, limit, remaining: 0, resetAt: resetSec };
  }

  state.count++;
  return { allowed: true, limit, remaining, resetAt: resetSec };
}

/**
 * Attach X-RateLimit-* headers to `res` without overwriting an already-started response.
 */
function attachRateLimitHeaders(res, rateInfo) {
  if (res.headersSent) return;
  res.setHeader('X-RateLimit-Limit',     String(rateInfo.limit));
  res.setHeader('X-RateLimit-Remaining', String(rateInfo.remaining));
  res.setHeader('X-RateLimit-Reset',     String(rateInfo.resetAt));
  if (!rateInfo.allowed) {
    res.setHeader('Retry-After', String(rateInfo.resetAt - Math.ceil(Date.now() / 1000)));
  }
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

// Lazy shared db handle for the Phase 7 public REST API (api/v1/router.mjs) — separate
// connection from `getStore()`'s (same underlying WAL-mode SQLite file, so both coexist safely),
// since api_keys/webhooks/plugins aren't part of the ProjectStore facade.
let _v1Db = null;
function getV1Db(config) {
  return (_v1Db ||= openDb(undefined, config));
}

let _v1Logger = null;
function getV1Logger(config) {
  if (_v1Logger) return _v1Logger;
  try {
    _v1Logger = createRotatingLogger({ config });
  } catch {
    _v1Logger = { log: (_t, m) => console.log(`[meridianos] ${m}`), error: (_t, m, e) => console.error(`[meridianos] ${m}`, e ?? '') };
  }
  return _v1Logger;
}

// Security hardening (code-review follow-up): safe to apply to EVERY response regardless of
// content type — none of these restrict script execution, so they can't break the dashboard's
// existing inline <script> (see index.html). `frame-ancestors 'none'` is the modern equivalent of
// X-Frame-Options: DENY; both are sent since older browsers only honor the latter.
const BASELINE_SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "frame-ancestors 'none'",
};

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', ...BASELINE_SECURITY_HEADERS });
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
  // 009 — Dashboard Modernization (US1/T018): ALLOWED alone only recognizes the hardcoded
  // claude/antigravity agent names — isAgentLeverPath() additionally accepts a per-agent budget/
  // model/routing path for any agent actually in the configured roster (see its own doc comment).
  const roster = config?.domain?.agents ?? [];
  for (const p of Object.keys(updates)) {
    if (!ALLOWED.has(p) && !isAgentLeverPath(p, roster)) throw new Error(`path not allowed: ${p}`);
  }
  // Coherence gate (postmortem A5): validate the WOULD-BE-MERGED policy before writing, so the
  // dashboard can't persist an incoherent combination (WIP > parallel, unknown cadence, bad enum…).
  const merged = applyDottedUpdates(loadPolicy(undefined, config), updates);
  const v = validatePolicy(merged);
  if (!v.ok) throw new Error(`invalid policy: ${v.errors.join('; ')}`);
  writePolicy(updates, { ...(path ? { path } : {}), config });
  return { ok: true, wrote: Object.keys(updates), warnings: v.warnings };
}

// getTaskCommentManager() (008 — Team Collaboration) needs `config.dbPath` — task_comments lives
// in the per-tenant state db, unlike the control-plane singletons (getUserStore() etc.), which
// are deliberately fixed-path and config-independent. It's a top-level function, outside
// createDashboardServer(config)'s closure, so it can't close over that parameter directly (it
// used to reference a bare `config` that was simply never in scope there — a ReferenceError on
// every call); this module-level capture, set once below, is threaded through instead —
// consistent with how AUTH_TOKEN etc. are already single-instance module state in this file.
let _dashboardConfig = null;

/** `config` is the injected AiosConfig (REQUIRED). Threaded to every call this server makes that
 *  accepts one: readSpec/writeSpec, execCommand, restartDaemon, buildStatus, openDb, actions. */
export function createDashboardServer(config) {
  _dashboardConfig = config;
  // lazy: don't open the DB just by importing this module
  const getStore = () => (_store ||= createProjectStore({ db: openDb(undefined, config), config }));
  // Start performance metrics collection for this server instance (T191)
  startMetricsCollection(60_000); // export snapshot every 60 s

  return createServer(async (req, res) => {
    try {
      // Metrics (code-review follow-up: "Add metrics export for monitoring") — registers a
      // `res.on('finish', ...)` listener and returns immediately (its `next` is a no-op; this
      // isn't an Express app, there's no middleware chain to continue), so every request's
      // timing/status is recorded regardless of which route below actually answers it.
      metricsMiddleware(req, res, () => {});

      const url = new URL(req.url, 'http://localhost');
      const clientIp = req.socket.remoteAddress || 'unknown';

      // Apply tiered rate limiting (T192) to all API requests. /api/v1/* is exempt from this
      // IP-based limiter — it has its own, more precise per-API-key sliding window
      // (api/v1/router.mjs, FR-009); stacking both on the same path would just make the public
      // API's rate limit depend on how many OTHER local tools happen to share this machine's
      // loopback address.
      if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/v1/')) {
        const tier     = rateTier(url.pathname, req.method);
        const rateInfo = checkRateLimit(clientIp, tier);
        attachRateLimitHeaders(res, rateInfo);
        if (!rateInfo.allowed) {
          return sendError(res, Errors.RATE_LIMIT_EXCEEDED);
        }
      }

      // Cheap liveness probe: touches NO DB, filesystem, git, or transcript scan, so it answers
      // instantly whenever the event loop is free — and, crucially, times out when the loop is
      // BLOCKED (e.g. a synchronous git/gh spawnSync in a tick). That makes it a true wedge signal
      // an external watchdog can poll to restart a daemon that is "listening but unresponsive"
      // (the failure mode that only a process-EXIT restart, not this, would otherwise miss).
      if (req.method === 'GET' && url.pathname === '/healthz') {
        return send(res, 200, JSON.stringify({ ok: true, ts: Date.now() }));
      }
      // Public REST API v1 (US3) — fully self-contained routing/auth/rate-limiting, so it must
      // run BEFORE the dashboard's own per-boot-token `authorized()` gate below (Bearer mk-{key}
      // is a completely separate credential from the dashboard's own token).
      if (url.pathname.startsWith('/api/v1/')) {
        const handled = await handleApiV1(req, res, url, {
          config, db: getV1Db(config), readBody, authorized, logger: getV1Logger(config),
        });
        if (handled) return;
      }
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        const html = readFileSync(INDEX, 'utf8').replaceAll('__AIOS_TOKEN__', AUTH_TOKEN);
        return send(res, 200, html, 'text/html; charset=utf-8');
      }
      // GET /setup + POST /api/setup/* (008 — End-User Configurability, US3): the browser twin of
      // `gateway/cli.mjs setup`, both built on setup-wizard-core.mjs so the two paths can never
      // drift into producing different policy.yaml/tenant.yaml/.env shapes (FR-009).
      if (req.method === 'GET' && url.pathname === '/setup') {
        const html = readFileSync(SETUP_HTML, 'utf8').replaceAll('__AIOS_TOKEN__', AUTH_TOKEN);
        return send(res, 200, html, 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && url.pathname === '/api/setup/status') {
        const { detectExistingConfig, detectEnvironment, detectProviders } = await import('../setup-wizard-core.mjs');
        const { exists } = detectExistingConfig(config.repoRoot);
        return send(res, 200, JSON.stringify({
          ok: true, exists, environment: detectEnvironment(),
          providers: detectProviders().map((p) => ({ name: p.name, keyEnv: p.keyEnv })),
        }));
      }
      // GET /static/* — the Settings/Observability workspace's own .mjs modules plus the three
      // vendored frontend libraries (008 — End-User Configurability, FR-015). Read-only, no auth
      // token required (same precedent as index.html itself — these are static assets, not data).
      // path.join + a startsWith(STATIC_DIR) check blocks '..' traversal outside the static root.
      if (req.method === 'GET' && url.pathname.startsWith('/static/')) {
        const rel = decodeURIComponent(url.pathname.slice('/static/'.length));
        const filePath = join(STATIC_DIR, rel);
        if (!filePath.startsWith(STATIC_DIR) || !existsSync(filePath) || !statSync(filePath).isFile()) {
          return send(res, 404, JSON.stringify({ ok: false, error: 'not found' }));
        }
        const contentType = STATIC_CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream';
        res.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store', ...BASELINE_SECURITY_HEADERS });
        return res.end(readFileSync(filePath));
      }
      // Every mutating request must be same-origin + carry the per-boot token (security P1).
      if (req.method === 'POST' && !authorized(req)) {
        return send(res, 403, JSON.stringify({ ok: false, error: 'forbidden: missing/invalid token or cross-origin request' }));
      }
      // POST /api/client-error (009 — Dashboard Modernization, US3/FR-006/FR-007): the backend half
      // of the dashboard's error-visibility hardening. Every caught client-side error is forwarded
      // here so it survives a reload and is diagnosable from daemon.log without devtools ever having
      // been open — see dashboard/static/client-error-log.mjs. Reuses the existing per-boot
      // getV1Logger() rather than a second logger instance; never throws back to the client on a
      // logging failure (daemon-logger.mjs's own contract: "never throws").
      if (req.method === 'POST' && url.pathname === '/api/client-error') {
        let body;
        try {
          body = JSON.parse((await readBody(req)) || '{}');
        } catch {
          return send(res, 400, JSON.stringify({ ok: false, error: 'invalid JSON body' }));
        }
        if (typeof body !== 'object' || body === null || Array.isArray(body)) {
          return send(res, 400, JSON.stringify({ ok: false, error: 'body must be a JSON object' }));
        }
        const { source, message, stack, timestamp } = body;
        if (typeof source !== 'string' || !source.trim()) {
          return send(res, 400, JSON.stringify({ ok: false, error: '`source` is required' }));
        }
        if (typeof message !== 'string' || !message.trim()) {
          return send(res, 400, JSON.stringify({ ok: false, error: '`message` is required' }));
        }
        const suffix = timestamp ? ` (client ts: ${timestamp})` : '';
        getV1Logger(config).error(source, `${message}${suffix}`, stack);
        return send(res, 200, JSON.stringify({ ok: true }));
      }
      // POST /api/setup/plan + /api/setup/commit (008 — End-User Configurability, US3) — placed
      // AFTER the authorized() gate above like every other mutating route; these write files to
      // the filesystem (commit) or at minimum echo back generated content (plan), so both require
      // the same per-boot token as POST /api/policy.
      if (req.method === 'POST' && url.pathname === '/api/setup/plan') {
        try {
          const { buildSetupPlan } = await import('../setup-wizard-core.mjs');
          const body = JSON.parse((await readBody(req)) || '{}');
          const plan = buildSetupPlan(body);
          return send(res, 200, JSON.stringify({ ok: true, files: plan.files, budget: plan.budget }));
        } catch (err) {
          return send(res, 200, JSON.stringify({ ok: false, error: err.message }));
        }
      }
      if (req.method === 'POST' && url.pathname === '/api/setup/commit') {
        try {
          const { buildSetupPlan, writeSetupPlan } = await import('../setup-wizard-core.mjs');
          const body = JSON.parse((await readBody(req)) || '{}');
          const plan = buildSetupPlan(body);
          writeSetupPlan(plan, config.repoRoot, { force: Boolean(body.force) });
          return send(res, 200, JSON.stringify({ ok: true, filesWritten: Object.keys(plan.files) }));
        } catch (err) {
          return send(res, 200, JSON.stringify({ ok: false, error: err.message }));
        }
      }
      if (req.method === 'GET' && url.pathname === '/api/status') {
        const t = Date.now();
        if (t - statusCache.t >= STATUS_TTL_MS) statusCache = { t, body: JSON.stringify(buildStatus({ config })) };
        return send(res, 200, statusCache.body);
      }
      // T094 — "Connected to cloud control plane" indicator. cloud/local-agent.mjs runs as a
      // SEPARATE process and has no other channel back to this one, so it persists its status to
      // a small file (cloud/local-agent.mjs's statusFilePath) that this route just reads.
      if (req.method === 'GET' && url.pathname === '/api/cloud/status') {
        try {
          const { statusFilePath } = await import('../cloud/local-agent.mjs');
          const raw = readFileSync(statusFilePath(config), 'utf8');
          return send(res, 200, raw);
        } catch {
          return send(res, 200, JSON.stringify({ connected: false, lastReportAt: null, lastError: null }));
        }
      }
      // Metrics export for monitoring (code-review follow-up). /api/metrics is the existing
      // JSON shape (dashboard/metrics.mjs, already built but previously never wired to a route);
      // /metrics is Prometheus text exposition format for scraping into an existing
      // Prometheus/Grafana setup — GET-only, read-only, no token required (same precedent as
      // /api/status).
      if (url.pathname === '/api/metrics') {
        return createMetricsEndpoint()(req, res);
      }
      if (req.method === 'GET' && url.pathname === '/metrics') {
        let webhookDeliveries, apiKeysActive;
        try {
          const v1Db = getV1Db(config);
          const rows = v1Db.prepare('SELECT status, COUNT(*) AS c FROM webhook_delivery_logs GROUP BY status').all();
          webhookDeliveries = Object.fromEntries(rows.map((r) => [r.status, r.c]));
          apiKeysActive = v1Db.prepare('SELECT COUNT(*) AS c FROM api_keys WHERE is_active = 1').get().c;
        } catch { /* Phase 7 tables may not exist yet on a very old DB — metrics export must never 500 */ }
        res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4', 'cache-control': 'no-store', ...BASELINE_SECURITY_HEADERS });
        return res.end(toPrometheusText({ webhookDeliveries, apiKeysActive }));
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
      if (req.method === 'GET' && url.pathname === '/api/config/backups') {
        const backups = listBackups(dirname(config.policyPath));
        return send(res, 200, JSON.stringify({ ok: true, backups }));
      }
      // GET /api/config/profiles (008 — End-User Configurability, US2/FR-007): no prior endpoint
      // exposed policy.yaml's `profiles:`/`active_profile` fields to the dashboard at all — every
      // other route either writes policy or reads unrelated data — so the Settings workspace's
      // profile selector had nothing to read from until this was added.
      if (req.method === 'GET' && url.pathname === '/api/config/profiles') {
        const policy = loadPolicy(undefined, config);
        return send(res, 200, JSON.stringify({ ok: true, profiles: listProfiles(policy), active: policy?.active_profile ?? null }));
      }
      // GET /api/config/routing (008 — End-User Configurability, US1/FR-014): the routing
      // flow-graph panel needs the roster + current model_routing.<agent>.<tier> assignments to
      // render existing connections on load — nothing previously exposed policy.model_routing to
      // the dashboard (status.mjs's `routing` field is per-TASK resolved routing, a different
      // thing). Read-only; the panel writes back through the existing POST /api/policy (FR-002).
      if (req.method === 'GET' && url.pathname === '/api/config/routing') {
        const policy = loadPolicy(undefined, config);
        return send(res, 200, JSON.stringify({
          ok: true,
          agents: config.domain?.agents ?? [],
          tiers: TIERS,
          routing: policy?.model_routing ?? {},
        }));
      }
      if (req.method === 'POST' && url.pathname.startsWith('/api/config/restore/')) {
        const timestamp = decodeURIComponent(url.pathname.slice('/api/config/restore/'.length));
        const result = restoreBackup(dirname(config.policyPath), timestamp, { policyPath: config.policyPath });
        if (result.ok) statusCache.t = 0; // restored config → next poll rebuilds instead of serving stale
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

      // ── Plugin Marketplace (US4, T059/T060) — dashboard-token-gated admin actions, distinct
      // from the public REST API's own auth. GET is open (matches the rest of this file's
      // read-vs-mutate pattern); every mutating route already passed the authorized() gate above.
      if (req.method === 'GET' && url.pathname === '/api/plugins') {
        const { seedBuiltinPlugins, registryPath } = await import('../plugin-registry.mjs');
        const { pluginStatus } = await import('../plugin-loader.mjs');
        const regPath = registryPath(config);
        seedBuiltinPlugins(regPath);
        const db = getV1Db(config);
        return send(res, 200, JSON.stringify({ ok: true, plugins: pluginStatus(db, regPath) }));
      }
      if (req.method === 'POST' && url.pathname.match(/^\/api\/plugins\/[^/]+\/install$/)) {
        const pluginId = url.pathname.split('/')[3];
        const { registryPath } = await import('../plugin-registry.mjs');
        const { installPlugin } = await import('../plugin-loader.mjs');
        try {
          const row = installPlugin(getV1Db(config), registryPath(config), pluginId, { logger: getV1Logger(config), policy: loadPolicy(undefined, config) });
          return send(res, 200, JSON.stringify({ ok: true, plugin: row }));
        } catch (err) {
          return send(res, 400, JSON.stringify({ ok: false, error: err.message }));
        }
      }
      if (req.method === 'POST' && url.pathname.match(/^\/api\/plugins\/[^/]+\/uninstall$/)) {
        const pluginId = url.pathname.split('/')[3];
        const { uninstallPlugin } = await import('../plugin-loader.mjs');
        uninstallPlugin(getV1Db(config), pluginId, { logger: getV1Logger(config) });
        return send(res, 200, JSON.stringify({ ok: true }));
      }
      if (req.method === 'POST' && url.pathname.match(/^\/api\/plugins\/[^/]+\/(enable|disable)$/)) {
        const parts = url.pathname.split('/');
        const pluginId = parts[3];
        const { enablePlugin, disablePlugin } = await import('../plugin-loader.mjs');
        try {
          (parts[4] === 'enable' ? enablePlugin : disablePlugin)(getV1Db(config), pluginId, { logger: getV1Logger(config) });
          return send(res, 200, JSON.stringify({ ok: true }));
        } catch (err) {
          return send(res, 400, JSON.stringify({ ok: false, error: err.message }));
        }
      }
      if (req.method === 'POST' && url.pathname.match(/^\/api\/plugins\/[^/]+\/rate$/)) {
        const pluginId = url.pathname.split('/')[3];
        const { registryPath, ratePlugin } = await import('../plugin-registry.mjs');
        const body = JSON.parse((await readBody(req)) || '{}');
        try {
          const entry = ratePlugin(registryPath(config), pluginId, Number(body.stars));
          getV1Logger(config).log('plugin-loader', `plugin '${pluginId}' rated ${body.stars} stars`);
          return send(res, 200, JSON.stringify({ ok: true, entry }));
        } catch (err) {
          return send(res, 400, JSON.stringify({ ok: false, error: err.message }));
        }
      }
      if (req.method === 'GET' && url.pathname.match(/^\/api\/plugins\/[^/]+\/config$/)) {
        const pluginId = url.pathname.split('/')[3];
        const { getPluginConfig } = await import('../plugin-loader.mjs');
        return send(res, 200, JSON.stringify({ ok: true, config: getPluginConfig(getV1Db(config), pluginId) }));
      }
      if (req.method === 'PUT' && url.pathname.match(/^\/api\/plugins\/[^/]+\/config$/)) {
        const pluginId = url.pathname.split('/')[3];
        const { setPluginConfig } = await import('../plugin-loader.mjs');
        const body = JSON.parse((await readBody(req)) || '{}');
        setPluginConfig(getV1Db(config), pluginId, body.values ?? {}, { sensitiveKeys: body.sensitiveKeys ?? [], logger: getV1Logger(config) });
        return send(res, 200, JSON.stringify({ ok: true }));
      }
      if (req.method === 'POST' && url.pathname.match(/^\/api\/plugins\/[^/]+\/test$/)) {
        const pluginId = url.pathname.split('/')[3];
        const { registryPath } = await import('../plugin-registry.mjs');
        const { getPluginConfig, testPluginConnection, analyzePluginSource } = await import('../plugin-loader.mjs');
        try {
          const { loadRegistry } = await import('../plugin-registry.mjs');
          const entry = loadRegistry(registryPath(config)).find((e) => e.id === pluginId);
          if (!entry) return send(res, 404, JSON.stringify({ ok: false, error: `Plugin '${pluginId}' not found` }));
          const entryPath = join(config.repoRoot, entry.main);
          // Same static-analysis gate loadPlugin() runs before its dynamic import (FR-019) — this
          // route imports plugin code independently (to test an already-installed plugin's live
          // connection config), so it must not skip the safety check just because discoverPlugins()
          // already vetted it once at daemon boot.
          const analysis = analyzePluginSource(readFileSync(entryPath, 'utf8'));
          if (!analysis.safe) {
            return send(res, 400, JSON.stringify({ ok: false, error: `Plugin '${entry.name ?? pluginId}' failed static analysis: ${analysis.violations.join('; ')}` }));
          }
          const pluginModule = await import(pathToFileURL(entryPath).href);
          const testConfig = getPluginConfig(getV1Db(config), pluginId, { includeSensitive: true });
          const result = await testPluginConnection(pluginModule, testConfig);
          return send(res, 200, JSON.stringify({ ok: true, ...result }));
        } catch (err) {
          return send(res, 500, JSON.stringify({ ok: false, error: err.message }));
        }
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
      if (req.method === 'GET' && url.pathname.match(/^\/api\/projects\/[^/]+\/members$/)) {
        return handleListProjectMembers(req, res);
      }
      if (req.method === 'POST' && url.pathname.match(/^\/api\/projects\/[^/]+\/members$/)) {
        return handleAddProjectMember(req, res);
      }
      if (req.method === 'PUT' && url.pathname.match(/^\/api\/projects\/[^/]+\/members\/[^/]+$/)) {
        return handleUpdateProjectMember(req, res);
      }
      if (req.method === 'DELETE' && url.pathname.match(/^\/api\/projects\/[^/]+\/members\/[^/]+$/)) {
        return handleRemoveProjectMember(req, res);
      }
      if (req.method === 'GET' && url.pathname.match(/^\/api\/projects\/[^/]+\/activity$/)) {
        return handleGetProjectActivity(req, res);
      }
      if (req.method === 'POST' && url.pathname.match(/^\/api\/projects\/[^/]+\/tasks\/[^/]+\/comments$/)) {
        const parts = url.pathname.split('/');
        return handleAddTaskComment(req, res, { taskId: parts[5], projectId: parts[3] });
      }
      if (req.method === 'GET' && url.pathname.match(/^\/api\/projects\/[^/]+\/tasks\/[^/]+\/comments$/)) {
        return handleGetProjectTaskComments(req, res);
      }
      if (req.method === 'GET' && url.pathname === '/api/activity/feed') {
        return handleGetActivityFeed(req, res);
      }
      if (req.method === 'GET' && url.pathname === '/api/activity/stats') {
        return handleGetActivityStats(req, res);
      }
      if (req.method === 'POST' && url.pathname.match(/^\/api\/tasks\/[^/]+\/comments$/)) {
        return handleAddTaskComment(req, res, { taskId: url.pathname.split('/')[3], projectId: null });
      }
      if (req.method === 'GET' && url.pathname.match(/^\/api\/tasks\/[^/]+\/comments$/)) {
        return handleGetTaskComments(req, res, { taskId: url.pathname.split('/')[3] });
      }
      if (req.method === 'PUT' && url.pathname.match(/^\/api\/tasks\/[^/]+\/comments\/[^/]+$/)) {
        const parts = url.pathname.split('/');
        return handleUpdateTaskComment(req, res, { taskId: parts[3], commentId: parts[5] });
      }
      if (req.method === 'DELETE' && url.pathname.match(/^\/api\/tasks\/[^/]+\/comments\/[^/]+$/)) {
        const parts = url.pathname.split('/');
        return handleDeleteTaskComment(req, res, { taskId: parts[3], commentId: parts[5] });
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

      // ── Performance metrics endpoint (T191) ────────────────────────────────
      // GET  /api/metrics  — current performance report (admin only)
      // POST /api/metrics  — reset metrics counters (admin only)
      if (url.pathname === '/api/metrics') {
        if (!requireAuth(req, res)) return;
        if (req.method === 'GET') {
          return send(res, 200, JSON.stringify(getPerformanceReport()));
        }
        if (req.method === 'POST') {
          resetMetrics();
          return send(res, 200, JSON.stringify({ ok: true, message: 'Metrics counters reset.' }));
        }
        return sendError(res, Errors.SERVER_METHOD_NOT_ALLOWED, { method: req.method });
      }

      return sendError(res, Errors.SERVER_NOT_FOUND);
    } catch (e) {
      const merr = (e && e.code && e.httpStatus) ? e : null;
      if (merr) return sendError(res, merr);
      return sendError(res, Errors.SERVER_INTERNAL, {}, { detail: String((e && e.message) || e) });
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
    sendError(res, Errors.AUTH_MISSING_HEADER);
    return false;
  }

  const parts = authHeader.split(' ');
  const scheme = parts[0];
  const token  = parts[1];
  if (!scheme || !token) {
    sendError(res, Errors.AUTH_INVALID_FORMAT);
    return false;
  }

  if (scheme.toLowerCase() === 'bearer') {
    const payload = verifyToken(token);
    if (!payload) {
      // Distinguish expired vs. invalid where possible
      sendError(res, Errors.AUTH_TOKEN_INVALID);
      return false;
    }
    req.user = payload;
    return true;
  } else if (scheme.toLowerCase() === 'apikey') {
    const tokenManager = getAPITokenManager();
    const tokenData = tokenManager.validateToken(token);
    if (!tokenData) {
      sendError(res, Errors.AUTH_TOKEN_INVALID);
      return false;
    }
    req.user = { sub: tokenData.user_id, email: tokenData.email };
    req.apiToken = tokenData;
    return true;
  } else {
    sendError(res, Errors.AUTH_INVALID_FORMAT);
    return false;
  }
}

/**
 * Project-scoped RBAC (008 — Team Collaboration, FR-008). Nothing in this file checked a role
 * before this — requireAuth() only proves the caller is SOME authenticated user, never that
 * they're allowed to manage a given project's team. `project_users.role` is per-project (a site
 * `users.role` of 'admin' doesn't imply project-admin, and vice versa — a project admin may be a
 * site 'viewer'); a site-wide admin is treated as implicitly authorized everywhere, matching how
 * handleCreateUser already gates purely on the site role for a platform-wide action.
 */
function getProjectRole(userId, projectId) {
  const row = getUserStore().db.prepare(
    'SELECT role FROM project_users WHERE user_id = ? AND project_id = ?',
  ).get(userId, projectId);
  return row?.role ?? null;
}

/** requireAuth() + project-role check, in one call. Sends the response and returns false itself
 *  on failure — callers just `if (!requireProjectRole(...)) return;`, same shape as requireAuth. */
function requireProjectRole(req, res, projectId, allowedRoles) {
  if (!requireAuth(req, res)) return false;
  if (req.user.role === 'admin') return true; // site-wide admin bypasses project-level checks
  const role = getProjectRole(req.user.sub, projectId);
  if (!role || !allowedRoles.includes(role)) {
    sendError(res, Errors.AUTH_FORBIDDEN);
    return false;
  }
  return true;
}

/**
 * Authentication API Handlers (Multi-Tenant Platform - US2)
 *
 * These were previously referenced by the route table above but never defined anywhere in this
 * file — every request to /api/auth/login, /me, /me/password, /tokens, /logout, /refresh, /users
 * threw `ReferenceError: handleX is not defined`. Nothing auth-gated (including every US3 Team
 * Collaboration route) is reachable without POST /api/auth/login working, so this was the actual
 * blocking prerequisite for that work, not a US3 task itself.
 */

async function parseJsonBody(req, res) {
  try {
    const parsed = JSON.parse((await readBody(req)) || '{}');
    return { ok: true, body: parsed };
  } catch {
    send(res, 400, JSON.stringify({ success: false, error: 'invalid JSON body' }));
    return { ok: false };
  }
}

/** Never send password_hash back over the wire. */
function publicUser(user) {
  return { id: user.id, email: user.email, full_name: user.full_name, role: user.role, github_username: user.github_username ?? null, created_at: user.created_at, last_login: user.last_login };
}

/** POST /api/auth/login — verify credentials, issue a JWT carrying {sub, email, role} so
 *  downstream role checks (see handleCreateUser) don't need a DB round-trip per request. */
async function handleLogin(req, res) {
  const { ok, body } = await parseJsonBody(req, res);
  if (!ok) return;
  const { email, password } = body;
  if (!email || !password) return send(res, 400, JSON.stringify({ success: false, error: 'email and password are required' }));

  const user = getUserStore().verifyCredentials(email, password);
  if (!user) return sendError(res, Errors.AUTH_BAD_CREDENTIALS);

  const token = generateToken({ sub: user.id, email: user.email, role: user.role });
  send(res, 200, JSON.stringify({ success: true, token, user: publicUser(user) }));
}

/** GET /api/auth/me — the authenticated user's own profile. */
async function handleGetCurrentUser(req, res) {
  if (!requireAuth(req, res)) return;
  const user = getUserStore().getUserById(req.user.sub);
  if (!user) return sendError(res, Errors.AUTH_TOKEN_INVALID);
  send(res, 200, JSON.stringify({ success: true, user: publicUser(user) }));
}

/** PUT /api/auth/me — self-update. full_name only: role/is_active changes are deliberately NOT
 *  self-service (role comes from admin user-creation or project membership, is_active from
 *  admin account management — neither exists as a self-service action for the same reason a
 *  user can't grant themselves admin). */
async function handleUpdateCurrentUser(req, res) {
  if (!requireAuth(req, res)) return;
  const { ok, body } = await parseJsonBody(req, res);
  if (!ok) return;
  const updates = {};
  if (typeof body.full_name === 'string') updates.full_name = body.full_name;
  // github_username (008 — Team Collaboration, FR-014): self-service, unlike role/is_active —
  // needed so PR reviewer auto-assignment (control-plane.mjs's ReviewerAssigner) has a real
  // GitHub identity to hand to `gh pr edit --add-reviewer`.
  if (typeof body.github_username === 'string') updates.github_username = body.github_username;
  const user = getUserStore().updateUser(req.user.sub, updates);
  send(res, 200, JSON.stringify({ success: true, user: publicUser(user) }));
}

/** POST /api/auth/me/password — change the authenticated user's own password. */
async function handleChangePassword(req, res) {
  if (!requireAuth(req, res)) return;
  const { ok, body } = await parseJsonBody(req, res);
  if (!ok) return;
  const { oldPassword, newPassword } = body;
  if (!oldPassword || !newPassword) return send(res, 400, JSON.stringify({ success: false, error: 'oldPassword and newPassword are required' }));
  const changed = await getUserStore().changePassword(req.user.sub, oldPassword, newPassword);
  if (!changed) return sendError(res, Errors.AUTH_BAD_CREDENTIALS);
  send(res, 200, JSON.stringify({ success: true }));
}

/** POST /api/auth/tokens — mint a long-lived API token for the authenticated user. The raw token
 *  is only ever returned here, at creation — listTokens() below never exposes it again. */
async function handleCreateApiToken(req, res) {
  if (!requireAuth(req, res)) return;
  const { ok, body } = await parseJsonBody(req, res);
  if (!ok) return;
  const { name, scope, expiresIn } = body;
  if (!name || !scope) return send(res, 400, JSON.stringify({ success: false, error: 'name and scope are required' }));
  // expiresIn arrives as a numeric string from the dashboard's <select> (HTML form values are
  // always strings) — generateToken() does `now + expiresIn` to compute expires_at, and adding a
  // string there is JS string concatenation, not arithmetic, so this must be a number first.
  const expiresInSeconds = expiresIn ? Number(expiresIn) : null;
  const token = getAPITokenManager().generateToken(req.user.sub, name, scope, expiresInSeconds || null);
  send(res, 201, JSON.stringify({ success: true, token }));
}

/** GET /api/auth/tokens — list the authenticated user's own API tokens (metadata only). */
async function handleListApiTokens(req, res) {
  if (!requireAuth(req, res)) return;
  const tokens = getAPITokenManager().listTokens(req.user.sub);
  send(res, 200, JSON.stringify({ success: true, tokens }));
}

/** DELETE /api/auth/tokens/:id — revoke one of the authenticated user's own tokens (the WHERE
 *  clause is scoped to req.user.sub, so this can't be used to revoke someone else's token). */
async function handleRevokeApiToken(req, res, tokenId) {
  if (!requireAuth(req, res)) return;
  const revoked = getAPITokenManager().revokeToken(tokenId, req.user.sub);
  if (!revoked) return send(res, 404, JSON.stringify({ success: false, error: 'token not found' }));
  send(res, 200, JSON.stringify({ success: true }));
}

/** POST /api/auth/logout — JWTs are stateless and there is no revocation list, so there is
 *  nothing to invalidate server-side; the client is responsible for discarding the token. This
 *  route exists for API symmetry with /login, not because it does meaningful work. */
async function handleLogout(_req, res) {
  send(res, 200, JSON.stringify({ success: true }));
}

/** POST /api/auth/refresh — exchange a token for a fresh one (see auth/jwt.mjs's refreshToken —
 *  it still requires the incoming token to verify, it does not accept an already-expired one). */
async function handleRefreshJWT(req, res) {
  const { ok, body } = await parseJsonBody(req, res);
  if (!ok) return;
  const token = body.token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return send(res, 400, JSON.stringify({ success: false, error: 'token is required' }));
  const fresh = jwtRefreshToken(token);
  if (!fresh) return sendError(res, Errors.AUTH_TOKEN_INVALID);
  send(res, 200, JSON.stringify({ success: true, token: fresh }));
}

/** POST /api/auth/users — admin-only: provision a user account directly, bypassing the
 *  email-invitation flow (for platform admins bulk-creating accounts, or creating the first
 *  admin account itself via CLI/script rather than this HTTP route). */
async function handleCreateUser(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.user.role !== 'admin') return sendError(res, Errors.AUTH_FORBIDDEN);
  const { ok, body } = await parseJsonBody(req, res);
  if (!ok) return;
  const { email, password, full_name, role } = body;
  if (!email || !password) return send(res, 400, JSON.stringify({ success: false, error: 'email and password are required' }));
  try {
    const user = await getUserStore().createUser({ email, password, full_name, role });
    send(res, 201, JSON.stringify({ success: true, user: publicUser(user) }));
  } catch (err) {
    send(res, 400, JSON.stringify({ success: false, error: err.message }));
  }
}

/**
 * Project Templates API Handlers (Multi-Tenant Platform - US4)
 */

/**
 * GET /api/projects/templates - List available project templates
 */
async function handleListTemplates(req, res) {
  try {
    const templates = getTemplateLoader().list();
    send(res, 200, JSON.stringify({ success: true, templates }));
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/**
 * GET /api/projects/templates/{id} - Get a single template's contents
 */
async function handleGetTemplate(req, res, templateId) {
  try {
    const template = getTemplateLoader().load(templateId);
    send(res, 200, JSON.stringify({ success: true, id: templateId, template }));
  } catch (error) {
    sendError(res, Errors.TEMPLATE_NOT_FOUND, { id: templateId });
  }
}

/**
 * Project Management API Handlers (Multi-Tenant Platform - US1)
 */

/** Map a ProjectManager error message onto the structured error catalog (falls back to a plain 400). */
function sendProjectError(res, error, projectId) {
  const msg = error?.message || String(error);
  if (msg === 'Project not found') return sendError(res, Errors.PROJECT_NOT_FOUND, { id: projectId });
  if (msg === 'Project is already running') return sendError(res, Errors.PROJECT_ALREADY_RUNNING, { id: projectId });
  if (msg === 'Project is not running') return sendError(res, Errors.PROJECT_NOT_RUNNING, { id: projectId });
  if (msg.startsWith('Cannot delete running project')) return sendError(res, Errors.PROJECT_DELETE_RUNNING, { id: projectId });
  return send(res, 400, JSON.stringify({ success: false, error: msg }));
}

/**
 * GET /api/projects - List projects (optional ?status= filter)
 */
async function handleListProjects(req, res) {
  try {
    const reqUrl = new URL(req.url, 'http://localhost');
    const status = reqUrl.searchParams.get('status');
    const projects = getProjectManager().listProjects(status ? { status } : {});
    send(res, 200, JSON.stringify({ success: true, projects }));
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/**
 * POST /api/projects - Create a new project (optionally from a template)
 */
async function handleCreateProject(req, res) {
  try {
    const body = JSON.parse((await readBody(req)) || '{}');
    const { name, template } = body;
    if (!name || typeof name !== 'string') {
      return send(res, 400, JSON.stringify({ success: false, error: 'name is required' }));
    }
    const statePath = body.state_path || path.join(HERE, '..', '.ai', 'projects', name);
    const configPath = body.config_path || path.join(statePath, '.ai', 'policy.yaml');
    const project = getProjectManager().createProject({
      name,
      template,
      config_path: configPath,
      state_path: statePath,
      created_by: req.user?.sub ?? null,
    });
    send(res, 201, JSON.stringify({ success: true, project }));
  } catch (error) {
    sendProjectError(res, error);
  }
}

/**
 * GET /api/projects/{id} - Get a single project's details
 */
async function handleGetProject(req, res, projectId) {
  try {
    const project = getProjectManager().getProject(projectId);
    if (!project) return sendError(res, Errors.PROJECT_NOT_FOUND, { id: projectId });
    send(res, 200, JSON.stringify({ success: true, project }));
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/**
 * POST /api/projects/{id}/start - Start a project's process
 */
async function handleStartProject(req, res, projectId) {
  try {
    const project = await getProjectManager().startProject(projectId);
    send(res, 200, JSON.stringify({ success: true, project }));
  } catch (error) {
    sendProjectError(res, error, projectId);
  }
}

/**
 * POST /api/projects/{id}/stop - Stop a project's process
 */
async function handleStopProject(req, res, projectId) {
  try {
    const project = await getProjectManager().stopProject(projectId);
    send(res, 200, JSON.stringify({ success: true, project }));
  } catch (error) {
    sendProjectError(res, error, projectId);
  }
}

/**
 * POST /api/projects/{id}/restart - Restart a project's process
 */
async function handleRestartProject(req, res, projectId) {
  try {
    const project = await getProjectManager().restartProject(projectId);
    send(res, 200, JSON.stringify({ success: true, project }));
  } catch (error) {
    sendProjectError(res, error, projectId);
  }
}

/**
 * DELETE /api/projects/{id} - Delete a (stopped) project
 */
async function handleDeleteProject(req, res, projectId) {
  try {
    await getProjectManager().deleteProject(projectId);
    send(res, 200, JSON.stringify({ success: true, id: projectId }));
  } catch (error) {
    sendProjectError(res, error, projectId);
  }
}

/**
 * GET /api/projects/{id}/health - Get a project's live health status
 */
async function handleGetProjectHealth(req, res, projectId) {
  try {
    const health = await getProjectManager().getProjectHealth(projectId);
    send(res, 200, JSON.stringify({ success: true, ...health }));
  } catch (error) {
    sendProjectError(res, error, projectId);
  }
}

/**
 * Compliance Reporting API Handlers (Multi-Tenant Platform - US7)
 */

const REPORTS_DIR = path.join(HERE, '..', '.ai', 'reports');

/** Persist a generated report to REPORTS_DIR so it shows up in GET /api/compliance/reports. */
function saveComplianceReport(type, format, content) {
  if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
  const ext = format === 'csv' ? 'csv' : 'json';
  const filename = `${type}-${Date.now()}.${ext}`;
  writeFileSync(path.join(REPORTS_DIR, filename), content, 'utf8');
  return filename;
}

/** Shared body for the four POST /api/compliance/reports/{type} handlers. */
async function generateComplianceReport(req, res, type, ReportClass, extraOptions = () => ({})) {
  try {
    const body = JSON.parse((await readBody(req)) || '{}');
    const { format = 'json', startDate, endDate } = body;
    const report = new ReportClass();
    const data = report.generate({ startDate, endDate, ...extraOptions(body) });

    if (format === 'csv') {
      const csv = report.exportCSV(data);
      const filename = saveComplianceReport(type, 'csv', csv);
      res.writeHead(200, {
        'content-type': 'text/csv',
        'content-disposition': `attachment; filename="${filename}"`,
      });
      res.end(csv);
      return;
    }

    const filename = saveComplianceReport(type, 'json', JSON.stringify(data, null, 2));
    send(res, 200, JSON.stringify({ success: true, filename, report: data }));
  } catch (error) {
    sendError(res, Errors.REPORT_GENERATION_FAILED, {}, { detail: error.message });
  }
}

/** POST /api/compliance/reports/soc2 */
async function handleGenerateSOC2Report(req, res) {
  return generateComplianceReport(req, res, 'soc2', SOC2Report);
}

/** POST /api/compliance/reports/gdpr */
async function handleGenerateGDPRReport(req, res) {
  return generateComplianceReport(req, res, 'gdpr', GDPRReport);
}

/** POST /api/compliance/reports/cost-allocation */
async function handleGenerateCostAllocationReport(req, res) {
  return generateComplianceReport(req, res, 'cost-allocation', CostAllocationReport, (body) => ({ department: body.department }));
}

/** POST /api/compliance/reports/model-usage */
async function handleGenerateModelUsageReport(req, res) {
  return generateComplianceReport(req, res, 'model-usage', ModelUsageReport);
}

/** GET /api/compliance/reports - List previously generated report files */
async function handleListComplianceReports(req, res) {
  try {
    if (!existsSync(REPORTS_DIR)) {
      return send(res, 200, JSON.stringify({ success: true, reports: [] }));
    }
    const reports = readdirSync(REPORTS_DIR)
      .filter((f) => /\.(json|csv)$/.test(f))
      .map((f) => {
        const st = statSync(path.join(REPORTS_DIR, f));
        return { filename: f, size: st.size, created_at: st.mtime.toISOString() };
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    send(res, 200, JSON.stringify({ success: true, reports }));
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/**
 * Billing API Handlers (Multi-Tenant Platform - US5)
 */

// Lazy load licensing modules
let _licenseValidator = null;
let _licenseRefresh = null;
let _stripeWebhook = null;

// Top-level functions, outside createDashboardServer(config)'s closure, so — like
// getTaskCommentManager() above — they use the module-level _dashboardConfig capture instead of
// a bare `config` that was never in scope here (a ReferenceError on every call). These also need
// `await import(...)`: a bare `import(...)` returns a Promise, and destructuring a named export
// off an un-awaited Promise silently yields `undefined`, which `new undefined(db)` would then
// throw on right after.
async function getLicenseValidator() {
  if (!_licenseValidator) {
    const { LicenseValidator } = await import('../licensing/license-validate.mjs');
    const db = openDb(undefined, _dashboardConfig);
    _licenseValidator = new LicenseValidator(db);
  }
  return _licenseValidator;
}

async function getLicenseRefresh() {
  if (!_licenseRefresh) {
    const { LicenseRefresh } = await import('../licensing/license-refresh.mjs');
    const db = openDb(undefined, _dashboardConfig);
    _licenseRefresh = new LicenseRefresh(db);
  }
  return _licenseRefresh;
}

async function getStripeWebhook() {
  if (!_stripeWebhook) {
    const { StripeWebhook } = await import('../licensing/stripe-webhook.mjs');
    const db = openDb(undefined, _dashboardConfig);
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
    const validator = await getLicenseValidator();
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

    const validator = await getLicenseValidator();
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
    const refresh = await getLicenseRefresh();
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
    const validator = await getLicenseValidator();
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
    const validator = await getLicenseValidator();
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

    const webhook = await getStripeWebhook();

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

    const validator = await getLicenseValidator();
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
    const validator = await getLicenseValidator();
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
 *
 * getActivityLogger/getReviewerAssigner are imported directly from their real modules at the top
 * of this file now (control-plane.mjs's ProjectManager already established that pattern) — the
 * versions that used to live here were unrelated local functions with the SAME names that shadowed
 * the real singletons, each individually broken: unawaited `import()` (destructuring a pending
 * Promise, not the module), a `config` reference with nothing in scope binding it at module level,
 * and constructor arguments that didn't match any real class's signature (a raw db instance where
 * InvitationManager needs a UserStore, where ActivityLogger needs a path string, etc.).
 */

function getInvitationManager() {
  return new InvitationManager(getUserStore());
}

/** TaskComment operates on a "project database" — in this repo's actual single-project-per-daemon
 *  deployment model (no separate per-project db surfaced anywhere else in this file), the state db
 *  IS that database: it already holds `tasks`, so task_comments belongs alongside it. Uses the
 *  module-level _dashboardConfig capture (see its own doc comment) since this function sits
 *  outside createDashboardServer(config)'s closure. */
function getTaskCommentManager() {
  return new TaskComment(openDb(undefined, _dashboardConfig));
}

/**
 * POST /api/auth/invitations - Create a team invitation for a project. Body: {email, project_id,
 * role}. Requires admin/operator membership on THAT project (or site-admin) — this route isn't
 * itself project-scoped in the URL (unlike /api/projects/:id/members), so project_id comes from
 * the body and the RBAC check has to happen after parsing it, not before.
 */
async function handleCreateInvitation(req, res) {
  try {
    const { ok, body } = await parseJsonBody(req, res);
    if (!ok) return;
    const { email, project_id, role = 'viewer' } = body;

    if (!email) return send(res, 400, JSON.stringify({ success: false, error: 'email is required' }));
    if (!project_id) return send(res, 400, JSON.stringify({ success: false, error: 'project_id is required' }));
    if (!requireProjectRole(req, res, project_id, ['admin', 'operator'])) return;

    const invitationManager = getInvitationManager();
    let invitation;
    try {
      invitation = invitationManager.create(email, project_id, role);
    } catch (err) {
      return send(res, 400, JSON.stringify({ success: false, error: err.message }));
    }

    getActivityLogger().log({
      user_id: req.user.sub,
      project_id,
      action: 'invitation_created',
      details: { email: invitation.email, role: invitation.role },
    });

    send(res, 201, JSON.stringify({ success: true, invitation }));
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/** GET /api/auth/invitations?project_id=X - List a project's invitations. Requires admin/operator
 *  membership on that project (or site-admin). */
async function handleListInvitations(req, res) {
  try {
    const projectId = new URL(req.url, 'http://localhost').searchParams.get('project_id');
    if (!projectId) return send(res, 400, JSON.stringify({ success: false, error: 'project_id query param is required' }));
    if (!requireProjectRole(req, res, projectId, ['admin', 'operator'])) return;

    const invitations = getInvitationManager().listProjectInvitations(projectId);
    send(res, 200, JSON.stringify({ success: true, invitations }));
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/**
 * POST /api/auth/invitations/:token/accept - Accept an invitation. Deliberately UNAUTHENTICATED
 * (no requireAuth): the whole point is that the invitee has no account yet — InvitationManager
 * .accept(token, password) CREATES the user. The previous version of this handler required a
 * bearer token and passed (invitationId, req.user.sub) to accept() — a chicken-and-egg
 * requirement (you'd need to already be logged in to accept the invitation that creates your
 * login), and the real accept() signature is (token, password), not (id, userId) anyway.
 */
async function handleAcceptInvitation(req, res) {
  try {
    const token = req.url.split('/')[4]?.split('?')[0];
    const { ok, body } = await parseJsonBody(req, res);
    if (!ok) return;
    if (!body.password) return send(res, 400, JSON.stringify({ success: false, error: 'password is required' }));

    const result = await getInvitationManager().accept(token, body.password);
    if (!result.success) return send(res, 400, JSON.stringify(result));

    getActivityLogger().log({
      user_id: result.user.id,
      project_id: result.project_id,
      action: 'invitation_accepted',
      details: { email: result.user.email, role: result.role },
    });

    send(res, 200, JSON.stringify(result));
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/**
 * POST /api/auth/invitations/:token/reject - Revoke a pending invitation (route name kept as
 * "reject" to match the pre-existing URL other clients may already reference; the underlying
 * operation is InvitationManager.revoke() — there is no "reject" concept in the real
 * implementation, just pending/accepted/revoked). This is an ADMIN action (cancel an invite you
 * sent), not something the invitee does — they have no account to authenticate with (see
 * handleAcceptInvitation) — so RBAC is checked against the invitation's OWN project_id, looked up
 * before the invitation can be revoked.
 */
async function handleRejectInvitation(req, res) {
  try {
    const token = req.url.split('/')[4]?.split('?')[0];
    const invitation = getUserStore().db.prepare('SELECT project_id FROM invitations WHERE token = ?').get(token);
    if (!invitation) return send(res, 404, JSON.stringify({ success: false, error: 'invitation not found' }));
    if (!requireProjectRole(req, res, invitation.project_id, ['admin', 'operator'])) return;

    const revoked = getInvitationManager().revoke(token);
    if (!revoked) return send(res, 400, JSON.stringify({ success: false, error: 'invitation already processed or not found' }));

    getActivityLogger().log({
      user_id: req.user.sub,
      project_id: invitation.project_id,
      action: 'invitation_revoked',
      details: { token },
    });

    send(res, 200, JSON.stringify({ success: true }));
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/**
 * GET /api/activity/feed?project_id=X - Activity feed. With project_id, requires membership on
 * that project (viewer+); without one, this is the GLOBAL feed across every project, site-admin
 * only (it would otherwise leak other projects' activity to anyone logged in).
 *
 * ActivityLogger.getProjectFeed()/getGlobalFeed() are synchronous (better-sqlite3), not async —
 * `await`ing a non-Promise is harmless but the `await` in the old version was misleading about
 * what the underlying call actually does. Neither method supports `offset` at all (confirmed
 * against compliance/audit-log.mjs directly) — the old handler read one from the query string and
 * silently discarded it; not present in this version so the API doesn't imply support that isn't
 * there.
 */
async function handleGetActivityFeed(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const projectId = url.searchParams.get('project_id');
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);

    if (projectId) {
      if (!requireProjectRole(req, res, projectId, ['admin', 'operator', 'viewer'])) return;
      return send(res, 200, JSON.stringify({ success: true, feed: getActivityLogger().getProjectFeed(projectId, { limit }) }));
    }
    if (!requireAuth(req, res)) return;
    if (req.user.role !== 'admin') return sendError(res, Errors.AUTH_FORBIDDEN);
    send(res, 200, JSON.stringify({ success: true, feed: getActivityLogger().getGlobalFeed({ limit }) }));
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/** GET /api/activity/stats?project_id=X - Same scoping rule as handleGetActivityFeed above. */
async function handleGetActivityStats(req, res) {
  try {
    const projectId = new URL(req.url, 'http://localhost').searchParams.get('project_id');

    if (projectId) {
      if (!requireProjectRole(req, res, projectId, ['admin', 'operator', 'viewer'])) return;
    } else {
      if (!requireAuth(req, res)) return;
      if (req.user.role !== 'admin') return sendError(res, Errors.AUTH_FORBIDDEN);
    }

    const stats = getActivityLogger().getStats(projectId ? { projectId } : {});
    send(res, 200, JSON.stringify({ success: true, stats }));
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/**
 * POST /api/tasks/:id/comments or /api/projects/:id/tasks/:task_id/comments - Add a comment.
 * Shared by both routes (matching the pre-existing route table) — {taskId, projectId} is now
 * passed explicitly by whichever route matched instead of the handler guessing from `req.pathname`
 * (which doesn't exist on a raw http.IncomingMessage — the OLD single-arg version always read
 * `req.pathname.split('/')[2]`, correct for neither URL shape, since "comments" sits at a
 * different path depth in each). project_id, if given, gates on project membership; the
 * non-project-scoped route just requires being logged in (see class doc comment on
 * getTaskCommentManager() for why: task_comments lives in the shared state db in this repo's
 * actual deployment model, not a separate per-project db).
 *
 * TaskComment.create(taskId, userId, content) returns the comment object directly — no
 * {success} wrapper — so a validation failure is a thrown Error, not a `{success:false}` result
 * (the OLD version checked `result.success`, which was always undefined either way).
 */
/** TaskComment rows only carry `user_id` (project/task-comments.mjs has no join to `users`,
 *  since it operates on a per-project db that doesn't necessarily contain the shared `users`
 *  table). The dashboard UI needs a display name, so resolve it here against the control-plane
 *  UserStore instead. */
function enrichCommentWithUserName(comment) {
  if (!comment) return comment;
  const user = getUserStore().getUserById(comment.user_id);
  return { ...comment, user_name: user ? (user.full_name || user.email) : 'Unknown' };
}

async function handleAddTaskComment(req, res, { taskId, projectId }) {
  try {
    if (projectId) {
      if (!requireProjectRole(req, res, projectId, ['admin', 'operator', 'viewer'])) return;
    } else {
      if (!requireAuth(req, res)) return;
    }

    const { ok, body } = await parseJsonBody(req, res);
    if (!ok) return;
    if (!body.content) return send(res, 400, JSON.stringify({ success: false, error: 'content is required' }));

    let comment;
    try {
      comment = getTaskCommentManager().create(taskId, req.user.sub, body.content);
    } catch (err) {
      return send(res, 400, JSON.stringify({ success: false, error: err.message }));
    }

    getActivityLogger().log({
      user_id: req.user.sub, project_id: projectId ?? null, action: 'task_commented',
      details: { task_id: taskId, comment_id: comment.id },
    });

    send(res, 201, JSON.stringify({ success: true, comment: enrichCommentWithUserName(comment) }));
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/** GET /api/tasks/:id/comments - list a task's comments. */
async function handleGetTaskComments(req, res, { taskId }) {
  try {
    if (!requireAuth(req, res)) return;
    const comments = getTaskCommentManager().list(taskId).map(enrichCommentWithUserName);
    send(res, 200, JSON.stringify({ success: true, comments }));
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/**
 * PUT /api/tasks/:id/comments/:commentId - Edit a comment. TaskComment.update(commentId, content)
 * only matches `WHERE id=? AND user_id=this.currentUserId` — setCurrentUser() must be called
 * first (the OLD version never did, so the WHERE clause compared against `undefined` and matched
 * zero rows, always returning null regardless of who called it or which comment they targeted).
 * A user may only edit their OWN comment — there is no admin-override path in TaskComment as it
 * exists today.
 */
async function handleUpdateTaskComment(req, res, { taskId, commentId }) {
  try {
    if (!requireAuth(req, res)) return;
    const { ok, body } = await parseJsonBody(req, res);
    if (!ok) return;
    if (!body.content) return send(res, 400, JSON.stringify({ success: false, error: 'content is required' }));

    const manager = getTaskCommentManager();
    manager.setCurrentUser(req.user.sub);
    const comment = manager.update(commentId, body.content);
    if (!comment) return send(res, 404, JSON.stringify({ success: false, error: 'comment not found, or you do not own it' }));

    getActivityLogger().log({ user_id: req.user.sub, action: 'task_comment_updated', details: { task_id: taskId, comment_id: commentId } });
    send(res, 200, JSON.stringify({ success: true, comment }));
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/** DELETE /api/tasks/:id/comments/:commentId - delete YOUR OWN comment (TaskComment.delete()
 *  requires the deleter's userId to match, same one-comment-owner-only limitation as update()
 *  above — no admin-override in the underlying class). */
async function handleDeleteTaskComment(req, res, { taskId, commentId }) {
  try {
    if (!requireAuth(req, res)) return;

    const deleted = getTaskCommentManager().delete(commentId, req.user.sub);
    if (!deleted) return send(res, 404, JSON.stringify({ success: false, error: 'comment not found, or you do not own it' }));

    getActivityLogger().log({ user_id: req.user.sub, action: 'task_comment_deleted', details: { task_id: taskId, comment_id: commentId } });
    send(res, 200, JSON.stringify({ success: true }));
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/**
 * POST /api/reviews/assign - Assign reviewers to a PR (round-robin from the project's roster).
 * Body: {project_id, pr_url, reviewer_count}. getReviewerAssigner() is now the real class
 * (control-plane.mjs's ReviewerAssigner — see its own file, it did not exist anywhere in the
 * codebase before this feature); the old req.user.sub-as-projectId bug meant every assignment was
 * scoped to a "project" that was actually a user id, matching nothing in `project_users`.
 */
async function handleAssignReviewers(req, res) {
  try {
    const { ok, body } = await parseJsonBody(req, res);
    if (!ok) return;
    const { project_id, pr_url, reviewer_count = 2 } = body;

    if (!project_id) return send(res, 400, JSON.stringify({ success: false, error: 'project_id is required' }));
    if (!pr_url) return send(res, 400, JSON.stringify({ success: false, error: 'pr_url is required' }));
    if (!requireProjectRole(req, res, project_id, ['admin', 'operator'])) return;

    const result = await getReviewerAssigner().assign(project_id, pr_url, reviewer_count);

    if (result.success) {
      getActivityLogger().log({
        user_id: req.user.sub,
        project_id,
        action: 'reviewers_assigned',
        details: { pr_url: result.pr_url, reviewers: result.reviewers.map(r => r.username), reviewer_count: result.reviewer_count },
      });
      send(res, 201, JSON.stringify(result));
    } else {
      send(res, 400, JSON.stringify(result));
    }
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/** GET /api/reviews/assignments?project_id=X - Recent review assignments for a project. */
async function handleGetReviewAssignments(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const projectId = url.searchParams.get('project_id');
    if (!projectId) return send(res, 400, JSON.stringify({ success: false, error: 'project_id query param is required' }));
    if (!requireProjectRole(req, res, projectId, ['admin', 'operator', 'viewer'])) return;

    const limit = parseInt(url.searchParams.get('limit') || '10', 10);
    const assignments = getReviewerAssigner().getRecentAssignments(projectId, limit);

    send(res, 200, JSON.stringify({ success: true, assignments }));
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/** Path segments for /api/projects/:id/... routes — `req.pathname` never existed on the raw
 *  http.IncomingMessage (the URL is parsed into a local `url` variable by the router, never
 *  attached back onto `req`); every handler below used to read it anyway, throwing before doing
 *  anything else. */
function projectRoutePathParts(req) {
  return new URL(req.url, 'http://localhost').pathname.split('/');
}

/** GET /api/projects/{id}/members - List project members. Any member (viewer+) can see the
 *  roster — this is read-only team visibility, not a management action. */
async function handleListProjectMembers(req, res) {
  try {
    const projectId = projectRoutePathParts(req)[3];
    if (!requireProjectRole(req, res, projectId, ['admin', 'operator', 'viewer'])) return;

    const members = getUserStore().db.prepare(`
      SELECT u.id, u.email, u.full_name, u.role, u.github_username, pu.role AS project_role, pu.created_at
      FROM users u
      INNER JOIN project_users pu ON u.id = pu.user_id
      WHERE pu.project_id = ?
    `).all(projectId);

    send(res, 200, JSON.stringify({
      success: true,
      project_id: projectId,
      members: members.map(m => ({
        id: m.id, email: m.email, full_name: m.full_name, github_username: m.github_username,
        role: m.project_role, joined_at: m.created_at,
      })),
    }));
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/** POST /api/projects/{id}/members - Add an existing user directly, or invite one who doesn't
 *  have an account yet. Admin/operator only. */
async function handleAddProjectMember(req, res) {
  try {
    const projectId = projectRoutePathParts(req)[3];
    if (!requireProjectRole(req, res, projectId, ['admin', 'operator'])) return;

    const { ok, body } = await parseJsonBody(req, res);
    if (!ok) return;
    const { email, role = 'viewer' } = body;
    if (!email) return send(res, 400, JSON.stringify({ success: false, error: 'email is required' }));

    const userStore = getUserStore();
    const existingUser = userStore.getUserByEmail(email);

    if (existingUser) {
      userStore.db.prepare(`
        INSERT OR IGNORE INTO project_users (id, project_id, user_id, role, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(crypto.randomUUID(), projectId, existingUser.id, role, Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000));

      getActivityLogger().log({ user_id: req.user.sub, project_id: projectId, action: 'member_added', details: { email, role } });
      send(res, 200, JSON.stringify({ success: true, message: 'User added to project', user: { id: existingUser.id, email: existingUser.email, role } }));
    } else {
      let invitation;
      try {
        invitation = getInvitationManager().create(email, projectId, role);
      } catch (err) {
        return send(res, 400, JSON.stringify({ success: false, error: err.message }));
      }
      getActivityLogger().log({ user_id: req.user.sub, project_id: projectId, action: 'invitation_created', details: { email, role } });
      send(res, 201, JSON.stringify({
        success: true, message: 'Invitation sent to user',
        invitation: { id: invitation.id, email: invitation.email, role: invitation.role, expires_at: invitation.expires_at },
      }));
    }
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/** PUT /api/projects/{id}/members/{user_id} - Update a member's project role. Admin only — role
 *  changes are more sensitive than adding a viewer, unlike handleAddProjectMember. */
async function handleUpdateProjectMember(req, res) {
  try {
    const parts = projectRoutePathParts(req);
    const projectId = parts[3];
    const userId = parts[5];
    if (!requireProjectRole(req, res, projectId, ['admin'])) return;

    const { ok, body } = await parseJsonBody(req, res);
    if (!ok) return;
    const { role } = body;
    if (!role) return send(res, 400, JSON.stringify({ success: false, error: 'role is required' }));
    const validRoles = ['admin', 'operator', 'viewer'];
    if (!validRoles.includes(role)) {
      return send(res, 400, JSON.stringify({ success: false, error: `Invalid role: ${role}. Must be one of: ${validRoles.join(', ')}` }));
    }

    const result = getUserStore().db.prepare(
      'UPDATE project_users SET role = ?, updated_at = ? WHERE project_id = ? AND user_id = ?',
    ).run(role, Math.floor(Date.now() / 1000), projectId, userId);

    if (result.changes === 0) return sendError(res, Errors.MEMBER_NOT_FOUND, { userId, id: projectId });

    getActivityLogger().log({ user_id: req.user.sub, project_id: projectId, action: 'member_role_updated', details: { target_user_id: userId, role } });
    send(res, 200, JSON.stringify({ success: true, message: 'Member role updated', user_id: userId, role }));
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/** DELETE /api/projects/{id}/members/{user_id} - Remove a member from a project. Admin only. */
async function handleRemoveProjectMember(req, res) {
  try {
    const parts = projectRoutePathParts(req);
    const projectId = parts[3];
    const userId = parts[5];
    if (!requireProjectRole(req, res, projectId, ['admin'])) return;

    const result = getUserStore().db.prepare(
      'DELETE FROM project_users WHERE project_id = ? AND user_id = ?',
    ).run(projectId, userId);

    if (result.changes === 0) return sendError(res, Errors.MEMBER_NOT_FOUND, { userId, id: projectId });

    getActivityLogger().log({ user_id: req.user.sub, project_id: projectId, action: 'member_removed', details: { target_user_id: userId } });
    send(res, 200, JSON.stringify({ success: true, message: 'Member removed from project', user_id: userId }));
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/** GET /api/projects/{id}/activity - Project activity feed. Any member (viewer+) can see it. */
async function handleGetProjectActivity(req, res) {
  try {
    const projectId = projectRoutePathParts(req)[3];
    if (!requireProjectRole(req, res, projectId, ['admin', 'operator', 'viewer'])) return;

    const limit = parseInt(new URL(req.url, 'http://localhost').searchParams.get('limit') || '50', 10);
    const feed = getActivityLogger().getProjectFeed(projectId, { limit });

    send(res, 200, JSON.stringify({ success: true, project_id: projectId, feed }));
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/** GET /api/projects/{id}/tasks/{task_id}/comments - list a task's comments, project-scoped
 *  (any member, viewer+). */
async function handleGetProjectTaskComments(req, res) {
  try {
    const parts = projectRoutePathParts(req);
    const projectId = parts[3];
    const taskId = parts[5];
    if (!requireProjectRole(req, res, projectId, ['admin', 'operator', 'viewer'])) return;

    const comments = getTaskCommentManager().list(taskId).map(enrichCommentWithUserName);
    send(res, 200, JSON.stringify({ success: true, project_id: projectId, task_id: taskId, comments }));
  } catch (error) {
    send(res, 500, JSON.stringify({ success: false, error: error.message }));
  }
}

/** GET /api/reviews/stats?project_id=X - Review assignment stats for a project. */
async function handleGetReviewStats(req, res) {
  try {
    const projectId = new URL(req.url, 'http://localhost').searchParams.get('project_id');
    if (!projectId) return send(res, 400, JSON.stringify({ success: false, error: 'project_id query param is required' }));
    if (!requireProjectRole(req, res, projectId, ['admin', 'operator', 'viewer'])) return;

    const stats = getReviewerAssigner().getAssignmentStats(projectId);
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
