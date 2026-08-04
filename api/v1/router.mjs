/**
 * api/v1/router — the public REST API's single entry point (T042-T056). dashboard/server.mjs
 * delegates every `/api/v1/*` request here with ONE line, keeping the new REST surface fully
 * isolated from the existing (very large) dashboard request handler.
 *
 * Responsibilities:
 *   - Serve the OpenAPI spec + Swagger UI unauthenticated (T048/T049)
 *   - API key management, gated by the SAME per-boot dashboard token as other mutations —
 *     minting a Bearer credential is a dashboard-administration action, not something a caller
 *     without any credential yet should be able to do over the network
 *   - Bearer `mk-{key}` authentication + scope enforcement for every resource route (T051)
 *   - Per-API-key sliding-window rate limiting (T050)
 *   - Uniform error envelope for 401/403/429/404/500 (T055)
 *   - Dispatch to api/v1/{tasks,costs,providers,models,config,webhooks}.mjs (T042-T047)
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateApiKey, validateApiKey, hasScope, listApiKeys, revokeApiKey, rotateApiKey } from '../../auth/api-tokens.mjs';
import { createRateLimiter, rateLimitHeaders } from '../rate-limiter.mjs';
import * as tasksRoutes from './tasks.mjs';
import * as costsRoutes from './costs.mjs';
import * as providersRoutes from './providers.mjs';
import * as modelsRoutes from './models.mjs';
import * as configRoutes from './config.mjs';
import * as webhooksRoutes from './webhooks.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESOURCE_MODULES = [tasksRoutes, costsRoutes, providersRoutes, modelsRoutes, configRoutes, webhooksRoutes];

// Module-scope: one rate-limiter instance shared across every request this daemon process
// handles (matches research.md decision #6 — 100 req/min per API key, in-memory sliding window).
const limiter = createRateLimiter();

const BEARER_RE = /^Bearer\s+(mk-[a-zA-Z0-9]{32})$/;

// Code-review follow-up (security hardening pass):
//   - CORS: this API is meant for third-party integrations (US3) calling from a browser-based
//     tool, so it allows any origin. That's safe here because auth is a Bearer token a page can
//     only send if it already KNOWS the key (unlike a cookie, nothing about CORS lets a hostile
//     page exfiltrate or replay a credential it doesn't already have) — CORS controls which
//     origins can READ the response, not which can guess the secret.
//   - Every response (including errors) carries baseline hardening headers. JSON responses get a
//     locked-down CSP (`default-src 'none'`) since nothing here is ever rendered as a page; the
//     one HTML response (Swagger UI) gets a separate, slightly relaxed policy that allows loading
//     its own CDN bundle.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};
const JSON_SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'",
  ...CORS_HEADERS,
};
const HTML_SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' https://unpkg.com; style-src 'self' https://unpkg.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
  ...CORS_HEADERS,
};

const MAX_BODY_ERROR = /body too large/i;

// Returns `true` (not void) — every api/v1/*.mjs resource module does `return json(code, body)`
// from its handle(ctx), and router.mjs's dispatch loop treats that return value as "did this
// module handle the request?". A void return would read as falsy, fall through to the NEXT
// module, and eventually hit the 404 fallback — a second res.writeHead() on an already-answered
// response (ERR_HTTP_HEADERS_SENT).
function jsonResponse(res, code, body, extraHeaders = {}) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', ...JSON_SECURITY_HEADERS, ...extraHeaders });
  res.end(JSON.stringify(body));
  return true;
}

function swaggerHtml() {
  return `<!DOCTYPE html>
<html>
<head>
  <title>MeridianOS API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = () => SwaggerUIBundle({ url: '/api/v1/openapi.yaml', dom_id: '#swagger-ui' });
  </script>
</body>
</html>`;
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {URL} url
 * @param {{config: object, db: import('node:sqlite').DatabaseSync, readBody: Function, authorized: Function, logger?: object}} deps
 * @returns {Promise<boolean>} true if this request was handled (a response was sent)
 */
