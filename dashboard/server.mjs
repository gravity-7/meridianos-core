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
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
import { readRuns } from '../runlog.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX = join(HERE, 'index.html');
const ALLOWED = new Set(LEVER_PATHS);
const ACTION_PATHS = new Set(['/api/run', '/api/task', '/api/verify', '/api/escalation']);
const STATUS_TTL_MS = 2000; // dedupe bursty polls; buildStatus rescans transcripts, so don't do it per-request

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
      return send(res, 404, JSON.stringify({ ok: false, error: 'not found' }));
    } catch (e) {
      return send(res, 400, JSON.stringify({ ok: false, error: String((e && e.message) || e) }));
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.AIOS_DASHBOARD_PORT) || 4317;
  // Diagnostic-only default plugin — see budget.mjs's identical comment.
  const DIAG_DOMAIN = { agents: ['a', 'b'], prompts: { implRules: [], reviewCriteria: [] }, guardrailCheck: null, boardTitle: 'AIOS', riskToAction: {}, knownRiskTags: [] };
  const { config } = createAios({ domain: DIAG_DOMAIN });
  createDashboardServer(config).listen(port, '127.0.0.1', () => {
    console.log(`AIOS dashboard → http://localhost:${port}`);
  });
}
