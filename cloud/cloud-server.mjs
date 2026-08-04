/**
 * cloud-server — local-dev/test HTTP wrapper around cloud-control-plane.mjs's pure functions.
 * A production deployment (Cloudflare Workers) would wrap the SAME functions in a `fetch` handler
 * instead of node:http — this file exists so the control plane is runnable and testable without
 * any Cloudflare account (per the spec's "cloud hosting/infra setup is deployment, not feature
 * development" — this is the feature; deploying it to Workers is a separate, later step).
 */
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  migrateCloudDb, createOrganization, createUser, authenticateUser,
  registerMachine, listMachines, reportMetadata, pushPolicy, aggregateProviderHealth, pruneOldMetadata,
} from './cloud-control-plane.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_DIR = join(HERE, 'dashboard');

/** Open (and migrate) the cloud control plane's local SQLite file — ':memory:' for tests. */
export function openCloudDb(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  migrateCloudDb(db);
  return db;
}

// Security hardening (code-review follow-up): no wildcard CORS here — unlike api/v1 (a public
// API meant for third-party callers), this is an admin-only cloud control plane whose own
// dashboard already talks to it same-origin, so there's no legitimate cross-origin caller to
// support. Baseline hardening headers still apply to every response.
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};
const JSON_CSP = "default-src 'none'";
const HTML_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'";
const MAX_BODY_ERROR = /body too large/i;

function send(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', 'content-security-policy': JSON_CSP, ...SECURITY_HEADERS });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 5e6) reject(new Error('body too large')); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/** Very small session scheme for this local-dev server: a bearer token that's just the user id,
 *  looked up fresh on every request. Not meant to be the production auth story (a real Workers
 *  deployment would use signed JWTs/D1-backed sessions) — the point of THIS file is to exercise
 *  cloud-control-plane.mjs's logic end-to-end locally, not to design production session security. */
function sessionUser(db, req) {
  const auth = req.headers.authorization;
  const m = auth && auth.match(/^Bearer\s+(user-.+)$/);
  if (!m) return null;
  const row = db.prepare('SELECT * FROM cloud_users WHERE id = ?').get(m[1]);
  if (!row) return null;
  // Normalize to the SAME camelCase shape authenticateUser() returns — every route below reads
  // `user.orgId`, not the raw column name `org_id`.
  return { id: row.id, orgId: row.org_id, email: row.email, role: row.role };
}

/** `logger` (T097) — a daemon-logger instance (see daemon-logger.mjs); optional since this is
 *  also constructed by hermetic unit tests that don't care about file-based ops logs. */
export function createCloudServer(db, { logger } = {}) {
  const log = logger ?? { log() {}, error() {} };
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');

      if (req.method === 'GET' && url.pathname === '/healthz') return send(res, 200, { ok: true });

      // T088 — serve the cloud dashboard's own static UI (cloud/dashboard/).
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/app.js')) {
        const file = join(DASHBOARD_DIR, url.pathname === '/' ? 'index.html' : 'app.js');
        if (existsSync(file)) {
          const isHtml = url.pathname === '/';
          res.writeHead(200, {
            'content-type': isHtml ? 'text/html; charset=utf-8' : 'application/javascript',
            ...(isHtml ? { 'content-security-policy': HTML_CSP } : {}),
            ...SECURITY_HEADERS,
          });
          return res.end(readFileSync(file, 'utf8'));
        }
      }

      if (req.method === 'POST' && url.pathname === '/api/cloud/organizations') {
        const { name } = JSON.parse((await readBody(req)) || '{}');
        return send(res, 201, createOrganization(db, name));
      }

      if (req.method === 'POST' && url.pathname === '/api/cloud/auth/register') {
        const { orgId, email, password, role } = JSON.parse((await readBody(req)) || '{}');
        const user = await createUser(db, { orgId, email, password, role });
        return send(res, 201, user);
      }

      if (req.method === 'POST' && url.pathname === '/api/cloud/auth/login') {
        const { email, password } = JSON.parse((await readBody(req)) || '{}');
        const user = await authenticateUser(db, { email, password });
        if (!user) return send(res, 401, { error: 'Unauthorized', message: 'Invalid email or password' });
        return send(res, 200, { ...user, token: `user-${user.id.replace(/^user-/, '')}` });
      }

      const user = sessionUser(db, req);

      if (req.method === 'POST' && url.pathname === '/api/cloud/machines') {
        if (!user) return send(res, 401, { error: 'Unauthorized' });
        const body = JSON.parse((await readBody(req)) || '{}');
        return send(res, 201, registerMachine(db, { orgId: user.orgId, ...body }));
      }

      if (req.method === 'GET' && url.pathname === '/api/cloud/machines') {
        if (!user) return send(res, 401, { error: 'Unauthorized' });
        return send(res, 200, { machines: listMachines(db, user.orgId) });
      }

      if (req.method === 'POST' && url.pathname === '/api/cloud/report') {
        const apiKey = String(req.headers['x-machine-key'] || '');
        const report = JSON.parse((await readBody(req)) || '{}');
        const result = reportMetadata(db, apiKey, report);
        return send(res, result.ok ? 200 : 401, result);
      }

      if (req.method === 'POST' && url.pathname === '/api/cloud/policy') {
        if (!user) return send(res, 401, { error: 'Unauthorized' });
        const { updates } = JSON.parse((await readBody(req)) || '{}');
        return send(res, 200, { pushed: pushPolicy(db, user.orgId, updates, { actor: user.email }) });
      }

      if (req.method === 'GET' && url.pathname === '/api/cloud/health') {
        if (!user) return send(res, 401, { error: 'Unauthorized' });
        return send(res, 200, aggregateProviderHealth(db, user.orgId));
      }

      if (req.method === 'POST' && url.pathname === '/api/cloud/retention/run') {
        // Manual trigger — production runs this on a Cron Trigger instead (T089).
        const deleted = pruneOldMetadata(db);
        log.log('cloud-server', `retention run: deleted ${deleted} metadata row(s)`);
        return send(res, 200, { deleted });
      }

      send(res, 404, { error: 'Not Found' });
    } catch (err) {
      if (MAX_BODY_ERROR.test(err.message)) {
        send(res, 413, { error: 'Payload Too Large', message: 'Request body exceeds the size limit' });
        return;
      }
      log.error('cloud-server', `${req.method} ${req.url} failed`, err);
      send(res, 500, { error: 'Internal Server Error', message: err.message });
    }
  });
}