export async function handleApiV1(req, res, url, { config, db, readBody, authorized, logger }) {
  if (!url.pathname.startsWith('/api/v1/')) return false;
  const log = logger ?? { log() {}, error() {} };

  // CORS preflight — answered before auth/rate-limiting (a preflight never carries the real
  // Authorization header, so there's nothing to check yet; the browser makes the REAL request,
  // WITH credentials, only after this succeeds).
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return true;
  }

  // ── Unauthenticated docs ────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/v1/openapi.yaml') {
    res.writeHead(200, { 'content-type': 'application/yaml', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...CORS_HEADERS });
    res.end(readFileSync(join(HERE, 'openapi.yaml'), 'utf8'));
    return true;
  }
  if (req.method === 'GET' && url.pathname === '/api/v1/docs') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...HTML_SECURITY_HEADERS });
    res.end(swaggerHtml());
    return true;
  }

  // ── API key management — dashboard-token gated, not Bearer-gated (bootstrapping) ───────────
  const keyMgmt = url.pathname.match(/^\/api\/v1\/api-keys(?:\/([^/]+))?(?:\/(rotate))?$/);
  if (keyMgmt) {
    if (!authorized(req)) {
      jsonResponse(res, 403, { error: 'Forbidden', message: 'Managing API keys requires the dashboard token' });
      return true;
    }
    try {
      if (req.method === 'POST' && !keyMgmt[1]) {
        const body = JSON.parse((await readBody(req)) || '{}');
        const key = generateApiKey(db, body);
        log.log('api-v1', `API key created: ${key.name} (${key.id})`);
        jsonResponse(res, 201, key);
        return true;
      }
      if (req.method === 'GET' && !keyMgmt[1]) {
        jsonResponse(res, 200, { api_keys: listApiKeys(db) });
        return true;
      }
      if (req.method === 'DELETE' && keyMgmt[1] && !keyMgmt[2]) {
        revokeApiKey(db, keyMgmt[1]);
        log.log('api-v1', `API key revoked: ${keyMgmt[1]}`);
        res.writeHead(204, CORS_HEADERS).end();
        return true;
      }
      // Key rotation (security hardening): mint a replacement key with the same name/scopes and
      // revoke the old one atomically — for a leaked/suspect key without losing the caller's
      // scope configuration.
      if (req.method === 'POST' && keyMgmt[1] && keyMgmt[2] === 'rotate') {
        const rotated = rotateApiKey(db, keyMgmt[1]);
        log.log('api-v1', `API key rotated: ${keyMgmt[1]} -> ${rotated.id}`);
        jsonResponse(res, 201, rotated);
        return true;
      }
    } catch (err) {
      if (MAX_BODY_ERROR.test(err.message)) {
        jsonResponse(res, 413, { error: 'Payload Too Large', message: 'Request body exceeds the size limit' });
        return true;
      }
      log.error('api-v1', 'API key management request failed', err);
      const notFound = /not found|already revoked/i.test(err.message);
      jsonResponse(res, notFound ? 404 : 400, { error: notFound ? 'Not Found' : 'Bad Request', message: err.message });
      return true;
    }
  }

  // ── Everything else requires Authorization: Bearer mk-{key} ────────────────────────────────
  const match = String(req.headers.authorization || '').match(BEARER_RE);
  if (!match) {
    jsonResponse(res, 401, { error: 'Unauthorized', message: 'Invalid or missing API key' });
    return true;
  }

  const apiKey = validateApiKey(db, match[1]);
  if (!apiKey) {
    jsonResponse(res, 401, { error: 'Unauthorized', message: 'Invalid or missing API key' });
    return true;
  }

  const rl = limiter.check(apiKey.id);
  if (!rl.allowed) {
    log.log('api-v1', `rate limit exceeded for key ${apiKey.id}`);
    jsonResponse(res, 429, { error: 'Too Many Requests', message: 'Rate limit exceeded', retry_after: rl.retryAfter }, rateLimitHeaders(rl));
    return true;
  }

  const ctx = {
    req, res, url, db, config,
    apiKey,
    readBody,
    hasScope,
    json: (code, body) => jsonResponse(res, code, body, rateLimitHeaders(rl)),
  };

  try {
    for (const mod of RESOURCE_MODULES) {
      if (await mod.handle(ctx)) return true;
    }
  } catch (err) {
    // Request size limits (DoS hardening): readBody() rejects once the body exceeds its cap —
    // that's a client error (413), not a server fault (500).
    if (MAX_BODY_ERROR.test(err.message)) {
      jsonResponse(res, 413, { error: 'Payload Too Large', message: 'Request body exceeds the size limit' }, rateLimitHeaders(rl));
      return true;
    }
    log.error('api-v1', `unhandled error in ${req.method} ${url.pathname}`, err);
    jsonResponse(res, 500, { error: 'Internal Server Error', message: 'An unexpected error occurred' }, rateLimitHeaders(rl));
    return true;
  }

  jsonResponse(res, 404, { error: 'Not Found', message: 'Resource not found' });
  return true;
}
